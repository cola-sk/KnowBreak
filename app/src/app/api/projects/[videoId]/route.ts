import { NextResponse } from "next/server";

import { deleteProjectRecord } from "@/lib/review-store";

export async function DELETE(
  _: Request,
  context: { params: Promise<{ videoId: string }> },
) {
  try {
    const { videoId } = await context.params;
    const result = await deleteProjectRecord(videoId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to delete project" },
      { status: 400 },
    );
  }
}
