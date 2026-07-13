import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import { buildRuntimeEnv } from "@/lib/runtime-env";
import type { RegenerationJob } from "@/lib/types";
import {
  getProductionReviewData,
  getVersionDir,
  listRegenerationJobs,
  readRegenerationJob,
  resolveOutDir,
  resolveReviewRelativePath,
  resolveWorkflowCliName,
  writeRegenerationJob,
} from "@/lib/review-store";
import {
  type StartJob,
  jobLogPath,
  jobMetaPath,
  relativeJobLogPath,
  writeJobMeta,
} from "@/lib/start-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ videoId: string; version: string }> },
) {
  const { videoId, version } = await context.params;
  const jobs = await listRegenerationJobs(videoId, version);
  const current = await readRegenerationJob(videoId, version);
  return NextResponse.json({ jobs, current });
}

type VersionMode = "create" | "update";
type CommandVersionMode = "legacy" | VersionMode;

const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const STARTABLE_STAGES = new Set([
  "asr",
  "extract",
  "topics",
  "topic_seed",
  "rewrite",
  "script",
  "script_review",
  "storyboard",
  "storyboard_review",
  "assets",
  "images",
  "image_review",
  "tts",
  "compose",
]);

interface RegenerateRequest {
  mode?: VersionMode;
  startFrom?: string;
  targetVersion?: string;
  workflow?: string;
  source?: string;
  projectOverrides?: Record<string, any>;
}

function resolveProjectRoot(): string {
  const candidates = [
    process.env.KB_PROJECT_ROOT,
    process.cwd(),
    path.resolve(process.cwd(), ".."),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "pyproject.toml"))) {
      return candidate;
    }
  }
  return path.resolve(process.cwd(), "..");
}

function validateVersion(version: string): string {
  if (!SAFE_SEGMENT_RE.test(version)) {
    throw new Error("version 只能包含字母、数字、点、下划线和中划线");
  }
  return version;
}

function validateWorkflowName(workflow: string): string {
  const segments = workflow.split("/");
  if (segments.length === 0 || segments.some((segment) => !SAFE_SEGMENT_RE.test(segment))) {
    throw new Error("workflow 名称非法");
  }
  return workflow;
}

async function nextVersion(videoId: string): Promise<string> {
  const baseDir = path.join(resolveOutDir(), validateVersion(videoId));
  let max = 0;
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const match = /^v(\d{3,})$/.exec(entry.name);
      if (match) {
        max = Math.max(max, Number(match[1]));
      }
    }
  } catch {
    return "v001";
  }
  return `v${String(max + 1).padStart(3, "0")}`;
}

function normalizeStartFrom(value: string | undefined): string | undefined {
  if (!value || value === "start") {
    return undefined;
  }
  if (!STARTABLE_STAGES.has(value)) {
    throw new Error(`未知起始阶段: ${value}`);
  }
  return value;
}

const URL_RE = /^(https?:\/\/|youtu\.be\/|youtube\.com)/i;

function normalizeSource(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("source 不能为空");
  }
  if (URL_RE.test(trimmed) || trimmed.startsWith("manual:")) {
    return trimmed;
  }
  return `manual:${trimmed}`;
}

async function persistJobCopies(
  videoId: string,
  versions: string[],
  job: RegenerationJob,
): Promise<void> {
  await Promise.all(versions.map((version) => writeRegenerationJob(videoId, version, job)));
}

async function readCurrentTask(jobId: string): Promise<StartJob | null> {
  try {
    const text = await fs.readFile(jobMetaPath(jobId), "utf-8");
    return JSON.parse(text) as StartJob;
  } catch {
    return null;
  }
}

async function listJsonFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }

  return files;
}

function rebasePathStrings(value: unknown, oldPrefix: string, newPrefix: string): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    if (value.startsWith(oldPrefix)) {
      return { value: `${newPrefix}${value.slice(oldPrefix.length)}`, changed: true };
    }
    return { value, changed: false };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const rebased = rebasePathStrings(item, oldPrefix, newPrefix);
      changed = changed || rebased.changed;
      return rebased.value;
    });
    return { value: items, changed };
  }

  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const rebased = rebasePathStrings(item, oldPrefix, newPrefix);
      changed = changed || rebased.changed;
      next[key] = rebased.value;
    }
    return { value: next, changed };
  }

  return { value, changed: false };
}

async function rebaseCopiedVersionJsonPaths(
  videoId: string,
  currentVersion: string,
  targetVersion: string,
  targetDir: string,
): Promise<void> {
  const oldPrefix = currentVersion === "legacy" ? `${videoId}/` : `${videoId}/${currentVersion}/`;
  const newPrefix = `${videoId}/${targetVersion}/`;

  for (const file of await listJsonFiles(targetDir)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(file, "utf-8"));
    } catch {
      continue;
    }
    const rebased = rebasePathStrings(parsed, oldPrefix, newPrefix);
    if (!rebased.changed) {
      continue;
    }
    await fs.writeFile(file, JSON.stringify(rebased.value, null, 2), "utf-8");
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ videoId: string; version: string }> },
) {
  try {
    const { videoId, version } = await context.params;
    const currentVersion = validateVersion(version);
    validateVersion(videoId);

    const body = (await request.json()) as RegenerateRequest;
    const mode: VersionMode = body.mode === "create" ? "create" : "update";
    const startFrom = normalizeStartFrom(body.startFrom);
    const currentData = await getProductionReviewData(videoId, currentVersion);
    const rawSource = (body.source?.trim() || currentData.source).trim();
    const source = normalizeSource(rawSource);
    const workflow = await resolveWorkflowCliName(
      (body.workflow?.trim() || currentData.workflow || "serious_science_one").trim(),
    );

    validateWorkflowName(workflow);

    let commandMode: CommandVersionMode = mode;
    let commandVersion: string | undefined = currentVersion;
    let targetVersion = mode === "update" && currentVersion !== "legacy" ? currentVersion : body.targetVersion?.trim();
    let jobVersion = currentVersion;

    if (mode === "update" && currentVersion === "legacy") {
      commandMode = "legacy";
      commandVersion = undefined;
      targetVersion = undefined;
    }

    if (mode === "create") {
      if (targetVersion) {
        validateVersion(targetVersion);
      } else {
        targetVersion = await nextVersion(videoId);
      }
      if (targetVersion === videoId) {
        throw new Error("新版本号不能与 video_id 相同；请使用 v001、v002 或 draft-a 这类名称");
      }

      if (startFrom) {
        const targetDir = getVersionDir(videoId, targetVersion);
        if (existsSync(targetDir)) {
          throw new Error(`目标版本已存在: ${targetVersion}`);
        }
        await fs.cp(getVersionDir(videoId, currentVersion), targetDir, { recursive: true });
        await rebaseCopiedVersionJsonPaths(videoId, currentVersion, targetVersion, targetDir);
        commandMode = "update";
        commandVersion = targetVersion;
        jobVersion = targetVersion;
      } else {
        commandMode = "create";
        commandVersion = targetVersion;
      }
    }

    // Save project profile overrides if provided and the folder exists
    if (body.projectOverrides) {
      const activeDir = getVersionDir(videoId, jobVersion);
      if (existsSync(activeDir)) {
        await fs.mkdir(activeDir, { recursive: true });
        await fs.writeFile(
          path.join(activeDir, "project_profile_overrides.json"),
          JSON.stringify(body.projectOverrides, null, 2),
          "utf-8"
        );
      }
    }

    const args = [
      "run",
      "knowbreak",
      "run",
      source,
      "--workflow",
      workflow,
      "--version-mode",
      commandMode,
      "--video-id",
      videoId,
    ];

    if (commandVersion) {
      args.push("--version", commandVersion);
    }
    if (startFrom) {
      args.push("--from", startFrom);
    }

    const jobId = randomUUID();
    const logPath = path.join(getVersionDir(videoId, jobVersion), "reviews", `regenerate_${jobId}.log`);
    const taskLogPath = jobLogPath(jobId);
    await Promise.all([
      fs.mkdir(path.dirname(logPath), { recursive: true }),
      fs.mkdir(path.dirname(taskLogPath), { recursive: true }),
    ]);

    const job: RegenerationJob = {
      id: jobId,
      status: "running",
      mode,
      requestedFromVersion: currentVersion,
      targetVersion,
      startFrom,
      workflow,
      source,
      command: ["uv", ...args],
      logPath: resolveReviewRelativePath(logPath),
      startedAt: new Date().toISOString(),
    };
    const taskJob: StartJob = {
      id: jobId,
      taskType: "regenerate",
      status: "running",
      input: `重新生成 ${videoId}/${currentVersion}${targetVersion && targetVersion !== currentVersion ? ` -> ${targetVersion}` : ""}`,
      source,
      workflow,
      videoId,
      version: targetVersion ?? jobVersion,
      command: ["uv", ...args],
      logPath: relativeJobLogPath(jobId),
      startedAt: job.startedAt,
      mode,
      requestedFromVersion: currentVersion,
      targetVersion,
      startFrom,
    };

    const mirrorVersions = Array.from(new Set([currentVersion, jobVersion]));
    await Promise.all([
      persistJobCopies(videoId, mirrorVersions, job),
      writeJobMeta(taskJob),
    ]);

    const logStream = createWriteStream(logPath, { flags: "a" });
    const taskLogStream = createWriteStream(taskLogPath, { flags: "a" });
    const commandLine = `$ uv ${args.map((arg) => JSON.stringify(arg)).join(" ")}\n\n`;
    logStream.write(commandLine);
    taskLogStream.write(commandLine);

    const projectRoot = resolveProjectRoot();
    const childEnv = await buildRuntimeEnv(projectRoot, {
      KB_REVIEW_AUTO_APPROVE: "0",
      ...(body.projectOverrides ? { KB_PROJECT_PROFILE_OVERRIDES: JSON.stringify(body.projectOverrides) } : {}),
    });

    const child = spawn("uv", args, {
      cwd: projectRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const runningJob = { ...job, pid: child.pid } satisfies RegenerationJob;
    const runningTask = { ...taskJob, pid: child.pid } satisfies StartJob;
    await Promise.all([
      persistJobCopies(videoId, mirrorVersions, runningJob),
      writeJobMeta(runningTask),
    ]);

    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    child.stdout.pipe(taskLogStream, { end: false });
    child.stderr.pipe(taskLogStream, { end: false });

    let finalized = false;
    const finalize = async (patch: Partial<RegenerationJob>) => {
      if (finalized) {
        return;
      }
      finalized = true;
      const finished: RegenerationJob = {
        ...runningJob,
        ...patch,
        finishedAt: new Date().toISOString(),
      };
      const currentTask = (await readCurrentTask(jobId)) ?? runningTask;
      const taskStatus = currentTask.status === "canceled"
        ? "canceled"
        : finished.status === "succeeded" ? "succeeded" : "failed";
      const finishedTask: StartJob = {
        ...currentTask,
        status: taskStatus,
        finishedAt: finished.finishedAt,
        exitCode: typeof patch.exitCode === "number" ? patch.exitCode : currentTask.exitCode,
        error: taskStatus === "canceled" ? currentTask.error : patch.error,
      };
      logStream.end(`\n[regenerate:${finished.status}] ${finished.finishedAt}\n`);
      taskLogStream.end(`\n[start:${finishedTask.status}] ${finishedTask.finishedAt}\n`);
      await Promise.all([
        persistJobCopies(videoId, mirrorVersions, finished),
        writeJobMeta(finishedTask),
      ]);
    };

    child.on("error", (error) => {
      void finalize({ status: "failed", error: error.message });
    });
    child.on("close", (code) => {
      void finalize({
        status: code === 0 ? "succeeded" : "failed",
        exitCode: code,
        error: code === 0 ? undefined : `knowbreak exited with code ${code}`,
      });
    });

    return NextResponse.json({ ok: true, job: runningJob });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to start regeneration" },
      { status: 400 },
    );
  }
}
