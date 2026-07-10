import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { getVersionDir, listWorkflows, resolveOutDir } from "@/lib/review-store";

export interface StartJob {
  id: string;
  status: "running" | "succeeded" | "failed";
  input: string;
  source: string;
  workflow: string;
  videoId: string | null;
  version: string | null;
  command: string[];
  logPath: string;
  startedAt: string;
  pid?: number;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
}

export interface JobStageProgress {
  stage: string;
  index: number;
  status: "pending" | "running" | "done" | "failed";
  artifact?: string;
  artifactExists: boolean;
}

export interface StartJobDetail {
  job: StartJob;
  stages: JobStageProgress[];
  currentStage: string | null;
  logText: string;
  logUpdatedAt: string | null;
}

const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const STAGE_ARTIFACT: Record<string, string> = {
  asr: "transcript.json",
  extract: "knowledge.json",
  topics: "topics.json",
  topic_seed: "topics.json",
  rewrite: "scripts.json",
  script: "scripts.json",
  script_review: "reviews/script_review.json",
  storyboard: "storyboards.json",
  storyboard_review: "reviews/storyboard_review.json",
  assets: "assets.json",
  images: "images.json",
  image_review: "reviews/image_review.json",
  tts: "tts.json",
  compose: "compose.json",
};

function jobsDir(): string {
  return path.join(resolveOutDir(), "_start_jobs");
}

export function jobLogPath(jobId: string): string {
  if (!SAFE_SEGMENT_RE.test(jobId)) {
    throw new Error(`Invalid job id: ${jobId}`);
  }
  return path.join(jobsDir(), `${jobId}.log`);
}

export function jobMetaPath(jobId: string): string {
  if (!SAFE_SEGMENT_RE.test(jobId)) {
    throw new Error(`Invalid job id: ${jobId}`);
  }
  return path.join(jobsDir(), `${jobId}.json`);
}

export function relativeJobLogPath(jobId: string): string {
  const outDir = resolveOutDir();
  const rel = path.relative(outDir, jobLogPath(jobId));
  return rel.startsWith("..") || path.isAbsolute(rel) ? jobLogPath(jobId) : rel;
}

export async function writeJobMeta(job: StartJob): Promise<StartJob> {
  const filePath = jobMetaPath(job.id);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(job, null, 2), "utf-8");
  return job;
}

export async function readJobMeta(jobId: string): Promise<StartJob | null> {
  if (!existsSync(jobMetaPath(jobId))) {
    return null;
  }
  try {
    const text = await fs.readFile(jobMetaPath(jobId), "utf-8");
    return JSON.parse(text) as StartJob;
  } catch {
    return null;
  }
}

export async function listStartJobs(): Promise<StartJob[]> {
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(jobsDir(), { withFileTypes: true });
  } catch {
    return [];
  }

  const jobs: StartJob[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const jobId = entry.name.replace(/\.json$/, "");
    const job = await readJobMeta(jobId);
    if (job) {
      jobs.push(job);
    }
  }
  return jobs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export async function readJobDetail(jobId: string): Promise<StartJobDetail | null> {
  const job = await readJobMeta(jobId);
  if (!job) {
    return null;
  }
  const { text, updatedAt } = await readJobLog(jobId);
  const currentStage = parseCurrentStage(text);
  const stages = await buildStageProgress(job, currentStage);
  return {
    job,
    stages,
    currentStage,
    logText: text,
    logUpdatedAt: updatedAt,
  };
}

async function readJobLog(jobId: string): Promise<{ text: string; updatedAt: string | null }> {
  const filePath = jobLogPath(jobId);
  try {
    const stat = await fs.stat(filePath);
    const text = await fs.readFile(filePath, "utf-8");
    const lines = stripAnsi(text).split(/\r?\n/);
    return {
      text: lines.slice(-500).join("\n"),
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return { text: "", updatedAt: null };
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function parseCurrentStage(logText: string): string | null {
  const regex = /▸\s*阶段\s+\d+\/\d+\s+([A-Za-z0-9_-]+)/g;
  let current: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(logText)) !== null) {
    current = match[1];
  }
  return current;
}

async function buildStageProgress(job: StartJob, currentStage: string | null): Promise<JobStageProgress[]> {
  const workflows = await listWorkflows();
  const workflow = workflows.find((item) => item.path === job.workflow || item.id === job.workflow);
  const steps = workflow?.steps ?? [];
  const currentIndex = currentStage ? steps.indexOf(currentStage) : -1;

  return Promise.all(steps.map(async (stage, index) => {
    const artifact = STAGE_ARTIFACT[stage];
    const artifactExists = artifact ? await artifactExistsForJob(job, artifact) : false;
    let status: JobStageProgress["status"] = "pending";
    if (artifactExists || job.status === "succeeded" || (currentIndex >= 0 && index < currentIndex)) {
      status = "done";
    }
    if (job.status === "running" && currentStage === stage && !artifactExists) {
      status = "running";
    }
    if (job.status === "failed" && currentStage === stage) {
      status = "failed";
    }
    return {
      stage,
      index,
      status,
      artifact,
      artifactExists,
    };
  }));
}

async function artifactExistsForJob(job: StartJob, artifact: string): Promise<boolean> {
  if (!job.videoId) {
    return false;
  }
  const version = job.version ?? "legacy";
  const filePath = path.join(getVersionDir(job.videoId, version), artifact);
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() || stat.isDirectory();
  } catch {
    return false;
  }
}

const VIDEO_ID_RE = /video_id\s*=\s*([A-Za-z0-9._-]+)/;
const VERSION_RE = /version\s*=\s*([A-Za-z0-9._-]+)/;

export function parseRunIds(line: string): { videoId?: string; version?: string } {
  const result: { videoId?: string; version?: string } = {};
  const v = VIDEO_ID_RE.exec(line);
  if (v) {
    result.videoId = v[1];
  }
  const ver = VERSION_RE.exec(line);
  if (ver) {
    result.version = ver[1];
  }
  return result;
}
