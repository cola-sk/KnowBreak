import { TasksListClient } from "@/components/tasks-client";
import { listStartJobs, readJobDetail } from "@/lib/start-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const jobs = await listStartJobs();
  const summaries = await Promise.all(jobs.map(async (job) => {
    const detail = await readJobDetail(job.id);
    return {
      ...(detail?.job ?? job),
      currentStage: detail?.currentStage ?? null,
      stages: detail?.stages ?? [],
    };
  }));

  return (
    <main className="shell">
      <div className="page-header">
        <div className="hero-eyebrow">Pipeline Tasks</div>
        <h1 className="hero-title">任务中心</h1>
        <p className="hero-sub">
          查看启动任务的实时状态、阶段进度和请求日志，定位当前流程卡在哪一步。
        </p>
      </div>
      <TasksListClient initialJobs={summaries} />
    </main>
  );
}
