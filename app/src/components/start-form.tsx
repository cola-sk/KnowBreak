"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";

import { countOverrideLeaves, deepMerge, ProjectProfileConfigModal } from "@/components/profile-editor";
import { TtsSettingsPanel } from "@/components/tts-settings-panel";
import type { WorkflowSummary } from "@/lib/review-store";
import {
  compactRuntimeOverrides,
  countRuntimeOverrideLeaves,
  effectiveTtsSettings,
  saveTtsHistoryItem,
  type ProjectRuntimeOverrides,
  type TtsRuntimeDefaults,
} from "@/lib/tts-settings";

interface Props {
  workflows: WorkflowSummary[];
  profileBase: Record<string, unknown>;
  globalOverrides: Record<string, unknown>;
  ttsDefaults: TtsRuntimeDefaults;
}

interface StartResponse {
  ok?: boolean;
  job?: {
    id: string;
    logPath: string;
  };
  error?: string;
}

interface JobStatus {
  job?: {
    id: string;
    status: "running" | "succeeded" | "failed";
    videoId: string | null;
    version: string | null;
    error?: string;
  };
  error?: string;
}

export function StartForm({ workflows, profileBase, globalOverrides, ttsDefaults }: Props) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [workflow, setWorkflow] = useState("topic_seed_review");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Project overrides state
  const [projectOverrides, setProjectOverrides] = useState<Record<string, unknown>>({});
  const [runtimeOverrides, setRuntimeOverrides] = useState<ProjectRuntimeOverrides>({});
  const [showConfig, setShowConfig] = useState(false);
  const inheritedProfile = useMemo(() => deepMerge(profileBase, globalOverrides), [profileBase, globalOverrides]);

  const detectKind = (value: string): "url" | "topic" => {
    return /^(https?:\/\/|youtu\.be\/|youtube\.com)/i.test(value.trim()) ? "url" : "topic";
  };

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setError("请输入主题或 YouTube URL");
      return;
    }
    if (inputMismatch) {
      setError(inputMismatch);
      return;
    }
    setSubmitting(true);
    setError("");
    setStatus("正在启动...");
    try {
      saveTtsHistoryItem(effectiveTtsSettings(ttsDefaults, runtimeOverrides));
      const response = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: trimmed,
          workflow,
          projectOverrides: countOverrideLeaves(projectOverrides) > 0 ? projectOverrides : undefined,
          runtimeOverrides: countRuntimeOverrideLeaves(runtimeOverrides) > 0
            ? compactRuntimeOverrides(runtimeOverrides)
            : undefined,
        }),
      });
      const payload = (await response.json()) as StartResponse;
      if (!response.ok || !payload.job) {
        throw new Error(payload.error ?? "启动失败");
      }
      setJobId(payload.job.id);
      setStatus("已启动，正在跳转任务详情页...");
      router.push(`/tasks/${payload.job.id}`);
      setSubmitting(false);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "启动失败");
    }
  };

  const pollJob = async (id: string) => {
    const deadline = Date.now() + 10 * 60 * 1000;
    const intervalMs = 2000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`/api/start/${id}`);
        if (res.ok) {
          const payload = (await res.json()) as JobStatus;
          const job = payload.job;
          if (job?.videoId && job.version) {
            setStatus(`已生成 video_id=${job.videoId} version=${job.version}，跳转中...`);
            router.push(`/projects/${job.videoId}/${job.version}/review`);
            return;
          }
          if (job?.status === "failed") {
            throw new Error(job.error ?? "流水线失败");
          }
          setStatus(`运行中 (${job?.status ?? "running"})...`);
        }
      } catch (err) {
        setSubmitting(false);
        setError(err instanceof Error ? err.message : "查询状态失败");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    setSubmitting(false);
    setError("等待超时：流水线超过 10 分钟仍未输出 video_id，可在 /projects 中查看是否已生成项目。");
  };

  const kind = detectKind(input);
  const selectedWorkflow = useMemo(
    () => workflows.find((item) => item.path === workflow || item.id === workflow),
    [workflows, workflow],
  );
  const inputMismatch = useMemo(() => {
    if (!input.trim() || !selectedWorkflow) {
      return "";
    }
    if (kind === "url" && selectedWorkflow.inputMode === "topic") {
      return "当前工作流是主题直出流程，不会处理 YouTube 视频；请选择包含 ASR 的视频工作流，或改用主题文本输入。";
    }
    if (kind === "topic" && selectedWorkflow.inputMode === "video") {
      return "当前工作流需要视频源；请选择 topic_seed 类主题工作流，或输入 YouTube URL。";
    }
    return "";
  }, [input, kind, selectedWorkflow]);

  return (
    <div className="form-card">
      <div className="form-group">
        <div className="form-label-row">
          <label htmlFor="input-field" className="form-label">
            输入主题或 YouTube 链接
          </label>
          {input && (
            <span className="badge info-badge">
              当前识别为：{kind === "url" ? "🔗 视频链接" : "📝 主题"}
            </span>
          )}
        </div>
        <textarea
          id="input-field"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="例如：台风天玻璃贴米字胶带有用吗，或者输入 https://www.youtube.com/watch?v=..."
          disabled={submitting}
        />
      </div>

      <div className="form-group">
        <div className="form-label-row">
          <label htmlFor="workflow-field" className="form-label">
            工作流模板 (Workflow)
          </label>
          {selectedWorkflow && (
            <span className={`badge ${selectedWorkflow.inputMode === "video" ? "info-badge" : ""}`}>
              {selectedWorkflow.inputMode === "video" ? "视频源工作流" : "主题直出工作流"}
            </span>
          )}
        </div>
        <div className="select-wrapper">
          <select
            id="workflow-field"
            value={workflow}
            onChange={(event) => setWorkflow(event.target.value)}
            disabled={submitting}
          >
            {workflows.length === 0 ? (
              <option value="">（无可用 workflow）</option>
            ) : (
              workflows.map((w) => (
                <option key={w.path} value={w.path}>
                  {w.id}
                  {w.description ? ` — ${w.description}` : ""}
                </option>
              ))
            )}
          </select>
        </div>
        {inputMismatch && (
          <div className="warning-message">
            {inputMismatch}
          </div>
        )}
      </div>

      {/* Project configuration customization panel */}
      <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
        <button
          type="button"
          className="btn secondary-btn"
          onClick={() => setShowConfig(true)}
          style={{ width: "100%", justifyContent: "space-between", padding: "12px 18px" }}
        >
          <span>自定义当前项目专属参数 {countOverrideLeaves(projectOverrides) > 0 ? `(${countOverrideLeaves(projectOverrides)} 项修改)` : ""}</span>
          <span>打开可视化设置</span>
        </button>
        <div className="section-subtitle">
          仅对本次启动任务生效；未设置的字段继承全局配置。
        </div>
      </div>

      {showConfig ? (
        <ProjectProfileConfigModal
          title="当前项目专属参数"
          description="这里的修改只随本次启动任务保存到项目，不会写入全局 profile_overrides.json。"
          base={inheritedProfile}
          value={projectOverrides}
          onChange={setProjectOverrides}
          onClose={() => setShowConfig(false)}
        />
      ) : null}

      <TtsSettingsPanel
        value={runtimeOverrides}
        defaults={ttsDefaults}
        onChange={setRuntimeOverrides}
        disabled={submitting}
      />

      <div className="form-actions">
        <button
          className="btn primary-btn"
          disabled={submitting || !input.trim() || workflows.length === 0 || Boolean(inputMismatch)}
          onClick={handleSubmit}
        >
          {submitting ? "正在运行中..." : "开始流程"}
        </button>
        
        {status && (
          <div className="status-message">
            <span className="spinner-dots"></span>
            <span>{status}</span>
          </div>
        )}
        
        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}
      </div>

      {jobId && (
        <div className="job-info">
          <span className="job-label">任务 ID:</span>
          <code className="job-id">{jobId}</code>
        </div>
      )}
    </div>
  );
}
