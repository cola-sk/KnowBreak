import { NextResponse } from "next/server";

import { getVersionStartPreset } from "@/lib/review-store";

export async function GET(
  _: Request,
  context: { params: Promise<{ videoId: string; version: string }> },
) {
  try {
    const { videoId, version } = await context.params;
    const preset = await getVersionStartPreset(videoId, version);
    return NextResponse.json({ preset });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to read start preset" },
      { status: 400 },
    );
  }
}
