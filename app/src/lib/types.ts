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
  doneStages: string[];
  review: Partial<Record<ReviewStage, ReviewStatus>>;
  updatedAt: string;
}

export interface ProjectSummary {
  videoId: string;
  versions: VersionSummary[];
}
