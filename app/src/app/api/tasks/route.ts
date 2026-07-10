import { NextResponse } from "next/server";

import { listStartJobs, readJobDetail } from "@/lib/start-store";

export const runtime = "nodejs";

export async function GET() {
  const jobs = await listStartJobs();
  const summaries = await Promise.all(jobs.map(async (job) => {
    const detail = await readJobDetail(job.id);
    return {
      ...(detail?.job ?? job),
      currentStage: detail?.currentStage ?? null,
      stages: detail?.stages ?? [],
    };
  }));
  return NextResponse.json({ jobs: summaries });
}
