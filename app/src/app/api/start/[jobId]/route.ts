import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { buildRuntimeEnv } from "@/lib/runtime-env";
import { getVersionDir, resolveProjectRoot } from "@/lib/review-store";
import {
  cancelStartJob,
  deleteStartJob,
  type StartJob,
  type StartJobDetail,
  jobLogPath,
  jobMetaPath,
  parseRunIds,
  readJobDetail,
  relativeJobLogPath,
  writeJobMeta,
} from "@/lib/start-store";
import { runtimeOverridesToEnv, type ProjectRuntimeOverrides } from "@/lib/tts-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

interface JobActionBody {
  action?: "cancel" | "resume";
  startFrom?: string;
}

function normalizeResumeMode(version: string | null): "legacy" | "update" {
  if (!version || version === "legacy") {
    return "legacy";
  }
  return "update";
}

async function readCurrent(jobId: string): Promise<StartJob | null> {
  try {
    const text = await fs.readFile(jobMetaPath(jobId), "utf-8");
    return JSON.parse(text) as StartJob;
  } catch {
    return null;
  }
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function resolveResumeStage(detail: StartJobDetail, requested?: string): string {
  const candidate = (requested?.trim() || detail.currentStage || detail.job.startFrom || "").trim();
  if (!candidate) {
    throw new Error("无法判断续跑阶段：当前日志里没有可恢复的阶段信息");
  }
  const workflowSteps = detail.stages.map((item) => item.stage);
  if (workflowSteps.length > 0 && !workflowSteps.includes(candidate)) {
    throw new Error(`续跑阶段非法：${candidate}`);
  }
  return candidate;
}

async function resumeFromJob(detail: StartJobDetail, requestedStage?: string): Promise<StartJob> {
  if (detail.job.status === "running") {
    throw new Error("任务仍在运行，无需续跑");
  }

  const resumeStage = resolveResumeStage(detail, requestedStage);
  const mode = normalizeResumeMode(detail.job.version);
  const jobId = randomUUID();
  const args = [
    "run",
    "knowbreak",
    "run",
    detail.job.source,
    "--workflow",
    detail.job.workflow,
    "--version-mode",
    mode,
  ];
  if (mode === "update" && detail.job.version) {
    args.push("--version", detail.job.version);
  }
  args.push("--from", resumeStage);
  if (detail.job.videoId) {
    args.push("--video-id", detail.job.videoId);
  }

  const command = ["uv", ...args];
  const logPath = jobLogPath(jobId);
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  let projectOverrides: Record<string, unknown> | undefined;
  let runtimeOverrides: ProjectRuntimeOverrides | undefined;
  if (detail.job.videoId && detail.job.version) {
    const versionDir = getVersionDir(detail.job.videoId, detail.job.version);
    projectOverrides = await readJsonObject(path.join(versionDir, "project_profile_overrides.json"));
    const parsedRuntime = await readJsonObject(path.join(versionDir, "project_runtime_overrides.json"));
    if (parsedRuntime) {
      runtimeOverrides = parsedRuntime as ProjectRuntimeOverrides;
    }
  }

  const initial: StartJob = {
    id: jobId,
    taskType: "start",
    status: "running",
    input: detail.job.input,
    source: detail.job.source,
    workflow: detail.job.workflow,
    videoId: detail.job.videoId,
    version: detail.job.version,
    command,
    logPath: relativeJobLogPath(jobId),
    startedAt: new Date().toISOString(),
    mode: mode === "update" ? "update" : undefined,
    startFrom: resumeStage,
  };
  await writeJobMeta(initial);

  const logStream = createWriteStream(logPath, { flags: "a" });
  logStream.write(`$ uv ${args.map((arg) => JSON.stringify(arg)).join(" ")}\n\n`);

  const projectRoot = resolveProjectRoot();
  const childEnv = await buildRuntimeEnv(projectRoot, {
    KB_REVIEW_AUTO_APPROVE: "0",
    ...(projectOverrides ? { KB_PROJECT_PROFILE_OVERRIDES: JSON.stringify(projectOverrides) } : {}),
    ...(runtimeOverrides ? { KB_PROJECT_RUNTIME_OVERRIDES: JSON.stringify(runtimeOverrides) } : {}),
    ...runtimeOverridesToEnv(runtimeOverrides),
  });

  const child = spawn("uv", args, {
    cwd: projectRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const running = { ...initial, pid: child.pid } satisfies StartJob;
  await writeJobMeta(running);

  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });

  let finalized = false;
  let capturedOutput = "";
  const finalize = async (patch: Partial<StartJob>) => {
    if (finalized) {
      return;
    }
    finalized = true;
    const current = (await readCurrent(jobId)) ?? running;
    const parsed = parseRunIds(capturedOutput);
    const preserveCanceled = current.status === "canceled";
    const finished: StartJob = {
      ...current,
      ...patch,
      status: preserveCanceled ? "canceled" : patch.status ?? current.status,
      videoId: current.videoId ?? parsed.videoId ?? null,
      version: current.version ?? parsed.version ?? null,
      error: preserveCanceled ? current.error : patch.error,
      finishedAt: new Date().toISOString(),
    };
    logStream.end(`\n[start:${finished.status}] ${finished.finishedAt}\n`);
    await writeJobMeta(finished);
  };

  const lineBuffer: string[] = [];
  child.stdout.on("data", async (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    capturedOutput += text;
    lineBuffer.push(text);
    const joined = lineBuffer.join("");
    const lines = joined.split(/\r?\n/);
    lineBuffer.length = 0;
    const partial = lines.pop();
    if (partial !== undefined) {
      lineBuffer.push(partial);
    }
    for (const line of lines) {
      const parsed = parseRunIds(line);
      if (!parsed.videoId && !parsed.version) {
        continue;
      }
      const current = (await readCurrent(jobId)) ?? running;
      const next: StartJob = {
        ...current,
        videoId: parsed.videoId ?? current.videoId,
        version: parsed.version ?? current.version,
      };
      await writeJobMeta(next);
    }
  });

  child.on("error", (error) => {
    void finalize({ status: "failed", error: error.message });
  });
  child.on("close", (code) => {
    void finalize({
      status: code === 0 ? "succeeded" : "failed",
      exitCode: code ?? undefined,
      error: code === 0 ? undefined : `knowbreak exited with code ${code}`,
    });
  });

  return running;
}

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const detail = await readJobDetail(jobId);
  if (!detail) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}

export async function POST(request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const body = await request.json().catch(() => ({})) as JobActionBody;
  const action = body.action ?? "cancel";

  if (action === "cancel") {
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

  if (action === "resume") {
    try {
      const detail = await readJobDetail(jobId);
      if (!detail) {
        return NextResponse.json({ error: "job not found" }, { status: 404 });
      }
      const resumed = await resumeFromJob(detail, body.startFrom);
      return NextResponse.json({ ok: true, job: resumed, resumedFrom: jobId });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "failed to resume job" },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ error: "unsupported action" }, { status: 400 });
}

export async function DELETE(_request: Request, context: RouteContext) {
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
