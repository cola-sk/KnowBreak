import { ProjectArtifactOverviewClient } from "@/components/project-artifact-overview-client";
import { StageHeader } from "@/components/stage-header";
import type { ProjectArtifactOverview } from "@/lib/review-store";

interface ReviewUnavailableProps {
  videoId: string;
  version: string;
  active: "review" | "script" | "storyboard" | "images";
  stageLabel: string;
  error: unknown;
  overview?: ProjectArtifactOverview;
  taskHref?: string;
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
): string | null {
  if (overview && !hasReviewStage(overview)) {
    return null;
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
  taskHref,
}: ReviewUnavailableProps) {
  const title = overview?.title || stageLabel;
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
      {subtitle ? (
        <div className="notice" style={{ marginBottom: 14 }}>
          {subtitle}
        </div>
      ) : null}
      {overview ? (
        <ProjectArtifactOverviewClient overview={overview} taskHref={taskHref} />
      ) : (
        <div className="panel artifact-overview-panel">
          <div className="empty-state">
            <h3 className="empty-title">暂无可展示产物</h3>
            <p className="empty-desc">项目目录不存在或没有可读取的阶段文件。</p>
          </div>
        </div>
      )}
    </main>
  );
}
