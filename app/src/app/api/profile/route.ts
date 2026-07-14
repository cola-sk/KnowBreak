import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { resolveProjectRoot } from "@/lib/review-store";

export const runtime = "nodejs";

const OVERRIDES_FILE = "profile_overrides.json";

function overridesPath(): string {
  return path.join(
    resolveProjectRoot(),
    "profiles",
    OVERRIDES_FILE,
  );
}

export async function GET() {
  try {
    if (!existsSync(overridesPath())) {
      return NextResponse.json({});
    }
    const text = await fs.readFile(overridesPath(), "utf-8");
    return NextResponse.json(JSON.parse(text));
  } catch {
    return NextResponse.json({});
  }
}

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

  const target = overridesPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(body, null, 2), "utf-8");
  await fs.rename(tmp, target);

  return NextResponse.json({ ok: true });
}
