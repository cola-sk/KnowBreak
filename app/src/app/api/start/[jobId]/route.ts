import { NextResponse } from "next/server";

import { readJobDetail } from "@/lib/start-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const detail = await readJobDetail(jobId);
  if (!detail) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
