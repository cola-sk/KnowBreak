import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import { buildRuntimeEnv } from "@/lib/runtime-env";
import { listWorkflows, resolveProjectRoot } from "@/lib/review-store";
import { runtimeOverridesToEnv, type ProjectRuntimeOverrides } from "@/lib/tts-settings";
import {
  type StartJob,
  jobLogPath,
  jobMetaPath,
  parseRunIds,
  relativeJobLogPath,
  writeJobMeta,
} from "@/lib/start-store";

export const runtime = "nodejs";

const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const URL_RE = /^(https?:\/\/|youtu\.be\/|youtube\.com)/i;

interface StartRequest {
  input?: string;
  workflow?: string;
  projectOverrides?: Record<string, any>;
  runtimeOverrides?: ProjectRuntimeOverrides;
}

function validateWorkflow(workflow: string): string {
  const segments = workflow.split("/");
  if (segments.length === 0 || segments.some((segment) => !isSafeWorkflowSegment(segment))) {
    throw new Error("workflow 名称非法");
  }
  return workflow;
}

function isSafeWorkflowSegment(segment: string): boolean {
  return SAFE_SEGMENT_RE.test(segment) && segment !== "." && segment !== "..";
}

function resolveSource(input: string): { source: string; kind: "url" | "topic" } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("输入不能为空");
  }
  if (URL_RE.test(trimmed)) {
    return { source: trimmed, kind: "url" };
  }
  return { source: `manual:${trimmed}`, kind: "topic" };
}

async function validateWorkflowInputMode(workflowName: string, inputKind: "url" | "topic"): Promise<void> {
  const workflows = await listWorkflows();
  const workflow = workflows.find((item) => item.path === workflowName || item.id === workflowName);
  if (!workflow) {
    throw new Error(`workflow 不存在: ${workflowName}`);
  }
  if (inputKind === "url" && workflow.inputMode === "topic") {
    throw new Error("当前工作流是主题直出流程，不会处理 YouTube 视频；请选择包含 ASR 的视频工作流，或改用主题文本输入。");
  }
  if (inputKind === "topic" && workflow.inputMode === "video") {
    throw new Error("当前工作流需要视频源；请选择 topic_seed 类主题工作流，或输入 YouTube URL。");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StartRequest;
    const workflow = validateWorkflow((body.workflow ?? "topic_seed_review").trim());
    const { source, kind } = resolveSource(body.input ?? "");
    await validateWorkflowInputMode(workflow, kind);

    const jobId = randomUUID();
    const args = [
      "run",
      "knowbreak",
      "run",
      source,
      "--workflow",
      workflow,
      "--version-mode",
      "create",
    ];
    const command = ["uv", ...args];

    const logPath = jobLogPath(jobId);
    await fs.mkdir(path.dirname(logPath), { recursive: true });

    const initial: StartJob = {
      id: jobId,
      status: "running",
      input: body.input ?? "",
      source,
      workflow,
      videoId: null,
      version: null,
      command,
      logPath: relativeJobLogPath(jobId),
      startedAt: new Date().toISOString(),
    };
    await writeJobMeta(initial);

    const logStream = createWriteStream(logPath, { flags: "a" });
    logStream.write(`$ uv ${args.map((arg) => JSON.stringify(arg)).join(" ")}\n\n`);

    const projectRoot = resolveProjectRoot();
    const childEnv = await buildRuntimeEnv(projectRoot, {
      KB_REVIEW_AUTO_APPROVE: "0",
      ...(body.projectOverrides ? { KB_PROJECT_PROFILE_OVERRIDES: JSON.stringify(body.projectOverrides) } : {}),
      ...(body.runtimeOverrides ? { KB_PROJECT_RUNTIME_OVERRIDES: JSON.stringify(body.runtimeOverrides) } : {}),
      ...runtimeOverridesToEnv(body.runtimeOverrides),
    });

    const child = spawn("uv", args, {
      cwd: projectRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const running = { ...initial, pid: child.pid } as StartJob & { pid?: number };
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
        if (parsed.videoId || parsed.version) {
          const current = (await readCurrent(jobId)) ?? running;
          const next: StartJob = {
            ...current,
            videoId: parsed.videoId ?? current.videoId,
            version: parsed.version ?? current.version,
          };
          await writeJobMeta(next);
        }
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

    return NextResponse.json({ ok: true, job: running });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to start" },
      { status: 400 },
    );
  }
}

async function readCurrent(jobId: string): Promise<StartJob | null> {
  try {
    const text = await fs.readFile(jobMetaPath(jobId), "utf-8");
    return JSON.parse(text) as StartJob;
  } catch {
    return null;
  }
}
