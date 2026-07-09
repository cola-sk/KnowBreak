import { ReviewUnavailable } from "@/components/review-unavailable";
import { StageHeader } from "@/components/stage-header";
import {
  StoryboardReviewClient,
  type StoryboardReviewPayload,
} from "@/components/storyboard-review-client";
import { getStageData } from "@/lib/review-store";

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
    const title = initial.artifact.storyboards[0]?.title;
    return (
      <main className="shell">
        <StageHeader videoId={videoId} version={version} title={title} active="storyboard" />
        <StoryboardReviewClient videoId={videoId} version={version} initial={initial} />
      </main>
    );
  } catch (error) {
    return (
      <ReviewUnavailable
        videoId={videoId}
        version={version}
        active="storyboard"
        stageLabel="分镜审核"
        error={error}
      />
    );
  }
}
