import { NextResponse } from "next/server";

import { approveAllReviewStages, deleteProjectRecord, deleteVersionRecord, setVersionIgnored } from "@/lib/review-store";

type Action = "approve_all" | "ignore" | "unignore" | "delete_version" | "delete_project";

export async function POST(
  request: Request,
  context: { params: Promise<{ videoId: string; version: string }> },
) {
  try {
    const { videoId, version } = await context.params;
    const body = (await request.json()) as { action?: Action };
    const action = body.action;

    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    if (action === "approve_all") {
      const result = await approveAllReviewStages(videoId, version);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "ignore") {
      const flags = await setVersionIgnored(videoId, version, true);
      return NextResponse.json({ ok: true, flags });
    }
    if (action === "unignore") {
      const flags = await setVersionIgnored(videoId, version, false);
      return NextResponse.json({ ok: true, flags });
    }
    if (action === "delete_version") {
      const result = await deleteVersionRecord(videoId, version);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "delete_project") {
      const result = await deleteProjectRecord(videoId);
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: `unknown action: ${String(action)}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to run action" },
      { status: 400 },
    );
  }
}
