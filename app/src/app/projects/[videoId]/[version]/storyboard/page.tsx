import { ReviewUnavailable } from "@/components/review-unavailable";
import { StageHeader } from "@/components/stage-header";
import {
  StoryboardReviewClient,
  type StoryboardReviewPayload,
} from "@/components/storyboard-review-client";
import { getProjectArtifactOverview, getReviewStatuses, getStageData } from "@/lib/review-store";

interface Props {
  params: Promise<{ videoId: string; version: string }>;
}

export default async function StoryboardReviewPage({ params }: Props) {
  const { videoId, version } = await params;
  try {
    const initial = (await getStageData(
      videoId,
      version,
      "storyboard",
    )) as StoryboardReviewPayload;
    const overview = await getProjectArtifactOverview(videoId, version).catch(() => null);
    const title = initial.artifact.storyboards[0]?.title;
    const reviewStatuses = {
      ...(await getReviewStatuses(videoId, version)),
      storyboard_review: initial.review.status,
    };
    return (
      <main className="shell">
        <StageHeader
          videoId={videoId}
          version={version}
          title={title}
          active="storyboard"
          reviewStatuses={reviewStatuses}
          workflowSteps={overview?.workflowSteps}
          hasProductionArtifact={Boolean(overview?.artifacts.some((artifact) => artifact.stage === "compose" && artifact.exists))}
        />
        <StoryboardReviewClient videoId={videoId} version={version} initial={initial} />
      </main>
    );
  } catch (error) {
    const overview = await getProjectArtifactOverview(videoId, version).catch(() => null);
    return (
      <ReviewUnavailable
        videoId={videoId}
        version={version}
        active="storyboard"
        stageLabel="分镜审核"
        error={error}
        overview={overview ?? undefined}
      />
    );
  }
}
