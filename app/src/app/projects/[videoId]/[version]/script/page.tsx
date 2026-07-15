import { ReviewUnavailable } from "@/components/review-unavailable";
import { ScriptReviewClient, type ScriptReviewPayload } from "@/components/script-review-client";
import { StageHeader } from "@/components/stage-header";
import { getProjectArtifactOverview, getReviewStatuses, getStageData } from "@/lib/review-store";

interface Props {
  params: Promise<{ videoId: string; version: string }>;
}

export default async function ScriptReviewPage({ params }: Props) {
  const { videoId, version } = await params;
  try {
    const initial = (await getStageData(
      videoId,
      version,
      "script",
    )) as ScriptReviewPayload;
    const overview = await getProjectArtifactOverview(videoId, version).catch(() => null);
    const title = initial.artifact.scripts[0]?.title;
    const reviewStatuses = {
      ...(await getReviewStatuses(videoId, version)),
      script_review: initial.review.status,
    };
    return (
      <main className="shell">
        <StageHeader
          videoId={videoId}
          version={version}
          title={title}
          active="script"
          reviewStatuses={reviewStatuses}
          workflowSteps={overview?.workflowSteps}
          hasProductionArtifact={Boolean(overview?.artifacts.some((artifact) => artifact.stage === "compose" && artifact.exists))}
        />
        <ScriptReviewClient videoId={videoId} version={version} initial={initial} />
      </main>
    );
  } catch (error) {
    const overview = await getProjectArtifactOverview(videoId, version).catch(() => null);
    return (
      <ReviewUnavailable
        videoId={videoId}
        version={version}
        active="script"
        stageLabel="脚本审核"
        error={error}
        overview={overview ?? undefined}
      />
    );
  }
}
