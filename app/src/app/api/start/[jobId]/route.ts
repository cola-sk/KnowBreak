import { NextResponse } from "next/server";

import { cancelStartJob, deleteStartJob, readJobDetail } from "@/lib/start-store";

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

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const body = await request.json().catch(() => ({})) as { action?: string };
  if (body.action !== "cancel") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }

  try {
    const job = await cancelStartJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "job not found" }, { status: 404 });
    }
    const detail = await readJobDetail(jobId);
    return NextResponse.json(detail ?? { job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to cancel job" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  try {
    const deleted = await deleteStartJob(jobId);
    if (!deleted) {
      return NextResponse.json({ error: "job not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to delete job" },
      { status: 409 },
    );
  }
}
