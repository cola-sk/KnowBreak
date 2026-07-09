import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  ArtifactStage,
  ProjectSummary,
  ReviewFile,
  ReviewItem,
  ReviewStage,
  ReviewStatus,
  VersionSummary,
} from "@/lib/types";

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

const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

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

function getVersionDir(videoId: string, version: string): string {
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

export async function getStageData(videoId: string, version: string, stage: ArtifactStage): Promise<{ artifact: unknown; review: ReviewFile }> {
  const artifactFilePath = artifactPath(videoId, version, stage);
  const artifact = await readJsonFile<unknown>(artifactFilePath);
  if (artifact === null) {
    throw new Error(`Artifact not found: ${artifactFilePath}`);
  }
  const review = await ensureReviewFile(videoId, version, stage, artifact);
  return { artifact, review };
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

async function listVersionSummaries(videoId: string, projectDir: string): Promise<VersionSummary[]> {
  const versions: VersionSummary[] = [];

  const rootDoneStages = Object.entries(PIPELINE_ARTIFACTS)
    .filter(([, fileName]) => existsSync(path.join(projectDir, fileName)))
    .map(([stage]) => stage);
  if (rootDoneStages.length > 0) {
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
    if (!hasAnyArtifact) {
      continue;
    }
    versions.push(await buildVersionSummary(videoId, child.name, versionDir));
  }

  versions.sort((a, b) => b.version.localeCompare(a.version));
  return versions;
}

async function buildVersionSummary(videoId: string, version: string, versionDir: string): Promise<VersionSummary> {
  const doneStages = Object.entries(PIPELINE_ARTIFACTS)
    .filter(([, fileName]) => existsSync(path.join(versionDir, fileName)))
    .map(([stage]) => stage);

  const reviewStatuses: Partial<Record<ReviewStage, ReviewStatus>> = {};
  const reviewDir = path.join(versionDir, "reviews");
  for (const [stage, fileName] of Object.entries(REVIEW_FILE) as Array<[ReviewStage, string]>) {
    const filePath = path.join(reviewDir, fileName);
    const review = await readJsonFile<ReviewFile>(filePath);
    if (review) {
      reviewStatuses[stage] = review.status;
    }
  }

  const stats = await fs.stat(versionDir);
  return {
    version,
    doneStages,
    review: reviewStatuses,
    updatedAt: stats.mtime.toISOString(),
  };
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const outDir = resolveOutDir();
  if (!existsSync(outDir)) {
    return [];
  }

  const entries = await fs.readdir(outDir, { withFileTypes: true });
  const projectDirs = entries.filter((entry) => entry.isDirectory());

  const projects: ProjectSummary[] = [];
  for (const dirent of projectDirs) {
    const videoId = dirent.name;
    if (!SAFE_SEGMENT_RE.test(videoId)) {
      continue;
    }
    const projectDir = path.join(outDir, videoId);
    const versions = await listVersionSummaries(videoId, projectDir);
    if (versions.length === 0) {
      continue;
    }
    projects.push({ videoId, versions });
  }

  projects.sort((a, b) => b.videoId.localeCompare(a.videoId));
  return projects;
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
