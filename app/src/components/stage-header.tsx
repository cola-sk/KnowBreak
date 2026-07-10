import Link from "next/link";

import type { ReviewStage, ReviewStatus } from "@/lib/types";

interface StageHeaderProps {
  videoId: string;
  version: string;
  title?: string;
  active: "review" | "script" | "storyboard" | "images";
  reviewStatuses?: Partial<Record<ReviewStage, ReviewStatus>>;
}

type StageKey = "review" | "script" | "storyboard" | "images";

const STAGE_LABELS: Record<StageKey, string> = {
  review: "成片审核",
  script: "脚本审核",
  storyboard: "分镜审核",
  images: "图片审核",
};

const STAGE_TO_REVIEW: Record<StageKey, ReviewStage | null> = {
  review: null,
  script: "script_review",
  storyboard: "storyboard_review",
  images: "image_review",
};

function isProductionApproved(
  statuses: Partial<Record<ReviewStage, ReviewStatus>> | undefined,
): boolean {
  if (!statuses) {
    return false;
  }
  return (
    statuses.script_review === "approved" &&
    statuses.storyboard_review === "approved" &&
    statuses.image_review === "approved"
  );
}

function isStageApproved(
  stage: StageKey,
  statuses: Partial<Record<ReviewStage, ReviewStatus>> | undefined,
): boolean {
  if (stage === "review") {
    return isProductionApproved(statuses);
  }
  const reviewStage = STAGE_TO_REVIEW[stage];
  if (!reviewStage) {
    return false;
  }
  return statuses?.[reviewStage] === "approved";
}

export function StageHeader({ videoId, version, title, active, reviewStatuses }: StageHeaderProps) {
  const base = `/projects/${videoId}/${version}`;
  const stages: StageKey[] = ["review", "script", "storyboard", "images"];

  return (
    <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700 }}>{title || videoId}</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            version: {version} · id: {videoId}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link href="/projects" className="badge">
            返回项目列表
          </Link>
          <Link href="/settings" className="badge">
            参数设置
          </Link>
          <Link href="/" className="badge">
            首页
          </Link>
        </div>
      </div>
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        {stages.map((stage) => {
          const approved = isStageApproved(stage, reviewStatuses);
          const label = STAGE_LABELS[stage];
          if (approved) {
            return (
              <span key={stage} className="tab approved" title={`${label} · 已通过`}>
                {label} · 已通过
              </span>
            );
          }
          return (
            <Link key={stage} href={`${base}/${stage}`} className={`tab ${active === stage ? "active" : ""}`}>
              {label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
