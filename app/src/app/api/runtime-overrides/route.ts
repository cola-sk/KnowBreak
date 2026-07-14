import { NextResponse } from "next/server";

import { writeGlobalRuntimeOverrides } from "@/lib/tts-settings-server";
import type { ProjectRuntimeOverrides } from "@/lib/tts-settings";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "请求体必须是 JSON 对象" }, { status: 400 });
  }

  await writeGlobalRuntimeOverrides(body as ProjectRuntimeOverrides);
  return NextResponse.json({ ok: true });
}
