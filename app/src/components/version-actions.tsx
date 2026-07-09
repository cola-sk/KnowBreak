"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Action = "approve_all" | "ignore" | "unignore";

interface Props {
  videoId: string;
  version: string;
  ignored: boolean;
  doneStages: string[];
}

export function VersionActions({ videoId, version, ignored, doneStages }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const reviewHref = doneStages.includes("compose")
    ? `/projects/${videoId}/${version}/review`
    : `/projects/${videoId}/${version}/script`;

  const run = async (action: Action) => {
    setBusy(action);
    setError("");
    try {
      const response = await fetch(`/api/projects/${videoId}/${version}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "操作失败");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div className="row">
        <Link href={reviewHref}>
          <button className="secondary soft-cta">进入审核</button>
        </Link>
        <button
          className="secondary"
          disabled={busy !== null}
          onClick={() => run("approve_all")}
          title="将脚本/分镜/图片审核标记为通过"
        >
          {busy === "approve_all" ? "处理中..." : "标记通过"}
        </button>
        <button
          className="secondary"
          disabled={busy !== null}
          onClick={() => run(ignored ? "unignore" : "ignore")}
          title={ignored ? "恢复到待审核列表" : "从默认待审核列表中隐藏"}
        >
          {busy === "ignore" || busy === "unignore"
            ? "处理中..."
            : ignored
              ? "取消忽略"
              : "忽略"}
        </button>
      </div>
      {error ? <div style={{ marginTop: 6, color: "var(--danger)", fontSize: 12 }}>{error}</div> : null}
    </div>
  );
}
