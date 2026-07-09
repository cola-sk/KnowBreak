import { NextResponse } from "next/server";

import { getStageData, updateStageData } from "@/lib/review-store";

export async function GET(
  _: Request,
  context: { params: Promise<{ videoId: string; version: string }> },
) {
  try {
    const params = await context.params;
    const data = await getStageData(params.videoId, params.version, "storyboard");
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read storyboard stage" },
      { status: 404 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ videoId: string; version: string }> },
) {
  try {
    const params = await context.params;
    const body = (await request.json()) as { artifact?: unknown; review?: unknown };
    const data = await updateStageData(params.videoId, params.version, "storyboard", {
      artifact: body.artifact,
      review: body.review as never,
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update storyboard stage" },
      { status: 400 },
    );
  }
}
