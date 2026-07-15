"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ImageReviewClient, type ImageReviewContext, type ImageReviewPayload } from "@/components/image-review-client";
import { ScriptReviewClient, type ScriptReviewPayload } from "@/components/script-review-client";
import { StoryboardReviewClient, type StoryboardReviewPayload } from "@/components/storyboard-review-client";
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

interface ResumeStartResponse {
  ok?: boolean;
  resumedFrom?: string;
  job?: StartJob;
  error?: string;
}

type InlineReviewStage = "script_review" | "storyboard_review" | "image_review";

interface ReviewDrawerState {
  stage: InlineReviewStage;
  loading: boolean;
  error: string | null;
  payload: ScriptReviewPayload | StoryboardReviewPayload | ImageReviewPayload | null;
  context?: ImageReviewContext;
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

function shortJobId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function taskKindLabel(job: StartJob): string {
  return job.taskType === "regenerate" ? "重生成" : "启动";
}

function taskTitle(job: StartJob): string {
  if (job.taskType === "regenerate") {
    const requested = job.requestedFromVersion ?? job.version ?? "-";
    const target = job.targetVersion && job.targetVersion !== requested ? ` -> ${job.targetVersion}` : "";
    return `重新生成 ${job.videoId ?? "-"} / ${requested}${target}`;
  }
  return job.input || job.source;
}

function taskStageText(job: TaskSummary): string {
  if (job.currentStage) {
    return `${stageLabel(job.currentStage)} (${job.currentStage})`;
  }
  if (job.startFrom) {
    return `from ${stageLabel(job.startFrom)}`;
  }
  return "-";
}

function inlineReviewStage(stage: string | null | undefined): InlineReviewStage | null {
  if (stage === "script_review" || stage === "storyboard_review" || stage === "image_review") {
    return stage;
  }
  return null;
}

function artifactStageForReview(stage: InlineReviewStage): "script" | "storyboard" | "images" {
  if (stage === "script_review") {
    return "script";
  }
  if (stage === "storyboard_review") {
    return "storyboard";
  }
  return "images";
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
                <div className="task-card-main">
                  <div className="task-title-row">
                    <span className="task-kind">{taskKindLabel(job)}</span>
                    <div className="task-title">{taskTitle(job)}</div>
                  </div>
                  <div className="task-meta">
                    <code>{shortJobId(job.id)}</code>
                    <span>{job.workflow}</span>
                    <span>{formatTime(job.startedAt)}</span>
                  </div>
                </div>
                <span className={statusClass(job.status)}>{job.status}</span>
              </div>
              <div className="task-summary-row">
                <span>阶段：{taskStageText(job)}</span>
                <span>项目：{job.videoId ?? "-"} / {job.version ?? "-"}</span>
                <span>结束：{formatTime(job.finishedAt)}</span>
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
  const [actionLoading, setActionLoading] = useState<"cancel" | "resume" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewDrawer, setReviewDrawer] = useState<ReviewDrawerState | null>(null);

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

  const resumeJob = async (stageOverride?: string) => {
    const stage = stageOverride || detail.currentStage || detail.job.startFrom;
    if (!stage) {
      setActionError("当前日志没有可恢复阶段，请从首页重新发起任务。");
      return;
    }
    if (!window.confirm(`确定从出错阶段「${stageLabel(stage)}」重试吗？`)) {
      return;
    }
    setActionLoading("resume");
    setActionError(null);
    try {
      const response = await fetch(`/api/start/${detail.job.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resume", startFrom: stage }),
      });
      const payload = (await response.json()) as ResumeStartResponse;
      if (!response.ok || !payload.job?.id) {
        throw new Error(payload.error ?? "续跑任务失败");
      }
      router.push(`/tasks/${payload.job.id}`);
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "续跑任务失败");
      setActionLoading(null);
    }
  };

  const openInlineReview = async (stage: InlineReviewStage) => {
    if (!detail.job.videoId || !detail.job.version) {
      setActionError("当前任务还没有解析出 video_id/version，暂时不能打开审核。");
      return;
    }
    setReviewDrawer({
      stage,
      loading: true,
      error: null,
      payload: null,
    });
    try {
      const artifactStage = artifactStageForReview(stage);
      const response = await fetch(
        `/api/projects/${detail.job.videoId}/${detail.job.version}/${artifactStage}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "加载审核数据失败");
      }

      let context: ImageReviewContext | undefined;
      if (stage === "image_review") {
        const [scriptResponse, storyboardResponse] = await Promise.allSettled([
          fetch(`/api/projects/${detail.job.videoId}/${detail.job.version}/script`, { cache: "no-store" }),
          fetch(`/api/projects/${detail.job.videoId}/${detail.job.version}/storyboard`, { cache: "no-store" }),
        ]);
        const scriptPayload = scriptResponse.status === "fulfilled" && scriptResponse.value.ok
          ? await scriptResponse.value.json()
          : null;
        const storyboardPayload = storyboardResponse.status === "fulfilled" && storyboardResponse.value.ok
          ? await storyboardResponse.value.json()
          : null;
        context = {
          script: scriptPayload?.artifact ?? null,
          storyboard: storyboardPayload?.artifact ?? null,
        };
      }

      setReviewDrawer({
        stage,
        loading: false,
        error: null,
        payload,
        context,
      });
    } catch (error) {
      setReviewDrawer({
        stage,
        loading: false,
        error: error instanceof Error ? error.message : "加载审核数据失败",
        payload: null,
      });
    }
  };

  useEffect(() => {
    const timer = window.setInterval(refresh, detail.job.status === "running" ? 2000 : 8000);
    return () => window.clearInterval(timer);
  }, [detail.job.id, detail.job.status]);

  const activeReviewStage = inlineReviewStage(detail.currentStage);
  const retryStage = detail.currentStage || detail.job.startFrom || null;
  const canRetryFailedStage = (detail.job.status === "failed" || detail.job.status === "canceled") && Boolean(retryStage);

  return (
    <div className="task-page-stack">
      <section className="panel task-detail-panel task-detail-overview">
        <div className="task-detail-head">
          <div className="task-detail-main">
            <div className="task-title">{detail.job.input || detail.job.source}</div>
            <div className="task-meta task-detail-meta">
              <code>{detail.job.id}</code>
              <span>{detail.job.workflow}</span>
              {detail.job.pid ? <span>pid: {detail.job.pid}</span> : null}
            </div>
          </div>
          <span className={statusClass(detail.job.status)}>{detail.job.status}</span>
        </div>
        <div className="task-meta-grid task-detail-fields">
          <div className="task-field task-field-wide">
            <span className="task-field-label">source</span>
            <span className="task-field-value">{detail.job.source}</span>
          </div>
          <div className="task-field">
            <span className="task-field-label">开始</span>
            <span className="task-field-value">{formatTime(detail.job.startedAt)}</span>
          </div>
          <div className="task-field">
            <span className="task-field-label">结束</span>
            <span className="task-field-value">{formatTime(detail.job.finishedAt)}</span>
          </div>
          <div className="task-field">
            <span className="task-field-label">日志更新</span>
            <span className="task-field-value">{formatTime(detail.logUpdatedAt)}</span>
          </div>
          <div className="task-field">
            <span className="task-field-label">video_id</span>
            <span className="task-field-value">{detail.job.videoId ?? "-"}</span>
          </div>
          <div className="task-field">
            <span className="task-field-label">version</span>
            <span className="task-field-value">{detail.job.version ?? "-"}</span>
          </div>
        </div>
        <div className="task-actions task-detail-actions">
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
            <Link className="btn primary-btn compact-btn task-open-project-btn" href={`/projects/${detail.job.videoId}/${detail.job.version}/review`}>
              打开项目详情
            </Link>
          ) : null}
        </div>
        {activeReviewStage && detail.job.status === "running" ? (
          <div className="task-review-callout">
            <div>
              <div className="section-title">当前进入审核阶段</div>
              <div className="section-subtitle">
                {stageLabel(activeReviewStage)} 正在等待通过；可以在当前页面打开审核抽屉，任务会在审核通过后继续执行。
              </div>
            </div>
            <button
              type="button"
              className="btn primary-btn compact-btn"
              onClick={() => openInlineReview(activeReviewStage)}
            >
              进入审核
            </button>
          </div>
        ) : null}
        {actionError ? (
          <div className="task-error task-detail-error">
            <span className="task-error-label">操作失败</span>
            <span>{actionError}</span>
          </div>
        ) : null}
        {detail.job.error ? (
          <div className="task-error task-detail-error">
            <span className="task-error-label">错误</span>
            <span>{detail.job.error}</span>
          </div>
        ) : null}
      </section>

      <section className="panel task-detail-panel">
        <div className="section-title">阶段进度</div>
        <div className="stage-progress-list">
          {detail.stages.map((stage) => (
            <StageProgressRow
              key={`${stage.index}-${stage.stage}`}
              stage={stage}
              current={detail.currentStage === stage.stage}
              canRetry={canRetryFailedStage && retryStage === stage.stage}
              retryLoading={actionLoading === "resume"}
              canReview={Boolean(
                inlineReviewStage(stage.stage)
                && detail.job.videoId
                && detail.job.version
                && (detail.currentStage === stage.stage || stage.artifactExists),
              )}
              onRetry={() => resumeJob(stage.stage)}
              onReview={(reviewStage) => openInlineReview(reviewStage)}
            />
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

      {reviewDrawer ? (
        <InlineReviewDrawer
          videoId={detail.job.videoId ?? ""}
          version={detail.job.version ?? ""}
          state={reviewDrawer}
          onClose={() => setReviewDrawer(null)}
        />
      ) : null}
    </div>
  );
}

function StageProgressRow({
  stage,
  current,
  canRetry,
  retryLoading,
  canReview,
  onRetry,
  onReview,
}: {
  stage: JobStageProgress;
  current: boolean;
  canRetry: boolean;
  retryLoading: boolean;
  canReview: boolean;
  onRetry: () => void;
  onReview: (stage: InlineReviewStage) => void;
}) {
  const reviewStage = inlineReviewStage(stage.stage);
  return (
    <div className={`stage-progress-row ${current ? "current" : ""} ${stage.status}`}>
      <div className="stage-progress-index">{stage.index + 1}</div>
      <div className="stage-progress-main">
        <div className="stage-progress-title">
          {stageLabel(stage.stage)} <code>{stage.stage}</code>
        </div>
        <div className="stage-progress-artifact">
          {stage.artifact ? `${stage.artifact}${stage.artifactExists ? " 已生成" : " 未生成"}` : "无产物文件"}
        </div>
      </div>
      <div className="stage-progress-actions">
        {canRetry ? (
          <button type="button" className="btn primary-btn compact-btn" onClick={onRetry} disabled={retryLoading}>
            {retryLoading ? "重试中" : "重试"}
          </button>
        ) : null}
        {reviewStage && canReview ? (
          <button type="button" className="btn secondary-btn compact-btn" onClick={() => onReview(reviewStage)}>
            进入审核
          </button>
        ) : null}
        <span className={statusClass(stage.status)}>{stage.status}</span>
      </div>
    </div>
  );
}

function InlineReviewDrawer({
  videoId,
  version,
  state,
  onClose,
}: {
  videoId: string;
  version: string;
  state: ReviewDrawerState;
  onClose: () => void;
}) {
  return (
    <div className="review-drawer-backdrop">
      <aside className="review-drawer" role="dialog" aria-modal="true">
        <div className="review-drawer-head">
          <div>
            <div className="section-title">{stageLabel(state.stage)}</div>
            <div className="section-subtitle">
              {videoId} / {version}
            </div>
          </div>
          <button type="button" className="btn secondary-btn compact-btn" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="review-drawer-body">
          {state.loading ? <div className="empty-state">正在加载审核数据...</div> : null}
          {state.error ? <div className="task-error">{state.error}</div> : null}
          {!state.loading && !state.error && state.payload ? (
            <>
              {state.stage === "script_review" ? (
                <ScriptReviewClient videoId={videoId} version={version} initial={state.payload as ScriptReviewPayload} />
              ) : null}
              {state.stage === "storyboard_review" ? (
                <StoryboardReviewClient videoId={videoId} version={version} initial={state.payload as StoryboardReviewPayload} />
              ) : null}
              {state.stage === "image_review" ? (
                <ImageReviewClient
                  videoId={videoId}
                  version={version}
                  initial={state.payload as ImageReviewPayload}
                  context={state.context}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
