import { NextResponse } from "next/server";

import { deleteCustomWorkflow, readWorkflowDetail } from "@/lib/workflow-store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string[] }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const workflow = await readWorkflowDetail(id);
    return NextResponse.json({ workflow });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to read workflow" },
      { status: 404 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteCustomWorkflow(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to delete workflow" },
      { status: 400 },
    );
  }
}
