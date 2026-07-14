"use client";

import { useState } from "react";

import type { ReviewStatus } from "@/lib/types";

type Action = "approve_all" | "delete_version";

const REVIEW_STAGES = ["script_review", "storyboard_review", "image_review"] as const;

interface Props {
  videoId: string;
  version: string;
  doneStages: string[];
  review: Partial<Record<(typeof REVIEW_STAGES)[number], ReviewStatus>>;
  detailHref: string;
  onChanged: () => Promise<void>;
}

function isApproved(review: Props["review"]): boolean {
  return REVIEW_STAGES.every((stage) => review[stage] === "approved");
}

function hasReviewableArtifact(doneStages: string[]): boolean {
  return doneStages.some((stage) => ["script", "storyboard", "images", "compose"].includes(stage));
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function ReviewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16" />
      <path d="M4 12h10" />
      <path d="M4 19h8" />
      <path d="M17 15l2 2 4-4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function VersionActions({ videoId, version, doneStages, review, detailHref, onChanged }: Props) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const approved = isApproved(review);
  const canApprove = !approved && hasReviewableArtifact(doneStages);
  const showEnterReview = !approved && hasReviewableArtifact(doneStages);
  const canDeleteVersion = version !== "legacy";

  const run = async (action: Action) => {
    if (action === "delete_version") {
      const confirmed = window.confirm(`确定删除版本记录 ${version} 吗？此操作会删除该版本目录及其产物。`);
      if (!confirmed) {
        return;
      }
    }
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${videoId}/${version}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "操作失败");
      }
      await onChanged();
      setMessage(action === "approve_all"
        ? "已标记通过"
        : "已删除记录");
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <div className="row">
        {showEnterReview ? (
          <a
            className="icon-btn reveal-action-btn"
            href={detailHref}
            aria-label={`进入版本 ${version} 审核`}
            title="进入审核"
          >
            <ReviewIcon />
          </a>
        ) : null}
        {canApprove ? (
          <button
            className="icon-btn reveal-action-btn"
            disabled={busy !== null}
            aria-label={`标记版本 ${version} 通过`}
            onClick={() => run("approve_all")}
            title={busy === "approve_all" ? "标记中..." : "标记通过"}
          >
            <CheckIcon />
          </button>
        ) : null}
        {canDeleteVersion ? (
          <button
            className="icon-btn danger reveal-delete-btn"
            disabled={busy !== null}
            aria-label={`删除版本记录 ${version}`}
            onClick={() => run("delete_version")}
            title={busy === "delete_version" ? "删除中..." : "删除此条记录"}
          >
            <TrashIcon />
          </button>
        ) : null}
      </div>
      {error ? <div style={{ marginTop: 6, color: "var(--danger)", fontSize: 12 }}>{error}</div> : null}
      {message ? <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 12 }}>{message}</div> : null}
    </div>
  );
}
