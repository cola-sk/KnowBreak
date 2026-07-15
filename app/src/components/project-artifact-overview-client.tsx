"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ImageReviewClient, type ImageReviewPayload } from "@/components/image-review-client";
import { ScriptReviewClient, type ScriptReviewPayload } from "@/components/script-review-client";
import { StoryboardReviewClient, type StoryboardReviewPayload } from "@/components/storyboard-review-client";
import type { ProjectArtifactOverview } from "@/lib/review-store";
import type { ReviewFile, ReviewStage } from "@/lib/types";

interface Props {
  overview: ProjectArtifactOverview;
  taskHref?: string;
}

type ArtifactEntry = ProjectArtifactOverview["artifacts"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function artifactTopics(artifact: unknown): ProjectArtifactOverview["topics"] {
  if (!isRecord(artifact) || !Array.isArray(artifact.topics)) {
    return [];
  }
  return (artifact.topics as Array<Record<string, unknown>>).map((topic, fallbackIndex) => ({
    index: typeof topic.index === "number"
      ? topic.index
      : typeof topic.topic_index === "number"
        ? topic.topic_index
        : fallbackIndex,
    title: typeof topic.title === "string" && topic.title.trim() ? topic.title : `选题 ${fallbackIndex + 1}`,
    hook: typeof topic.hook === "string" ? topic.hook : undefined,
    angle: typeof topic.angle === "string" ? topic.angle : undefined,
    targetDuration: typeof topic.target_duration === "number" ? topic.target_duration : undefined,
  }));
}

interface KnowledgePoint {
  title?: string;
  summary?: string;
  key_statements?: string[];
  examples?: string[];
  source_excerpt?: string;
}

interface KnowledgeArtifact {
  video_id?: string;
  title?: string;
  domain?: string;
  points?: KnowledgePoint[];
}

interface TranscriptSegment {
  start?: number;
  end?: number;
  text: string;
}

interface TranscriptArtifact {
  source?: string;
  duration?: number;
  language?: string;
  method?: string;
  segments?: TranscriptSegment[];
  text?: string;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(stringValue).filter((item): item is string => Boolean(item));
}

function artifactKnowledge(artifact: unknown): KnowledgeArtifact {
  if (!isRecord(artifact)) {
    return {};
  }
  return {
    video_id: stringValue(artifact.video_id),
    title: stringValue(artifact.title),
    domain: stringValue(artifact.domain),
    points: Array.isArray(artifact.points)
      ? artifact.points
          .filter(isRecord)
          .map((point) => ({
            title: stringValue(point.title),
            summary: stringValue(point.summary),
            key_statements: stringList(point.key_statements),
            examples: stringList(point.examples),
            source_excerpt: stringValue(point.source_excerpt),
          }))
      : [],
  };
}

function artifactTranscript(artifact: unknown): TranscriptArtifact {
  if (!isRecord(artifact)) {
    return {};
  }
  return {
    source: stringValue(artifact.source),
    duration: numberValue(artifact.duration),
    language: stringValue(artifact.language),
    method: stringValue(artifact.method),
    text: stringValue(artifact.text),
    segments: Array.isArray(artifact.segments)
      ? artifact.segments
          .filter(isRecord)
          .map((segment) => ({
            start: numberValue(segment.start),
            end: numberValue(segment.end),
            text: stringValue(segment.text) ?? "",
          }))
          .filter((segment) => segment.text)
      : [],
  };
}

function readonlyReview(stage: ReviewStage): ReviewFile {
  return {
    stage,
    status: "pending",
    version: 1,
    updated_at: new Date(0).toISOString(),
    items: [],
  };
}

function artifactByStage(artifacts: ArtifactEntry[], stage: string): unknown | null {
  return artifacts.find((artifact) => artifact.stage === stage)?.artifact ?? null;
}

export function ProjectArtifactOverviewClient({ overview, taskHref }: Props) {
  const firstGeneratedStage = useMemo(
    () => overview.artifacts.find((artifact) => artifact.exists)?.stage ?? overview.artifacts[0]?.stage ?? "",
    [overview.artifacts],
  );
  const [selectedStage, setSelectedStage] = useState(firstGeneratedStage);
  const selected = overview.artifacts.find((artifact) => artifact.stage === selectedStage) ?? null;
  const generatedCount = overview.artifacts.filter((artifact) => artifact.exists).length;

  return (
    <div className="panel artifact-overview-panel">
      <div className="artifact-overview-head">
        <div>
          <div className="section-title">项目产物概览</div>
        </div>
        <div className="row artifact-overview-actions">
          {taskHref ? (
            <Link href={taskHref} className="badge">
              打开任务详情
            </Link>
          ) : null}
          <span className="badge in_review">
            已生成 {generatedCount}/{overview.artifacts.length}
          </span>
        </div>
      </div>

      <div className="artifact-overview-meta">
        <span>项目：{overview.videoId}</span>
        <span>版本：{overview.version}</span>
        <span>workflow：{overview.workflow}</span>
        {overview.source ? <span>source：{overview.source}</span> : null}
      </div>

      <div className="artifact-stage-grid">
        {overview.artifacts.map((artifact) => (
          <button
            type="button"
            className={`artifact-stage-card artifact-stage-button ${artifact.exists ? "done" : ""} ${selectedStage === artifact.stage ? "selected" : ""}`}
            key={artifact.stage}
            disabled={!artifact.exists}
            onClick={() => setSelectedStage(artifact.stage)}
          >
            <span className="artifact-stage-title">{artifact.label}</span>
            <span className="artifact-stage-file">{artifact.fileName}</span>
            <span className={artifact.exists ? "badge approved" : "badge"}>
              {artifact.exists ? "已生成" : "未生成"}
            </span>
          </button>
        ))}
      </div>

      {selected ? <ArtifactDetail artifact={selected} artifacts={overview.artifacts} /> : null}
    </div>
  );
}

function ArtifactDetail({ artifact, artifacts }: { artifact: ArtifactEntry; artifacts: ArtifactEntry[] }) {
  if (!artifact.exists || artifact.artifact === null) {
    return null;
  }

  if (artifact.stage === "script") {
    return (
      <section className="artifact-detail-panel">
        <ScriptReviewClient
          videoId=""
          version=""
          initial={{
            artifact: artifact.artifact as ScriptReviewPayload["artifact"],
            review: readonlyReview("script_review"),
          }}
          readOnly
        />
      </section>
    );
  }

  if (artifact.stage === "storyboard") {
    return (
      <section className="artifact-detail-panel">
        <StoryboardReviewClient
          videoId=""
          version=""
          initial={{
            artifact: artifact.artifact as StoryboardReviewPayload["artifact"],
            review: readonlyReview("storyboard_review"),
          }}
          readOnly
        />
      </section>
    );
  }

  if (artifact.stage === "images") {
    return (
      <section className="artifact-detail-panel">
        <ImagesReadOnly artifact={artifact.artifact} artifacts={artifacts} />
      </section>
    );
  }

  return (
    <section className="artifact-detail-panel">
      <div className="artifact-section-head">
        <div>
          <div className="section-title small">{artifact.label}产物</div>
          <div className="section-subtitle">{artifact.fileName}</div>
        </div>
        <span className="badge">只读</span>
      </div>

      {artifact.stage === "asr" ? (
        <TranscriptReadOnly transcript={artifactTranscript(artifact.artifact)} />
      ) : artifact.stage === "topics" || artifact.stage === "topic_seed" ? (
        <TopicsReadOnly topics={artifactTopics(artifact.artifact)} />
      ) : artifact.stage === "extract" ? (
        <KnowledgeReadOnly knowledge={artifactKnowledge(artifact.artifact)} />
      ) : (
        <JsonReadOnly value={artifact.artifact} />
      )}
    </section>
  );
}

function TopicsReadOnly({ topics }: { topics: ProjectArtifactOverview["topics"] }) {
  if (topics.length === 0) {
    return <JsonReadOnly value={topics} />;
  }
  return (
    <div className="artifact-card-list">
      {topics.map((topic) => (
        <article className="artifact-summary-card" key={topic.index}>
          <div className="artifact-summary-title">
            {topic.index + 1}. {topic.title}
          </div>
          {topic.hook ? <p>{topic.hook}</p> : null}
          {topic.angle ? <p>{topic.angle}</p> : null}
          {typeof topic.targetDuration === "number" ? (
            <div className="artifact-summary-meta">目标时长：{topic.targetDuration}s</div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ImagesReadOnly({ artifact, artifacts }: { artifact: unknown; artifacts: ArtifactEntry[] }) {
  if (!Array.isArray(artifact)) {
    return <JsonReadOnly value={artifact} />;
  }
  return (
    <ImageReviewClient
      videoId=""
      version=""
      initial={{
        artifact: artifact as ImageReviewPayload["artifact"],
        review: readonlyReview("image_review"),
      }}
      context={{
        script: artifactByStage(artifacts, "script") as never,
        storyboard: artifactByStage(artifacts, "storyboard") as never,
      }}
      readOnly
    />
  );
}

function formatSeconds(value: number | undefined): string | null {
  if (typeof value !== "number") {
    return null;
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function TranscriptReadOnly({ transcript }: { transcript: TranscriptArtifact }) {
  const segments = transcript.segments ?? [];
  if (segments.length === 0 && !transcript.text) {
    return (
      <div className="empty-state compact">
        <h3 className="empty-title">暂无转录内容</h3>
        <p className="empty-desc">ASR 产物存在，但没有可展示的文本片段。</p>
      </div>
    );
  }

  return (
    <div className="artifact-card-list">
      <div className="artifact-summary-card">
        <div className="artifact-summary-title">ASR 转录结果</div>
        <div className="artifact-meta-row">
          {transcript.language ? <span>语言：{transcript.language}</span> : null}
          {transcript.method ? <span>方法：{transcript.method}</span> : null}
          {typeof transcript.duration === "number" ? <span>时长：{Math.round(transcript.duration)}s</span> : null}
          {transcript.source ? <span>来源：{transcript.source}</span> : null}
        </div>
      </div>

      {segments.length > 0 ? (
        <div className="transcript-segment-list">
          {segments.map((segment, index) => (
            <article className="transcript-segment-card" key={`${segment.start ?? index}-${index}`}>
              <div className="transcript-time">
                {formatSeconds(segment.start) ?? "--:--"}
                {segment.end !== undefined ? ` - ${formatSeconds(segment.end) ?? "--:--"}` : ""}
              </div>
              <p>{segment.text}</p>
            </article>
          ))}
        </div>
      ) : (
        <article className="artifact-summary-card">
          <p>{transcript.text}</p>
        </article>
      )}
    </div>
  );
}

function KnowledgeReadOnly({ knowledge }: { knowledge: KnowledgeArtifact }) {
  const points = knowledge.points ?? [];
  if (points.length === 0) {
    return (
      <div className="empty-state compact">
        <h3 className="empty-title">暂无知识点</h3>
        <p className="empty-desc">知识提取产物存在，但没有可展示的 points 内容。</p>
      </div>
    );
  }

  return (
    <div className="artifact-card-list">
      <div className="artifact-summary-card">
        <div className="artifact-summary-title">{knowledge.title || "知识提取结果"}</div>
        <div className="artifact-meta-row">
          {knowledge.domain ? <span>领域：{knowledge.domain}</span> : null}
          {knowledge.video_id ? <span>项目：{knowledge.video_id}</span> : null}
          <span>知识点：{points.length}</span>
        </div>
      </div>
      {points.map((point, index) => (
        <article className="artifact-summary-card" key={`${point.title ?? "point"}-${index}`}>
          <div className="artifact-summary-title">
            {index + 1}. {point.title || "未命名知识点"}
          </div>
          {point.summary ? <p>{point.summary}</p> : null}
          {point.key_statements && point.key_statements.length > 0 ? (
            <div className="artifact-bullet-block">
              <div className="artifact-bullet-title">关键论断</div>
              <ul>
                {point.key_statements.map((statement, statementIndex) => (
                  <li key={statementIndex}>{statement}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {point.examples && point.examples.length > 0 ? (
            <div className="artifact-bullet-block">
              <div className="artifact-bullet-title">例子</div>
              <ul>
                {point.examples.map((example, exampleIndex) => (
                  <li key={exampleIndex}>{example}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {point.source_excerpt ? (
            <details className="artifact-source-excerpt">
              <summary>原文摘录</summary>
              <p>{point.source_excerpt}</p>
            </details>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function JsonReadOnly({ value }: { value: unknown }) {
  return (
    <pre className="artifact-json-view">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
