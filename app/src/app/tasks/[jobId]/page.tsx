import Link from "next/link";

import { TaskDetailClient } from "@/components/tasks-client";
import { readJobDetail } from "@/lib/start-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ jobId: string }>;
  searchParams?: Promise<{ videoId?: string; version?: string }>;
}

export default async function TaskDetailPage({ params, searchParams }: Props) {
  const { jobId } = await params;
  const query = await searchParams;
  const detail = await readJobDetail(
    jobId,
    query?.videoId && query?.version ? { videoId: query.videoId, version: query.version } : undefined,
  );

  if (!detail) {
    return (
      <main className="shell">
        <div className="empty-state">
          <h1 className="empty-title">任务不存在</h1>
          <p className="empty-desc">没有找到任务 ID：{jobId}</p>
          <Link href="/tasks" className="btn primary-btn">返回任务中心</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="page-header">
        <div className="hero-eyebrow">Task Detail</div>
        <h1 className="hero-title">任务详情</h1>
        <p className="hero-sub">
          实时查看阶段进度和日志输出。任务完成后可跳转到对应项目版本继续审核。
        </p>
      </div>
      <TaskDetailClient initial={detail} />
    </main>
  );
}
