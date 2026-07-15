"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { VersionActions } from "@/components/version-actions";
import type { ProjectSummary, ReviewStatus } from "@/lib/types";

const REVIEW_STAGES = ["script_review", "storyboard_review", "image_review"] as const;

type FilterMode = "open" | "all" | "approved";

interface ProjectsPayload {
  projects: ProjectSummary[];
}

interface Props {
  initialProjects: ProjectSummary[];
  filter: FilterMode;
}

function isVersionApproved(version: {
  workflowSteps: string[];
  review: Partial<Record<(typeof REVIEW_STAGES)[number], ReviewStatus>>;
}): boolean {
  const reviewStages = configuredReviewStages(version.workflowSteps);
  return reviewStages.length > 0 && reviewStages.every((stage) => version.review[stage] === "approved");
}

function isVersionOpen(version: {
  workflowSteps: string[];
  review: Partial<Record<(typeof REVIEW_STAGES)[number], ReviewStatus>>;
  ignored: boolean;
}): boolean {
  if (configuredReviewStages(version.workflowSteps).length === 0) {
    return false;
  }
  return !version.ignored && !isVersionApproved(version);
}

function configuredReviewStages(workflowSteps: string[]): Array<(typeof REVIEW_STAGES)[number]> {
  return REVIEW_STAGES.filter((stage) => workflowSteps.includes(stage));
}

function reviewBadge(status: ReviewStatus | undefined): string {
  if (!status) {
    return "badge";
  }
  if (status === "approved") {
    return "badge approved";
  }
  if (status === "rejected") {
    return "badge rejected";
  }
  if (status === "in_review") {
    return "badge in_review";
  }
  return "badge";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function filterProjects(projects: ProjectSummary[], filter: FilterMode): ProjectSummary[] {
  return projects
    .map((project) => {
      const versions = project.versions.filter((version) => {
        if (filter === "all") {
          return true;
        }
        if (filter === "approved") {
          return isVersionApproved(version);
        }
        return isVersionOpen(version);
      });
      return {
        ...project,
        versions,
      };
    })
    .filter((project) => project.versions.length > 0);
}

function versionDetailHref(
  videoId: string,
  version: string,
  item: {
    doneStages: string[];
    workflowSteps: string[];
    review: Partial<Record<(typeof REVIEW_STAGES)[number], ReviewStatus>>;
  },
): string {
  if (item.doneStages.includes("compose")) {
    return `/projects/${videoId}/${version}/review`;
  }
  const reviewStages = configuredReviewStages(item.workflowSteps);
  if (reviewStages.includes("script_review") && item.review.script_review !== "approved") {
    return `/projects/${videoId}/${version}/script`;
  }
  if (reviewStages.includes("storyboard_review") && item.review.storyboard_review !== "approved") {
    return `/projects/${videoId}/${version}/storyboard`;
  }
  if (reviewStages.includes("image_review") && item.review.image_review !== "approved") {
    return `/projects/${videoId}/${version}/images`;
  }
  return `/projects/${videoId}/${version}/review`;
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

export function ProjectsClient({ initialProjects, filter }: Props) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [loading, setLoading] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [operationMessage, setOperationMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toISOString());
  const filteredProjects = filterProjects(projects, filter);

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const payload = (await response.json()) as ProjectsPayload;
      if (response.ok) {
        setProjects(payload.projects);
        setLastUpdated(new Date().toISOString());
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  const deleteProject = async (videoId: string, title: string) => {
    const confirmed = window.confirm(`确定删除项目记录「${title || videoId}」吗？此操作会删除该项目的所有版本和产物。`);
    if (!confirmed) {
      return;
    }
    setDeletingProjectId(videoId);
    setOperationMessage("");
    try {
      const response = await fetch(`/api/projects/${videoId}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "删除项目失败");
      }
      await refresh();
      setOperationMessage("项目记录已删除");
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : "删除项目失败");
    } finally {
      setDeletingProjectId(null);
    }
  };

  return (
    <>
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">过滤视图</span>
          <div className="filter-options">
            <Link className={`filter-option ${filter === "all" ? "active" : ""}`} href="/projects?filter=all">
              全部项目
            </Link>
            <Link className={`filter-option ${filter === "open" ? "active" : ""}`} href="/projects?filter=open">
              仅待处理
            </Link>
            <Link className={`filter-option ${filter === "approved" ? "active" : ""}`} href="/projects?filter=approved">
              仅已通过
            </Link>
          </div>
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          <div className="filter-stats">
            共 <span className="stat-count">{filteredProjects.length}</span> 个活跃项目 · 更新于 {new Date(lastUpdated).toLocaleTimeString()}
          </div>
          <button type="button" className="btn secondary-btn compact-btn" onClick={refresh} disabled={loading}>
            {loading ? "刷新中" : "刷新状态"}
          </button>
        </div>
      </div>
      {operationMessage ? (
        <div className="section-subtitle" style={{ marginTop: 8 }}>{operationMessage}</div>
      ) : null}

      {filteredProjects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📁</div>
          <h3 className="empty-title">暂无可审核项目</h3>
          <p className="empty-desc">
            当前筛选下没有发现任何生成版本。可以修改筛选状态，或者前往首页启动一个全新的生成工作流。
          </p>
          <div className="empty-actions">
            <Link href="/" className="btn primary-btn">启动新流程</Link>
          </div>
        </div>
      ) : (
        <div className="project-grid">
          {filteredProjects.map((project) => (
            <div className="project-card" key={project.videoId}>
              <div className="project-card-header">
                <div>
                  <h3 className="project-title">{project.title}</h3>
                  <div className="project-meta">
                    <span className="project-id-badge">ID: {project.videoId}</span>
                    <span className="project-version-count">版本数: {project.versions.length}</span>
                  </div>
                </div>
                <div className="project-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="icon-btn danger reveal-delete-btn"
                    disabled={deletingProjectId !== null}
                    aria-label={`删除项目记录 ${project.title || project.videoId}`}
                    onClick={() => deleteProject(project.videoId, project.title)}
                    title={deletingProjectId === project.videoId ? "删除中..." : "删除项目记录"}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              <div className="version-stack">
                {project.versions.map((v) => {
                  const detailHref = versionDetailHref(project.videoId, v.version, v);
                  const reviewStages = configuredReviewStages(v.workflowSteps);
                  return (
                    <div
                      key={`${project.videoId}-${v.version}`}
                      className="version-item version-item-clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(detailHref)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(detailHref);
                        }
                      }}
                    >
                      <div className="version-item-header">
                        <div className="version-identity">
                          <span className="version-tag">{v.version}</span>
                          {v.title && <span className="version-title">{v.title}</span>}
                          {v.ignored && <span className="badge warning">已忽略</span>}
                        </div>
                        <div className="version-header-side">
                          <VersionActions
                            videoId={project.videoId}
                            version={v.version}
                            doneStages={v.doneStages}
                            workflowSteps={v.workflowSteps}
                            review={v.review}
                            detailHref={detailHref}
                            onChanged={refresh}
                          />
                        </div>
                      </div>

                      <div className="version-body">
                        <div className="version-stages">
                          <span className="stages-label">已完成阶段:</span>
                          <span className="stages-value">
                            {v.doneStages.length > 0 ? v.doneStages.join(" -> ") : "暂无已完成阶段"}
                          </span>
                        </div>

                        {reviewStages.length > 0 ? (
                          <div className="version-reviews">
                            {reviewStages.includes("script_review") ? (
                              <span className={reviewBadge(v.review.script_review)}>文案: {v.review.script_review ?? "pending"}</span>
                            ) : null}
                            {reviewStages.includes("storyboard_review") ? (
                              <span className={reviewBadge(v.review.storyboard_review)}>分镜: {v.review.storyboard_review ?? "pending"}</span>
                            ) : null}
                            {reviewStages.includes("image_review") ? (
                              <span className={reviewBadge(v.review.image_review)}>图片: {v.review.image_review ?? "pending"}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <time className="version-time version-time-bottom">
                        {formatDate(v.updatedAt)}
                      </time>

                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
