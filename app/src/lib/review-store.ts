import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  ArtifactStage,
  ProjectSummary,
  RegenerationJob,
  ReviewFile,
  ReviewItem,
  ReviewStage,
  ReviewStatus,
  VersionSummary,
} from "@/lib/types";
import type { ProjectRuntimeOverrides } from "@/lib/tts-settings";

const ARTIFACT_FILE: Record<ArtifactStage, string> = {
  script: "scripts.json",
  storyboard: "storyboards.json",
  images: "images.json",
};

const REVIEW_FILE: Record<ReviewStage, string> = {
  script_review: "script_review.json",
  storyboard_review: "storyboard_review.json",
  image_review: "image_review.json",
};

const ARTIFACT_TO_REVIEW_STAGE: Record<ArtifactStage, ReviewStage> = {
  script: "script_review",
  storyboard: "storyboard_review",
  images: "image_review",
};

const REVIEW_TO_ARTIFACT_STAGE: Record<ReviewStage, ArtifactStage> = {
  script_review: "script",
  storyboard_review: "storyboard",
  image_review: "images",
};

const PIPELINE_ARTIFACTS: Record<string, string> = {
  asr: "transcript.json",
  extract: "knowledge.json",
  topics: "topics.json",
  script: "scripts.json",
  storyboard: "storyboards.json",
  images: "images.json",
  tts: "tts.json",
  compose: "compose.json",
};
const VERSION_MARKER_FILES = [
  "workflow_plan.json",
  "project_profile_overrides.json",
  "project_runtime_overrides.json",
];
const VERSION_FLAGS_FILE = "_version_flags.json";
const REGENERATION_JOB_FILE = "regenerate_job.json";
const PROJECT_RUNTIME_OVERRIDES_FILE = "project_runtime_overrides.json";
const REVIEW_STAGE_ORDER: ReviewStage[] = ["script_review", "storyboard_review", "image_review"];

const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

interface ProjectJobSnapshot {
  id?: string;
  status?: string;
  input?: string;
  source?: string;
  workflow?: string;
  videoId?: string | null;
  version?: string | null;
  startedAt?: string;
}

function ensureSafeSegment(name: string, value: string): string {
  if (!SAFE_SEGMENT_RE.test(value)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function resolveOutDir(): string {
  const candidates: string[] = [];
  const envOut = process.env.KB_OUT_DIR;
  if (envOut) {
    candidates.push(path.isAbsolute(envOut) ? envOut : path.resolve(process.cwd(), envOut));
  }
  candidates.push(path.resolve(process.cwd(), "out"));
  candidates.push(path.resolve(process.cwd(), "..", "out"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function getVersionDir(videoId: string, version: string): string {
  const safeVideoId = ensureSafeSegment("video_id", videoId);
  const safeVersion = ensureSafeSegment("version", version);
  const outDir = resolveOutDir();

  if (safeVersion === "legacy") {
    return path.join(outDir, safeVideoId);
  }
  return path.join(outDir, safeVideoId, safeVersion);
}

function artifactPath(videoId: string, version: string, stage: ArtifactStage): string {
  return path.join(getVersionDir(videoId, version), ARTIFACT_FILE[stage]);
}

function reviewPath(videoId: string, version: string, stage: ReviewStage): string {
  return path.join(getVersionDir(videoId, version), "reviews", REVIEW_FILE[stage]);
}

function versionFlagsPath(videoId: string, version: string): string {
  return path.join(getVersionDir(videoId, version), "reviews", VERSION_FLAGS_FILE);
}

function regenerationJobPath(videoId: string, version: string): string {
  return path.join(getVersionDir(videoId, version), "reviews", REGENERATION_JOB_FILE);
}

function regenerationJobPathForId(videoId: string, version: string, jobId: string): string {
  return path.join(getVersionDir(videoId, version), "reviews", `regenerate_${jobId}.json`);
}

function regenerationJobLogPathForId(videoId: string, version: string, jobId: string): string {
  return path.join(getVersionDir(videoId, version), "reviews", `regenerate_${jobId}.log`);
}

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface VersionFlags {
  ignored: boolean;
  ignored_at?: string;
}

function defaultReview(stage: ReviewStage, items: ReviewItem[]): ReviewFile {
  return {
    stage,
    status: "pending",
    version: 1,
    updated_at: nowIso(),
    items,
  };
}

function buildScriptReviewItems(artifact: unknown): ReviewItem[] {
  const scripts = (artifact as { scripts?: Array<{ topic_index?: number; lines?: Array<{ text?: string }> }> })
    ?.scripts;
  if (!Array.isArray(scripts)) {
    return [];
  }

  const items: ReviewItem[] = [];
  for (const script of scripts) {
    const topicIndex = typeof script.topic_index === "number" ? script.topic_index : 0;
    const lines = Array.isArray(script.lines) ? script.lines : [];
    lines.forEach((_, lineIndex) => {
      items.push({
        id: `topic_${topicIndex}_line_${lineIndex}`,
        status: "pending",
        notes: "",
      });
    });
  }
  return items;
}

function buildStoryboardReviewItems(artifact: unknown): ReviewItem[] {
  const boards = (artifact as { storyboards?: Array<{ topic_index?: number; shots?: Array<{ index?: number }> }> })
    ?.storyboards;
  if (!Array.isArray(boards)) {
    return [];
  }

  const items: ReviewItem[] = [];
  for (const board of boards) {
    const topicIndex = typeof board.topic_index === "number" ? board.topic_index : 0;
    const shots = Array.isArray(board.shots) ? board.shots : [];
    shots.forEach((shot, shotIndex) => {
      const index = typeof shot.index === "number" ? shot.index : shotIndex;
      items.push({
        id: `topic_${topicIndex}_shot_${index}`,
        status: "pending",
        notes: "",
      });
    });
  }
  return items;
}

function buildImageReviewItems(artifact: unknown): ReviewItem[] {
  if (!Array.isArray(artifact)) {
    return [];
  }
  const topics = artifact as Array<{ topic_index?: number; cover?: unknown; shots?: Array<{ shot_index?: number }> }>;

  const items: ReviewItem[] = [];
  for (const topic of topics) {
    const topicIndex = typeof topic.topic_index === "number" ? topic.topic_index : 0;
    if (topic.cover) {
      items.push({
        id: `topic_${topicIndex}_cover`,
        status: "pending",
        notes: "",
      });
    }
    const shots = Array.isArray(topic.shots) ? topic.shots : [];
    shots.forEach((shot, idx) => {
      const shotIndex = typeof shot.shot_index === "number" ? shot.shot_index : idx;
      items.push({
        id: `topic_${topicIndex}_shot_${shotIndex}`,
        status: "pending",
        notes: "",
      });
    });
  }
  return items;
}

function buildReviewItems(stage: ArtifactStage, artifact: unknown): ReviewItem[] {
  if (stage === "script") {
    return buildScriptReviewItems(artifact);
  }
  if (stage === "storyboard") {
    return buildStoryboardReviewItems(artifact);
  }
  return buildImageReviewItems(artifact);
}

function mergeItems(base: ReviewItem[], existing: ReviewItem[]): ReviewItem[] {
  const existingMap = new Map(existing.map((item) => [item.id, item]));
  return base.map((item) => {
    const old = existingMap.get(item.id);
    if (!old) {
      return item;
    }
    return {
      ...item,
      status: old.status,
      notes: old.notes,
    };
  });
}

export async function ensureReviewFile(
  videoId: string,
  version: string,
  stage: ArtifactStage,
  artifact: unknown,
): Promise<ReviewFile> {
  const reviewStage = ARTIFACT_TO_REVIEW_STAGE[stage];
  const reviewFilePath = reviewPath(videoId, version, reviewStage);
  const existing = await readJsonFile<ReviewFile>(reviewFilePath);

  const baseItems = buildReviewItems(stage, artifact);
  const mergedItems = existing ? mergeItems(baseItems, existing.items ?? []) : baseItems;

  const normalized: ReviewFile = existing
    ? {
        ...existing,
        stage: reviewStage,
        items: mergedItems,
      }
    : defaultReview(reviewStage, mergedItems);

  const oldSerialized = existing ? JSON.stringify(existing) : "";
  const newSerialized = JSON.stringify(normalized);
  if (!existing || oldSerialized !== newSerialized) {
    await writeJsonFile(reviewFilePath, normalized);
  }

  return normalized;
}

export async function getReviewStatuses(
  videoId: string,
  version: string,
): Promise<Partial<Record<ReviewStage, ReviewStatus>>> {
  const statuses: Partial<Record<ReviewStage, ReviewStatus>> = {};
  for (const reviewStage of REVIEW_STAGE_ORDER) {
    const review = await readJsonFile<ReviewFile>(reviewPath(videoId, version, reviewStage));
    if (review?.status) {
      statuses[reviewStage] = review.status;
    }
  }
  return statuses;
}

export async function getStageData(videoId: string, version: string, stage: ArtifactStage): Promise<{ artifact: unknown; review: ReviewFile }> {
  const artifactFilePath = artifactPath(videoId, version, stage);
  const artifact = await readJsonFile<unknown>(artifactFilePath);
  if (artifact === null) {
    throw new Error(`Artifact not found: ${artifactFilePath}`);
  }
  const review = await ensureReviewFile(videoId, version, stage, artifact);
  return { artifact, review };
}

interface ComposeVideo {
  topic_index: number;
  title: string;
  path: string;
  duration?: number;
  intro_duration?: number;
}

interface WorkflowPlan {
  workflow?: string;
  profile?: string;
  steps?: Array<{
    capability?: string;
    params?: Record<string, string>;
  }>;
}

interface TopicsArtifact {
  topics?: Array<{
    index?: number;
    topic_index?: number;
    title?: string;
    hook?: string;
    angle?: string;
    target_duration?: number;
  }>;
}

interface TranscriptArtifact {
  source?: string;
}

interface ScriptArtifact {
  scripts?: Array<{
    topic_index?: number;
    title?: string;
    cover_narration?: string;
    total_duration?: number;
    lines?: Array<{
      text?: string;
      estimated_seconds?: number;
    }>;
  }>;
}

export interface ProductionReviewData {
  videoId: string;
  version: string;
  title: string;
  versionDir: string;
  source: string;
  workflow: string;
  workflowSteps: string[];
  videos: ComposeVideo[];
  artifacts: {
    script: unknown | null;
    storyboard: unknown | null;
    images: unknown | null;
    compose: unknown | null;
  };
  reviews: Partial<Record<ReviewStage, ReviewFile>>;
  job: RegenerationJob | null;
  regenerationJobs: RegenerationJob[];
  projectOverrides?: Record<string, any>;
  runtimeOverrides?: ProjectRuntimeOverrides;
}

export interface ProjectArtifactOverview {
  videoId: string;
  version: string;
  title: string;
  versionDir: string;
  source: string | null;
  workflow: string;
  workflowSteps: string[];
  artifacts: Array<{
    stage: string;
    label: string;
    fileName: string;
    exists: boolean;
    artifact: unknown | null;
  }>;
  topics: Array<{
    index: number;
    title: string;
    hook?: string;
    angle?: string;
    targetDuration?: number;
  }>;
  scripts: Array<{
    topicIndex: number;
    title: string;
    lineCount: number;
    totalDuration?: number;
    previewLines: string[];
  }>;
}

export interface StartPresetData {
  input: string;
  source: string;
  workflow: string;
  title: string;
  projectOverrides: Record<string, any>;
  runtimeOverrides: ProjectRuntimeOverrides;
  copiedFrom: {
    videoId: string;
    version: string;
  };
}

async function readArtifact(videoId: string, version: string, stage: ArtifactStage): Promise<unknown | null> {
  return readJsonFile<unknown>(artifactPath(videoId, version, stage));
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    asr: "ASR",
    extract: "知识提取",
    topics: "选题",
    topic_seed: "主题播种",
    rewrite: "改写",
    script: "脚本",
    storyboard: "分镜",
    assets: "资源",
    images: "图片",
    tts: "配音",
    compose: "合成",
  };
  return labels[stage] ?? stage;
}

function topicIndexOf(
  topic: NonNullable<TopicsArtifact["topics"]>[number],
  fallback: number,
): number {
  if (typeof topic.index === "number") {
    return topic.index;
  }
  if (typeof topic.topic_index === "number") {
    return topic.topic_index;
  }
  return fallback;
}

function normalizeTopics(topics: TopicsArtifact | null): ProjectArtifactOverview["topics"] {
  if (!Array.isArray(topics?.topics)) {
    return [];
  }
  return topics.topics.map((topic, fallbackIndex) => ({
    index: topicIndexOf(topic, fallbackIndex),
    title: topic.title?.trim() || `选题 ${fallbackIndex + 1}`,
    hook: topic.hook?.trim() || undefined,
    angle: topic.angle?.trim() || undefined,
    targetDuration: topic.target_duration,
  }));
}

function normalizeScripts(scripts: ScriptArtifact | null): ProjectArtifactOverview["scripts"] {
  if (!Array.isArray(scripts?.scripts)) {
    return [];
  }
  return scripts.scripts.map((script, fallbackIndex) => {
    const lines = Array.isArray(script.lines) ? script.lines : [];
    return {
      topicIndex: typeof script.topic_index === "number" ? script.topic_index : fallbackIndex,
      title: script.title?.trim() || script.cover_narration?.trim() || `脚本 ${fallbackIndex + 1}`,
      lineCount: lines.length,
      totalDuration: script.total_duration,
      previewLines: lines
        .map((line) => line.text?.trim())
        .filter((text): text is string => Boolean(text))
        .slice(0, 4),
    };
  });
}

async function readWorkflowPlan(versionDir: string): Promise<WorkflowPlan | null> {
  return readJsonFile<WorkflowPlan>(path.join(versionDir, "workflow_plan.json"));
}

export function resolveProjectRoot(): string {
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

export async function listTomlFiles(dir: string): Promise<string[]> {
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
      files.push(...(await listTomlFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".toml")) {
      files.push(entryPath);
    }
  }
  return files;
}

export function readWorkflowId(toml: string): string | null {
  const match = /^id\s*=\s*"([^"]+)"/m.exec(toml);
  return match?.[1] ?? null;
}

export function readWorkflowDescription(toml: string): string | null {
  const match = /^description\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(toml);
  return match?.[1] ?? null;
}

export function readWorkflowSteps(toml: string): string[] {
  const match = /^steps\s*=\s*\[([\s\S]*?)\]/m.exec(toml);
  if (!match) {
    return [];
  }
  const steps: string[] = [];
  const regex = /"((?:[^"\\]|\\.)*)"/g;
  let item: RegExpExecArray | null;
  while ((item = regex.exec(match[1])) !== null) {
    steps.push(item[1]);
  }
  return steps;
}

export interface WorkflowSummary {
  id: string;
  displayName: string;
  description: string | null;
  path: string;
  steps: string[];
  inputMode: "video" | "topic";
  isCustom: boolean;
  isTopic: boolean;
  isEditable: boolean;
}

export async function listWorkflows(
  _profileName = "default",
): Promise<WorkflowSummary[]> {
  const workflowsDir = path.join(resolveProjectRoot(), "profiles", "workflows");
  const files = await listTomlFiles(workflowsDir);
  const summaries: WorkflowSummary[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf-8");
    const id = readWorkflowId(text);
    if (!id) {
      continue;
    }
    const workflowPath = path.relative(workflowsDir, file).replace(/\.toml$/, "").split(path.sep).join("/");
    const isCustom = workflowPath.startsWith("custom/");
    const isTopic = workflowPath.startsWith("topics/");
    const steps = readWorkflowSteps(text);
    summaries.push({
      id,
      displayName: id,
      description: readWorkflowDescription(text),
      path: workflowPath,
      steps,
      inputMode: steps.includes("asr") ? "video" : "topic",
      isCustom,
      isTopic,
      isEditable: true,
    });
  }
  return summaries.sort((a, b) => {
    const order = (item: WorkflowSummary) => item.isTopic ? 1 : item.isCustom ? 2 : 0;
    if (order(a) !== order(b)) {
      return order(a) - order(b);
    }
    return a.path.localeCompare(b.path);
  });
}

export async function resolveWorkflowCliName(
  workflowName: string,
  _profileName = "default",
): Promise<string> {
  const trimmed = workflowName.trim();
  if (!trimmed) {
    return trimmed;
  }

  const workflowsDir = path.join(resolveProjectRoot(), "profiles", "workflows");
  const directPath = path.join(workflowsDir, `${trimmed}.toml`);
  if (existsSync(directPath)) {
    return trimmed;
  }

  const files = await listTomlFiles(workflowsDir);
  for (const file of files) {
    const text = await fs.readFile(file, "utf-8");
    if (readWorkflowId(text) !== trimmed) {
      continue;
    }
    return path.relative(workflowsDir, file).replace(/\.toml$/, "").split(path.sep).join("/");
  }

  return trimmed;
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function sourceToTitle(source: string | undefined): string | null {
  if (!source) {
    return null;
  }
  try {
    const url = new URL(source);
    return url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).at(-1) || url.hostname;
  } catch {
    const base = path.basename(source);
    return base.replace(/\.[A-Za-z0-9]+$/, "") || source;
  }
}

async function inferVersionTitle(versionDir: string): Promise<string> {
  const compose = await readJsonFile<{ videos?: Array<{ title?: string }> }>(
    path.join(versionDir, "compose.json"),
  );
  const composeTitle = firstNonEmpty(compose?.videos?.map((video) => video.title) ?? []);
  if (composeTitle) {
    return composeTitle;
  }

  const scripts = await readJsonFile<{ scripts?: Array<{ title?: string }> }>(
    path.join(versionDir, "scripts.json"),
  );
  const scriptTitle = firstNonEmpty(scripts?.scripts?.map((script) => script.title) ?? []);
  if (scriptTitle) {
    return scriptTitle;
  }

  const storyboards = await readJsonFile<{ storyboards?: Array<{ title?: string }> }>(
    path.join(versionDir, "storyboards.json"),
  );
  const storyboardTitle = firstNonEmpty(storyboards?.storyboards?.map((board) => board.title) ?? []);
  if (storyboardTitle) {
    return storyboardTitle;
  }

  const images = await readJsonFile<Array<{ title?: string }>>(path.join(versionDir, "images.json"));
  const imageTitle = firstNonEmpty(Array.isArray(images) ? images.map((topic) => topic.title) : []);
  if (imageTitle) {
    return imageTitle;
  }

  const topics = await readJsonFile<TopicsArtifact>(path.join(versionDir, "topics.json"));
  const topicTitle = firstNonEmpty(topics?.topics?.map((topic) => topic.title) ?? []);
  if (topicTitle) {
    return topicTitle;
  }

  const workflowPlan = await readWorkflowPlan(versionDir);
  const topicSeed = workflowPlan?.steps?.find((step) => step.capability === "topic_seed");
  const promptTitle = firstNonEmpty([topicSeed?.params?.topic, topicSeed?.params?.hook]);
  if (promptTitle) {
    return promptTitle;
  }

  const transcript = await readJsonFile<TranscriptArtifact>(path.join(versionDir, "transcript.json"));
  return sourceToTitle(transcript?.source) ?? "未命名视频";
}

async function inferRegenerationSource(versionDir: string): Promise<string> {
  const transcript = await readJsonFile<TranscriptArtifact>(path.join(versionDir, "transcript.json"));
  if (transcript?.source) {
    return transcript.source;
  }

  const workflowPlan = await readWorkflowPlan(versionDir);
  const topicSeed = workflowPlan?.steps?.find((step) => step.capability === "topic_seed");
  const bakedTopic = topicSeed?.params?.topic;
  if (bakedTopic) {
    return bakedTopic;
  }

  const topics = await readJsonFile<TopicsArtifact>(path.join(versionDir, "topics.json"));
  const firstTopic = topics?.topics?.[0];
  if (firstTopic?.title) {
    return firstTopic.title;
  }

  throw new Error("Unable to infer regeneration source. Please provide source explicitly.");
}

function sourceToStartInput(source: string): string {
  return source.startsWith("manual:") ? source.slice("manual:".length) : source;
}

export async function getVersionStartPreset(
  videoId: string,
  version: string,
): Promise<StartPresetData> {
  const versionDir = getVersionDir(videoId, version);
  if (!existsSync(versionDir)) {
    throw new Error(`Version not found: ${version}`);
  }
  const workflowPlan = await readWorkflowPlan(versionDir);
  const source = await inferRegenerationSource(versionDir);
  const projectOverrides = (await readJsonFile<Record<string, any>>(
    path.join(versionDir, "project_profile_overrides.json"),
  )) || {};
  const runtimeOverrides = (await readJsonFile<ProjectRuntimeOverrides>(
    path.join(versionDir, PROJECT_RUNTIME_OVERRIDES_FILE),
  )) || {};
  return {
    input: sourceToStartInput(source),
    source,
    workflow: await resolveWorkflowCliName(
      workflowPlan?.workflow ?? "custom/serious_science_one",
      workflowPlan?.profile ?? "default",
    ),
    title: await inferVersionTitle(versionDir),
    projectOverrides,
    runtimeOverrides,
    copiedFrom: { videoId, version },
  };
}

export async function getProductionReviewData(
  videoId: string,
  version: string,
): Promise<ProductionReviewData> {
  const versionDir = getVersionDir(videoId, version);
  const compose = await readJsonFile<{ videos?: ComposeVideo[] }>(path.join(versionDir, "compose.json"));
  if (!compose) {
    throw new Error(`Compose artifact not found: ${path.join(versionDir, "compose.json")}`);
  }

  const workflowPlan = await readWorkflowPlan(versionDir);
  const reviews: Partial<Record<ReviewStage, ReviewFile>> = {};
  for (const reviewStage of REVIEW_STAGE_ORDER) {
    const review = await readJsonFile<ReviewFile>(reviewPath(videoId, version, reviewStage));
    if (review) {
      reviews[reviewStage] = review;
    }
  }

  const projectOverrides = (await readJsonFile<Record<string, any>>(path.join(versionDir, "project_profile_overrides.json"))) || {};
  const runtimeOverrides = (await readJsonFile<ProjectRuntimeOverrides>(
    path.join(versionDir, PROJECT_RUNTIME_OVERRIDES_FILE),
  )) || {};

  return {
    videoId,
    version,
    title: await inferVersionTitle(versionDir),
    versionDir,
    source: await inferRegenerationSource(versionDir),
    workflow: await resolveWorkflowCliName(
      workflowPlan?.workflow ?? "custom/serious_science_one",
      workflowPlan?.profile ?? "default",
    ),
    workflowSteps: workflowPlan?.steps?.map((step) => step.capability).filter(Boolean) as string[] ?? [],
    videos: Array.isArray(compose.videos) ? compose.videos : [],
    artifacts: {
      script: await readArtifact(videoId, version, "script"),
      storyboard: await readArtifact(videoId, version, "storyboard"),
      images: await readArtifact(videoId, version, "images"),
      compose,
    },
    reviews,
    job: await readRegenerationJob(videoId, version),
    regenerationJobs: await listRegenerationJobs(videoId, version),
    projectOverrides,
    runtimeOverrides,
  };
}

export async function getProjectArtifactOverview(
  videoId: string,
  version: string,
): Promise<ProjectArtifactOverview> {
  const versionDir = getVersionDir(videoId, version);
  if (!existsSync(versionDir)) {
    throw new Error(`Version not found: ${version}`);
  }

  const workflowPlan = await readWorkflowPlan(versionDir);
  const topics = await readJsonFile<TopicsArtifact>(path.join(versionDir, "topics.json"));
  const scripts = await readJsonFile<ScriptArtifact>(path.join(versionDir, "scripts.json"));
  const source = await inferRegenerationSource(versionDir).catch(() => null);
  const workflow = await resolveWorkflowCliName(
    workflowPlan?.workflow ?? "custom/serious_science_one",
    workflowPlan?.profile ?? "default",
  );

  return {
    videoId,
    version,
    title: await inferVersionTitle(versionDir),
    versionDir,
    source,
    workflow,
    workflowSteps: workflowPlan?.steps?.map((step) => step.capability).filter(Boolean) as string[] ?? [],
    artifacts: await Promise.all(Object.entries(PIPELINE_ARTIFACTS).map(async ([stage, fileName]) => {
      const filePath = path.join(versionDir, fileName);
      const exists = existsSync(filePath);
      return {
        stage,
        label: stageLabel(stage),
        fileName,
        exists,
        artifact: exists ? await readJsonFile<unknown>(filePath) : null,
      };
    })),
    topics: normalizeTopics(topics),
    scripts: normalizeScripts(scripts),
  };
}

export async function updateStageData(
  videoId: string,
  version: string,
  stage: ArtifactStage,
  patch: { artifact?: unknown; review?: Partial<ReviewFile> },
): Promise<{ artifact: unknown; review: ReviewFile }> {
  let artifact = patch.artifact;
  const artifactFilePath = artifactPath(videoId, version, stage);

  if (artifact !== undefined) {
    await writeJsonFile(artifactFilePath, artifact);
  } else {
    artifact = await readJsonFile<unknown>(artifactFilePath);
    if (artifact === null) {
      throw new Error(`Artifact not found: ${artifactFilePath}`);
    }
  }

  const ensured = await ensureReviewFile(videoId, version, stage, artifact);
  const nextReview: ReviewFile = {
    ...ensured,
    ...patch.review,
    stage: ARTIFACT_TO_REVIEW_STAGE[stage],
    updated_at: nowIso(),
  };

  if (patch.review?.items) {
    const incoming = new Map(patch.review.items.map((item) => [item.id, item]));
    nextReview.items = ensured.items.map((item) => incoming.get(item.id) ?? item);
  }

  await writeJsonFile(reviewPath(videoId, version, ARTIFACT_TO_REVIEW_STAGE[stage]), nextReview);
  return { artifact, review: nextReview };
}

export async function approveReviewStage(
  videoId: string,
  version: string,
  reviewStage: ReviewStage,
): Promise<ReviewFile> {
  const artifactStage = REVIEW_TO_ARTIFACT_STAGE[reviewStage];
  const { artifact, review } = await getStageData(videoId, version, artifactStage);

  const approved: ReviewFile = {
    ...review,
    stage: reviewStage,
    status: "approved",
    updated_at: nowIso(),
    items: review.items.map((item) => ({ ...item, status: "approved" })),
  };

  await writeJsonFile(reviewPath(videoId, version, reviewStage), approved);
  await ensureReviewFile(videoId, version, artifactStage, artifact);
  return approved;
}

export async function approveAllReviewStages(videoId: string, version: string): Promise<{
  appliedStages: ReviewStage[];
}> {
  const appliedStages: ReviewStage[] = [];
  for (const reviewStage of REVIEW_STAGE_ORDER) {
    const artifactStage = REVIEW_TO_ARTIFACT_STAGE[reviewStage];
    const artifactFilePath = artifactPath(videoId, version, artifactStage);
    if (!existsSync(artifactFilePath)) {
      continue;
    }
    await approveReviewStage(videoId, version, reviewStage);
    appliedStages.push(reviewStage);
  }
  await setVersionIgnored(videoId, version, false);
  return { appliedStages };
}

export async function setVersionIgnored(
  videoId: string,
  version: string,
  ignored: boolean,
): Promise<VersionFlags> {
  const next: VersionFlags = {
    ignored,
    ignored_at: ignored ? nowIso() : undefined,
  };
  await writeJsonFile(versionFlagsPath(videoId, version), next);
  return next;
}

export async function deleteVersionRecord(videoId: string, version: string): Promise<{
  deleted: true;
  path: string;
}> {
  if (version === "legacy") {
    throw new Error("Legacy version uses the project root. Delete the project record instead.");
  }
  const versionDir = getVersionDir(videoId, version);
  if (!existsSync(versionDir)) {
    throw new Error(`Version not found: ${version}`);
  }
  await fs.rm(versionDir, { recursive: true, force: true });
  return { deleted: true, path: versionDir };
}

export async function deleteProjectRecord(videoId: string): Promise<{
  deleted: true;
  path: string;
}> {
  const safeVideoId = ensureSafeSegment("video_id", videoId);
  const projectDir = path.join(resolveOutDir(), safeVideoId);
  if (!existsSync(projectDir)) {
    throw new Error(`Project not found: ${videoId}`);
  }
  await fs.rm(projectDir, { recursive: true, force: true });
  return { deleted: true, path: projectDir };
}

export async function readRegenerationJob(
  videoId: string,
  version: string,
): Promise<RegenerationJob | null> {
  return readJsonFile<RegenerationJob>(regenerationJobPath(videoId, version));
}

export async function readRegenerationJobForId(
  videoId: string,
  version: string,
  jobId: string,
): Promise<RegenerationJob | null> {
  if (!JOB_ID_RE.test(jobId)) {
    return null;
  }
  const fromJson = await readJsonFile<RegenerationJob>(regenerationJobPathForId(videoId, version, jobId));
  if (fromJson) {
    return fromJson;
  }
  return synthesizeJobFromLog(videoId, version, jobId);
}

export async function listRegenerationJobs(
  videoId: string,
  version: string,
): Promise<RegenerationJob[]> {
  const dir = path.join(getVersionDir(videoId, version), "reviews");
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const jsonJobs: Record<string, RegenerationJob> = {};
  const logJobIds: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    let match = /^regenerate_([0-9a-f-]{36})\.json$/i.exec(entry.name);
    if (match) {
      const job = await readJsonFile<RegenerationJob>(path.join(dir, entry.name));
      if (job) {
        jsonJobs[job.id] = job;
      }
      continue;
    }
    match = /^regenerate_([0-9a-f-]{36})\.log$/i.exec(entry.name);
    if (match) {
      logJobIds.push(match[1]);
    }
  }

  for (const jobId of logJobIds) {
    if (jsonJobs[jobId]) {
      continue;
    }
    const synthesized = await synthesizeJobFromLog(videoId, version, jobId, dir);
    if (synthesized) {
      jsonJobs[jobId] = synthesized;
    }
  }

  return Object.values(jsonJobs).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

async function synthesizeJobFromLog(
  videoId: string,
  version: string,
  jobId: string,
  dir?: string,
): Promise<RegenerationJob | null> {
  const reviewsDir = dir ?? path.join(getVersionDir(videoId, version), "reviews");
  const logFile = path.join(reviewsDir, `regenerate_${jobId}.log`);
  let raw: string;
  let mtime: number;
  try {
    const stat = await fs.stat(logFile);
    raw = await fs.readFile(logFile, "utf-8");
    mtime = stat.mtimeMs;
  } catch {
    return null;
  }
  const finishMatch = /\[regenerate:(succeeded|failed)\]\s+(\S+)/.exec(raw);
  const status = finishMatch ? (finishMatch[1] as RegenerationJob["status"]) : "running";
  const finishedAt = finishMatch?.[2];
  const commandLine = raw.split(/\r?\n/)[0]?.replace(/^\$\s*/, "");
  const command = commandLine ? parseCommandString(commandLine) : [];
  const errorLine = /(?:error|traceback|valueerror|filenotfounderror)[: ]([^\n]+)/i.exec(raw);
  return {
    id: jobId,
    status,
    mode: "update",
    requestedFromVersion: version,
    targetVersion: version,
    workflow: "",
    source: "",
    command,
    logPath: `${videoId}/${version}/reviews/regenerate_${jobId}.log`,
    startedAt: new Date(mtime).toISOString(),
    finishedAt,
    error: status === "failed" ? (errorLine?.[1]?.slice(0, 200) ?? "regeneration failed") : undefined,
  };
}

function parseCommandString(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) {
      i += 1;
    }
    if (i >= line.length) {
      break;
    }
    const ch = line[i];
    if (ch === '"' || ch === "'") {
      i += 1;
      const start = i;
      while (i < line.length && line[i] !== ch) {
        i += 1;
      }
      tokens.push(line.slice(start, i));
      i += 1;
    } else {
      const start = i;
      while (i < line.length && !/\s/.test(line[i])) {
        i += 1;
      }
      tokens.push(line.slice(start, i));
    }
  }
  return tokens;
}

export async function writeRegenerationJob(
  videoId: string,
  version: string,
  job: RegenerationJob,
): Promise<RegenerationJob> {
  await writeJsonFile(regenerationJobPath(videoId, version), job);
  await writeJsonFile(regenerationJobPathForId(videoId, version, job.id), job);
  return job;
}

export async function readRegenerationJobLogForId(
  videoId: string,
  version: string,
  jobId: string,
): Promise<{ text: string; updatedAt: string | null }> {
  if (!JOB_ID_RE.test(jobId)) {
    return { text: "", updatedAt: null };
  }
  const filePath = regenerationJobLogPathForId(videoId, version, jobId);
  try {
    const stat = await fs.stat(filePath);
    const raw = await fs.readFile(filePath, "utf-8");
    const text = stripAnsi(raw).split(/\r?\n/).slice(-200).join("\n");
    return { text, updatedAt: stat.mtime.toISOString() };
  } catch {
    return { text: "", updatedAt: null };
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

export function parseRegenerationStage(logText: string): string | null {
  const regex = /▸\s*阶段\s+\d+\/\d+\s+([A-Za-z0-9_-]+)/g;
  let current: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(logText)) !== null) {
    current = match[1];
  }
  return current;
}

export function resolveReviewRelativePath(filePath: string): string {
  const outDir = resolveOutDir();
  const rel = path.relative(outDir, filePath);
  return rel.startsWith("..") || path.isAbsolute(rel) ? filePath : rel;
}

interface MutableImageEntry {
  image_path?: string;
  provider?: string;
  mode?: string;
  query?: string;
  prompt?: string;
  source_url?: string;
  creator?: string;
  license?: string;
  model?: string;
  width?: number;
  height?: number;
}

interface ParsedImageItemId {
  topicIndex: number;
  shotIndex?: number;
  isCover: boolean;
}

function parseImageItemId(itemId: string): ParsedImageItemId {
  const cover = /^topic_(\d+)_cover$/.exec(itemId);
  if (cover) {
    return {
      topicIndex: Number(cover[1]),
      isCover: true,
    };
  }
  const shot = /^topic_(\d+)_shot_(\d+)$/.exec(itemId);
  if (shot) {
    return {
      topicIndex: Number(shot[1]),
      shotIndex: Number(shot[2]),
      isCover: false,
    };
  }
  throw new Error(`Invalid image review item id: ${itemId}`);
}

function locateImageEntry(artifact: unknown, itemId: string): MutableImageEntry {
  if (!Array.isArray(artifact)) {
    throw new Error("images artifact is not an array");
  }

  const parsed = parseImageItemId(itemId);
  for (const topic of artifact) {
    if (!topic || typeof topic !== "object") {
      continue;
    }
    const typedTopic = topic as {
      topic_index?: number;
      cover?: MutableImageEntry;
      shots?: Array<{ shot_index?: number } & MutableImageEntry>;
    };
    if (typedTopic.topic_index !== parsed.topicIndex) {
      continue;
    }

    if (parsed.isCover) {
      if (!typedTopic.cover || typeof typedTopic.cover !== "object") {
        throw new Error(`Cover not found for ${itemId}`);
      }
      return typedTopic.cover;
    }

    const shots = Array.isArray(typedTopic.shots) ? typedTopic.shots : [];
    const targetShot = shots.find((shot) => shot.shot_index === parsed.shotIndex);
    if (!targetShot) {
      throw new Error(`Shot not found for ${itemId}`);
    }
    return targetShot;
  }

  throw new Error(`Topic not found for ${itemId}`);
}

function resolveOutputImagePath(relativePath: string): string {
  const outDir = resolveOutDir();
  const absolutePath = path.resolve(outDir, relativePath);
  const rel = path.relative(outDir, absolutePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Invalid image path: ${relativePath}`);
  }
  return absolutePath;
}

export async function replaceImageForReviewItem(
  videoId: string,
  version: string,
  itemId: string,
  imageData: Uint8Array,
): Promise<{ artifact: unknown; review: ReviewFile; imagePath: string }> {
  const { artifact, review } = await getStageData(videoId, version, "images");
  const entry = locateImageEntry(artifact, itemId);
  const relativeImagePath = entry.image_path;
  if (!relativeImagePath) {
    throw new Error(`Image path missing for ${itemId}`);
  }

  const outputPath = resolveOutputImagePath(relativeImagePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, imageData);

  entry.provider = "manual_upload";
  entry.query = "manual_crop_replace";
  entry.source_url = "";
  entry.creator = "review_user";
  entry.license = "user_provided";

  const patchedItems: ReviewItem[] = review.items.map((item): ReviewItem => {
    if (item.id !== itemId) {
      return item;
    }
    return {
      ...item,
      status: "modified",
      notes: item.notes || "Replaced by reviewer upload",
    };
  });

  const updated = await updateStageData(videoId, version, "images", {
    artifact,
    review: {
      status: "in_review",
      items: patchedItems,
    },
  });

  return {
    artifact: updated.artifact,
    review: updated.review,
    imagePath: relativeImagePath,
  };
}

interface GeneratedImageMetadata {
  provider: string;
  mode: "generate";
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  source_url?: string;
  creator?: string;
  license?: string;
}

export async function replaceImageWithGeneratedImageForReviewItem(
  videoId: string,
  version: string,
  itemId: string,
  imageData: Uint8Array,
  metadata: GeneratedImageMetadata,
): Promise<{ artifact: unknown; review: ReviewFile; imagePath: string }> {
  const { artifact, review } = await getStageData(videoId, version, "images");
  const entry = locateImageEntry(artifact, itemId);
  const relativeImagePath = entry.image_path;
  if (!relativeImagePath) {
    throw new Error(`Image path missing for ${itemId}`);
  }

  const outputPath = resolveOutputImagePath(relativeImagePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, imageData);

  entry.provider = metadata.provider;
  entry.mode = metadata.mode;
  entry.query = "";
  entry.prompt = metadata.prompt;
  entry.source_url = metadata.source_url ?? "";
  entry.creator = metadata.creator ?? "ai_generated";
  entry.license = metadata.license ?? "provider_terms";
  entry.model = metadata.model;
  entry.width = metadata.width;
  entry.height = metadata.height;

  const patchedItems: ReviewItem[] = review.items.map((item): ReviewItem => {
    if (item.id !== itemId) {
      return item;
    }
    return {
      ...item,
      status: "regenerated",
      notes: item.notes || "Replaced by AI generation",
    };
  });

  const updated = await updateStageData(videoId, version, "images", {
    artifact,
    review: {
      status: "in_review",
      items: patchedItems,
    },
  });

  return {
    artifact: updated.artifact,
    review: updated.review,
    imagePath: relativeImagePath,
  };
}

async function listVersionSummaries(videoId: string, projectDir: string): Promise<VersionSummary[]> {
  const versions: VersionSummary[] = [];

  const rootDoneStages = Object.entries(PIPELINE_ARTIFACTS)
    .filter(([, fileName]) => existsSync(path.join(projectDir, fileName)))
    .map(([stage]) => stage);
  const rootHasRunMarker = VERSION_MARKER_FILES.some((fileName) => existsSync(path.join(projectDir, fileName)));
  if (rootDoneStages.length > 0 || rootHasRunMarker) {
    versions.push(await buildVersionSummary(videoId, "legacy", projectDir));
  }

  const children = await fs.readdir(projectDir, { withFileTypes: true });
  for (const child of children) {
    if (!child.isDirectory()) {
      continue;
    }
    const versionDir = path.join(projectDir, child.name);
    const hasAnyArtifact = Object.values(PIPELINE_ARTIFACTS).some((name) =>
      existsSync(path.join(versionDir, name)),
    );
    const hasRunMarker = VERSION_MARKER_FILES.some((fileName) => existsSync(path.join(versionDir, fileName)));
    if (!hasAnyArtifact && !hasRunMarker) {
      continue;
    }
    versions.push(await buildVersionSummary(videoId, child.name, versionDir));
  }

  versions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return versions;
}

async function buildVersionSummary(videoId: string, version: string, versionDir: string): Promise<VersionSummary> {
  const doneStages = Object.entries(PIPELINE_ARTIFACTS)
    .filter(([, fileName]) => existsSync(path.join(versionDir, fileName)))
    .map(([stage]) => stage);
  const workflowPlan = await readWorkflowPlan(versionDir);
  const workflowSteps = workflowPlan?.steps?.map((step) => step.capability).filter(Boolean) as string[] ?? [];

  const reviewStatuses: Partial<Record<ReviewStage, ReviewStatus>> = {};
  const reviewDir = path.join(versionDir, "reviews");
  for (const [stage, fileName] of Object.entries(REVIEW_FILE) as Array<[ReviewStage, string]>) {
    if (!workflowSteps.includes(stage)) {
      continue;
    }
    const filePath = path.join(reviewDir, fileName);
    const review = await readJsonFile<ReviewFile>(filePath);
    if (review) {
      reviewStatuses[stage] = review.status;
    }
  }
  const flags = await readJsonFile<VersionFlags>(versionFlagsPath(videoId, version));

  const updatedAt = await latestVersionUpdatedAt(versionDir);
  return {
    version,
    title: await inferVersionTitle(versionDir),
    doneStages,
    workflowSteps,
    review: reviewStatuses,
    updatedAt,
    ignored: Boolean(flags?.ignored),
    ignoredAt: flags?.ignored_at,
  };
}

async function latestVersionUpdatedAt(versionDir: string): Promise<string> {
  let latest = 0;

  async function include(filePath: string): Promise<void> {
    try {
      const stat = await fs.stat(filePath);
      latest = Math.max(latest, stat.mtimeMs);
    } catch {
      // Missing optional artifacts do not affect ordering.
    }
  }

  await include(versionDir);
  await Promise.all([
    ...Object.values(PIPELINE_ARTIFACTS).map((fileName) => include(path.join(versionDir, fileName))),
    include(path.join(versionDir, "workflow_plan.json")),
    include(path.join(versionDir, "project_profile_overrides.json")),
    include(path.join(versionDir, "reviews", VERSION_FLAGS_FILE)),
    ...Object.values(REVIEW_FILE).map((fileName) => include(path.join(versionDir, "reviews", fileName))),
    include(path.join(versionDir, "reviews", REGENERATION_JOB_FILE)),
  ]);

  return new Date(latest || Date.now()).toISOString();
}

async function readProjectJobSnapshots(outDir: string): Promise<ProjectJobSnapshot[]> {
  const dir = path.join(outDir, "_start_jobs");
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const jobs: ProjectJobSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, entry.name), "utf-8")) as ProjectJobSnapshot;
      if (parsed.videoId && parsed.version && SAFE_SEGMENT_RE.test(parsed.videoId) && SAFE_SEGMENT_RE.test(parsed.version)) {
        jobs.push(parsed);
      }
    } catch {
      continue;
    }
  }
  return jobs;
}

function workflowStepsForJob(job: ProjectJobSnapshot, workflows: Awaited<ReturnType<typeof listWorkflows>>): string[] {
  if (!job.workflow) {
    return [];
  }
  const workflow = workflows.find((item) => item.path === job.workflow || item.id === job.workflow);
  return workflow?.steps ?? [];
}

function versionSummaryFromJob(
  job: ProjectJobSnapshot,
  workflows: Awaited<ReturnType<typeof listWorkflows>>,
): VersionSummary | null {
  if (!job.videoId || !job.version || !SAFE_SEGMENT_RE.test(job.videoId) || !SAFE_SEGMENT_RE.test(job.version)) {
    return null;
  }
  return {
    version: job.version,
    title: job.input || job.source || job.videoId,
    doneStages: [],
    workflowSteps: workflowStepsForJob(job, workflows),
    review: {},
    updatedAt: job.startedAt ?? new Date().toISOString(),
    ignored: false,
  };
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const outDir = resolveOutDir();
  if (!existsSync(outDir)) {
    return [];
  }
  const projectJobTimes = await latestJobStartedAtByProject(outDir);
  const projectJobs = await readProjectJobSnapshots(outDir);
  const workflows = projectJobs.length > 0 ? await listWorkflows() : [];

  const entries = await fs.readdir(outDir, { withFileTypes: true });
  const projectDirs = entries.filter((entry) => entry.isDirectory());

  const projectsById = new Map<string, ProjectSummary>();
  for (const dirent of projectDirs) {
    const videoId = dirent.name;
    if (videoId === "_start_jobs" || !SAFE_SEGMENT_RE.test(videoId)) {
      continue;
    }
    const projectDir = path.join(outDir, videoId);
    const versions = await listVersionSummaries(videoId, projectDir);
    if (versions.length === 0) {
      continue;
    }
    projectsById.set(videoId, { videoId, title: versions[0]?.title ?? videoId, versions });
  }

  for (const job of projectJobs) {
    const summary = versionSummaryFromJob(job, workflows);
    if (!summary || !job.videoId) {
      continue;
    }
    const existing = projectsById.get(job.videoId);
    if (existing) {
      if (!existing.versions.some((version) => version.version === summary.version)) {
        existing.versions.push(summary);
        existing.versions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      }
      existing.title = existing.versions[0]?.title ?? existing.title;
      continue;
    }
    projectsById.set(job.videoId, {
      videoId: job.videoId,
      title: summary.title || job.videoId,
      versions: [summary],
    });
  }

  const projects = Array.from(projectsById.values());

  projects.sort((a, b) => {
    const aJobTime = projectJobTimes.get(a.videoId) ?? 0;
    const bJobTime = projectJobTimes.get(b.videoId) ?? 0;
    if (aJobTime || bJobTime) {
      const diff = bJobTime - aJobTime;
      if (diff !== 0) {
        return diff;
      }
    }
    const aUpdated = Date.parse(a.versions[0]?.updatedAt ?? "") || 0;
    const bUpdated = Date.parse(b.versions[0]?.updatedAt ?? "") || 0;
    if (aUpdated || bUpdated) {
      const diff = bUpdated - aUpdated;
      if (diff !== 0) {
        return diff;
      }
    }
    return b.videoId.localeCompare(a.videoId);
  });
  return projects;
}

async function latestJobStartedAtByProject(outDir: string): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const dir = path.join(outDir, "_start_jobs");
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(dir, entry.name);
    let parsed: { videoId?: string | null; startedAt?: string } | null = null;
    try {
      parsed = JSON.parse(await fs.readFile(filePath, "utf-8"));
    } catch {
      continue;
    }
    if (!parsed?.videoId || !SAFE_SEGMENT_RE.test(parsed.videoId)) {
      continue;
    }
    const startedAt = Date.parse(parsed.startedAt ?? "");
    if (!startedAt || Number.isNaN(startedAt)) {
      continue;
    }
    result.set(parsed.videoId, Math.max(result.get(parsed.videoId) ?? 0, startedAt));
  }

  return result;
}

export async function resolveAssetPath(segments: string[]): Promise<string | null> {
  const outDir = resolveOutDir();
  const target = path.resolve(outDir, ...segments);
  const rel = path.relative(outDir, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }

  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      return null;
    }
    return target;
  } catch {
    return null;
  }
}
