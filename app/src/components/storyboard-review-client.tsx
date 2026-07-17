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

function reindexShots(shots: Shot[]): Shot[] {
  return shots.map((shot, index) => ({ ...shot, index }));
}

export function StoryboardReviewClient({ videoId, version, initial, readOnly = false }: Props) {
  const [data, setData] = useState<StoryboardReviewPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [undoStack, setUndoStack] = useState<StoryboardReviewPayload[]>([]);

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

  const addShot = (boardIndex: number, afterIndex: number | null = null) => {
    if (readOnly) {
      return;
    }
    pushUndo();
    setData((prev) => ({
      ...prev,
      artifact: {
        ...prev.artifact,
        storyboards: prev.artifact.storyboards.map((board, bIdx) => {
          if (bIdx !== boardIndex) {
            return board;
          }
          const insertAt = afterIndex === null ? board.shots.length : afterIndex + 1;
          const base = afterIndex === null ? board.shots.at(-1) : board.shots[afterIndex];
          const narration = base?.narration ?? "";
          const nextShots = reindexShots([
            ...board.shots.slice(0, insertAt),
            {
              index: insertAt,
              narration,
              visual: "",
              broll: "",
              subtitle: narration,
              duration: base?.duration ?? 3,
            },
            ...board.shots.slice(insertAt),
          ]);
          return { ...board, shots: nextShots };
        }),
      },
    }));
    setMessage("已新增一条分镜，保存后生效。");
  };

  const deleteShot = (boardIndex: number, shotIndex: number) => {
    if (readOnly) {
      return;
    }
    pushUndo();
    setData((prev) => ({
      ...prev,
      artifact: {
        ...prev.artifact,
        storyboards: prev.artifact.storyboards.map((board, bIdx) =>
          bIdx === boardIndex
            ? { ...board, shots: reindexShots(board.shots.filter((_, sIdx) => sIdx !== shotIndex)) }
            : board,
        ),
      },
    }));
    setMessage("已删除一条分镜，可撤销；保存后生效。");
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${videoId}/${version}/storyboard`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifact: {
            ...data.artifact,
            storyboards: data.artifact.storyboards.map((board) => ({
              ...board,
              shots: reindexShots(board.shots),
            })),
          },
          review: { status: "in_review" },
        }),
      });
      const next = (await response.json()) as StoryboardReviewPayload | { error: string };
      if (!response.ok) {
        throw new Error("error" in next ? next.error : "保存失败");
      }
      setData(next as StoryboardReviewPayload);
      setUndoStack([]);
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
      const saveResponse = await fetch(`/api/projects/${videoId}/${version}/storyboard`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifact: {
            ...data.artifact,
            storyboards: data.artifact.storyboards.map((board) => ({
              ...board,
              shots: reindexShots(board.shots),
            })),
          },
          review: { status: "in_review" },
        }),
      });
      const saved = (await saveResponse.json()) as StoryboardReviewPayload | { error: string };
      if (!saveResponse.ok) {
        throw new Error("error" in saved ? saved.error : "保存失败");
      }
      const savedPayload = saved as StoryboardReviewPayload;

      const response = await fetch(
        `/api/projects/${videoId}/${version}/reviews/storyboard_review/approve`,
        { method: "POST" },
      );
      const result = (await response.json()) as { review?: ReviewFile; error?: string };
      if (!response.ok || !result.review) {
        throw new Error(result.error ?? "通过失败");
      }
      setData({ ...savedPayload, review: result.review });
      setUndoStack([]);
      setMessage("分镜已保存并审核通过。你可以进入图片审核阶段。");
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
          <span className={readOnly ? "badge" : statusClass(data.review.status)}>
            {readOnly ? "只读" : data.review.status}
          </span>
          {!readOnly ? <span className="badge">updated: {new Date(data.review.updated_at).toLocaleString()}</span> : null}
        </div>
      </div>

      {!readOnly ? (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="secondary" disabled={saving} onClick={save}>
            保存分镜
          </button>
          <button className="secondary" disabled={saving || undoStack.length === 0} onClick={restoreLast}>
            撤销新增/删除
          </button>
          {data.review.status === "approved" ? (
            <span className="approved-pill">已通过</span>
          ) : (
            <button className="approve-btn" disabled={saving} onClick={approve}>
              通过分镜审核
            </button>
          )}
        </div>
      ) : null}

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
              {!readOnly ? (
                <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
                  <button className="secondary compact-btn" disabled={saving} onClick={() => addShot(bIdx)}>
                    末尾新增分镜
                  </button>
                </div>
              ) : null}
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>镜头</th>
                    {!readOnly ? <th style={{ textAlign: "left" }}>操作</th> : null}
                    <th style={{ textAlign: "left" }}>旁白</th>
                    <th style={{ textAlign: "left" }}>画面</th>
                    <th style={{ textAlign: "left" }}>B-roll</th>
                    <th style={{ textAlign: "left" }}>字幕</th>
                    <th style={{ textAlign: "left" }}>参考时长</th>
                  </tr>
                </thead>
                <tbody>
                  {board.shots.map((shot, sIdx) => (
                    <tr key={shot.index}>
                      <td style={{ verticalAlign: "top", padding: "8px 6px", width: 80 }}>{shot.index}</td>
                      {!readOnly ? (
                        <td style={{ verticalAlign: "top", padding: "8px 6px", width: 142 }}>
                          <div className="row" style={{ gap: 6 }}>
                            <button className="secondary compact-btn" disabled={saving} onClick={() => addShot(bIdx, sIdx)}>
                              下方新增
                            </button>
                            <button className="warn compact-btn" disabled={saving} onClick={() => deleteShot(bIdx, sIdx)}>
                              删除
                            </button>
                          </div>
                        </td>
                      ) : null}
                      <td style={{ padding: "8px 6px" }}>
                        <textarea
                          value={shot.narration}
                          readOnly={readOnly}
                          onChange={(event) =>
                            updateShot(bIdx, sIdx, "narration", event.target.value)
                          }
                        />
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <textarea
                          value={shot.visual}
                          readOnly={readOnly}
                          onChange={(event) => updateShot(bIdx, sIdx, "visual", event.target.value)}
                        />
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <textarea
                          value={shot.broll}
                          readOnly={readOnly}
                          onChange={(event) => updateShot(bIdx, sIdx, "broll", event.target.value)}
                        />
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <textarea
                          value={shot.subtitle}
                          readOnly={readOnly}
                          onChange={(event) =>
                            updateShot(bIdx, sIdx, "subtitle", event.target.value)
                          }
                        />
                      </td>
                      <td style={{ padding: "8px 6px", width: 110 }}>
                        <div style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.4, marginBottom: 4 }}>
                          最终有口播以 TTS 为准
                        </div>
                        <input
                          type="number"
                          step="0.1"
                          value={shot.duration}
                          readOnly={readOnly}
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
