import Link from "next/link";

import { VersionActions } from "@/components/version-actions";
import { listProjectSummaries, resolveOutDir } from "@/lib/review-store";
import type { ReviewStatus } from "@/lib/types";

const REVIEW_STAGES = ["script_review", "storyboard_review", "image_review"] as const;

type FilterMode = "open" | "all" | "approved";

function normalizeFilter(raw: string | undefined): FilterMode {
  if (raw === "all") {
    return "all";
  }
  if (raw === "approved") {
    return "approved";
  }
  return "open";
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

export default async function HomePage(props: {
  searchParams?: Promise<{ filter?: string }>;
}) {
  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const filter = normalizeFilter(searchParams?.filter);
  const projects = await listProjectSummaries();
  const outDir = resolveOutDir();
  const filteredProjects = projects
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

  return (
    <main className="shell">
      <div className="panel home-hero">
        <div className="hero-eyebrow">Review Console</div>
        <div className="hero-title">KnowBreak Review Studio</div>
        <div className="hero-sub">默认展示未通过或未处理版本，减少干扰并优先清理积压审核。</div>
        <div className="hero-sub">本地审核目录：{outDir}</div>
      </div>

      <div className="panel home-filter-panel">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="row" style={{ alignItems: "center" }}>
            <span className="badge">筛选</span>
            <div className="filter-chip-row">
              <Link className={`chip-link ${filter === "open" ? "active" : ""}`} href="/?filter=open">
                仅待处理
              </Link>
              <Link className={`chip-link ${filter === "all" ? "active" : ""}`} href="/?filter=all">
                全部
              </Link>
              <Link
                className={`chip-link ${filter === "approved" ? "active" : ""}`}
                href="/?filter=approved"
              >
                仅已通过
              </Link>
            </div>
          </div>
          <span className="badge">视频数：{filteredProjects.length}</span>
        </div>
      </div>

      {filteredProjects.length === 0 ? (
        <div className="panel" style={{ padding: 22 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>暂无可审核项目</div>
          <div style={{ color: "var(--muted)", marginTop: 4 }}>
            当前筛选下没有结果。可切换筛选，或先运行 pipeline 生成 scripts/storyboards/images。
          </div>
        </div>
      ) : (
        <div className="grid">
          {filteredProjects.map((project) => (
            <div className="panel" key={project.videoId} style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{project.title}</div>
              <div style={{ color: "var(--muted)", marginTop: 4 }}>
                版本数：{project.versions.length}
                <span className="badge" style={{ marginLeft: 8 }}>
                  id: {project.videoId}
                </span>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {project.versions.map((v) => (
                  <div key={`${project.videoId}-${v.version}`} className="version-card">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <div className="row" style={{ alignItems: "center", minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{v.title}</div>
                        <span className="badge">{v.version}</span>
                        {v.ignored ? <span className="badge">已忽略</span> : null}
                      </div>
                      <span className="badge">{new Date(v.updatedAt).toLocaleString()}</span>
                    </div>
                    <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 13 }}>
                      已完成阶段：{v.doneStages.join(" -> ") || "无"}
                    </div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <span className={reviewBadge(v.review.script_review)}>
                        script_review: {v.review.script_review ?? "pending"}
                      </span>
                      <span className={reviewBadge(v.review.storyboard_review)}>
                        storyboard_review: {v.review.storyboard_review ?? "pending"}
                      </span>
                      <span className={reviewBadge(v.review.image_review)}>
                        image_review: {v.review.image_review ?? "pending"}
                      </span>
                    </div>
                    <VersionActions
                      videoId={project.videoId}
                      version={v.version}
                      ignored={v.ignored}
                      doneStages={v.doneStages}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
