import Link from "next/link";

import { StageHeader } from "@/components/stage-header";
import type { ProjectArtifactOverview } from "@/lib/review-store";

interface ReviewUnavailableProps {
  videoId: string;
  version: string;
  active: "review" | "script" | "storyboard" | "images";
  stageLabel: string;
  error: unknown;
  overview?: ProjectArtifactOverview;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法读取当前审核阶段的数据";
}

function hasReviewStage(overview: ProjectArtifactOverview | undefined): boolean {
  const steps = overview?.workflowSteps ?? [];
  return steps.includes("script_review") || steps.includes("storyboard_review") || steps.includes("image_review");
}

function unavailableMessage(
  active: ReviewUnavailableProps["active"],
  stageLabel: string,
  error: unknown,
  overview: ProjectArtifactOverview | undefined,
): string {
  if (overview && !hasReviewStage(overview)) {
    return "当前工作流未配置审核阶段，下面展示已生成的阶段产物。";
  }

  const raw = errorMessage(error);
  const missingArtifact = /Artifact not found: .*\/([^/]+\.json)$/i.exec(raw);
  if (missingArtifact) {
    return `${stageLabel}暂不可用：${missingArtifact[1]} 尚未生成。`;
  }
  if (active === "review") {
    return `${stageLabel}暂不可用，请先完成前置阶段产物。`;
  }
  return `${stageLabel}暂不可用：${raw}`;
}

export function ReviewUnavailable({
  videoId,
  version,
  active,
  stageLabel,
  error,
  overview,
}: ReviewUnavailableProps) {
  const base = `/projects/${videoId}/${version}`;
  const title = overview?.title || stageLabel;
  const generatedCount = overview?.artifacts.filter((artifact) => artifact.exists).length ?? 0;
  const subtitle = unavailableMessage(active, stageLabel, error, overview);

  return (
    <main className="shell">
      <StageHeader
        videoId={videoId}
        version={version}
        title={title}
        active={active}
        workflowSteps={overview?.workflowSteps}
      />
      <div className="panel artifact-overview-panel">
        <div className="artifact-overview-head">
          <div>
            <div className="section-title">项目产物概览</div>
            <div className="section-subtitle">
              {subtitle}
            </div>
          </div>
          {overview ? (
            <span className="badge in_review">
              已生成 {generatedCount}/{overview.artifacts.length}
            </span>
          ) : null}
        </div>
        <div className="artifact-overview-meta">
          <span>项目：{videoId}</span>
          <span>版本：{version}</span>
          {overview?.workflow ? <span>workflow：{overview.workflow}</span> : null}
          {overview?.source ? <span>source：{overview.source}</span> : null}
        </div>

        {overview ? (
          <>
            <div className="artifact-stage-grid">
              {overview.artifacts.map((artifact) => (
                <div className={`artifact-stage-card ${artifact.exists ? "done" : ""}`} key={artifact.stage}>
                  <div className="artifact-stage-title">{artifact.label}</div>
                  <div className="artifact-stage-file">{artifact.fileName}</div>
                  <span className={artifact.exists ? "badge approved" : "badge"}>
                    {artifact.exists ? "已生成" : "未生成"}
                  </span>
                </div>
              ))}
            </div>

            {overview.topics.length > 0 ? (
              <section className="artifact-section">
                <div className="artifact-section-head">
                  <div className="section-title small">选题产出</div>
                  <span className="badge">topics.json</span>
                </div>
                <div className="artifact-card-list">
                  {overview.topics.map((topic) => (
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
              </section>
            ) : null}

            {overview.scripts.length > 0 ? (
              <section className="artifact-section">
                <div className="artifact-section-head">
                  <div className="section-title small">脚本产出</div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="badge">scripts.json</span>
                    <Link href={`${base}/script`} className="badge">
                      打开脚本
                    </Link>
                  </div>
                </div>
                <div className="artifact-card-list">
                  {overview.scripts.map((script) => (
                    <article className="artifact-summary-card" key={script.topicIndex}>
                      <div className="artifact-summary-title">{script.title}</div>
                      <div className="artifact-summary-meta">
                        {script.lineCount} 句
                        {typeof script.totalDuration === "number" ? ` · ${script.totalDuration}s` : ""}
                      </div>
                      {script.previewLines.length > 0 ? (
                        <ol className="artifact-script-preview">
                          {script.previewLines.map((line, index) => (
                            <li key={`${script.topicIndex}-${index}`}>{line}</li>
                          ))}
                        </ol>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <div className="empty-state">
            <h3 className="empty-title">暂无可展示产物</h3>
            <p className="empty-desc">项目目录不存在或没有可读取的阶段文件。</p>
          </div>
        )}
      </div>
    </main>
  );
}
