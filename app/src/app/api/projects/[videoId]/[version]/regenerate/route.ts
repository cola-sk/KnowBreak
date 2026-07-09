import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import type { RegenerationJob } from "@/lib/types";
import {
  getProductionReviewData,
  getVersionDir,
  resolveOutDir,
  resolveReviewRelativePath,
  writeRegenerationJob,
} from "@/lib/review-store";

export const runtime = "nodejs";

type VersionMode = "create" | "update";

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

async function persistJobCopies(
  videoId: string,
  versions: string[],
  job: RegenerationJob,
): Promise<void> {
  await Promise.all(versions.map((version) => writeRegenerationJob(videoId, version, job)));
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
    const source = (body.source?.trim() || currentData.source).trim();
    const workflow = (body.workflow?.trim() || currentData.workflow || "serious_science_one").trim();

    if (!source) {
      throw new Error("source 不能为空");
    }
    if (!workflow || !SAFE_SEGMENT_RE.test(workflow)) {
      throw new Error("workflow 名称非法");
    }

    let commandMode: VersionMode = mode;
    let commandVersion = currentVersion;
    let targetVersion = mode === "update" ? currentVersion : body.targetVersion?.trim();
    let jobVersion = currentVersion;

    if (mode === "create") {
      if (targetVersion) {
        validateVersion(targetVersion);
      } else if (startFrom) {
        targetVersion = await nextVersion(videoId);
      }

      if (startFrom) {
        if (!targetVersion) {
          throw new Error("create + 指定阶段需要可用的新版本号");
        }
        const targetDir = getVersionDir(videoId, targetVersion);
        if (existsSync(targetDir)) {
          throw new Error(`目标版本已存在: ${targetVersion}`);
        }
        await fs.cp(getVersionDir(videoId, currentVersion), targetDir, { recursive: true });
        commandMode = "update";
        commandVersion = targetVersion;
        jobVersion = targetVersion;
      } else if (targetVersion) {
        commandVersion = targetVersion;
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
    ];

    if (mode === "update" || startFrom || targetVersion) {
      args.push("--version", commandVersion);
    }
    if (startFrom) {
      args.push("--from", startFrom);
    }

    const jobId = randomUUID();
    const logPath = path.join(getVersionDir(videoId, jobVersion), "reviews", `regenerate_${jobId}.log`);
    await fs.mkdir(path.dirname(logPath), { recursive: true });

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

    const mirrorVersions = Array.from(new Set([currentVersion, jobVersion]));
    await persistJobCopies(videoId, mirrorVersions, job);

    const logStream = createWriteStream(logPath, { flags: "a" });
    logStream.write(`$ uv ${args.map((arg) => JSON.stringify(arg)).join(" ")}\n\n`);

    const child = spawn("uv", args, {
      cwd: resolveProjectRoot(),
      env: {
        ...process.env,
        KB_REVIEW_AUTO_APPROVE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const runningJob = { ...job, pid: child.pid } satisfies RegenerationJob;
    await persistJobCopies(videoId, mirrorVersions, runningJob);

    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });

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
      logStream.end(`\n[regenerate:${finished.status}] ${finished.finishedAt}\n`);
      await persistJobCopies(videoId, mirrorVersions, finished);
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
