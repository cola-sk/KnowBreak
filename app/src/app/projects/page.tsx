import { ProjectsClient } from "@/components/projects-client";
import { listProjectSummaries } from "@/lib/review-store";

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

export default async function ProjectsPage(props: {
  searchParams?: Promise<{ filter?: string }>;
}) {
  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const filter = normalizeFilter(searchParams?.filter);
  const projects = await listProjectSummaries();

  return (
    <main className="shell">
      <div className="page-header">
        <div className="hero-eyebrow">Workspace</div>
        <h1 className="hero-title">二创项目管理</h1>
        <p className="hero-sub">
          查看和过滤当前生成的二创视频版本，快速跳转至脚本、分镜或图片的修改审核界面。
        </p>
      </div>
      <ProjectsClient initialProjects={projects} filter={filter} />
    </main>
  );
}
