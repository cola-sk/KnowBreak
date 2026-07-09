import { notFound } from "next/navigation";

import { ImageReviewClient, type ImageReviewPayload } from "@/components/image-review-client";
import { StageHeader } from "@/components/stage-header";
import { getStageData } from "@/lib/review-store";

interface Props {
  params: Promise<{ videoId: string; version: string }>;
}

export default async function ImageReviewPage({ params }: Props) {
  try {
    const { videoId, version } = await params;
    const initial = (await getStageData(
      videoId,
      version,
      "images",
    )) as ImageReviewPayload;
    return (
      <main className="shell">
        <StageHeader videoId={videoId} version={version} active="images" />
        <ImageReviewClient videoId={videoId} version={version} initial={initial} />
      </main>
    );
  } catch {
    notFound();
  }
}
