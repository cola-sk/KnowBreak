"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { JobStageProgress, StartJob, StartJobDetail } from "@/lib/start-store";

interface TasksPayload {
  jobs: TaskSummary[];
}

interface TasksListClientProps {
  initialJobs: TaskSummary[];
}

interface TaskDetailClientProps {
  initial: StartJobDetail;
}

type TaskSummary = StartJob & {
  currentStage?: string | null;
  stages?: JobStageProgress[];
};

function statusClass(status: string | undefined): string {
  if (status === "succeeded" || status === "done") {
    return "badge approved";
  }
  if (status === "failed") {
    return "badge rejected";
  }
  if (status === "canceled") {
    return "badge warning";
  }
  if (status === "running") {
    return "badge in_review";
  }
  return "badge";
}

function formatTime(value: string | undefined | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    asr: "ASR",
    extract: "知识提取",
    topics: "选题",
    topic_seed: "主题播种",
    rewrite: "改写",
    script: "脚本",
    script_review: "脚本审核",
    storyboard: "分镜",
    storyboard_review: "分镜审核",
    assets: "资源",
    images: "图片",
    image_review: "图片审核",
    tts: "配音",
    compose: "合成",
  };
  return labels[stage] ?? stage;
}

export function TasksListClient({ initialJobs }: TasksListClientProps) {
  const [jobs, setJobs] = useState<TaskSummary[]>(initialJobs);
  const [lastUpdated, setLastUpdated] = useState<string>(() => new Date().toISOString());
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      const payload = (await response.json()) as TasksPayload;
      if (response.ok) {
        setJobs(payload.jobs);
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
    <div className="task-page-stack">
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">任务总数</span>
          <span className="stat-count">{jobs.length}</span>
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          <span className="filter-stats">更新于 {formatTime(lastUpdated)}</span>
          <button type="button" className="btn secondary-btn compact-btn" onClick={refresh} disabled={loading}>
            {loading ? "刷新中" : "刷新状态"}
          </button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="empty-state">
          <h3 className="empty-title">暂无启动任务</h3>
          <p className="empty-desc">从首页启动流程后，任务会出现在这里。</p>
        </div>
      ) : (
        <div className="task-list">
          {jobs.map((job) => (
            <Link href={`/tasks/${job.id}`} className="task-card" key={job.id}>
              <div className="task-card-head">
                <div>
                  <div className="task-title">{job.input || job.source}</div>
                  <div className="task-meta">
                    <code>{job.id}</code>
                    <span>{job.workflow}</span>
                  </div>
                </div>
                <span className={statusClass(job.status)}>{job.status}</span>
              </div>
              <div className="task-meta-grid">
                <span>开始：{formatTime(job.startedAt)}</span>
                <span>结束：{formatTime(job.finishedAt)}</span>
                <span>当前阶段：{job.currentStage ? `${stageLabel(job.currentStage)} (${job.currentStage})` : "-"}</span>
                <span>video_id：{job.videoId ?? "-"}</span>
                <span>version：{job.version ?? "-"}</span>
              </div>
              {job.error ? <div className="task-error">{job.error}</div> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskDetailClient({ initial }: TaskDetailClientProps) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [lastUpdated, setLastUpdated] = useState<string>(() => new Date().toISOString());
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<"cancel" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/start/${detail.job.id}`, { cache: "no-store" });
      const payload = (await response.json()) as StartJobDetail;
      if (response.ok && payload.job) {
        setDetail(payload);
        setLastUpdated(new Date().toISOString());
      }
    } finally {
      setLoading(false);
    }
  };

  const cancelJob = async () => {
    if (!window.confirm("确定中断这个任务吗？正在等待审核或生成中的进程会被终止。")) {
      return;
    }
    setActionLoading("cancel");
    setActionError(null);
    try {
      const response = await fetch(`/api/start/${detail.job.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const payload = (await response.json()) as StartJobDetail | { error?: string };
      if (!response.ok || !("job" in payload)) {
        throw new Error("error" in payload && payload.error ? payload.error : "中断任务失败");
      }
      setDetail(payload);
      setLastUpdated(new Date().toISOString());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "中断任务失败");
    } finally {
      setActionLoading(null);
    }
  };

  const deleteJob = async () => {
    if (!window.confirm("确定删除这条任务记录吗？只删除启动记录和日志，不删除已生成项目文件。")) {
      return;
    }
    setActionLoading("delete");
    setActionError(null);
    try {
      const response = await fetch(`/api/start/${detail.job.id}`, { method: "DELETE" });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "删除任务记录失败");
      }
      router.push("/tasks");
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "删除任务记录失败");
      setActionLoading(null);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(refresh, detail.job.status === "running" ? 2000 : 8000);
    return () => window.clearInterval(timer);
  }, [detail.job.id, detail.job.status]);

  return (
    <div className="task-page-stack">
      <section className="panel task-detail-panel">
        <div className="task-card-head">
          <div>
            <div className="task-title">{detail.job.input || detail.job.source}</div>
            <div className="task-meta">
              <code>{detail.job.id}</code>
              <span>{detail.job.workflow}</span>
              {detail.job.pid ? <span>pid: {detail.job.pid}</span> : null}
            </div>
          </div>
          <span className={statusClass(detail.job.status)}>{detail.job.status}</span>
        </div>
        <div className="task-meta-grid">
          <span>source：{detail.job.source}</span>
          <span>开始：{formatTime(detail.job.startedAt)}</span>
          <span>结束：{formatTime(detail.job.finishedAt)}</span>
          <span>日志更新时间：{formatTime(detail.logUpdatedAt)}</span>
          <span>video_id：{detail.job.videoId ?? "-"}</span>
          <span>version：{detail.job.version ?? "-"}</span>
        </div>
        <div className="task-actions">
          <button type="button" className="btn secondary-btn compact-btn" onClick={refresh} disabled={loading}>
            {loading ? "刷新中" : "刷新状态"}
          </button>
          {detail.job.status === "running" ? (
            <button type="button" className="btn warn compact-btn" onClick={cancelJob} disabled={actionLoading !== null}>
              {actionLoading === "cancel" ? "中断中" : "中断任务"}
            </button>
          ) : null}
          <button type="button" className="btn secondary-btn compact-btn" onClick={deleteJob} disabled={actionLoading !== null}>
            {actionLoading === "delete" ? "删除中" : "删除任务记录"}
          </button>
          {detail.job.videoId && detail.job.version ? (
            <Link className="btn primary-btn compact-btn" href={`/projects/${detail.job.videoId}/${detail.job.version}/review`}>
              打开项目详情
            </Link>
          ) : null}
        </div>
        {actionError ? <div className="task-error">{actionError}</div> : null}
        {detail.job.error ? <div className="task-error">{detail.job.error}</div> : null}
      </section>

      <section className="panel task-detail-panel">
        <div className="section-title">阶段进度</div>
        <div className="stage-progress-list">
          {detail.stages.map((stage) => (
            <StageProgressRow key={`${stage.index}-${stage.stage}`} stage={stage} current={detail.currentStage === stage.stage} />
          ))}
        </div>
      </section>

      <section className="panel task-detail-panel">
        <div className="task-card-head">
          <div>
            <div className="section-title">请求日志</div>
            <div className="section-subtitle">日志路径：{detail.job.logPath}</div>
          </div>
          <span className="filter-stats">轮询更新于 {formatTime(lastUpdated)}</span>
        </div>
        <pre className="task-log">{detail.logText || "暂无日志内容。"}</pre>
      </section>
    </div>
  );
}

function StageProgressRow({ stage, current }: { stage: JobStageProgress; current: boolean }) {
  return (
    <div className={`stage-progress-row ${current ? "current" : ""}`}>
      <div className="stage-progress-index">{stage.index + 1}</div>
      <div className="stage-progress-main">
        <div className="stage-progress-title">
          {stageLabel(stage.stage)} <code>{stage.stage}</code>
        </div>
        <div className="stage-progress-artifact">
          {stage.artifact ? `${stage.artifact}${stage.artifactExists ? " 已生成" : " 未生成"}` : "无产物文件"}
        </div>
      </div>
      <span className={statusClass(stage.status)}>{stage.status}</span>
    </div>
  );
}
