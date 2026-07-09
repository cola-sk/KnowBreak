import Link from "next/link";

interface StageHeaderProps {
  videoId: string;
  version: string;
  title?: string;
  active: "review" | "script" | "storyboard" | "images";
}

function stageClass(active: boolean): string {
  return active ? "primary" : "secondary";
}

export function StageHeader({ videoId, version, title, active }: StageHeaderProps) {
  const base = `/projects/${videoId}/${version}`;
  return (
    <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700 }}>{title || videoId}</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            version: {version} · id: {videoId}
          </div>
        </div>
        <Link href="/" className="badge">
          返回项目列表
        </Link>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <Link href={`${base}/review`}>
          <button className={stageClass(active === "review")}>成片审核</button>
        </Link>
        <Link href={`${base}/script`}>
          <button className={stageClass(active === "script")}>脚本审核</button>
        </Link>
        <Link href={`${base}/storyboard`}>
          <button className={stageClass(active === "storyboard")}>分镜审核</button>
        </Link>
        <Link href={`${base}/images`}>
          <button className={stageClass(active === "images")}>图片审核</button>
        </Link>
      </div>
    </div>
  );
}
