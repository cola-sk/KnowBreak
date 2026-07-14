"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { countOverrideLeaves, deepMerge, ProjectProfileConfigModal } from "@/components/profile-editor";
import { TtsSettingsPanel } from "@/components/tts-settings-panel";
import { readImageFileFromClipboard } from "@/lib/clipboard-image";
import { buildContextualImagePrompt } from "@/lib/image-generation-prompt";
import type { RegenerationJob, RegenerationJobDetail, ReviewFile, ReviewStage } from "@/lib/types";
import {
  compactRuntimeOverrides,
  countRuntimeOverrideLeaves,
  effectiveTtsSettings,
  saveTtsHistoryItem,
  type ProjectRuntimeOverrides,
  type TtsRuntimeDefaults,
} from "@/lib/tts-settings";

interface ScriptLine {
  text: string;
  estimated_seconds: number;
}

interface ScriptItem {
  topic_index: number;
  title: string;
  cover_narration?: string;
  lines: ScriptLine[];
  total_duration?: number;
  hashtags?: string[];
}

interface ScriptArtifact {
  video_id: string;
  scripts: ScriptItem[];
}

interface Shot {
  index: number;
  narration: string;
  visual: string;
  broll: string;
  subtitle: string;
  duration: number;
}

interface StoryboardItem {
  topic_index: number;
  title: string;
  shots: Shot[];
}

interface StoryboardArtifact {
  video_id: string;
  storyboards: StoryboardItem[];
}

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

interface ComposeVideo {
  topic_index: number;
  title: string;
  path: string;
  duration?: number;
  intro_duration?: number;
}

export interface ProductionReviewPayload {
  videoId: string;
  version: string;
  title: string;
  versionDir: string;
  source: string;
  workflow: string;
  workflowSteps: string[];
  videos: ComposeVideo[];
  artifacts: {
    script: ScriptArtifact | null;
    storyboard: StoryboardArtifact | null;
    images: TopicImages[] | null;
    compose: unknown | null;
  };
  reviews: Partial<Record<ReviewStage, ReviewFile>>;
  job: RegenerationJob | null;
  regenerationJobs: RegenerationJob[];
  projectOverrides?: Record<string, any>;
  runtimeOverrides?: ProjectRuntimeOverrides;
}

interface Props {
  initial: ProductionReviewPayload;
  profileBase: Record<string, unknown>;
  globalOverrides: Record<string, unknown>;
  ttsDefaults: TtsRuntimeDefaults;
}

interface CropEditorState {
  itemId: string;
  title: string;
  objectUrl: string;
  fileName: string;
}

type PromptSource = "visual" | "narration" | "script" | "query" | "prompt" | "title" | "fallback";

interface PromptSources {
  visual?: string;
  narration?: string;
  script?: string;
  broll?: string;
  subtitle?: string;
  query?: string;
  prompt?: string;
  title?: string;
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

interface LightboxState {
  title: string;
  src: string;
}

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

const VIEWPORT_SIZE: Size = {
  width: 360,
  height: 640,
};

const IMAGE_PROVIDER_OPTIONS = [
  { value: "pollinations", label: "Pollinations", defaultModel: "" },
  { value: "cloudflare_workers", label: "Cloudflare Workers AI", defaultModel: "@cf/black-forest-labs/flux-1-schnell" },
  { value: "huggingface", label: "Hugging Face", defaultModel: "black-forest-labs/FLUX.1-schnell" },
];

const PROMPT_SOURCE_LABELS: Record<PromptSource, string> = {
  visual: "分镜画面",
  narration: "旁白",
  script: "口播文案",
  query: "搜索词",
  prompt: "原 prompt",
  title: "标题",
  fallback: "默认提示词",
};

function defaultModelForProvider(provider: string): string {
  return IMAGE_PROVIDER_OPTIONS.find((option) => option.value === provider)?.defaultModel ?? "";
}

function sourceText(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function firstAvailablePromptSource(sources: PromptSources, preferred: PromptSource[]): PromptSource {
  return preferred.find((source) => Boolean(sources[source])) ?? "fallback";
}

const STAGE_LABELS: Record<string, string> = {
  start: "从头开始",
  asr: "ASR/字幕",
  extract: "知识提取",
  topics: "选题",
  topic_seed: "主题播种",
  rewrite: "改写脚本",
  script: "脚本",
  storyboard: "分镜",
  assets: "资源清单",
  images: "图片",
  tts: "配音",
  compose: "合成视频",
};

function assetUrl(relativePath: string, token?: string): string {
  const encoded = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/assets/${encoded}${token ? `?v=${encodeURIComponent(token)}` : ""}`;
}

function statusClass(status: string | undefined): string {
  if (status === "approved") {
    return "badge approved";
  }
  if (status === "rejected" || status === "failed") {
    return "badge rejected";
  }
  if (status === "in_review" || status === "running") {
    return "badge in_review";
  }
  return "badge";
}

function uniqueStageOptions(steps: string[]): string[] {
  const preferred = [
    "asr",
    "extract",
    "topics",
    "topic_seed",
    "rewrite",
    "script",
    "storyboard",
    "assets",
    "images",
    "tts",
    "compose",
  ];
  if (steps.length === 0) {
    return ["start", "script", "storyboard", "images", "tts", "compose"];
  }
  const fromWorkflow = steps.filter((step) => !step.endsWith("_review"));
  return ["start", ...preferred.filter((step) => fromWorkflow.includes(step))];
}

function sourceInputApplies(startFrom: string): boolean {
  return startFrom === "start" || startFrom === "asr" || startFrom === "topic_seed";
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

export function ProductionReviewClient({ initial, profileBase, globalOverrides, ttsDefaults }: Props) {
  const [data, setData] = useState<ProductionReviewPayload>(initial);
  const [topicIndex, setTopicIndex] = useState<number>(initial.videos[0]?.topic_index ?? 0);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [replacingItemId, setReplacingItemId] = useState<string | null>(null);
  const [generatingItemId, setGeneratingItemId] = useState<string | null>(null);
  const [editor, setEditor] = useState<CropEditorState | null>(null);
  const [generateEditor, setGenerateEditor] = useState<GenerateEditorState | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"create" | "update">("update");
  const [startFrom, setStartFrom] = useState("tts");
  const [targetVersion, setTargetVersion] = useState("");
  const [source, setSource] = useState(initial.source);
  const [workflow, setWorkflow] = useState(initial.workflow);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>(() => new Date().toISOString());
  const [refreshing, setRefreshing] = useState(false);
  const [activeJobDetail, setActiveJobDetail] = useState<RegenerationJobDetail | null>(null);
  const [showJobLog, setShowJobLog] = useState(false);
  const [jobNotice, setJobNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const previousJobRef = useRef<{ id: string; status: RegenerationJob["status"] } | null>(null);

  // Project overrides state
  const [projectOverrides, setProjectOverrides] = useState<Record<string, any>>(() => initial.projectOverrides ?? {});
  const [runtimeOverrides, setRuntimeOverrides] = useState<ProjectRuntimeOverrides>(() => initial.runtimeOverrides ?? {});
  const [showConfig, setShowConfig] = useState(false);
  const inheritedProfile = useMemo(() => deepMerge(profileBase, globalOverrides), [profileBase, globalOverrides]);

  const selectedVideo = useMemo(() => {
    return data.videos.find((video) => video.topic_index === topicIndex) ?? data.videos[0] ?? null;
  }, [data.videos, topicIndex]);

  const selectedScript = useMemo(() => {
    return data.artifacts.script?.scripts.find((item) => item.topic_index === topicIndex) ?? null;
  }, [data.artifacts.script, topicIndex]);

  const selectedStoryboard = useMemo(() => {
    return data.artifacts.storyboard?.storyboards.find((item) => item.topic_index === topicIndex) ?? null;
  }, [data.artifacts.storyboard, topicIndex]);

  const selectedImages = useMemo(() => {
    return data.artifacts.images?.find((item) => item.topic_index === topicIndex) ?? null;
  }, [data.artifacts.images, topicIndex]);

  const stageOptions = useMemo(() => uniqueStageOptions(data.workflowSteps), [data.workflowSteps]);
  const sourceInputEnabled = sourceInputApplies(startFrom);
  const sourceInputLabel = data.workflowSteps.includes("asr") ? "source / 视频源" : "topic / 主题输入";
  const imageToken = data.reviews.image_review?.updated_at ?? data.job?.finishedAt ?? data.version;
  const workflowStageProgress = useMemo(() => {
    const artifactDone: Record<string, boolean> = {
      script: Boolean(data.artifacts.script),
      storyboard: Boolean(data.artifacts.storyboard),
      images: Boolean(data.artifacts.images),
      compose: Boolean(data.artifacts.compose),
      tts: Boolean(data.videos.length > 0 || data.artifacts.compose),
    };
    const steps = data.workflowSteps.filter((step) => !step.endsWith("_review"));
    const lastDoneIndex = steps.reduce((max, step, index) => artifactDone[step] ? Math.max(max, index) : max, -1);
    return steps.map((step, index) => ({
      stage: step,
      done: index <= lastDoneIndex || Boolean(artifactDone[step]),
    }));
  }, [data]);

  const refreshData = async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/projects/${data.videoId}/${data.version}/review`, { cache: "no-store" });
      const payload = (await response.json()) as ProductionReviewPayload | { error?: string };
      if (!response.ok || !("videoId" in payload)) {
        throw new Error("error" in payload ? payload.error ?? "刷新失败" : "刷新失败");
      }
      setData(payload);
      setSource(payload.source);
      setWorkflow(payload.workflow);
      setRuntimeOverrides(payload.runtimeOverrides ?? {});
      setLastRefreshedAt(new Date().toISOString());
      setIsDirty(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

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
    sources: PromptSources,
    preferredSources: PromptSource[],
  ) => {
    const promptSource = firstAvailablePromptSource(sources, preferredSources);
    const savedProvider = typeof window !== "undefined" ? window.localStorage.getItem("kb_last_image_provider") : null;
    const savedModel = typeof window !== "undefined" ? window.localStorage.getItem("kb_last_image_model") : null;
    const provider = savedProvider || "pollinations";
    const model = savedModel !== null ? savedModel : defaultModelForProvider(provider);

    setGenerateEditor({
      itemId,
      title,
      prompt: sources[promptSource] ?? "",
      provider,
      model,
      promptSource,
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

  useEffect(() => {
    if (data.job?.status !== "running") {
      setActiveJobDetail(null);
      return;
    }
    const jobId = data.job.id;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/projects/${data.videoId}/${data.version}/regenerate/${jobId}`, { cache: "no-store" });
        const payload = (await response.json()) as RegenerationJobDetail | { error?: string };
        if (!cancelled && response.ok && "job" in payload) {
          setActiveJobDetail(payload);
        }
      } catch {
        // swallow transient network errors during polling
      }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [data.job?.id, data.job?.status, data.videoId, data.version]);

  useEffect(() => {
    if (data.job?.status !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshData();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [data.job?.status, data.videoId, data.version]);

  useEffect(() => {
    const currentJob = data.job;
    const current = data.job ? { id: data.job.id, status: data.job.status } : null;
    const previous = previousJobRef.current;

    if (current?.status === "running" && (!previous || previous.id !== current.id)) {
      setJobNotice(null);
    }

    if (
      previous
      && current
      && previous.id === current.id
      && previous.status === "running"
      && current.status !== "running"
      && currentJob
    ) {
      if (current.status === "succeeded") {
        const hasSeparateTarget = Boolean(currentJob.targetVersion && currentJob.targetVersion !== data.version);
        setJobNotice({
          tone: "success",
          text: hasSeparateTarget
            ? `重生成已完成，已生成新版本 ${currentJob.targetVersion}。`
            : "重生成已完成，当前版本已更新。",
        });
      } else {
        setJobNotice({
          tone: "danger",
          text: currentJob.error ? `重生成失败：${currentJob.error}` : "重生成失败，请查看任务详情或日志。",
        });
      }
    }

    previousJobRef.current = current;
  }, [data.job, data.version]);

  const updateScriptLine = (lineIndex: number, key: keyof ScriptLine, value: string) => {
    setIsDirty(true);
    setData((prev) => {
      if (!prev.artifacts.script) {
        return prev;
      }
      const scripts = prev.artifacts.script.scripts.map((script) => {
        if (script.topic_index !== topicIndex) {
          return script;
        }
        return {
          ...script,
          lines: script.lines.map((line, idx) => {
            if (idx !== lineIndex) {
              return line;
            }
            if (key === "estimated_seconds") {
              const parsed = Number(value);
              return { ...line, estimated_seconds: Number.isFinite(parsed) ? parsed : line.estimated_seconds };
            }
            return { ...line, text: value };
          }),
        };
      });
      return {
        ...prev,
        artifacts: { ...prev.artifacts, script: { ...prev.artifacts.script, scripts } },
      };
    });
  };

  const updateScriptCoverNarration = (value: string) => {
    setIsDirty(true);
    setData((prev) => {
      if (!prev.artifacts.script) {
        return prev;
      }
      const scripts = prev.artifacts.script.scripts.map((script) => {
        if (script.topic_index !== topicIndex) {
          return script;
        }
        return { ...script, cover_narration: value };
      });
      return {
        ...prev,
        artifacts: { ...prev.artifacts, script: { ...prev.artifacts.script, scripts } },
      };
    });
  };

  const updateScriptTitle = (value: string) => {
    setIsDirty(true);
    setData((prev) => {
      const nextArtifacts = { ...prev.artifacts };
      if (prev.artifacts.script) {
        nextArtifacts.script = {
          ...prev.artifacts.script,
          scripts: prev.artifacts.script.scripts.map((script) =>
            script.topic_index === topicIndex ? { ...script, title: value } : script,
          ),
        };
      }
      if (prev.artifacts.storyboard) {
        nextArtifacts.storyboard = {
          ...prev.artifacts.storyboard,
          storyboards: prev.artifacts.storyboard.storyboards.map((board) =>
            board.topic_index === topicIndex ? { ...board, title: value } : board,
          ),
        };
      }
      if (prev.artifacts.images) {
        nextArtifacts.images = prev.artifacts.images.map((topic) =>
          topic.topic_index === topicIndex ? { ...topic, title: value } : topic,
        );
      }
      return {
        ...prev,
        artifacts: nextArtifacts,
        videos: prev.videos.map((video) =>
          video.topic_index === topicIndex ? { ...video, title: value } : video,
        ),
      };
    });
  };

  const updateShot = (shotIndex: number, key: keyof Shot, value: string) => {
    setIsDirty(true);
    setData((prev) => {
      if (!prev.artifacts.storyboard) {
        return prev;
      }
      const storyboards = prev.artifacts.storyboard.storyboards.map((board) => {
        if (board.topic_index !== topicIndex) {
          return board;
        }
        return {
          ...board,
          shots: board.shots.map((shot, idx) => {
            if (idx !== shotIndex) {
              return shot;
            }
            if (key === "duration" || key === "index") {
              const parsed = Number(value);
              return { ...shot, [key]: Number.isFinite(parsed) ? parsed : shot[key] };
            }
            return { ...shot, [key]: value };
          }),
        };
      });
      return {
        ...prev,
        artifacts: { ...prev.artifacts, storyboard: { ...prev.artifacts.storyboard, storyboards } },
      };
    });
  };

  const updateImage = (
    kind: "cover" | "shot",
    shotIndex: number | undefined,
    key: keyof ImageEntry,
    value: string,
  ) => {
    setIsDirty(true);
    setData((prev) => {
      if (!prev.artifacts.images) {
        return prev;
      }
      const images = prev.artifacts.images.map((topic) => {
        if (topic.topic_index !== topicIndex) {
          return topic;
        }
        if (kind === "cover" && topic.cover) {
          return { ...topic, cover: { ...topic.cover, [key]: value } };
        }
        return {
          ...topic,
          shots: topic.shots.map((shot) =>
            shot.shot_index === shotIndex ? { ...shot, [key]: value } : shot,
          ),
        };
      });
      return { ...prev, artifacts: { ...prev.artifacts, images } };
    });
  };

  const deleteImage = (kind: "cover" | "shot", shotIndex: number | undefined) => {
    setIsDirty(true);
    setData((prev) => {
      if (!prev.artifacts.images) {
        return prev;
      }
      const images = prev.artifacts.images.map((topic) => {
        if (topic.topic_index !== topicIndex) {
          return topic;
        }
        const cleared = {
          image_path: "",
          provider: "manual",
          mode: "",
          query: "",
          prompt: "",
          source_url: "",
          creator: "",
          license: "",
          model: "",
        };
        if (kind === "cover" && topic.cover) {
          return { ...topic, cover: cleared };
        }
        return {
          ...topic,
          shots: topic.shots.map((shot) =>
            shot.shot_index === shotIndex ? { ...shot, ...cleared } : shot,
          ),
        };
      });
      return { ...prev, artifacts: { ...prev.artifacts, images } };
    });
  };

  const persistEdits = async (): Promise<{
    artifacts: ProductionReviewPayload["artifacts"];
    reviews: ProductionReviewPayload["reviews"];
  }> => {
    const nextReviews: Partial<Record<ReviewStage, ReviewFile>> = { ...data.reviews };
    const nextArtifacts = { ...data.artifacts };

    if (data.artifacts.script) {
      const response = await fetch(`/api/projects/${data.videoId}/${data.version}/script`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifact: data.artifacts.script, review: { status: "in_review" } }),
      });
      const payload = (await response.json()) as { artifact?: ScriptArtifact; review?: ReviewFile; error?: string };
      if (!response.ok || !payload.artifact || !payload.review) {
        throw new Error(payload.error ?? "脚本保存失败");
      }
      nextArtifacts.script = payload.artifact;
      nextReviews.script_review = payload.review;
    }

    if (data.artifacts.storyboard) {
      const response = await fetch(`/api/projects/${data.videoId}/${data.version}/storyboard`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifact: data.artifacts.storyboard, review: { status: "in_review" } }),
      });
      const payload = (await response.json()) as { artifact?: StoryboardArtifact; review?: ReviewFile; error?: string };
      if (!response.ok || !payload.artifact || !payload.review) {
        throw new Error(payload.error ?? "分镜保存失败");
      }
      nextArtifacts.storyboard = payload.artifact;
      nextReviews.storyboard_review = payload.review;
    }

    if (data.artifacts.images) {
      const response = await fetch(`/api/projects/${data.videoId}/${data.version}/images`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifact: data.artifacts.images, review: { status: "in_review" } }),
      });
      const payload = (await response.json()) as { artifact?: TopicImages[]; review?: ReviewFile; error?: string };
      if (!response.ok || !payload.artifact || !payload.review) {
        throw new Error(payload.error ?? "图片信息保存失败");
      }
      nextArtifacts.images = payload.artifact;
      nextReviews.image_review = payload.review;
    }

    setData((prev) => ({ ...prev, artifacts: nextArtifacts, reviews: nextReviews }));
    return { artifacts: nextArtifacts, reviews: nextReviews };
  };

  const saveAll = async () => {
    setSaving(true);
    setMessage("");
    try {
      await persistEdits();
      setMessage("已保存所有页面的修改。需要更新 MP4 时请选择阶段并点击重生成。");
      setIsDirty(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const discardAll = () => {
    if (window.confirm("确定要放弃所有未保存的修改吗？")) {
      setData(initial);
      setProjectOverrides(initial.projectOverrides ?? {});
      setRuntimeOverrides(initial.runtimeOverrides ?? {});
      setIsDirty(false);
      setMessage("已放弃所有未保存的修改");
    }
  };

  const uploadCroppedImage = async (blob: Blob) => {
    if (!editor) {
      return;
    }

    setSaving(true);
    setReplacingItemId(editor.itemId);
    setMessage("");
    try {
      const form = new FormData();
      form.append("itemId", editor.itemId);
      form.append("file", blob, "replacement.jpg");

      const response = await fetch(`/api/projects/${data.videoId}/${data.version}/images/replace`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as
        | { artifact?: TopicImages[]; review?: ReviewFile; imagePath?: string; error?: string }
        | { error: string };

      if (!response.ok || !("artifact" in payload) || !payload.artifact || !payload.review) {
        throw new Error("error" in payload ? payload.error : "图片替换失败");
      }

      setData((prev) => ({
        ...prev,
        artifacts: { ...prev.artifacts, images: payload.artifact as TopicImages[] },
        reviews: { ...prev.reviews, image_review: payload.review as ReviewFile },
      }));
      setMessage(`图片已裁剪、替换并保存：${payload.imagePath ?? editor.itemId}`);
      closeEditor();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片替换失败");
    } finally {
      setSaving(false);
      setReplacingItemId(null);
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
      const response = await fetch(`/api/projects/${data.videoId}/${data.version}/images/generate`, {
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
        throw new Error("error" in payload ? payload.error : "AI 图片生成失败");
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
      setMessage(error instanceof Error ? error.message : "AI 图片生成失败");
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
      const response = await fetch(`/api/projects/${data.videoId}/${data.version}/images/generate`, {
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
        | { artifact?: TopicImages[]; review?: ReviewFile; imagePath?: string; error?: string }
        | { error: string };

      if (!response.ok || !("artifact" in payload) || !payload.artifact || !payload.review) {
        throw new Error("error" in payload ? payload.error : "AI 图片插入失败");
      }

      setData((prev) => ({
        ...prev,
        artifacts: { ...prev.artifacts, images: payload.artifact as TopicImages[] },
        reviews: { ...prev.reviews, image_review: payload.review as ReviewFile },
      }));
      setGenerateEditor(null);
      setMessage(`AI 图片已插入并替换本地文件：${payload.imagePath ?? generateEditor.itemId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI 图片插入失败");
    } finally {
      setSaving(false);
      setGeneratingItemId(null);
    }
  };

  const regenerate = async (saveBeforeRun: boolean) => {
    setRegenerating(true);
    if (saveBeforeRun) {
      setSaving(true);
    }
    setShowJobLog(false);
    setJobNotice(null);
    setMessage("");
    try {
      if (saveBeforeRun) {
        await persistEdits();
        setIsDirty(false);
      }
      saveTtsHistoryItem(effectiveTtsSettings(ttsDefaults, runtimeOverrides));
      const response = await fetch(`/api/projects/${data.videoId}/${data.version}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          startFrom,
          targetVersion: targetVersion.trim() || undefined,
          source,
          workflow,
          projectOverrides: countOverrideLeaves(projectOverrides) > 0 ? projectOverrides : undefined,
          runtimeOverrides: countRuntimeOverrideLeaves(runtimeOverrides) > 0
            ? compactRuntimeOverrides(runtimeOverrides)
            : undefined,
        }),
      });
      const payload = (await response.json()) as { job?: RegenerationJob; error?: string };
      if (!response.ok || !payload.job) {
        throw new Error(payload.error ?? "启动重生成失败");
      }
      setData((prev) => ({
        ...prev,
        job: payload.job!,
        regenerationJobs: [payload.job!, ...prev.regenerationJobs],
      }));
      setMessage(saveBeforeRun
        ? "已保存修改，并启动重生成任务；下方可查看实时进度。"
        : "重生成任务已启动；下方可查看实时进度。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "启动重生成失败");
    } finally {
      setSaving(false);
      setRegenerating(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="production-layout">
        <section className="panel" style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>成片播放审核</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                workflow: {data.workflow}, source: {data.source}
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn secondary-btn compact-btn" onClick={refreshData} disabled={refreshing || saving}>
                {refreshing ? "刷新中" : "刷新状态"}
              </button>
              {Object.entries(data.reviews).map(([stage, review]) => (
                <span key={stage} className={statusClass(review?.status)}>
                  {stage}: {review?.status}
                </span>
              ))}
            </div>
          </div>
          <div className="section-subtitle" style={{ marginTop: 8 }}>
            状态更新于 {new Date(lastRefreshedAt).toLocaleTimeString()}
          </div>

          {workflowStageProgress.length > 0 ? (
            <div className="compact-stage-strip">
              {workflowStageProgress.map((item) => (
                <span key={item.stage} className={`compact-stage ${item.done ? "done" : ""}`}>
                  {STAGE_LABELS[item.stage] ?? item.stage}
                </span>
              ))}
            </div>
          ) : null}

          {data.videos.length > 1 ? (
            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>选择成片</label>
              <select value={topicIndex} onChange={(event) => setTopicIndex(Number(event.target.value))}>
                {data.videos.map((video) => (
                  <option key={video.topic_index} value={video.topic_index}>
                    #{video.topic_index} {video.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {selectedVideo ? (
            <div style={{ marginTop: 12 }}>
              <video
                controls
                playsInline
                src={assetUrl(selectedVideo.path, data.job?.finishedAt)}
                style={{ width: "100%", maxHeight: 720, borderRadius: 12, background: "#0f0f0f" }}
              />
              <div className="row" style={{ marginTop: 8 }}>
                <span className="badge">topic: {selectedVideo.topic_index}</span>
                <span className="badge">duration: {Math.round(selectedVideo.duration ?? 0)}s</span>
                <span className="badge">intro: {selectedVideo.intro_duration ?? 0}s</span>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12, color: "var(--danger)" }}>没有找到可播放的 MP4。</div>
          )}
        </section>

        <section className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>MP4 视频重生成</div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            配置重生成参数并合成新的 MP4 视频。
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>模式</label>
              <select value={mode} onChange={(event) => setMode(event.target.value as "create" | "update")}>
                <option value="update">覆盖当前版本</option>
                <option value="create">新生成一个 version</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>从哪个阶段开始</label>
              <select value={startFrom} onChange={(event) => setStartFrom(event.target.value)}>
                {stageOptions.map((stage) => (
                  <option key={stage} value={stage}>
                    {STAGE_LABELS[stage] ?? stage}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>workflow</label>
              <input value={workflow} onChange={(event) => setWorkflow(event.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>
                {sourceInputLabel}
              </label>
              <input
                value={source}
                disabled={!sourceInputEnabled}
                onChange={(event) => setSource(event.target.value)}
              />
              <div className="section-subtitle" style={{ marginTop: 4 }}>
                {sourceInputEnabled
                  ? "仅在从头、ASR 或 topic_seed 阶段重跑时生效。"
                  : `当前从“${STAGE_LABELS[startFrom] ?? startFrom}”开始，已有脚本/分镜不会重新读取这里；改封面大字请编辑下方“封面显示标题”。`}
              </div>
            </div>
            {mode === "create" ? (
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>新版本号（可空，自动 vNNN）</label>
                <input value={targetVersion} onChange={(event) => setTargetVersion(event.target.value)} />
              </div>
            ) : null}

            {/* Project specific overrides in regeneration form */}
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              <button
                type="button"
                className="btn secondary-btn"
                onClick={() => setShowConfig(true)}
                style={{ width: "100%", justifyContent: "space-between", fontSize: 12, padding: "8px 12px" }}
              >
                <span>自定义项目专属参数 {countOverrideLeaves(projectOverrides) > 0 ? `(${countOverrideLeaves(projectOverrides)} 项修改)` : ""}</span>
                <span>打开可视化设置</span>
              </button>
              <div className="section-subtitle">随本次重生成请求保存为项目级覆盖，不影响全局设置。</div>
            </div>

            <TtsSettingsPanel
              value={runtimeOverrides}
              defaults={ttsDefaults}
              onChange={setRuntimeOverrides}
              disabled={saving || regenerating}
            />
            <div className="row">
              <button className="primary-btn" disabled={saving || regenerating} onClick={() => regenerate(true)}>
                {saving || regenerating ? "处理中..." : "保存表单并重生成"}
              </button>
              <button className="secondary" disabled={saving || regenerating} onClick={() => regenerate(false)}>
                直接重生成 MP4
              </button>
            </div>
          </div>

          {data.job ? (
            <RegenerationProgressCard
              job={data.job}
              detail={activeJobDetail}
              showLog={showJobLog}
              onShowLog={() => setShowJobLog(true)}
              onCloseLog={() => setShowJobLog(false)}
              videoId={data.videoId}
              version={data.version}
            />
          ) : null}

          {data.regenerationJobs.length > 0 ? (
            <RegenerationHistoryList
              jobs={data.regenerationJobs}
              currentJobId={data.job?.id}
              videoId={data.videoId}
              version={data.version}
            />
          ) : null}

          {jobNotice ? (
            <div className={`notice ${jobNotice.tone}`} style={{ marginTop: 12 }}>
              {jobNotice.text}
            </div>
          ) : null}
          {message ? <div style={{ marginTop: 12, color: "var(--muted)" }}>{message}</div> : null}
        </section>
      </div>

      <section className="panel" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            #{topicIndex} {selectedScript?.title ?? selectedStoryboard?.title ?? selectedImages?.title ?? "未命名"}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {isDirty ? (
              <span style={{ fontSize: 13, color: "var(--warning)", marginRight: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--warning)", display: "inline-block" }}></span>
                有未保存的修改
              </span>
            ) : (
              <span style={{ fontSize: 13, color: "var(--success)", marginRight: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--success)", display: "inline-block" }}></span>
                修改已保存
              </span>
            )}
            <button
              type="button"
              className={isDirty ? "primary-btn" : "secondary"}
              disabled={saving || regenerating}
              onClick={saveAll}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              {saving ? "保存中..." : "保存全部修改 (所有 Topic)"}
            </button>
            {isDirty ? (
              <button
                type="button"
                className="secondary"
                disabled={saving || regenerating}
                onClick={discardAll}
                style={{ padding: "6px 14px", fontSize: 13, color: "var(--danger)" }}
              >
                放弃修改
              </button>
            ) : null}
          </div>
        </div>
        <GroupedTopicEditor
          script={selectedScript}
          board={selectedStoryboard}
          images={selectedImages}
          imageToken={imageToken}
          replacingItemId={replacingItemId}
          generatingItemId={generatingItemId}
          onScriptChange={updateScriptLine}
          onScriptTitleChange={updateScriptTitle}
          onScriptCoverNarrationChange={updateScriptCoverNarration}
          onShotChange={updateShot}
          onImageChange={updateImage}
          onImageReplace={openEditorForFile}
          onImageGenerate={openGenerateEditor}
          onImageDelete={deleteImage}
          onImageZoom={(title, src) => setLightbox({ title, src })}
        />
      </section>

      {editor ? (
        <ImageCropModal
          editor={editor}
          busy={saving}
          onClose={closeEditor}
          onSave={uploadCroppedImage}
          onPickAnother={replaceEditorSource}
        />
      ) : null}

      {lightbox ? (
        <ImageLightbox
          title={lightbox.title}
          src={lightbox.src}
          onClose={() => setLightbox(null)}
        />
      ) : null}

      {generateEditor ? (
        <ImageGenerateModal
          editor={generateEditor}
          busy={saving}
          onChange={setGenerateEditor}
          onClose={() => setGenerateEditor(null)}
          onGeneratePreview={generatePreviewImage}
          onInsert={insertGeneratedImage}
        />
      ) : null}

      {showConfig ? (
        <ProjectProfileConfigModal
          title="项目专属参数"
          description="这里的修改会随重生成任务保存到当前项目版本，不会写入全局 profile_overrides.json。"
          base={inheritedProfile}
          value={projectOverrides}
          onChange={setProjectOverrides}
          onClose={() => setShowConfig(false)}
        />
      ) : null}
    </div>
  );
}

function GroupedTopicEditor({
  script,
  board,
  images,
  imageToken,
  replacingItemId,
  generatingItemId,
  onScriptChange,
  onScriptTitleChange,
  onScriptCoverNarrationChange,
  onShotChange,
  onImageChange,
  onImageReplace,
  onImageGenerate,
  onImageDelete,
  onImageZoom,
}: {
  script: ScriptItem | null;
  board: StoryboardItem | null;
  images: TopicImages | null;
  imageToken: string;
  replacingItemId: string | null;
  generatingItemId: string | null;
  onScriptChange: (lineIndex: number, key: keyof ScriptLine, value: string) => void;
  onScriptTitleChange: (value: string) => void;
  onScriptCoverNarrationChange: (value: string) => void;
  onShotChange: (shotIndex: number, key: keyof Shot, value: string) => void;
  onImageChange: (kind: "cover" | "shot", shotIndex: number | undefined, key: keyof ImageEntry, value: string) => void;
  onImageReplace: (itemId: string, title: string, file: File) => void;
  onImageGenerate: (
    itemId: string,
    title: string,
    sources: PromptSources,
    preferredSources: PromptSource[],
  ) => void;
  onImageDelete: (kind: "cover" | "shot", shotIndex: number | undefined) => void;
  onImageZoom: (title: string, src: string) => void;
}) {
  const shotCount = Math.max(
    script?.lines.length ?? 0,
    board?.shots.length ?? 0,
    images?.shots.length ?? 0,
  );

  if (shotCount === 0 && !images?.cover) {
    return <div className="sub-panel" style={{ marginTop: 12 }}>未找到可审核的分镜信息。</div>;
  }

  return (
    <div className="shot-review-stack">
      {images?.cover ? (
        <div className="shot-card cover-card">
          <div className="cover-summary">
            <div className="shot-card-title">封面</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>不属于具体分镜，用于片头/封面图。</div>
            <ImageActionPanel
              image={images.cover}
              imageToken={imageToken}
              title="封面图片"
              itemId={`topic_${images.topic_index}_cover`}
              replacing={replacingItemId === `topic_${images.topic_index}_cover`}
              generating={generatingItemId === `topic_${images.topic_index}_cover`}
              onReplace={(file) => onImageReplace(`topic_${images.topic_index}_cover`, "封面图片", file)}
              onGenerate={() => onImageGenerate(
                `topic_${images.topic_index}_cover`,
                "封面图片",
                {
                  title: sourceText(script?.title ?? images.title),
                  narration: sourceText(script?.cover_narration),
                  query: sourceText(images.cover?.query),
                  prompt: sourceText(images.cover?.prompt),
                  fallback: `${images.title}, vertical 9:16 documentary science cover image`,
                },
                ["query", "prompt", "title", "narration", "fallback"],
              )}
              onDelete={() => onImageDelete("cover", undefined)}
              onZoom={(src) => onImageZoom("封面图片", src)}
            />
          </div>
          <div className="shot-fields">
            {script ? (
              <div className="field-group">
                <div className="field-group-title">口播文案</div>
                <FieldInput
                  label="封面显示标题 / script.title（控制 MP4 封面大字和正文顶部标题）"
                  value={script.title}
                  onChange={onScriptTitleChange}
                />
                <FieldTextarea
                  label="cover_narration（只控制封面朗读，不控制画面大字；留空则 tts 阶段用标题+？兜底）"
                  value={script.cover_narration ?? ""}
                  onChange={(value) => onScriptCoverNarrationChange(value)}
                />
              </div>
            ) : null}
            <div className="field-group">
              <details className="image-meta-details" open>
                <summary className="field-group-title">封面图片信息</summary>
              <ImageMetaEditor
                title="cover"
                image={images.cover}
                imageToken={imageToken}
                compact
                onChange={(key, value) => onImageChange("cover", undefined, key, value)}
              />
              </details>
            </div>
          </div>
        </div>
      ) : null}

      {Array.from({ length: shotCount }, (_, idx) => {
        const line = script?.lines[idx] ?? null;
        const shot = board?.shots[idx] ?? null;
        const image = shot
          ? images?.shots.find((item) => item.shot_index === shot.index) ?? images?.shots[idx] ?? null
          : images?.shots[idx] ?? null;
        const displayIndex = shot?.index ?? image?.shot_index ?? idx;
        const imageItemId = images && image
          ? `topic_${images.topic_index}_shot_${image.shot_index}`
          : null;

        return (
          <section key={`${displayIndex}-${idx}`} className="shot-card">
            <div className="shot-card-header">
              <div>
                <div className="shot-card-title">分镜 {idx + 1}</div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  shot_index: {displayIndex} / line: {idx + 1}
                </div>
              </div>
              {shot ? (
                <div style={{ width: 128 }}>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>duration</label>
                  <input
                    type="number"
                    step="0.1"
                    value={shot.duration}
                    onChange={(event) => onShotChange(idx, "duration", event.target.value)}
                  />
                </div>
              ) : null}
            </div>

            <div className="shot-card-body">
              <div className="shot-media-panel">
                {image ? (
                  <>
                    <ImageActionPanel
                      image={image}
                      imageToken={imageToken}
                      title={`shot ${image.shot_index}`}
                      itemId={imageItemId ?? `shot_${displayIndex}`}
                      replacing={Boolean(imageItemId && replacingItemId === imageItemId)}
                      generating={Boolean(imageItemId && generatingItemId === imageItemId)}
                      onReplace={(file) => imageItemId && onImageReplace(imageItemId, `shot ${image.shot_index}`, file)}
                      onGenerate={() => imageItemId && onImageGenerate(
                        imageItemId,
                        `shot ${image.shot_index}`,
                        {
                          title: sourceText(script?.title ?? board?.title ?? images?.title),
                          visual: sourceText(shot?.visual),
                          narration: sourceText(shot?.narration),
                          script: sourceText(line?.text),
                          broll: sourceText(shot?.broll),
                          subtitle: sourceText(shot?.subtitle),
                          query: sourceText(image.query),
                          prompt: sourceText(image.prompt),
                          fallback: [
                            shot?.visual,
                            shot?.broll,
                            shot?.subtitle,
                            line?.text,
                            "vertical 9:16 documentary science image",
                          ].filter(Boolean).join(", "),
                        },
                        ["visual", "narration", "script", "query", "prompt", "fallback"],
                      )}
                      onDelete={() => onImageDelete("shot", image.shot_index)}
                      onZoom={(src) => onImageZoom(`shot ${image.shot_index}`, src)}
                    />
                    <div className="row" style={{ marginTop: 8 }}>
                      <span className="badge">图片 shot {image.shot_index}</span>
                      <span className="badge">{image.provider ?? "unknown"}</span>
                    </div>
                  </>
                ) : (
                  <div className="shot-empty-preview">未找到对应图片</div>
                )}
              </div>

              <div className="shot-fields">
                <div className="field-group">
                  <div className="field-group-title">口播文案</div>
                  {line ? (
                    <>
                      <FieldInput
                        label="estimated_seconds"
                        value={String(line.estimated_seconds)}
                        onChange={(value) => onScriptChange(idx, "estimated_seconds", value)}
                      />
                      <FieldTextarea
                        label="text"
                        value={line.text}
                        onChange={(value) => onScriptChange(idx, "text", value)}
                      />
                    </>
                  ) : (
                    <div style={{ color: "var(--danger)", fontSize: 13 }}>未找到对应脚本文案。</div>
                  )}
                </div>

                <div className="field-group">
                  <div className="field-group-title">分镜信息</div>
                  {shot ? (
                    <>
                      <FieldTextarea label="旁白" value={shot.narration} onChange={(value) => onShotChange(idx, "narration", value)} />
                      <FieldTextarea label="画面" value={shot.visual} onChange={(value) => onShotChange(idx, "visual", value)} />
                      <FieldTextarea label="B-roll" value={shot.broll} onChange={(value) => onShotChange(idx, "broll", value)} />
                      <FieldTextarea label="字幕" value={shot.subtitle} onChange={(value) => onShotChange(idx, "subtitle", value)} />
                    </>
                  ) : (
                    <div style={{ color: "var(--danger)", fontSize: 13 }}>未找到对应分镜。</div>
                  )}
                </div>

                {image && imageItemId ? (
                  <div className="field-group">
                    <details className="image-meta-details">
                      <summary className="field-group-title">图片信息</summary>
                    <ImageMetaEditor
                      title={`shot ${image.shot_index}`}
                      image={image}
                      imageToken={imageToken}
                      compact
                      onChange={(key, value) => onImageChange("shot", image.shot_index, key, value)}
                    />
                    </details>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ImageMetaEditor({
  title,
  image,
  imageToken,
  onChange,
  compact = false,
}: {
  title: string;
  image: ImageEntry;
  imageToken: string;
  onChange: (key: keyof ImageEntry, value: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      style={{ border: compact ? "none" : "1px solid var(--line)", borderRadius: 12, padding: compact ? 0 : 10 }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      {compact ? null : (
        <img
          src={assetUrl(image.image_path, imageToken)}
          alt={title}
          style={{ width: "100%", aspectRatio: "9 / 16", objectFit: "cover", borderRadius: 10, marginTop: 8 }}
        />
      )}
      <FieldInput label="provider" value={image.provider ?? ""} onChange={(value) => onChange("provider", value)} />
      <FieldInput label="mode" value={image.mode ?? ""} onChange={(value) => onChange("mode", value)} />
      <FieldInput label="query" value={image.query ?? ""} onChange={(value) => onChange("query", value)} />
      <FieldTextarea label="prompt" value={image.prompt ?? ""} onChange={(value) => onChange("prompt", value)} />
      <FieldInput label="model" value={image.model ?? ""} onChange={(value) => onChange("model", value)} />
      <FieldInput label="creator" value={image.creator ?? ""} onChange={(value) => onChange("creator", value)} />
      <FieldInput label="license" value={image.license ?? ""} onChange={(value) => onChange("license", value)} />
      <FieldTextarea label="source_url" value={image.source_url ?? ""} onChange={(value) => onChange("source_url", value)} />
    </div>
  );
}

function ImageActionPanel({
  image,
  imageToken,
  title,
  itemId,
  replacing,
  generating,
  onReplace,
  onGenerate,
  onDelete,
  onZoom,
}: {
  image: ImageEntry;
  imageToken: string;
  title: string;
  itemId: string;
  replacing: boolean;
  generating: boolean;
  onReplace: (file: File) => void;
  onGenerate: () => void;
  onDelete: () => void;
  onZoom: (src: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pasteMessage, setPasteMessage] = useState("");
  const imageSrc = image.image_path ? assetUrl(image.image_path, imageToken) : "";

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData.items;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith("image/")) {
        continue;
      }
      const file = item.getAsFile();
      if (!file) {
        continue;
      }
      event.preventDefault();
      setPasteMessage("");
      onReplace(file);
      return;
    }
  };

  const pasteFromClipboard = async () => {
    setPasteMessage("");
    try {
      const file = await readImageFileFromClipboard();
      if (!file) {
        panelRef.current?.focus();
        setPasteMessage("未读取到剪贴板图片。请先复制图片，再点击粘贴；或点击本区域后按 Ctrl/Cmd + V。");
        return;
      }
      onReplace(file);
    } catch {
      panelRef.current?.focus();
      setPasteMessage("浏览器未允许直接读取剪贴板。请点击本区域后按 Ctrl/Cmd + V，或使用上传。");
    }
  };

  return (
    <div ref={panelRef} className="image-action-panel" tabIndex={0} onPaste={handlePaste}>
      {imageSrc ? (
        <button type="button" className="image-preview-button" onClick={() => onZoom(imageSrc)}>
          <img
            src={imageSrc}
            alt={title}
            className="shot-preview"
          />
        </button>
      ) : (
        <div className="shot-empty-preview">图片已删除或未找到</div>
      )}
      <div className="image-action-toolbar">
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
            onReplace(file);
            event.currentTarget.value = "";
          }}
        />
        <button type="button" className="secondary compact-btn" disabled={!imageSrc} onClick={() => imageSrc && onZoom(imageSrc)}>
          放大
        </button>
        <button type="button" className="secondary compact-btn" disabled={replacing} onClick={() => inputRef.current?.click()}>
          {replacing ? "替换中" : "上传"}
        </button>
        <button type="button" className="secondary compact-btn" disabled={generating} onClick={onGenerate}>
          {generating ? "生成中" : "生图"}
        </button>
        <button type="button" className="secondary compact-btn" disabled={replacing} onClick={pasteFromClipboard}>
          粘贴图片
        </button>
        <button
          type="button"
          className="warn compact-btn"
          disabled={!image.image_path}
          onClick={() => {
            if (window.confirm("确认从当前成品审核中移除这张图片？不会删除磁盘原文件。")) {
              onDelete();
            }
          }}
        >
          删除
        </button>
      </div>
      <div className="image-action-hint">
        {pasteMessage || `可点击“粘贴图片”，也可点此区域后按 Ctrl/Cmd + V。ID: ${itemId}`}
      </div>
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
}

function ImageGenerateModal({ editor, busy, onChange, onClose, onGeneratePreview, onInsert }: ImageGenerateModalProps) {
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
      <div className="image-lightbox image-generate-modal" style={{ maxWidth: 760 }}>
        <div className="image-lightbox-head">
          <div>
            <div className="section-title">AI 生成替换</div>
            <div className="section-subtitle">{editor.title}</div>
          </div>
          <button type="button" className="secondary compact-btn" disabled={busy} onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="image-generate-body">
          <div className="form-row">
            <label className="form-label">provider</label>
            <select
              value={editor.provider}
              disabled={busy}
              onChange={(event) => {
                const provider = event.target.value;
                const model = defaultModelForProvider(provider);
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
          <div className="form-row">
            <label className="form-label">文案来源</label>
            <select
              value={editor.promptSource}
              disabled={busy}
              onChange={(event) => {
                const promptSource = event.target.value as PromptSource;
                onChange({
                  ...editor,
                  promptSource,
                  prompt: editor.sources[promptSource] ?? editor.prompt,
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
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13 }}>
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
          <div className="form-row">
            <label className="form-label">prompt</label>
            <textarea
              value={editor.prompt}
              disabled={busy}
              rows={5}
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
              <textarea value={effectivePrompt} readOnly rows={7} />
            </div>
          ) : null}
          <div className="image-generate-preview-slot">
            {previewSrc ? (
              <img src={previewSrc} alt="AI 生成预览" />
            ) : (
              <div className="empty">
                {busy ? "生成中..." : "尚未生成预览，点击下方按钮开始"}
              </div>
            )}
          </div>
        </div>
        <div className="image-generate-footer">
          <button type="button" className="secondary compact-btn" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="button" className="secondary compact-btn" disabled={busy} onClick={onGeneratePreview}>
            {busy ? "生成中" : previewSrc ? "重新生成预览" : "生成预览"}
          </button>
          <button type="button" className="approve-btn compact-btn" disabled={busy || !previewSrc} onClick={onInsert}>
            {busy ? "插入中" : "插入替换"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageLightbox({ title, src, onClose }: { title: string; src: string; onClose: () => void }) {
  return (
    <div className="image-lightbox-backdrop" onClick={onClose}>
      <div className="image-lightbox" onClick={(event) => event.stopPropagation()}>
        <div className="image-lightbox-head">
          <div className="section-title">{title}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <img src={src} alt={title} />
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
    setOffset(clampOffset({
      x: dragRef.current.startOffset.x + dx,
      y: dragRef.current.startOffset.y + dy,
    }, size, scale));
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
    <div className="crop-modal-backdrop">
      <div className="panel crop-modal">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>替换并裁剪：{editor.title}</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              文件：{editor.fileName}。拖拽调整画面，或直接粘贴剪切板图片。
            </div>
          </div>
          <button className="secondary" disabled={busy} onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="crop-modal-grid">
          <div>
            <div
              className="crop-viewport"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={clearDragging}
              onPointerCancel={clearDragging}
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

function FieldInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div style={{ marginTop: 8 }}>
      <label style={{ fontSize: 12, color: "var(--muted)" }}>{label}</label>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function FieldTextarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div style={{ marginTop: 8 }}>
      <label style={{ fontSize: 12, color: "var(--muted)" }}>{label}</label>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatElapsed(startedAt: string | undefined, finishedAt: string | undefined): string {
  if (!startedAt) {
    return "-";
  }
  const start = Date.parse(startedAt);
  const end = finishedAt ? Date.parse(finishedAt) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return "-";
  }
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

interface RegenerationProgressCardProps {
  job: RegenerationJob;
  detail: RegenerationJobDetail | null;
  showLog: boolean;
  onShowLog: () => void;
  onCloseLog: () => void;
  videoId: string;
  version: string;
}

function RegenerationProgressCard({ job, detail, showLog, onShowLog, onCloseLog, videoId, version }: RegenerationProgressCardProps) {
  const running = job.status === "running";
  const currentStage = detail?.currentStage ?? null;
  const logText = detail?.logText ?? "";
  const hasSeparateTarget = Boolean(job.targetVersion && job.targetVersion !== version);
  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12, display: "grid", gap: 8 }}>
      <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span className={statusClass(job.status)}>job: {job.status}</span>
        {hasSeparateTarget ? <span className="badge">新版本: {job.targetVersion}</span> : null}
        {job.startFrom ? <span className="badge">from: {STAGE_LABELS[job.startFrom] ?? job.startFrom}</span> : null}
        {currentStage && running ? <span className="badge in_review">阶段: {STAGE_LABELS[currentStage] ?? currentStage}</span> : null}
        {job.pid ? <span className="badge">pid: {job.pid}</span> : null}
        <span className="badge">耗时: {formatElapsed(job.startedAt, job.finishedAt)}</span>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, wordBreak: "break-all" }}>
        log: {job.logPath}
      </div>
      {running ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          正在重生成… 每 3 秒刷新一次状态。
        </div>
      ) : null}
      {job.error ? <div style={{ color: "var(--danger)" }}>{job.error}</div> : null}
      <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Link href={`/tasks/${job.id}`} className="secondary compact-btn">
          任务详情
        </Link>
        <button type="button" className="secondary compact-btn" onClick={onShowLog}>
          查看日志
        </button>
      </div>
      {showLog ? (
        <RegenerationLogDrawer
          title="重生成日志"
          subtitle={job.logPath}
          logText={logText}
          onClose={onCloseLog}
        />
      ) : null}
      {hasSeparateTarget ? (
        <Link
          href={`/projects/${videoId}/${job.targetVersion}/review`}
          style={{ display: "inline-flex", color: "var(--accent)", fontSize: 13 }}
        >
          打开新版本
        </Link>
      ) : null}
      {job.status === "succeeded" && job.targetVersion === version ? (
        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          重生成完成，刷新页面查看新成片。
        </div>
      ) : null}
    </div>
  );
}

interface RegenerationHistoryListProps {
  jobs: RegenerationJob[];
  currentJobId: string | undefined;
  videoId: string;
  version: string;
}

function RegenerationLogDrawer({
  title,
  subtitle,
  logText,
  onClose,
}: {
  title: string;
  subtitle: string;
  logText: string;
  onClose: () => void;
}) {
  return (
    <div className="review-drawer-backdrop">
      <aside className="review-drawer regeneration-log-drawer" role="dialog" aria-modal="true">
        <div className="review-drawer-head">
          <div>
            <div className="section-title">{title}</div>
            <div className="section-subtitle" style={{ wordBreak: "break-all" }}>{subtitle}</div>
          </div>
          <button type="button" className="secondary compact-btn" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="review-drawer-body">
          <pre className="drawer-log">{logText || "（暂无日志输出）"}</pre>
        </div>
      </aside>
    </div>
  );
}

function RegenerationHistoryList({ jobs, currentJobId, videoId, version }: RegenerationHistoryListProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [logCache, setLogCache] = useState<Record<string, RegenerationJobDetail>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const toggleHistory = async (jobId: string) => {
    if (openId === jobId) {
      setOpenId(null);
      return;
    }
    setOpenId(jobId);
    if (logCache[jobId]) {
      return;
    }
    setLoadingId(jobId);
    try {
      const response = await fetch(`/api/projects/${videoId}/${version}/regenerate/${jobId}`, { cache: "no-store" });
      const payload = (await response.json()) as RegenerationJobDetail | { error?: string };
      if (response.ok && "job" in payload) {
        setLogCache((prev) => ({ ...prev, [jobId]: payload }));
      }
    } catch {
      // ignore
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12, display: "grid", gap: 8 }}>
      <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>历史记录（{jobs.length}）</div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            最近：{formatRelativeTime(jobs[0]?.startedAt)} · {jobs[0]?.status ?? "-"}
          </div>
        </div>
        <button
          type="button"
          className="secondary compact-btn"
          style={{ marginLeft: "auto" }}
          onClick={() => setDrawerOpen(true)}
        >
          查看历史
        </button>
      </div>
      {drawerOpen ? (
        <RegenerationHistoryDrawer
          jobs={jobs}
          currentJobId={currentJobId}
          version={version}
          openId={openId}
          logCache={logCache}
          loadingId={loadingId}
          onToggleLog={toggleHistory}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </div>
  );
}

interface RegenerationHistoryDrawerProps {
  jobs: RegenerationJob[];
  currentJobId: string | undefined;
  version: string;
  openId: string | null;
  logCache: Record<string, RegenerationJobDetail>;
  loadingId: string | null;
  onToggleLog: (jobId: string) => void;
  onClose: () => void;
}

function RegenerationHistoryDrawer({
  jobs,
  currentJobId,
  version,
  openId,
  logCache,
  loadingId,
  onToggleLog,
  onClose,
}: RegenerationHistoryDrawerProps) {
  return (
    <div className="review-drawer-backdrop">
      <aside className="review-drawer regeneration-history-drawer" role="dialog" aria-modal="true">
        <div className="review-drawer-head">
          <div>
            <div className="section-title">重生成历史</div>
            <div className="section-subtitle">共 {jobs.length} 条记录</div>
          </div>
          <button type="button" className="secondary compact-btn" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="review-drawer-body">
          <div style={{ display: "grid", gap: 8 }}>
            {jobs.map((job) => {
              const isOpen = openId === job.id;
              const isCurrent = job.id === currentJobId;
              const hasSeparateTarget = Boolean(job.targetVersion && job.targetVersion !== version);
              return (
                <div key={job.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, fontSize: 12 }}>
                  <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className={statusClass(job.status)}>{job.status}</span>
                    {isCurrent ? <span className="badge">本次</span> : null}
                    {job.startFrom ? <span className="badge">from: {STAGE_LABELS[job.startFrom] ?? job.startFrom}</span> : null}
                    {hasSeparateTarget ? <span className="badge">新版本: {job.targetVersion}</span> : null}
                    <span style={{ color: "var(--muted)" }}>开始: {formatRelativeTime(job.startedAt)}</span>
                    <span style={{ color: "var(--muted)" }}>耗时: {formatElapsed(job.startedAt, job.finishedAt)}</span>
                  </div>
                  <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <Link href={`/tasks/${job.id}`} className="secondary compact-btn">
                      任务详情
                    </Link>
                    <button type="button" className="secondary compact-btn" onClick={() => onToggleLog(job.id)}>
                      {isOpen ? "收起日志" : loadingId === job.id ? "加载..." : "查看日志"}
                    </button>
                  </div>
                  {isOpen ? (
                    <pre style={{
                      marginTop: 8,
                      maxHeight: 260,
                      overflow: "auto",
                      background: "#090d16",
                      color: "#cdd6e3",
                      padding: 10,
                      borderRadius: 6,
                      fontSize: 11,
                      lineHeight: 1.4,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}>
                      {logCache[job.id]?.logText ?? "（暂无日志）"}
                    </pre>
                  ) : null}
                  {isOpen && job.error ? (
                    <div style={{ color: "var(--danger)", marginTop: 6, fontSize: 12 }}>{job.error}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
