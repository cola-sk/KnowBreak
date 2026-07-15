import { ImageReviewClient, type ImageReviewPayload } from "@/components/image-review-client";
import { ReviewUnavailable } from "@/components/review-unavailable";
import { StageHeader } from "@/components/stage-header";
import { getProjectArtifactOverview, getReviewStatuses, getStageData } from "@/lib/review-store";

interface Props {
  params: Promise<{ videoId: string; version: string }>;
}

export default async function ImageReviewPage({ params }: Props) {
  const { videoId, version } = await params;
  try {
    const initial = (await getStageData(
      videoId,
      version,
    "images",
    )) as ImageReviewPayload;
    const [scriptData, storyboardData] = await Promise.all([
      getStageData(videoId, version, "script").catch(() => null),
      getStageData(videoId, version, "storyboard").catch(() => null),
    ]);
    const overview = await getProjectArtifactOverview(videoId, version).catch(() => null);
    const title = initial.artifact[0]?.title;
    const reviewStatuses = {
      ...(await getReviewStatuses(videoId, version)),
      image_review: initial.review.status,
    };
    return (
      <main className="shell">
        <StageHeader
          videoId={videoId}
          version={version}
          title={title}
          active="images"
          reviewStatuses={reviewStatuses}
          workflowSteps={overview?.workflowSteps}
        />
        <ImageReviewClient
          videoId={videoId}
          version={version}
          initial={initial}
          context={{
            script: scriptData?.artifact as never,
            storyboard: storyboardData?.artifact as never,
          }}
        />
      </main>
    );
  } catch (error) {
    const overview = await getProjectArtifactOverview(videoId, version).catch(() => null);
    return (
      <ReviewUnavailable
        videoId={videoId}
        version={version}
        active="images"
        stageLabel="图片审核"
        error={error}
        overview={overview ?? undefined}
      />
    );
  }
}
