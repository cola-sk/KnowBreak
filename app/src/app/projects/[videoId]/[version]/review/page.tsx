import {
  ProductionReviewClient,
  type ProductionReviewPayload,
} from "@/components/production-review-client";
import { ReviewUnavailable } from "@/components/review-unavailable";
import { StageHeader } from "@/components/stage-header";
import { readProfileBase, readProfileOverrides } from "@/lib/profile-server";
import { getProductionReviewData } from "@/lib/review-store";
import { readTtsRuntimeDefaults } from "@/lib/tts-settings-server";

interface Props {
  params: Promise<{ videoId: string; version: string }>;
}

export default async function ProductionReviewPage({ params }: Props) {
  const { videoId, version } = await params;
  try {
    const [initial, profileBase, globalOverrides, ttsDefaults] = await Promise.all([
      getProductionReviewData(videoId, version) as Promise<ProductionReviewPayload>,
      readProfileBase(),
      readProfileOverrides(),
      readTtsRuntimeDefaults(),
    ]);
    const reviewStatuses = Object.fromEntries(
      Object.entries(initial.reviews).map(([stage, review]) => [stage, review?.status]),
    );
    return (
      <main className="shell">
        <StageHeader
          videoId={videoId}
          version={version}
          title={initial.title}
          active="review"
          reviewStatuses={reviewStatuses}
        />
        <ProductionReviewClient
          initial={initial}
          profileBase={profileBase}
          globalOverrides={globalOverrides}
          ttsDefaults={ttsDefaults}
        />
      </main>
    );
  } catch (error) {
    return (
      <ReviewUnavailable
        videoId={videoId}
        version={version}
        active="review"
        stageLabel="成片审核"
        error={error}
      />
    );
  }
}
