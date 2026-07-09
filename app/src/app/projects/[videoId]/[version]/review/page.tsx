import { notFound } from "next/navigation";

import {
  ProductionReviewClient,
  type ProductionReviewPayload,
} from "@/components/production-review-client";
import { StageHeader } from "@/components/stage-header";
import { getProductionReviewData } from "@/lib/review-store";

interface Props {
  params: Promise<{ videoId: string; version: string }>;
}

export default async function ProductionReviewPage({ params }: Props) {
  try {
    const { videoId, version } = await params;
    const initial = (await getProductionReviewData(videoId, version)) as ProductionReviewPayload;
    return (
      <main className="shell">
        <StageHeader videoId={videoId} version={version} title={initial.title} active="review" />
        <ProductionReviewClient initial={initial} />
      </main>
    );
  } catch {
    notFound();
  }
}
