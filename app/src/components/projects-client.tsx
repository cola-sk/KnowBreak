"use client";

import Link from "next/link";
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
  review: Partial<Record<(typeof REVIEW_STAGES)[number], ReviewStatus>>;
}): boolean {
  return REVIEW_STAGES.every((stage) => version.review[stage] === "approved");
}

function isVersionOpen(version: {
  review: Partial<Record<(typeof REVIEW_STAGES)[number], ReviewStatus>>;
  ignored: boolean;
}): boolean {
  return !version.ignored && !isVersionApproved(version);
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

export function ProjectsClient({ initialProjects, filter }: Props) {
  const [projects, setProjects] = useState(initialProjects);
  const [loading, setLoading] = useState(false);
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

  return (
    <>
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">过滤视图</span>
          <div className="filter-options">
            <Link className={`filter-option ${filter === "open" ? "active" : ""}`} href="/projects?filter=open">
              仅待处理
            </Link>
            <Link className={`filter-option ${filter === "all" ? "active" : ""}`} href="/projects?filter=all">
              全部项目
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
              </div>

              <div className="version-stack">
                {project.versions.map((v) => (
                  <div key={`${project.videoId}-${v.version}`} className="version-item">
                    <div className="version-item-header">
                      <div className="version-identity">
                        <span className="version-tag">{v.version}</span>
                        {v.title && <span className="version-title">{v.title}</span>}
                        {v.ignored && <span className="badge warning">已忽略</span>}
                      </div>
                      <time className="version-time">
                        {new Date(v.updatedAt).toLocaleDateString()} {new Date(v.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </div>

                    <div className="version-body">
                      <div className="version-stages">
                        <span className="stages-label">已完成阶段:</span>
                        <span className="stages-value">
                          {v.doneStages.length > 0 ? v.doneStages.join(" -> ") : "暂无已完成阶段"}
                        </span>
                      </div>

                      <div className="version-reviews">
                        <span className={reviewBadge(v.review.script_review)}>文案: {v.review.script_review ?? "pending"}</span>
                        <span className={reviewBadge(v.review.storyboard_review)}>分镜: {v.review.storyboard_review ?? "pending"}</span>
                        <span className={reviewBadge(v.review.image_review)}>图片: {v.review.image_review ?? "pending"}</span>
                      </div>
                    </div>

                    <div className="version-actions-container">
                      <VersionActions
                        videoId={project.videoId}
                        version={v.version}
                        ignored={v.ignored}
                        doneStages={v.doneStages}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
