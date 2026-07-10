import { NextResponse } from "next/server";

import { getProductionReviewData } from "@/lib/review-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ videoId: string; version: string }> },
) {
  try {
    const { videoId, version } = await context.params;
    const data = await getProductionReviewData(videoId, version);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read project review data" },
      { status: 404 },
    );
  }
}
