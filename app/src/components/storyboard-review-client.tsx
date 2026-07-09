"use client";

import { useMemo, useState } from "react";

import type { ReviewFile } from "@/lib/types";

interface Shot {
  index: number;
  narration: string;
  visual: string;
  broll: string;
  subtitle: string;
  duration: number;
}

interface StoryboardItem {
  topic_index: number;
  title: string;
  shots: Shot[];
}

interface StoryboardsArtifact {
  video_id: string;
  storyboards: StoryboardItem[];
}

export interface StoryboardReviewPayload {
  artifact: StoryboardsArtifact;
  review: ReviewFile;
}

interface Props {
  videoId: string;
  version: string;
  initial: StoryboardReviewPayload;
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

export function StoryboardReviewClient({ videoId, version, initial }: Props) {
  const [data, setData] = useState<StoryboardReviewPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const totalShots = useMemo(
    () => data.artifact.storyboards.reduce((acc, item) => acc + item.shots.length, 0),
    [data.artifact.storyboards],
  );

  const updateShot = (
    boardIndex: number,
    shotIndex: number,
    key: "narration" | "visual" | "broll" | "subtitle" | "duration",
    value: string,
  ) => {
    setData((prev) => {
      const storyboards = prev.artifact.storyboards.map((board, bIdx) => {
        if (bIdx !== boardIndex) {
          return board;
        }
        const shots = board.shots.map((shot, sIdx) => {
          if (sIdx !== shotIndex) {
            return shot;
          }
          if (key === "duration") {
            const parsed = Number(value);
            return {
              ...shot,
              duration: Number.isFinite(parsed) ? parsed : shot.duration,
            };
          }
          return {
            ...shot,
            [key]: value,
          };
        });
        return { ...board, shots };
      });
      return {
        ...prev,
        artifact: {
          ...prev.artifact,
          storyboards,
        },
      };
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${videoId}/${version}/storyboard`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifact: data.artifact,
          review: { status: "in_review" },
        }),
      });
      const next = (await response.json()) as StoryboardReviewPayload | { error: string };
      if (!response.ok) {
        throw new Error("error" in next ? next.error : "保存失败");
      }
      setData(next as StoryboardReviewPayload);
      setMessage("分镜已保存。可继续编辑，或点击“通过分镜审核”。");
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
        `/api/projects/${videoId}/${version}/reviews/storyboard_review/approve`,
        { method: "POST" },
      );
      const result = (await response.json()) as { review?: ReviewFile; error?: string };
      if (!response.ok || !result.review) {
        throw new Error(result.error ?? "通过失败");
      }
      setData((prev) => ({ ...prev, review: result.review! }));
      setMessage("分镜审核已通过。你可以进入图片审核阶段。");
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
          <div style={{ fontWeight: 700, fontSize: 18 }}>分镜审核</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            topics: {data.artifact.storyboards.length}, shots: {totalShots}
          </div>
        </div>
        <div className="row">
          <span className={statusClass(data.review.status)}>{data.review.status}</span>
          <span className="badge">updated: {new Date(data.review.updated_at).toLocaleString()}</span>
        </div>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="secondary" disabled={saving} onClick={save}>
          保存分镜
        </button>
        {data.review.status === "approved" ? (
          <span className="approved-pill">已通过</span>
        ) : (
          <button className="approve-btn" disabled={saving} onClick={approve}>
            通过分镜审核
          </button>
        )}
      </div>

      {message ? <div style={{ marginTop: 10, color: "var(--muted)" }}>{message}</div> : null}

      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {data.artifact.storyboards.map((board, bIdx) => (
          <section
            key={`${board.topic_index}-${bIdx}`}
            style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}
          >
            <div style={{ fontWeight: 700 }}>
              #{board.topic_index} {board.title}
            </div>

            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>镜头</th>
                    <th style={{ textAlign: "left" }}>旁白</th>
                    <th style={{ textAlign: "left" }}>画面</th>
                    <th style={{ textAlign: "left" }}>B-roll</th>
                    <th style={{ textAlign: "left" }}>字幕</th>
                    <th style={{ textAlign: "left" }}>时长</th>
                  </tr>
                </thead>
                <tbody>
                  {board.shots.map((shot, sIdx) => (
                    <tr key={shot.index}>
                      <td style={{ verticalAlign: "top", padding: "8px 6px", width: 80 }}>{shot.index}</td>
                      <td style={{ padding: "8px 6px" }}>
                        <textarea
                          value={shot.narration}
                          onChange={(event) =>
                            updateShot(bIdx, sIdx, "narration", event.target.value)
                          }
                        />
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <textarea
                          value={shot.visual}
                          onChange={(event) => updateShot(bIdx, sIdx, "visual", event.target.value)}
                        />
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <textarea
                          value={shot.broll}
                          onChange={(event) => updateShot(bIdx, sIdx, "broll", event.target.value)}
                        />
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <textarea
                          value={shot.subtitle}
                          onChange={(event) =>
                            updateShot(bIdx, sIdx, "subtitle", event.target.value)
                          }
                        />
                      </td>
                      <td style={{ padding: "8px 6px", width: 110 }}>
                        <input
                          type="number"
                          step="0.1"
                          value={shot.duration}
                          onChange={(event) =>
                            updateShot(bIdx, sIdx, "duration", event.target.value)
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
