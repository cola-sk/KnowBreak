"use client";

import { useMemo, useState } from "react";

import type { ReviewFile, ReviewItemStatus } from "@/lib/types";

interface ImageEntry {
  image_path: string;
  provider?: string;
  query?: string;
  source_url?: string;
  creator?: string;
  license?: string;
}

interface ShotImageEntry extends ImageEntry {
  shot_index: number;
}

interface TopicImages {
  topic_index: number;
  title: string;
  cover?: ImageEntry;
  shots: ShotImageEntry[];
}

export interface ImageReviewPayload {
  artifact: TopicImages[];
  review: ReviewFile;
}

interface Props {
  videoId: string;
  version: string;
  initial: ImageReviewPayload;
}

const ITEM_STATUSES: ReviewItemStatus[] = [
  "pending",
  "approved",
  "rejected",
  "modified",
  "regenerated",
];

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

function assetUrl(relativePath: string): string {
  const encoded = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/assets/${encoded}`;
}

export function ImageReviewClient({ videoId, version, initial }: Props) {
  const [data, setData] = useState<ImageReviewPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const totalImages = useMemo(
    () =>
      data.artifact.reduce(
        (acc, topic) => acc + (topic.cover ? 1 : 0) + (Array.isArray(topic.shots) ? topic.shots.length : 0),
        0,
      ),
    [data.artifact],
  );

  const patchReviewItem = (id: string, patch: Partial<{ status: ReviewItemStatus; notes: string }>) => {
    setData((prev) => ({
      ...prev,
      review: {
        ...prev.review,
        status: "in_review",
        items: prev.review.items.map((item) =>
          item.id === id
            ? {
                ...item,
                ...patch,
              }
            : item,
        ),
      },
    }));
  };

  const saveReview = async () => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${videoId}/${version}/images`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          review: {
            status: data.review.status,
            items: data.review.items,
          },
        }),
      });
      const next = (await response.json()) as ImageReviewPayload | { error: string };
      if (!response.ok) {
        throw new Error("error" in next ? next.error : "保存失败");
      }
      setData(next as ImageReviewPayload);
      setMessage("图片审核状态已保存。");
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
      const response = await fetch(`/api/projects/${videoId}/${version}/reviews/image_review/approve`, {
        method: "POST",
      });
      const result = (await response.json()) as { review?: ReviewFile; error?: string };
      if (!response.ok || !result.review) {
        throw new Error(result.error ?? "通过失败");
      }
      setData((prev) => ({ ...prev, review: result.review! }));
      setMessage("图片审核已通过。可以继续后续 TTS/合成阶段。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通过失败");
    } finally {
      setSaving(false);
    }
  };

  const findItem = (id: string) => {
    return data.review.items.find((item) => item.id === id);
  };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>图片审核</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            topics: {data.artifact.length}, images: {totalImages}
          </div>
        </div>
        <div className="row">
          <span className={statusClass(data.review.status)}>{data.review.status}</span>
          <span className="badge">updated: {new Date(data.review.updated_at).toLocaleString()}</span>
        </div>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="secondary" disabled={saving} onClick={saveReview}>
          保存图片审核
        </button>
        <button className="warn" disabled={saving} onClick={approve}>
          通过图片审核
        </button>
      </div>

      {message ? <div style={{ marginTop: 10, color: "var(--muted)" }}>{message}</div> : null}

      <div style={{ marginTop: 14, display: "grid", gap: 16 }}>
        {data.artifact.map((topic) => (
          <section
            key={`topic-${topic.topic_index}`}
            style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}
          >
            <div style={{ fontWeight: 700 }}>
              #{topic.topic_index} {topic.title}
            </div>
            <div className="grid" style={{ marginTop: 10 }}>
              {topic.cover ? (
                <ImageCard
                  title="cover"
                  image={topic.cover}
                  item={findItem(`topic_${topic.topic_index}_cover`)}
                  onChange={patchReviewItem}
                  itemId={`topic_${topic.topic_index}_cover`}
                />
              ) : null}
              {topic.shots.map((shot) => {
                const id = `topic_${topic.topic_index}_shot_${shot.shot_index}`;
                return (
                  <ImageCard
                    key={id}
                    title={`shot_${shot.shot_index}`}
                    image={shot}
                    item={findItem(id)}
                    onChange={patchReviewItem}
                    itemId={id}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

interface ImageCardProps {
  title: string;
  image: ImageEntry;
  itemId: string;
  item: { status: ReviewItemStatus; notes: string } | undefined;
  onChange: (id: string, patch: Partial<{ status: ReviewItemStatus; notes: string }>) => void;
}

function ImageCard({ title, image, itemId, item, onChange }: ImageCardProps) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <span className="badge">{image.provider ?? "unknown"}</span>
      </div>

      <img
        src={assetUrl(image.image_path)}
        alt={title}
        style={{
          width: "100%",
          aspectRatio: "9 / 16",
          objectFit: "cover",
          borderRadius: 10,
          border: "1px solid var(--line)",
          marginTop: 8,
        }}
      />

      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8, lineHeight: 1.4 }}>
        <div>query: {image.query ?? "-"}</div>
        <div>creator: {image.creator ?? "-"}</div>
        <div style={{ wordBreak: "break-all" }}>source: {image.source_url ?? "-"}</div>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>status</label>
        <select
          value={item?.status ?? "pending"}
          onChange={(event) =>
            onChange(itemId, { status: event.target.value as ReviewItemStatus })
          }
        >
          {ITEM_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>notes</label>
        <textarea
          value={item?.notes ?? ""}
          onChange={(event) => onChange(itemId, { notes: event.target.value })}
        />
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <button className="secondary" onClick={() => onChange(itemId, { status: "approved" })}>
          通过此图
        </button>
        <button className="secondary" onClick={() => onChange(itemId, { status: "rejected" })}>
          标记问题
        </button>
      </div>
    </div>
  );
}
