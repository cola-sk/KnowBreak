"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { RegenerationJob, ReviewFile, ReviewStage } from "@/lib/types";

interface ScriptLine {
  text: string;
  estimated_seconds: number;
}

interface ScriptItem {
  topic_index: number;
  title: string;
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
  query?: string;
  source_url?: string;
  creator?: string;
  license?: string;
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
}

interface Props {
  initial: ProductionReviewPayload;
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

export function ProductionReviewClient({ initial }: Props) {
  const [data, setData] = useState<ProductionReviewPayload>(initial);
  const [topicIndex, setTopicIndex] = useState<number>(initial.videos[0]?.topic_index ?? 0);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"create" | "update">("update");
  const [startFrom, setStartFrom] = useState("compose");
  const [targetVersion, setTargetVersion] = useState("");
  const [source, setSource] = useState(initial.source);
  const [workflow, setWorkflow] = useState(initial.workflow);

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
  const imageToken = data.reviews.image_review?.updated_at ?? data.job?.finishedAt ?? data.version;

  const updateScriptLine = (lineIndex: number, key: keyof ScriptLine, value: string) => {
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

  const updateShot = (shotIndex: number, key: keyof Shot, value: string) => {
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

  const saveAll = async () => {
    setSaving(true);
    setMessage("");
    try {
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
      setMessage("已保存脚本、分镜和图片信息。需要更新 MP4 时请选择阶段并点击重生成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${data.videoId}/${data.version}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          startFrom,
          targetVersion: targetVersion.trim() || undefined,
          source,
          workflow,
        }),
      });
      const payload = (await response.json()) as { job?: RegenerationJob; error?: string };
      if (!response.ok || !payload.job) {
        throw new Error(payload.error ?? "启动重生成失败");
      }
      setData((prev) => ({ ...prev, job: payload.job! }));
      setMessage("重生成任务已启动。日志会写入版本 reviews 目录；任务完成后刷新页面查看新视频。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "启动重生成失败");
    } finally {
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
              {Object.entries(data.reviews).map(([stage, review]) => (
                <span key={stage} className={statusClass(review?.status)}>
                  {stage}: {review?.status}
                </span>
              ))}
            </div>
          </div>

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
          <div style={{ fontWeight: 700, fontSize: 18 }}>保存与重生成</div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            保存只改 JSON/图片元数据；重生成会调用 CLI 更新音频、图片或 MP4。
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="secondary" disabled={saving || regenerating} onClick={saveAll}>
              {saving ? "保存中..." : "保存当前修改"}
            </button>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>模式</label>
              <select value={mode} onChange={(event) => setMode(event.target.value as "create" | "update")}>
                <option value="update">update：覆盖当前版本</option>
                <option value="create">create：生成新版本</option>
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
              <label style={{ fontSize: 12, color: "var(--muted)" }}>source / topic</label>
              <input value={source} onChange={(event) => setSource(event.target.value)} />
            </div>
            {mode === "create" ? (
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>新版本号（可空，自动 vNNN）</label>
                <input value={targetVersion} onChange={(event) => setTargetVersion(event.target.value)} />
              </div>
            ) : null}
            <button className="warn" disabled={saving || regenerating} onClick={regenerate}>
              {regenerating ? "启动中..." : "重生成视频"}
            </button>
          </div>

          {data.job ? (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div className="row" style={{ alignItems: "center" }}>
                <span className={statusClass(data.job.status)}>job: {data.job.status}</span>
                {data.job.targetVersion ? <span className="badge">target: {data.job.targetVersion}</span> : null}
                {data.job.pid ? <span className="badge">pid: {data.job.pid}</span> : null}
              </div>
              <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12, wordBreak: "break-all" }}>
                log: {data.job.logPath}
              </div>
              {data.job.targetVersion ? (
                <Link
                  href={`/projects/${data.videoId}/${data.job.targetVersion}/review`}
                  style={{ display: "inline-flex", marginTop: 8, color: "var(--accent)", fontSize: 13 }}
                >
                  打开目标版本
                </Link>
              ) : null}
              {data.job.error ? <div style={{ color: "var(--danger)", marginTop: 8 }}>{data.job.error}</div> : null}
            </div>
          ) : null}

          {message ? <div style={{ marginTop: 12, color: "var(--muted)" }}>{message}</div> : null}
        </section>
      </div>

      <section className="panel" style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>
          #{topicIndex} {selectedScript?.title ?? selectedStoryboard?.title ?? selectedImages?.title ?? "未命名"}
        </div>
        <div className="review-columns" style={{ marginTop: 12 }}>
          <ScriptEditor script={selectedScript} onChange={updateScriptLine} />
          <StoryboardEditor board={selectedStoryboard} images={selectedImages} imageToken={imageToken} onChange={updateShot} />
          <ImagesEditor topic={selectedImages} imageToken={imageToken} onChange={updateImage} />
        </div>
      </section>
    </div>
  );
}

function ScriptEditor({
  script,
  onChange,
}: {
  script: ScriptItem | null;
  onChange: (lineIndex: number, key: keyof ScriptLine, value: string) => void;
}) {
  if (!script) {
    return <div className="sub-panel">未找到脚本。</div>;
  }
  return (
    <div className="sub-panel">
      <div style={{ fontWeight: 700 }}>脚本</div>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>lines: {script.lines.length}</div>
      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        {script.lines.map((line, idx) => (
          <div key={idx} style={{ border: "1px dashed var(--line)", borderRadius: 10, padding: 10 }}>
            <div className="row" style={{ alignItems: "center", marginBottom: 6 }}>
              <span className="badge">line {idx + 1}</span>
              <input
                type="number"
                step="0.1"
                value={line.estimated_seconds}
                onChange={(event) => onChange(idx, "estimated_seconds", event.target.value)}
                style={{ maxWidth: 120 }}
              />
            </div>
            <textarea value={line.text} onChange={(event) => onChange(idx, "text", event.target.value)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StoryboardEditor({
  board,
  images,
  imageToken,
  onChange,
}: {
  board: StoryboardItem | null;
  images: TopicImages | null;
  imageToken: string;
  onChange: (shotIndex: number, key: keyof Shot, value: string) => void;
}) {
  if (!board) {
    return <div className="sub-panel">未找到分镜。</div>;
  }
  return (
    <div className="sub-panel">
      <div style={{ fontWeight: 700 }}>分镜 + 对应图片</div>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>shots: {board.shots.length}</div>
      <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
        {board.shots.map((shot, idx) => {
          const image = images?.shots.find((item) => item.shot_index === shot.index) ?? images?.shots[idx];
          return (
            <div key={`${shot.index}-${idx}`} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10 }}>
              <div className="row" style={{ alignItems: "center" }}>
                <span className="badge">shot {shot.index}</span>
                <input
                  type="number"
                  step="0.1"
                  value={shot.duration}
                  onChange={(event) => onChange(idx, "duration", event.target.value)}
                  style={{ maxWidth: 110 }}
                />
              </div>
              {image ? (
                <img
                  src={assetUrl(image.image_path, imageToken)}
                  alt={`shot ${shot.index}`}
                  style={{ width: "100%", aspectRatio: "9 / 16", objectFit: "cover", borderRadius: 10, marginTop: 8 }}
                />
              ) : null}
              <FieldTextarea label="旁白" value={shot.narration} onChange={(value) => onChange(idx, "narration", value)} />
              <FieldTextarea label="画面" value={shot.visual} onChange={(value) => onChange(idx, "visual", value)} />
              <FieldTextarea label="B-roll" value={shot.broll} onChange={(value) => onChange(idx, "broll", value)} />
              <FieldTextarea label="字幕" value={shot.subtitle} onChange={(value) => onChange(idx, "subtitle", value)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ImagesEditor({
  topic,
  imageToken,
  onChange,
}: {
  topic: TopicImages | null;
  imageToken: string;
  onChange: (kind: "cover" | "shot", shotIndex: number | undefined, key: keyof ImageEntry, value: string) => void;
}) {
  if (!topic) {
    return <div className="sub-panel">未找到图片信息。</div>;
  }
  return (
    <div className="sub-panel">
      <div style={{ fontWeight: 700 }}>图片信息</div>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>images: {(topic.cover ? 1 : 0) + topic.shots.length}</div>
      <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
        {topic.cover ? (
          <ImageMetaEditor
            title="cover"
            image={topic.cover}
            imageToken={imageToken}
            onChange={(key, value) => onChange("cover", undefined, key, value)}
          />
        ) : null}
        {topic.shots.map((shot) => (
          <ImageMetaEditor
            key={shot.shot_index}
            title={`shot ${shot.shot_index}`}
            image={shot}
            imageToken={imageToken}
            onChange={(key, value) => onChange("shot", shot.shot_index, key, value)}
          />
        ))}
      </div>
    </div>
  );
}

function ImageMetaEditor({
  title,
  image,
  imageToken,
  onChange,
}: {
  title: string;
  image: ImageEntry;
  imageToken: string;
  onChange: (key: keyof ImageEntry, value: string) => void;
}) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10 }}>
      <div style={{ fontWeight: 600 }}>{title}</div>
      <img
        src={assetUrl(image.image_path, imageToken)}
        alt={title}
        style={{ width: "100%", aspectRatio: "9 / 16", objectFit: "cover", borderRadius: 10, marginTop: 8 }}
      />
      <FieldInput label="provider" value={image.provider ?? ""} onChange={(value) => onChange("provider", value)} />
      <FieldInput label="query" value={image.query ?? ""} onChange={(value) => onChange("query", value)} />
      <FieldInput label="creator" value={image.creator ?? ""} onChange={(value) => onChange("creator", value)} />
      <FieldInput label="license" value={image.license ?? ""} onChange={(value) => onChange("license", value)} />
      <FieldTextarea label="source_url" value={image.source_url ?? ""} onChange={(value) => onChange("source_url", value)} />
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
