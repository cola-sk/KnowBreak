import { NextResponse } from "next/server";

import { listProjectSummaries, resolveOutDir } from "@/lib/review-store";

export async function GET() {
  try {
    const projects = await listProjectSummaries();
    return NextResponse.json({
      outDir: resolveOutDir(),
      projects,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list projects" },
      { status: 500 },
    );
  }
}
