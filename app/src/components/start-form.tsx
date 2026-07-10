"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";

import type { WorkflowSummary } from "@/lib/review-store";
import { PROFILE_DEFAULTS, type ColorTriple, type FieldSpec } from "@/lib/profile-defaults";

interface Props {
  workflows: WorkflowSummary[];
  globalOverrides: Record<string, any>;
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

function getNested(state: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = state;
  for (const part of parts) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function setNested(state: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const parts = key.split(".");
  const next = structuredClone(state) as Record<string, unknown>;
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
  return next;
}

function clearNested(state: Record<string, unknown>, key: string): Record<string, unknown> {
  const parts = key.split(".");
  const next = structuredClone(state) as Record<string, unknown>;
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      return next;
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  delete cursor[parts[parts.length - 1]];

  // Clean empty parent objects recursively
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    let pCursor = next;
    for (let j = 0; j < i; j += 1) {
      pCursor = pCursor[parts[j]] as Record<string, unknown>;
    }
    const currentPart = parts[i];
    const parentObj = pCursor[currentPart];
    if (parentObj && typeof parentObj === "object" && Object.keys(parentObj).length === 0) {
      delete pCursor[currentPart];
    }
  }

  return next;
}

export function StartForm({ workflows, globalOverrides }: Props) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [workflow, setWorkflow] = useState("topic_seed_review");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Project overrides state
  const [projectOverrides, setProjectOverrides] = useState<Record<string, unknown>>({});
  const [showConfig, setShowConfig] = useState(false);
  const [showAllConfig, setShowAllConfig] = useState(false);
  const [aspectRatioPreset, setAspectRatioPreset] = useState<string>("inherit");

  const detectKind = (value: string): "url" | "topic" => {
    return /^(https?:\/\/|youtu\.be\/|youtube\.com)/i.test(value.trim()) ? "url" : "topic";
  };

  const getInheritedValue = (key: string): unknown => {
    const val = getNested(globalOverrides, key);
    if (val !== undefined) return val;

    // Fallback to absolute defaults
    for (const group of PROFILE_DEFAULTS) {
      for (const spec of group.fields) {
        if (spec.key === key) {
          return spec.default;
        }
      }
    }
    return undefined;
  };

  const getInheritedValueString = (key: string): string => {
    const val = getInheritedValue(key);
    if (val === undefined) return "—";
    if (typeof val === "boolean") return val ? "是" : "否";
    if (Array.isArray(val)) return val.join(", ");
    if (val && typeof val === "object" && "r" in val) {
      const c = val as any;
      return `rgb(${c.r}, ${c.g}, ${c.b})`;
    }
    return String(val);
  };

  const handleOverrideChange = (key: string, value: unknown) => {
    if (value === undefined || value === "") {
      setProjectOverrides((prev) => clearNested(prev, key));
    } else {
      setProjectOverrides((prev) => setNested(prev, key, value));
    }
  };

  const handleAspectRatioPresetChange = (preset: string) => {
    setAspectRatioPreset(preset);
    if (preset === "vertical") {
      setProjectOverrides((prev) => {
        let n = setNested(prev, "compose.video_w", 1080);
        return setNested(n, "compose.video_h", 1920);
      });
    } else if (preset === "horizontal") {
      setProjectOverrides((prev) => {
        let n = setNested(prev, "compose.video_w", 1920);
        return setNested(n, "compose.video_h", 1080);
      });
    } else if (preset === "square") {
      setProjectOverrides((prev) => {
        let n = setNested(prev, "compose.video_w", 1080);
        return setNested(n, "compose.video_h", 1080);
      });
    } else if (preset === "inherit") {
      setProjectOverrides((prev) => {
        let n = clearNested(prev, "compose.video_w");
        return clearNested(n, "compose.video_h");
      });
    }
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
      const response = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: trimmed,
          workflow,
          projectOverrides: Object.keys(projectOverrides).length > 0 ? projectOverrides : undefined,
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

  // Filter out variables that we display separately in project config
  const curatedKeys = [
    "topics.count",
    "topics.target_duration_min",
    "topics.target_duration_max",
    "compose.brand",
    "intro.enabled",
    "compose.progress_bar_enabled"
  ];

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
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn secondary-btn"
          onClick={() => setShowConfig(!showConfig)}
          style={{ width: "100%", justifyContent: "space-between", padding: "12px 18px" }}
        >
          <span>✨ 自定义当前项目专属参数 {Object.keys(projectOverrides).length > 0 ? `(${Object.keys(projectOverrides).length} 项修改)` : ""}</span>
          <span>{showConfig ? "收起参数" : "展开参数配置"}</span>
        </button>

        {showConfig && (
          <div className="sub-panel" style={{ marginTop: 14, display: "grid", gap: 18, animation: "fadeIn 0.2s ease" }}>
            <div style={{ fontSize: 13, color: "var(--muted)", borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
              此处设置仅对本次启动的任务生效。空值表示**继承全局默认配置**。
            </div>

            {/* Curated overrides */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
              {/* Brand watermark */}
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 13 }}>视频品牌水印</label>
                <input
                  type="text"
                  placeholder={`继承全局: ${getInheritedValueString("compose.brand")}`}
                  value={(getNested(projectOverrides, "compose.brand") as string) || ""}
                  onChange={(e) => handleOverrideChange("compose.brand", e.target.value)}
                />
              </div>

              {/* Topics Count */}
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 13 }}>选题分裂数量</label>
                <input
                  type="number"
                  min={1}
                  placeholder={`继承全局: ${getInheritedValueString("topics.count")}`}
                  value={(getNested(projectOverrides, "topics.count") as number) || ""}
                  onChange={(e) => handleOverrideChange("topics.count", e.target.value ? Number(e.target.value) : "")}
                />
              </div>

              {/* Aspect Ratio Presets */}
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 13 }}>视频分辨率 / 比例</label>
                <select
                  value={aspectRatioPreset}
                  onChange={(e) => handleAspectRatioPresetChange(e.target.value)}
                >
                  <option value="inherit">继承全局默认比例</option>
                  <option value="vertical">📱 竖屏 9:16 (1080 x 1920)</option>
                  <option value="horizontal">💻 横屏 16:9 (1920 x 1080)</option>
                  <option value="square">⏹️ 方形 1:1 (1080 x 1080)</option>
                  <option value="custom">🛠️ 自定义尺寸</option>
                </select>
              </div>
            </div>

            {/* Custom dimensions if preset is custom */}
            {aspectRatioPreset === "custom" && (
              <div className="row" style={{ gap: 12 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" style={{ fontSize: 12, color: "var(--muted)" }}>视频宽度 (W)</label>
                  <input
                    type="number"
                    placeholder={`继承全局: ${getInheritedValueString("compose.video_w")}`}
                    value={(getNested(projectOverrides, "compose.video_w") as number) || ""}
                    onChange={(e) => handleOverrideChange("compose.video_w", e.target.value ? Number(e.target.value) : "")}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" style={{ fontSize: 12, color: "var(--muted)" }}>视频高度 (H)</label>
                  <input
                    type="number"
                    placeholder={`继承全局: ${getInheritedValueString("compose.video_h")}`}
                    value={(getNested(projectOverrides, "compose.video_h") as number) || ""}
                    onChange={(e) => handleOverrideChange("compose.video_h", e.target.value ? Number(e.target.value) : "")}
                  />
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
              {/* Min/Max duration */}
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 13 }}>单选题最短时长(秒)</label>
                <input
                  type="number"
                  placeholder={`继承全局: ${getInheritedValueString("topics.target_duration_min")}`}
                  value={(getNested(projectOverrides, "topics.target_duration_min") as number) || ""}
                  onChange={(e) => handleOverrideChange("topics.target_duration_min", e.target.value ? Number(e.target.value) : "")}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: 13 }}>单选题最长时长(秒)</label>
                <input
                  type="number"
                  placeholder={`继承全局: ${getInheritedValueString("topics.target_duration_max")}`}
                  value={(getNested(projectOverrides, "topics.target_duration_max") as number) || ""}
                  onChange={(e) => handleOverrideChange("topics.target_duration_max", e.target.value ? Number(e.target.value) : "")}
                />
              </div>

              {/* Boolean configs */}
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 13 }}>视频片头启用</label>
                <select
                  value={
                    getNested(projectOverrides, "intro.enabled") === undefined
                      ? "inherit"
                      : getNested(projectOverrides, "intro.enabled")
                        ? "true"
                        : "false"
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    handleOverrideChange(
                      "intro.enabled",
                      val === "inherit" ? undefined : val === "true"
                    );
                  }}
                >
                  <option value="inherit">继承全局默认 ({getInheritedValue("intro.enabled") ? "是" : "否"})</option>
                  <option value="true">启用片头</option>
                  <option value="false">禁用片头</option>
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
              {/* Progress bar enabled */}
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 13 }}>视频底部进度条</label>
                <select
                  value={
                    getNested(projectOverrides, "compose.progress_bar_enabled") === undefined
                      ? "inherit"
                      : getNested(projectOverrides, "compose.progress_bar_enabled")
                        ? "true"
                        : "false"
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    handleOverrideChange(
                      "compose.progress_bar_enabled",
                      val === "inherit" ? undefined : val === "true"
                    );
                  }}
                >
                  <option value="inherit">继承全局默认 ({getInheritedValue("compose.progress_bar_enabled") ? "是" : "否"})</option>
                  <option value="true">显示进度条</option>
                  <option value="false">隐藏进度条</option>
                </select>
              </div>
            </div>

            {/* Advanced configurations toggle */}
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 6 }}>
              <button
                type="button"
                className="btn secondary-btn"
                onClick={() => setShowAllConfig(!showAllConfig)}
                style={{ fontSize: 12, padding: "6px 12px" }}
              >
                {showAllConfig ? "隐藏高级全局覆盖" : "🔍 展开并覆盖其他所有配置选项"}
              </button>

              {showAllConfig && (
                <div style={{ marginTop: 14, display: "grid", gap: 16, borderLeft: "2px solid var(--accent)", paddingLeft: 14 }}>
                  {PROFILE_DEFAULTS.map((group) => {
                    // Filter out parameters we already showed in curated section above to prevent duplicate controls
                    const fields = group.fields.filter(f => !curatedKeys.includes(f.key) && f.key !== "compose.video_w" && f.key !== "compose.video_h");
                    if (fields.length === 0) return null;

                    return (
                      <div key={group.title} style={{ display: "grid", gap: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>{group.title}</div>
                        {fields.map((spec) => (
                          <FieldRow
                            key={spec.key}
                            spec={spec}
                            value={getNested(projectOverrides, spec.key)}
                            inheritedValue={getInheritedValue(spec.key)}
                            onChange={(value) => handleOverrideChange(spec.key, value)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

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

// Field row inside advanced settings
interface FieldRowProps {
  spec: FieldSpec;
  value: unknown;
  inheritedValue: unknown;
  onChange: (value: unknown) => void;
}

function FieldRow({ spec, value, inheritedValue, onChange }: FieldRowProps) {
  const isOverridden = value !== undefined;
  
  const getDisplayDefault = () => {
    if (inheritedValue === undefined) return "—";
    if (typeof inheritedValue === "boolean") return inheritedValue ? "是" : "否";
    if (inheritedValue && typeof inheritedValue === "object" && "r" in inheritedValue) {
      const c = inheritedValue as any;
      return `rgb(${c.r}, ${c.g}, ${c.b})`;
    }
    return String(inheritedValue);
  };

  const defaultHint = `继承: ${getDisplayDefault()}`;

  if (spec.kind === "bool") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500 }}>{spec.label}</label>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            <code>{spec.key}</code> · {defaultHint}
          </div>
        </div>
        <select
          value={value === undefined ? "inherit" : value ? "true" : "false"}
          onChange={(e) => {
            const val = e.target.value;
            onChange(val === "inherit" ? undefined : val === "true");
          }}
          style={{ maxWidth: 180 }}
        >
          <option value="inherit">继承</option>
          <option value="true">是 (True)</option>
          <option value="false">否 (False)</option>
        </select>
      </div>
    );
  }

  if (spec.kind === "color") {
    const arr = Array.isArray(value) && value.length === 3
      ? (value as number[]).map((n) => Number(n))
      : undefined;

    const displayArr = arr || (function () {
      if (inheritedValue && typeof inheritedValue === "object" && "r" in inheritedValue) {
        const c = inheritedValue as any;
        return [c.r, c.g, c.b];
      }
      if (Array.isArray(inheritedValue) && inheritedValue.length === 3) {
        return inheritedValue;
      }
      return [0, 0, 0];
    })();

    const handleChange = (idx: number, raw: string) => {
      const parsed = Number(raw);
      const next = [...(arr || displayArr)] as number[];
      next[idx] = Number.isFinite(parsed) ? Math.max(0, Math.min(255, Math.round(parsed))) : 0;
      onChange(next);
    };

    return (
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500 }}>{spec.label}</label>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              <code>{spec.key}</code> · {defaultHint}
            </div>
          </div>
          {isOverridden && (
            <button
              type="button"
              className="badge warning"
              onClick={() => onChange(undefined)}
              style={{ padding: "2px 8px", cursor: "pointer", border: "none" }}
            >
              清除覆盖
            </button>
          )}
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          {(["R", "G", "B"] as const).map((label, idx) => (
            <div key={label} style={{ display: "grid", gap: 2, maxWidth: 90 }}>
              <input
                type="number"
                min={0}
                max={255}
                value={isOverridden ? displayArr[idx] : ""}
                placeholder={String(displayArr[idx])}
                onChange={(event) => handleChange(idx, event.target.value)}
                style={{ maxWidth: 90 }}
              />
            </div>
          ))}
          <span
            className="badge"
            style={{
              background: `rgb(${displayArr[0]}, ${displayArr[1]}, ${displayArr[2]})`,
              color: displayArr[0] + displayArr[1] + displayArr[2] > 384 ? "#000" : "#fff",
              border: "1px solid var(--line)"
            }}
          >
            {displayArr.join(",")} {isOverridden ? "(已覆写)" : ""}
          </span>
        </div>
      </div>
    );
  }

  const numValue = typeof value === "number" ? String(value) : "";
  const strValue = typeof value === "string" ? value : "";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
      <div>
        <label style={{ fontSize: 13, fontWeight: 500 }}>{spec.label}</label>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          <code>{spec.key}</code> · {defaultHint}{spec.hint ? ` · ${spec.hint}` : ""}
        </div>
      </div>
      <input
        type={spec.kind === "string" ? "text" : "number"}
        step={spec.kind === "float" ? "0.01" : "1"}
        value={spec.kind === "string" ? strValue : numValue}
        placeholder={getDisplayDefault()}
        onChange={(event) => {
          if (event.target.value === "") {
            onChange(undefined);
            return;
          }
          if (spec.kind === "string") {
            onChange(event.target.value);
            return;
          }
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        style={{ maxWidth: 180 }}
      />
      {isOverridden ? (
        <button type="button" className="badge warning" onClick={() => onChange(undefined)} style={{ padding: "6px 12px", height: 38 }}>
          清除
        </button>
      ) : (
        <span style={{ width: 44 }} />
      )}
    </div>
  );
}
