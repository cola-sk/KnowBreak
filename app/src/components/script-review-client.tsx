"use client";

import { useMemo, useState } from "react";

import type { ReviewFile } from "@/lib/types";

interface ScriptLine {
  text: string;
  estimated_seconds: number;
}

interface ScriptItem {
  topic_index: number;
  title: string;
  cover_narration?: string;
  lines: ScriptLine[];
  total_duration: number;
  hashtags: string[];
}

interface ScriptsArtifact {
  video_id: string;
  scripts: ScriptItem[];
}

export interface ScriptReviewPayload {
  artifact: ScriptsArtifact;
  review: ReviewFile;
}

interface Props {
  videoId: string;
  version: string;
  initial: ScriptReviewPayload;
  readOnly?: boolean;
}

function statusClass(status: string): string {
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

export function ScriptReviewClient({ videoId, version, initial, readOnly = false }: Props) {
  const [data, setData] = useState<ScriptReviewPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [undoStack, setUndoStack] = useState<ScriptReviewPayload[]>([]);

  const totalLines = useMemo(
    () => data.artifact.scripts.reduce((acc, script) => acc + script.lines.length, 0),
    [data.artifact.scripts],
  );

  const updateLine = (scriptIndex: number, lineIndex: number, key: "text" | "estimated_seconds", value: string) => {
    setData((prev) => {
      const scripts = prev.artifact.scripts.map((script, sIdx) => {
        if (sIdx !== scriptIndex) {
          return script;
        }
        const lines = script.lines.map((line, lIdx) => {
          if (lIdx !== lineIndex) {
            return line;
          }
          if (key === "text") {
            return { ...line, text: value };
          }
          const parsed = Number(value);
          return { ...line, estimated_seconds: Number.isFinite(parsed) ? parsed : line.estimated_seconds };
        });
        return { ...script, lines };
      });

      return {
        ...prev,
        artifact: {
          ...prev.artifact,
          scripts,
        },
      };
    });
  };

  const updateScriptField = (scriptIndex: number, key: "title" | "cover_narration", value: string) => {
    setData((prev) => ({
      ...prev,
      artifact: {
        ...prev.artifact,
        scripts: prev.artifact.scripts.map((script, sIdx) =>
          sIdx === scriptIndex ? { ...script, [key]: value } : script,
        ),
      },
    }));
  };

  const pushUndo = () => {
    setUndoStack((prev) => [data, ...prev].slice(0, 20));
  };

  const restoreLast = () => {
    const previous = undoStack[0];
    if (!previous) {
      return;
    }
    setData(previous);
    setUndoStack((prev) => prev.slice(1));
    setMessage("已撤销上一处新增/删除。");
  };

  const recalcDuration = (lines: ScriptLine[]): number =>
    Number(lines.reduce((acc, line) => acc + (Number(line.estimated_seconds) || 0), 0).toFixed(1));

  const addLine = (scriptIndex: number, afterIndex: number | null = null) => {
    if (readOnly) {
      return;
    }
    pushUndo();
    setData((prev) => ({
      ...prev,
      artifact: {
        ...prev.artifact,
        scripts: prev.artifact.scripts.map((script, sIdx) => {
          if (sIdx !== scriptIndex) {
            return script;
          }
          const insertAt = afterIndex === null ? script.lines.length : afterIndex + 1;
          const base = afterIndex === null ? script.lines.at(-1) : script.lines[afterIndex];
          const nextLines = [
            ...script.lines.slice(0, insertAt),
            {
              text: "",
              estimated_seconds: base?.estimated_seconds ?? 3,
            },
            ...script.lines.slice(insertAt),
          ];
          return { ...script, lines: nextLines, total_duration: recalcDuration(nextLines) };
        }),
      },
    }));
    setMessage("已新增一条脚本行，保存后生效。");
  };

  const deleteLine = (scriptIndex: number, lineIndex: number) => {
    if (readOnly) {
      return;
    }
    pushUndo();
    setData((prev) => ({
      ...prev,
      artifact: {
        ...prev.artifact,
        scripts: prev.artifact.scripts.map((script, sIdx) => {
          if (sIdx !== scriptIndex) {
            return script;
          }
          const nextLines = script.lines.filter((_, lIdx) => lIdx !== lineIndex);
          return { ...script, lines: nextLines, total_duration: recalcDuration(nextLines) };
        }),
      },
    }));
    setMessage("已删除一条脚本行，可撤销；保存后生效。");
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${videoId}/${version}/script`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifact: data.artifact,
          review: { status: "in_review" },
        }),
      });
      const next = (await response.json()) as ScriptReviewPayload | { error: string };
      if (!response.ok) {
        throw new Error("error" in next ? next.error : "保存失败");
      }
      setData(next as ScriptReviewPayload);
      setUndoStack([]);
      setMessage("脚本已保存。可继续编辑，或点击“通过脚本审核”。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    setSaving(true);
    setMessage("");
    try {
      // 先把本地编辑过的 artifact 落盘，避免直接 approve 丢内容
      const saveResponse = await fetch(`/api/projects/${videoId}/${version}/script`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifact: data.artifact,
          review: { status: "in_review" },
        }),
      });
      const saved = (await saveResponse.json()) as ScriptReviewPayload | { error: string };
      if (!saveResponse.ok) {
        throw new Error("error" in saved ? saved.error : "保存失败");
      }
      const savedPayload = saved as ScriptReviewPayload;

      const approveResponse = await fetch(
        `/api/projects/${videoId}/${version}/reviews/script_review/approve`,
        { method: "POST" },
      );
      const result = (await approveResponse.json()) as { review?: ReviewFile; error?: string };
      if (!approveResponse.ok || !result.review) {
        throw new Error(result.error ?? "通过失败");
      }
      setData({ ...savedPayload, review: result.review });
      setUndoStack([]);
      setMessage("脚本已保存并审核通过。你可以进入分镜审核阶段。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通过失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>脚本审核</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            topics: {data.artifact.scripts.length}, lines: {totalLines}
          </div>
        </div>
        <div className="row">
          <span className={readOnly ? "badge" : statusClass(data.review.status)}>
            {readOnly ? "只读" : data.review.status}
          </span>
          {!readOnly ? <span className="badge">updated: {new Date(data.review.updated_at).toLocaleString()}</span> : null}
        </div>
      </div>

      {!readOnly ? (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="secondary" disabled={saving} onClick={save}>
            保存脚本
          </button>
          <button className="secondary" disabled={saving || undoStack.length === 0} onClick={restoreLast}>
            撤销新增/删除
          </button>
          {data.review.status === "approved" ? (
            <span className="approved-pill">已通过</span>
          ) : (
            <button className="approve-btn" disabled={saving} onClick={approve}>
              通过脚本审核
            </button>
          )}
        </div>
      ) : null}

      {message ? <div style={{ marginTop: 10, color: "var(--muted)" }}>{message}</div> : null}

      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {data.artifact.scripts.map((script, sIdx) => (
          <section
            key={`${script.topic_index}-${sIdx}`}
            style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}
          >
            <div style={{ fontWeight: 700 }}>
              #{script.topic_index} {script.title}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
              total_duration: {script.total_duration}s
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>
                  封面显示标题 / script.title（控制 MP4 封面大字和正文顶部标题）
                </label>
                <input
                  value={script.title}
                  readOnly={readOnly}
                  onChange={(event) => updateScriptField(sIdx, "title", event.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>
                  cover_narration（只控制封面朗读，不控制画面大字）
                </label>
                <textarea
                  value={script.cover_narration ?? ""}
                  readOnly={readOnly}
                  onChange={(event) => updateScriptField(sIdx, "cover_narration", event.target.value)}
                />
              </div>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {!readOnly ? (
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="secondary compact-btn" disabled={saving} onClick={() => addLine(sIdx)}>
                    末尾新增脚本行
                  </button>
                </div>
              ) : null}
              {script.lines.map((line, lIdx) => (
                <div key={lIdx} style={{ border: "1px dashed var(--line)", borderRadius: 10, padding: 10 }}>
                  {!readOnly ? (
                    <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                      <span className="badge">line {lIdx + 1}</span>
                      <div className="row">
                        <button className="secondary compact-btn" disabled={saving} onClick={() => addLine(sIdx, lIdx)}>
                          下方新增
                        </button>
                        <button className="warn compact-btn" disabled={saving} onClick={() => deleteLine(sIdx, lIdx)}>
                          删除
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 8 }}>
                    <textarea
                      value={line.text}
                      readOnly={readOnly}
                      onChange={(event) => updateLine(sIdx, lIdx, "text", event.target.value)}
                    />
                    <div>
                      <label style={{ fontSize: 12, color: "var(--muted)" }}>时长（秒）</label>
                      <input
                        type="number"
                        step="0.1"
                        value={line.estimated_seconds}
                        readOnly={readOnly}
                        onChange={(event) =>
                          updateLine(sIdx, lIdx, "estimated_seconds", event.target.value)
                        }
                      />
                      <div style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.4, marginTop: 4 }}>
                        有口播时以 TTS 实际时长为准；空口播按此生成静音。
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
