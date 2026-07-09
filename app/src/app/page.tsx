import Link from "next/link";

import { listProjectSummaries, resolveOutDir } from "@/lib/review-store";
import type { ReviewStatus } from "@/lib/types";

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

export default async function HomePage() {
  const projects = await listProjectSummaries();
  const outDir = resolveOutDir();

  return (
    <main className="shell">
      <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>KnowBreak Review Studio</div>
        <div style={{ color: "var(--muted)", marginTop: 4 }}>本地审核目录：{outDir}</div>
      </div>

      {projects.length === 0 ? (
        <div className="panel" style={{ padding: 22 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>暂无可审核项目</div>
          <div style={{ color: "var(--muted)", marginTop: 4 }}>
            先运行 pipeline 生成 scripts/storyboards/images，再进入审核。
          </div>
        </div>
      ) : (
        <div className="grid">
          {projects.map((project) => (
            <div className="panel" key={project.videoId} style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{project.videoId}</div>
              <div style={{ color: "var(--muted)", marginTop: 4 }}>
                版本数：{project.versions.length}
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {project.versions.map((v) => (
                  <div
                    key={`${project.videoId}-${v.version}`}
                    style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 600 }}>{v.version}</div>
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
                    <div className="row" style={{ marginTop: 10 }}>
                      <Link href={`/projects/${project.videoId}/${v.version}/script`}>
                        <button className="primary">进入审核</button>
                      </Link>
                    </div>
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
