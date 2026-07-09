export type ArtifactStage = "script" | "storyboard" | "images";

export type ReviewStage = "script_review" | "storyboard_review" | "image_review";

export type ReviewItemStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "modified"
  | "regenerated";

export type ReviewStatus =
  | "pending"
  | "in_review"
  | "approved"
  | "rejected"
  | "regenerating";

export interface ReviewItem {
  id: string;
  status: ReviewItemStatus;
  notes: string;
}

export interface ReviewFile {
  stage: ReviewStage;
  status: ReviewStatus;
  version: number;
  updated_at: string;
  items: ReviewItem[];
}

export interface VersionSummary {
  version: string;
  title: string;
  doneStages: string[];
  review: Partial<Record<ReviewStage, ReviewStatus>>;
  updatedAt: string;
  ignored: boolean;
  ignoredAt?: string;
}

export interface ProjectSummary {
  videoId: string;
  title: string;
  versions: VersionSummary[];
}

export type RegenerationJobStatus = "running" | "succeeded" | "failed";

export interface RegenerationJob {
  id: string;
  status: RegenerationJobStatus;
  mode: "create" | "update";
  requestedFromVersion: string;
  targetVersion?: string;
  startFrom?: string;
  workflow: string;
  source: string;
  command: string[];
  logPath: string;
  pid?: number;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  error?: string;
}
