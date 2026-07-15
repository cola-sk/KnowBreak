"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { readImageFileFromClipboard } from "@/lib/clipboard-image";
import { buildContextualImagePrompt } from "@/lib/image-generation-prompt";
import {
  FALLBACK_IMAGE_RUNTIME_DEFAULTS,
  type ImageRuntimeDefaults,
} from "@/lib/tts-settings";
import type { ReviewFile, ReviewItemStatus } from "@/lib/types";

interface ImageEntry {
  image_path: string;
  provider?: string;
  mode?: string;
  query?: string;
  prompt?: string;
  source_url?: string;
  creator?: string;
  license?: string;
  model?: string;
}

interface ShotImageEntry extends ImageEntry {
  shot_index: number;
}

interface TopicImages {
  topic_index: number;
  title: string;
  cover?: ImageEntry;
  shots: ShotImageEntry[];
}

interface ScriptLine {
  text: string;
  estimated_seconds: number;
}

interface ScriptArtifact {
  scripts: Array<{
    topic_index: number;
    title: string;
    lines: ScriptLine[];
  }>;
}

interface StoryboardShot {
  index: number;
  narration: string;
  visual: string;
  broll: string;
  subtitle: string;
  duration: number;
}

interface StoryboardArtifact {
  storyboards: Array<{
    topic_index: number;
    title: string;
    shots: StoryboardShot[];
  }>;
}

export interface ImageReviewPayload {
  artifact: TopicImages[];
  review: ReviewFile;
}

export interface ImageReviewContext {
  script?: ScriptArtifact | null;
  storyboard?: StoryboardArtifact | null;
}

interface Props {
  videoId: string;
  version: string;
  initial: ImageReviewPayload;
  context?: ImageReviewContext;
  readOnly?: boolean;
  imageDefaults?: ImageRuntimeDefaults;
}

interface CropEditorState {
  itemId: string;
  title: string;
  objectUrl: string;
  fileName: string;
}

type PromptSource = "visual" | "narration" | "script" | "query" | "prompt" | "fallback";

interface PromptSources {
  visual?: string;
  narration?: string;
  script?: string;
  broll?: string;
  subtitle?: string;
  query?: string;
  prompt?: string;
  fallback?: string;
}

interface GenerateEditorState {
  itemId: string;
  title: string;
  prompt: string;
  provider: string;
  model: string;
  promptSource: PromptSource;
  sources: PromptSources;
  useContextPrompt: boolean;
  previewImageBase64?: string;
  previewContentType?: string;
  previewMetadata?: GeneratedImageMetadata;
}

const PROMPT_SOURCE_LABELS: Record<PromptSource, string> = {
  visual: "分镜画面",
  narration: "旁白",
  script: "口播文案",
  query: "搜索词",
  prompt: "原 prompt",
  fallback: "默认提示词",
};

interface GeneratedImageMetadata {
  provider: string;
  mode: "generate";
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  source_url?: string;
  creator?: string;
  license?: string;
}

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

const ITEM_STATUSES: ReviewItemStatus[] = [
  "pending",
  "approved",
  "rejected",
  "modified",
  "regenerated",
];

const VIEWPORT_SIZE: Size = {
  width: 360,
  height: 640,
};

const IMAGE_PROVIDER_OPTIONS = [
  { value: "pollinations", label: "Pollinations", defaultModel: "" },
  { value: "cloudflare_workers", label: "Cloudflare Workers AI", defaultModel: "@cf/black-forest-labs/flux-1-schnell" },
  { value: "huggingface", label: "Hugging Face", defaultModel: "black-forest-labs/FLUX.1-schnell" },
];

function defaultModelForProvider(provider: string): string {
  return IMAGE_PROVIDER_OPTIONS.find((option) => option.value === provider)?.defaultModel ?? "";
}

function defaultGenerationProvider(providers: string[]): string {
  return providers.find((provider) => IMAGE_PROVIDER_OPTIONS.some((option) => option.value === provider)) ?? "pollinations";
}

function imageModelForProvider(provider: string, settings: ImageRuntimeDefaults): string {
  if (provider === "pollinations") {
    return settings.pollinationsModel;
  }
  if (provider === "cloudflare_workers") {
    return settings.cloudflareModel;
  }
  if (provider === "huggingface") {
    return settings.huggingfaceModel;
  }
  return defaultModelForProvider(provider);
}

function statusClass(status: string): string {
  if (status === "approved") {
    return "badge approved";
  }
  if (status === "rejected") {
    return "badge rejected";
  }
  if (status === "in_review") {
    return "badge in_review";
  }
  return "badge";
}

function imageAssetUrl(relativePath: string, versionToken?: string): string {
  const encoded = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const suffix = versionToken ? `?v=${encodeURIComponent(versionToken)}` : "";
  return `/api/assets/${encoded}${suffix}`;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function minCoverScale(size: Size): number {
  return Math.max(VIEWPORT_SIZE.width / size.width, VIEWPORT_SIZE.height / size.height);
}

function clampOffset(offset: Point, size: Size, scale: number): Point {
  const displayWidth = size.width * scale;
  const displayHeight = size.height * scale;
  const maxX = Math.max(0, (displayWidth - VIEWPORT_SIZE.width) / 2);
  const maxY = Math.max(0, (displayHeight - VIEWPORT_SIZE.height) / 2);

  return {
    x: Math.max(-maxX, Math.min(maxX, offset.x)),
    y: Math.max(-maxY, Math.min(maxY, offset.y)),
  };
}

export function ImageReviewClient({
  videoId,
  version,
  initial,
  context,
  readOnly = false,
  imageDefaults = FALLBACK_IMAGE_RUNTIME_DEFAULTS,
}: Props) {
  const [data, setData] = useState<ImageReviewPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<CropEditorState | null>(null);
  const [generateEditor, setGenerateEditor] = useState<GenerateEditorState | null>(null);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [generatingItemId, setGeneratingItemId] = useState<string | null>(null);

  const totalImages = useMemo(
    () =>
      data.artifact.reduce(
        (acc, topic) => acc + (topic.cover ? 1 : 0) + (Array.isArray(topic.shots) ? topic.shots.length : 0),
        0,
      ),
    [data.artifact],
  );

  const closeEditor = () => {
    setEditor((prev) => {
      if (prev?.objectUrl.startsWith("blob:")) {
        URL.revokeObjectURL(prev.objectUrl);
      }
      return null;
    });
  };

  const openGenerateEditor = (
    itemId: string,
    title: string,
    image: ImageEntry,
    shotCtx?: { line?: ScriptLine; shot?: StoryboardShot },
  ) => {
    const sources: PromptSources = {
      visual: shotCtx?.shot?.visual?.trim() || undefined,
      narration: shotCtx?.shot?.narration?.trim() || undefined,
      script: shotCtx?.line?.text?.trim() || undefined,
      broll: shotCtx?.shot?.broll?.trim() || undefined,
      subtitle: shotCtx?.shot?.subtitle?.trim() || undefined,
      query: image.query?.trim() || undefined,
      prompt: image.prompt?.trim() || undefined,
      fallback: `${title}, vertical 9:16 documentary science image`,
    };
    const defaultSource: PromptSource = sources.visual
      ? "visual"
      : sources.narration
        ? "narration"
        : sources.script
          ? "script"
          : sources.query
            ? "query"
            : sources.prompt
              ? "prompt"
              : "fallback";
    const initialPrompt = sources[defaultSource] || "";
    const savedProvider = typeof window !== "undefined" ? window.localStorage.getItem("kb_last_image_provider") : null;
    const savedModel = typeof window !== "undefined" ? window.localStorage.getItem("kb_last_image_model") : null;
    const provider = savedProvider || defaultGenerationProvider(imageDefaults.providers);
    const model = savedModel !== null ? savedModel : imageModelForProvider(provider, imageDefaults);

    setGenerateEditor({
      itemId,
      title,
      prompt: initialPrompt,
      provider,
      model,
      promptSource: defaultSource,
      sources,
      useContextPrompt: true,
    });
    setMessage("");
  };

  const openEditorForFile = (itemId: string, title: string, file: File) => {
    if (!isImageFile(file)) {
      setMessage("只支持图片文件。请上传 jpg/png/webp 等格式。");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setEditor((prev) => {
      if (prev?.objectUrl.startsWith("blob:")) {
        URL.revokeObjectURL(prev.objectUrl);
      }
      return {
        itemId,
        title,
        objectUrl,
        fileName: file.name || "pasted-image.jpg",
      };
    });
    setMessage("");
  };

  const replaceEditorSource = (file: File) => {
    if (!editor) {
      return;
    }
    openEditorForFile(editor.itemId, editor.title, file);
  };

  useEffect(() => {
    if (!editor) {
      return;
    }

    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }
      for (const item of items) {
        if (!item.type.startsWith("image/")) {
          continue;
        }
        const file = item.getAsFile();
        if (!file) {
          continue;
        }
        event.preventDefault();
        replaceEditorSource(file);
        return;
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [editor]);

  useEffect(() => {
    return () => {
      if (editor?.objectUrl.startsWith("blob:")) {
        URL.revokeObjectURL(editor.objectUrl);
      }
    };
  }, [editor]);

  const patchReviewItem = (id: string, patch: Partial<{ status: ReviewItemStatus; notes: string }>) => {
    setData((prev) => ({
      ...prev,
      review: {
        ...prev.review,
        status: "in_review",
        items: prev.review.items.map((item) =>
          item.id === id
            ? {
                ...item,
                ...patch,
              }
            : item,
        ),
      },
    }));
  };

  const saveReview = async () => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${videoId}/${version}/images`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          review: {
            status: data.review.status,
            items: data.review.items,
          },
        }),
      });
      const next = (await response.json()) as ImageReviewPayload | { error: string };
      if (!response.ok) {
        throw new Error("error" in next ? next.error : "保存失败");
      }
      setData(next as ImageReviewPayload);
      setMessage("图片审核状态已保存。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${videoId}/${version}/reviews/image_review/approve`, {
        method: "POST",
      });
      const result = (await response.json()) as { review?: ReviewFile; error?: string };
      if (!response.ok || !result.review) {
        throw new Error(result.error ?? "通过失败");
      }
      setData((prev) => ({ ...prev, review: result.review! }));
      setMessage("图片审核已通过。可以继续后续 TTS/合成阶段。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通过失败");
    } finally {
      setSaving(false);
    }
  };

  const uploadCroppedImage = async (blob: Blob) => {
    if (!editor) {
      return;
    }

    setSaving(true);
    setUploadingItemId(editor.itemId);
    setMessage("");

    try {
      const form = new FormData();
      form.append("itemId", editor.itemId);
      form.append("file", blob, "replacement.jpg");

      const response = await fetch(`/api/projects/${videoId}/${version}/images/replace`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as
        | (ImageReviewPayload & { imagePath: string })
        | { error: string };

      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "替换失败");
      }
      const successPayload = payload as ImageReviewPayload & { imagePath: string };

      setData({
        artifact: successPayload.artifact,
        review: successPayload.review,
      });
      setMessage(`图片已替换并保存：${successPayload.imagePath}`);
      closeEditor();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "替换失败");
    } finally {
      setSaving(false);
      setUploadingItemId(null);
    }
  };

  const generatePreviewImage = async () => {
    if (!generateEditor) {
      return;
    }
    const rawPrompt = generateEditor.prompt.trim();
    if (!rawPrompt) {
      setMessage("请输入生图提示词。");
      return;
    }
    const prompt = generateEditor.useContextPrompt
      ? buildContextualImagePrompt({
          corePrompt: rawPrompt,
          itemTitle: generateEditor.title,
          promptSource: generateEditor.promptSource,
          sources: generateEditor.sources,
        })
      : rawPrompt;

    setSaving(true);
    setGeneratingItemId(generateEditor.itemId);
    setMessage("");

    try {
      const response = await fetch(`/api/projects/${videoId}/${version}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          provider: generateEditor.provider,
          model: generateEditor.model || undefined,
          prompt,
        }),
      });
      const payload = (await response.json()) as
        | {
            preview?: {
              imageBase64: string;
              contentType: string;
              metadata: GeneratedImageMetadata;
            };
          }
        | { error: string };

      if (!response.ok || !("preview" in payload) || !payload.preview) {
        throw new Error("error" in payload ? payload.error : "生成失败");
      }
      setGenerateEditor((prev) => prev
        ? {
            ...prev,
            previewImageBase64: payload.preview!.imageBase64,
            previewContentType: payload.preview!.contentType,
            previewMetadata: payload.preview!.metadata,
          }
        : prev);
      setMessage("AI 图片已生成预览，确认后点击插入替换。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成失败");
    } finally {
      setSaving(false);
      setGeneratingItemId(null);
    }
  };

  const insertGeneratedImage = async () => {
    if (!generateEditor?.previewImageBase64 || !generateEditor.previewMetadata) {
      setMessage("请先生成预览图。");
      return;
    }

    setSaving(true);
    setGeneratingItemId(generateEditor.itemId);
    setMessage("");

    try {
      const response = await fetch(`/api/projects/${videoId}/${version}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "insert",
          itemId: generateEditor.itemId,
          imageBase64: generateEditor.previewImageBase64,
          metadata: generateEditor.previewMetadata,
        }),
      });
      const payload = (await response.json()) as
        | (ImageReviewPayload & { imagePath: string })
        | { error: string };

      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "插入失败");
      }
      const successPayload = payload as ImageReviewPayload & { imagePath: string };

      setData({
        artifact: successPayload.artifact,
        review: successPayload.review,
      });
      setGenerateEditor(null);
      setMessage(`AI 图片已插入并替换本地文件：${successPayload.imagePath}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "插入失败");
    } finally {
      setSaving(false);
      setGeneratingItemId(null);
    }
  };

  const findItem = (id: string) => {
    return data.review.items.find((item) => item.id === id);
  };

  const shotContext = (topicIndex: number, shotIndex: number) => {
    const script = context?.script?.scripts.find((item) => item.topic_index === topicIndex);
    const storyboard = context?.storyboard?.storyboards.find((item) => item.topic_index === topicIndex);
    const shot = storyboard?.shots.find((item) => item.index === shotIndex);
    const line = script?.lines[shotIndex];
    return { line, shot };
  };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>图片审核</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            topics: {data.artifact.length}, images: {totalImages}
          </div>
        </div>
        <div className="row">
          <span className={readOnly ? "badge" : statusClass(data.review.status)}>
            {readOnly ? "只读" : data.review.status}
          </span>
          {!readOnly ? <span className="badge">updated: {new Date(data.review.updated_at).toLocaleString()}</span> : null}
        </div>
      </div>

      {!readOnly ? (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="secondary" disabled={saving} onClick={saveReview}>
            保存图片审核
          </button>
          {data.review.status === "approved" ? (
            <span className="approved-pill">已通过</span>
          ) : (
            <button className="approve-btn" disabled={saving} onClick={approve}>
              通过图片审核
            </button>
          )}
        </div>
      ) : null}

      {message ? <div style={{ marginTop: 10, color: "var(--muted)" }}>{message}</div> : null}

      <div style={{ marginTop: 14, display: "grid", gap: 16 }}>
        {data.artifact.map((topic) => (
          <section
            key={`topic-${topic.topic_index}`}
            style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}
          >
            <div style={{ fontWeight: 700 }}>
              #{topic.topic_index} {topic.title}
            </div>
            <div className="grid" style={{ marginTop: 10 }}>
              {topic.cover ? (
                <ImageCard
                  title="cover"
                  image={topic.cover}
                  item={findItem(`topic_${topic.topic_index}_cover`)}
                  onChange={patchReviewItem}
                  itemId={`topic_${topic.topic_index}_cover`}
                  imageVersionToken={data.review.updated_at}
                  onReplaceFile={openEditorForFile}
                  onGenerate={openGenerateEditor}
                  replacing={uploadingItemId === `topic_${topic.topic_index}_cover`}
                  generating={generatingItemId === `topic_${topic.topic_index}_cover`}
                  readOnly={readOnly}
                />
              ) : null}
              {topic.shots.map((shot) => {
                const id = `topic_${topic.topic_index}_shot_${shot.shot_index}`;
                const related = shotContext(topic.topic_index, shot.shot_index);
                return (
                  <ImageCard
                    key={id}
                    title={`shot_${shot.shot_index}`}
                    image={shot}
                    shotContext={related}
                    item={findItem(id)}
                    onChange={patchReviewItem}
                    itemId={id}
                    imageVersionToken={data.review.updated_at}
                    onReplaceFile={openEditorForFile}
                    onGenerate={openGenerateEditor}
                    replacing={uploadingItemId === id}
                    generating={generatingItemId === id}
                    readOnly={readOnly}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {editor && !readOnly ? (
        <ImageCropModal
          editor={editor}
          busy={saving}
          onClose={closeEditor}
          onSave={uploadCroppedImage}
          onPickAnother={replaceEditorSource}
        />
      ) : null}
      {generateEditor && !readOnly ? (
        <ImageGenerateModal
          editor={generateEditor}
          busy={saving}
          onChange={setGenerateEditor}
          onClose={() => setGenerateEditor(null)}
          onGeneratePreview={generatePreviewImage}
          onInsert={insertGeneratedImage}
          imageDefaults={imageDefaults}
        />
      ) : null}
    </div>
  );
}

interface ImageCardProps {
  title: string;
  image: ImageEntry;
  shotContext?: {
    line?: ScriptLine;
    shot?: StoryboardShot;
  };
  itemId: string;
  item: { status: ReviewItemStatus; notes: string } | undefined;
  onChange: (id: string, patch: Partial<{ status: ReviewItemStatus; notes: string }>) => void;
  imageVersionToken: string;
  onReplaceFile: (itemId: string, title: string, file: File) => void;
  onGenerate: (itemId: string, title: string, image: ImageEntry, shotContext?: { line?: ScriptLine; shot?: StoryboardShot }) => void;
  replacing: boolean;
  generating: boolean;
  readOnly?: boolean;
}

function ImageCard({
  title,
  image,
  shotContext,
  itemId,
  item,
  onChange,
  imageVersionToken,
  onReplaceFile,
  onGenerate,
  replacing,
  generating,
  readOnly = false,
}: ImageCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pasteMessage, setPasteMessage] = useState("");

  const pasteFromClipboard = async () => {
    setPasteMessage("");
    try {
      const file = await readImageFileFromClipboard();
      if (!file) {
        setPasteMessage("未读取到剪贴板图片。请先复制图片，再点击粘贴图片。");
        return;
      }
      onReplaceFile(itemId, title, file);
    } catch {
      setPasteMessage("浏览器未允许直接读取剪贴板。可先点上传，或在裁剪弹窗里按 Ctrl/Cmd + V。");
    }
  };

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <span className="badge">{image.provider ?? "unknown"}</span>
      </div>

      <img
        src={imageAssetUrl(image.image_path, imageVersionToken)}
        alt={title}
        style={{
          width: "100%",
          aspectRatio: "9 / 16",
          objectFit: "cover",
          borderRadius: 10,
          border: "1px solid var(--line)",
          marginTop: 8,
        }}
      />

      {shotContext?.line || shotContext?.shot ? (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 10,
            marginTop: 8,
            display: "grid",
            gap: 8,
            background: "rgba(255,255,255,0.02)",
          }}
        >
          {shotContext.line ? (
            <ContextBlock label="口播文本" value={shotContext.line.text} />
          ) : null}
          {shotContext.shot ? (
            <>
              <ContextBlock label="分镜画面" value={shotContext.shot.visual} />
              <ContextBlock label="B-roll" value={shotContext.shot.broll} />
              <ContextBlock label="字幕" value={shotContext.shot.subtitle} />
            </>
          ) : null}
        </div>
      ) : null}

      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8, lineHeight: 1.4 }}>
        <div>mode: {image.mode ?? "-"}</div>
        <div>query: {image.query ?? "-"}</div>
        <div>prompt: {image.prompt ?? "-"}</div>
        <div>model: {image.model ?? "-"}</div>
        <div>creator: {image.creator ?? "-"}</div>
        <div style={{ wordBreak: "break-all" }}>source: {image.source_url ?? "-"}</div>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>status</label>
        <select
          value={item?.status ?? "pending"}
          disabled={readOnly}
          onChange={(event) =>
            onChange(itemId, { status: event.target.value as ReviewItemStatus })
          }
        >
          {ITEM_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>notes</label>
        <textarea
          value={item?.notes ?? ""}
          readOnly={readOnly}
          onChange={(event) => onChange(itemId, { notes: event.target.value })}
        />
      </div>

      {!readOnly ? (
        <>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="secondary" onClick={() => onChange(itemId, { status: "approved" })}>
              通过此图
            </button>
            <button className="secondary" onClick={() => onChange(itemId, { status: "rejected" })}>
              标记问题
            </button>
          </div>

          <div className="row" style={{ marginTop: 8 }}>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) {
                  return;
                }
                onReplaceFile(itemId, title, file);
                event.currentTarget.value = "";
              }}
            />
            <button className="secondary" disabled={replacing} onClick={() => inputRef.current?.click()}>
              {replacing ? "替换中..." : "上传并裁剪"}
            </button>
            <button className="secondary" disabled={generating} onClick={() => onGenerate(itemId, title, image, shotContext)}>
              {generating ? "生成中..." : "AI 生成替换"}
            </button>
            <button className="secondary" disabled={replacing} onClick={pasteFromClipboard}>
              粘贴图片
            </button>
          </div>
        </>
      ) : null}
      {pasteMessage ? (
        <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12, lineHeight: 1.4 }}>
          {pasteMessage}
        </div>
      ) : null}
    </div>
  );
}

function ContextBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{value || "-"}</div>
    </div>
  );
}

interface ImageGenerateModalProps {
  editor: GenerateEditorState;
  busy: boolean;
  onChange: (next: GenerateEditorState) => void;
  onClose: () => void;
  onGeneratePreview: () => Promise<void>;
  onInsert: () => Promise<void>;
  imageDefaults: ImageRuntimeDefaults;
}

function ImageGenerateModal({ editor, busy, onChange, onClose, onGeneratePreview, onInsert, imageDefaults }: ImageGenerateModalProps) {
  const previewSrc = editor.previewImageBase64
    ? `data:${editor.previewContentType ?? "image/jpeg"};base64,${editor.previewImageBase64}`
    : "";
  const effectivePrompt = editor.useContextPrompt
    ? buildContextualImagePrompt({
        corePrompt: editor.prompt,
        itemTitle: editor.title,
        promptSource: editor.promptSource,
        sources: editor.sources,
      })
    : editor.prompt;

  return (
    <div className="image-lightbox-backdrop" role="dialog" aria-modal="true">
      <div className="image-lightbox image-generate-modal" style={{ maxWidth: 1000 }}>
        <div className="image-lightbox-head">
          <div>
            <div style={{ fontWeight: 700 }}>AI 生成替换</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{editor.title}</div>
          </div>
          <button className="secondary" disabled={busy} onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="image-generate-body">
          <div className="image-generate-form">
            <div className="image-generate-form-row">
              <div className="form-row">
                <label className="form-label">provider</label>
                <select
                  value={editor.provider}
                  disabled={busy}
                  onChange={(event) => {
                    const provider = event.target.value;
                    const model = imageModelForProvider(provider, imageDefaults);
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem("kb_last_image_provider", provider);
                      window.localStorage.setItem("kb_last_image_model", model);
                    }
                    onChange({
                      ...editor,
                      provider,
                      model,
                      previewImageBase64: undefined,
                      previewContentType: undefined,
                      previewMetadata: undefined,
                    });
                  }}
                >
                  {IMAGE_PROVIDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label className="form-label">model</label>
                <input
                  value={editor.model}
                  disabled={busy}
                  placeholder="使用 provider 默认模型"
                  onChange={(event) => {
                    const model = event.target.value;
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem("kb_last_image_model", model);
                    }
                    onChange({
                      ...editor,
                      model,
                      previewImageBase64: undefined,
                      previewContentType: undefined,
                      previewMetadata: undefined,
                    });
                  }}
                />
              </div>
            </div>

            <div className="image-generate-form-row">
              <div className="form-row">
                <label className="form-label">文案来源</label>
                <select
                  value={editor.promptSource}
                  disabled={busy}
                  onChange={(event) => {
                    const nextSource = event.target.value as PromptSource;
                    const nextPrompt = editor.sources[nextSource];
                    onChange({
                      ...editor,
                      promptSource: nextSource,
                      prompt: nextPrompt ?? editor.prompt,
                      previewImageBase64: undefined,
                      previewContentType: undefined,
                      previewMetadata: undefined,
                    });
                  }}
                >
                  {(Object.keys(PROMPT_SOURCE_LABELS) as PromptSource[]).map((source) => {
                    const value = editor.sources[source];
                    return (
                      <option key={source} value={source} disabled={!value}>
                        {PROMPT_SOURCE_LABELS[source]}
                        {value ? "" : "（无）"}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="form-row image-generate-checkbox-container">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editor.useContextPrompt}
                    disabled={busy}
                    onChange={(event) => onChange({
                      ...editor,
                      useContextPrompt: event.target.checked,
                      previewImageBase64: undefined,
                      previewContentType: undefined,
                      previewMetadata: undefined,
                    })}
                  />
                  <span>上下文增强</span>
                </label>
              </div>
            </div>

            <div className="form-row">
              <label className="form-label">prompt</label>
              <textarea
                value={editor.prompt}
                disabled={busy}
                rows={4}
                onChange={(event) => onChange({
                  ...editor,
                  prompt: event.target.value,
                  previewImageBase64: undefined,
                  previewContentType: undefined,
                  previewMetadata: undefined,
                })}
              />
            </div>

            {editor.useContextPrompt ? (
              <div className="form-row">
                <label className="form-label">最终发送 prompt</label>
                <textarea value={effectivePrompt} readOnly rows={5} />
              </div>
            ) : null}
          </div>

          <div className="image-generate-preview-container">
            <div className="image-generate-preview-slot">
              {previewSrc ? (
                <img src={previewSrc} alt="AI 生成预览" />
              ) : (
                <div className={`empty ${busy ? "empty-loading" : ""}`}>
                  {busy ? "生成中..." : "尚未生成预览，点击下方按钮开始"}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="image-generate-footer">
          <button className="secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="secondary" disabled={busy} onClick={onGeneratePreview}>
            {busy ? "生成中..." : previewSrc ? "重新生成预览" : "生成预览"}
          </button>
          <button className="approve-btn" disabled={busy || !previewSrc} onClick={onInsert}>
            {busy ? "插入中..." : "插入替换"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ImageCropModalProps {
  editor: CropEditorState;
  busy: boolean;
  onClose: () => void;
  onSave: (blob: Blob) => Promise<void>;
  onPickAnother: (file: File) => void;
}

function ImageCropModal({ editor, busy, onClose, onSave, onPickAnother }: ImageCropModalProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffset: Point;
  } | null>(null);

  const [size, setSize] = useState<Size | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [localMessage, setLocalMessage] = useState("");

  const minScale = useMemo(() => {
    if (!size) {
      return 1;
    }
    return minCoverScale(size);
  }, [size]);

  const maxScale = Math.max(minScale * 4, minScale + 0.1);

  useEffect(() => {
    setSize(null);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setLocalMessage("");
  }, [editor.objectUrl]);

  const onImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const natural: Size = {
      width: event.currentTarget.naturalWidth,
      height: event.currentTarget.naturalHeight,
    };
    const firstScale = minCoverScale(natural);
    setSize(natural);
    setScale(firstScale);
    setOffset({ x: 0, y: 0 });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!size) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offset,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!size || !dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    const nextOffset = {
      x: dragRef.current.startOffset.x + dx,
      y: dragRef.current.startOffset.y + dy,
    };
    setOffset(clampOffset(nextOffset, size, scale));
  };

  const clearDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const updateScale = (nextScale: number) => {
    if (!size) {
      return;
    }
    setScale(nextScale);
    setOffset((prev) => clampOffset(prev, size, nextScale));
  };

  const saveCropped = async () => {
    if (!size || !imageRef.current) {
      return;
    }

    setLocalMessage("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Canvas is not supported");
      }

      const displayWidth = size.width * scale;
      const displayHeight = size.height * scale;
      const left = (VIEWPORT_SIZE.width - displayWidth) / 2 + offset.x;
      const top = (VIEWPORT_SIZE.height - displayHeight) / 2 + offset.y;

      const cropWidth = VIEWPORT_SIZE.width / scale;
      const cropHeight = VIEWPORT_SIZE.height / scale;
      const sourceX = Math.max(0, Math.min((0 - left) / scale, size.width - cropWidth));
      const sourceY = Math.max(0, Math.min((0 - top) / scale, size.height - cropHeight));

      ctx.drawImage(
        imageRef.current,
        sourceX,
        sourceY,
        cropWidth,
        cropHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => {
            if (!value) {
              reject(new Error("Failed to generate cropped image"));
              return;
            }
            resolve(value);
          },
          "image/jpeg",
          0.92,
        );
      });

      await onSave(blob);
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : "裁剪保存失败");
    }
  };

  const pasteAnother = async () => {
    setLocalMessage("");
    try {
      const file = await readImageFileFromClipboard();
      if (!file) {
        setLocalMessage("未读取到剪贴板图片。请先复制图片，再点击从剪贴板换图。");
        return;
      }
      onPickAnother(file);
    } catch {
      setLocalMessage("浏览器未允许直接读取剪贴板。请按 Ctrl/Cmd + V，或选择本地图片。");
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(0, 0, 0, 0.52)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div className="panel" style={{ width: "min(980px, 100%)", padding: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>替换并裁剪：{editor.title}</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              文件：{editor.fileName}。支持拖拽调整画面；粘贴剪切板图片请直接按 Ctrl/Cmd + V。
            </div>
          </div>
          <button className="secondary" disabled={busy} onClick={onClose}>
            关闭
          </button>
        </div>

        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "minmax(300px, 360px) 1fr",
            gap: 16,
          }}
        >
          <div>
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={clearDragging}
              onPointerCancel={clearDragging}
              style={{
                width: VIEWPORT_SIZE.width,
                maxWidth: "100%",
                aspectRatio: "9 / 16",
                borderRadius: 12,
                border: "1px solid var(--line)",
                overflow: "hidden",
                position: "relative",
                background: "#0f172a",
                touchAction: "none",
                cursor: "grab",
              }}
            >
              <img
                ref={imageRef}
                src={editor.objectUrl}
                alt={editor.title}
                onLoad={onImageLoad}
                draggable={false}
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  width: size ? `${size.width * scale}px` : "auto",
                  height: size ? `${size.height * scale}px` : "auto",
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                  userSelect: "none",
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>

          <div style={{ display: "grid", alignContent: "start", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>缩放</label>
              <input
                type="range"
                min={minScale}
                max={maxScale}
                step={(maxScale - minScale) / 200 || 0.01}
                value={scale}
                onChange={(event) => updateScale(Number(event.target.value))}
                disabled={!size || busy}
              />
              <div style={{ color: "var(--muted)", fontSize: 12 }}>scale: {scale.toFixed(3)}</div>
            </div>

            <div className="row">
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) {
                    return;
                  }
                  onPickAnother(file);
                  event.currentTarget.value = "";
                }}
              />
              <button className="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
                选择另一张图
              </button>
              <button className="secondary" disabled={busy} onClick={pasteAnother}>
                从剪贴板换图
              </button>
              <button className="primary" disabled={busy || !size} onClick={saveCropped}>
                保存裁剪并替换
              </button>
            </div>

            {localMessage ? <div style={{ color: "var(--danger)", fontSize: 13 }}>{localMessage}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
