import { StageHeader } from "@/components/stage-header";

interface ReviewUnavailableProps {
  videoId: string;
  version: string;
  active: "review" | "script" | "storyboard" | "images";
  stageLabel: string;
  error: unknown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法读取当前审核阶段的数据";
}

export function ReviewUnavailable({
  videoId,
  version,
  active,
  stageLabel,
  error,
}: ReviewUnavailableProps) {
  return (
    <main className="shell">
      <StageHeader videoId={videoId} version={version} title={stageLabel} active={active} />
      <div className="panel" style={{ padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>当前阶段还不可审核</div>
        <div style={{ color: "var(--muted)", marginTop: 8 }}>
          {errorMessage(error)}
        </div>
        <div style={{ color: "var(--muted)", marginTop: 8 }}>
          项目：{videoId}，版本：{version}
        </div>
      </div>
    </main>
  );
}
