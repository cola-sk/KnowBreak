import { NextResponse } from "next/server";

import { approveReviewStage } from "@/lib/review-store";
import type { ReviewStage } from "@/lib/types";

const ALLOWED_STAGES: ReviewStage[] = ["script_review", "storyboard_review", "image_review"];

export async function POST(
  _: Request,
  context: { params: Promise<{ videoId: string; version: string; stage: string }> },
) {
  try {
    const params = await context.params;
    if (!ALLOWED_STAGES.includes(params.stage as ReviewStage)) {
      return NextResponse.json({ error: `Invalid review stage: ${params.stage}` }, { status: 400 });
    }
    const review = await approveReviewStage(
      params.videoId,
      params.version,
      params.stage as ReviewStage,
    );
    return NextResponse.json({ review });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to approve review stage" },
      { status: 400 },
    );
  }
}
