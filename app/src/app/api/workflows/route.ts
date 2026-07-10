import { NextResponse } from "next/server";

import { listWorkflowPayload, saveCustomWorkflow } from "@/lib/workflow-store";

export const runtime = "nodejs";

export async function GET() {
  const payload = await listWorkflowPayload();
  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const workflow = await saveCustomWorkflow(body);
    return NextResponse.json({ ok: true, workflow });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to save workflow" },
      { status: 400 },
    );
  }
}
