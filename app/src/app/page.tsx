import { StartForm } from "@/components/start-form";
import { readProfileBase, readProfileOverrides } from "@/lib/profile-server";
import { listWorkflows, resolveOutDir } from "@/lib/review-store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [workflows, outDir, profileBase, globalOverrides] = await Promise.all([
    listWorkflows(),
    resolveOutDir(),
    readProfileBase(),
    readProfileOverrides(),
  ]);

  return (
    <main className="shell">
      <div className="page-header">
        <div className="hero-eyebrow">KnowBreak Pipeline</div>
        <h1 className="hero-title">开启全新短视频二创</h1>
        <p className="hero-sub">
          输入长视频 YouTube 链接，或直接输入创作主题，流水线将自动运行 ASR、选题拆解、口播脚本与分镜设计。
        </p>
      </div>

      <StartForm workflows={workflows} profileBase={profileBase} globalOverrides={globalOverrides} />

      <div className="footer-info">
        <span className="info-label">本地产出目录：</span>
        <code className="info-path">{outDir}</code>
      </div>
    </main>
  );
}
