import { NextResponse } from "next/server";

import {
  parseRegenerationStage,
  readRegenerationJobForId,
  readRegenerationJobLogForId,
} from "@/lib/review-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ videoId: string; version: string; jobId: string }> },
) {
  const { videoId, version, jobId } = await context.params;
  const job = await readRegenerationJobForId(videoId, version, jobId);
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  const { text, updatedAt } = await readRegenerationJobLogForId(videoId, version, jobId);
  const currentStage = parseRegenerationStage(text);
  return NextResponse.json({
    job,
    logText: text,
    logUpdatedAt: updatedAt,
    currentStage,
  });
}
