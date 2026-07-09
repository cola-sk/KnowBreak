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

export function ScriptReviewClient({ videoId, version, initial }: Props) {
  const [data, setData] = useState<ScriptReviewPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");

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
      const response = await fetch(
        `/api/projects/${videoId}/${version}/reviews/script_review/approve`,
        { method: "POST" },
      );
      const result = (await response.json()) as { review?: ReviewFile; error?: string };
      if (!response.ok || !result.review) {
        throw new Error(result.error ?? "通过失败");
      }
      setData((prev) => ({ ...prev, review: result.review! }));
      setMessage("脚本审核已通过。你可以进入分镜审核阶段。");
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
          <span className={statusClass(data.review.status)}>{data.review.status}</span>
          <span className="badge">updated: {new Date(data.review.updated_at).toLocaleString()}</span>
        </div>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="secondary" disabled={saving} onClick={save}>
          保存脚本
        </button>
        <button className="warn" disabled={saving} onClick={approve}>
          通过脚本审核
        </button>
      </div>

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
              {script.lines.map((line, lIdx) => (
                <div key={lIdx} style={{ border: "1px dashed var(--line)", borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 8 }}>
                    <textarea
                      value={line.text}
                      onChange={(event) => updateLine(sIdx, lIdx, "text", event.target.value)}
                    />
                    <div>
                      <label style={{ fontSize: 12, color: "var(--muted)" }}>estimated_seconds</label>
                      <input
                        type="number"
                        step="0.1"
                        value={line.estimated_seconds}
                        onChange={(event) =>
                          updateLine(sIdx, lIdx, "estimated_seconds", event.target.value)
                        }
                      />
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
