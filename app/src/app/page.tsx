import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { StartForm } from "@/components/start-form";
import { listWorkflows, resolveOutDir, resolveProjectRoot } from "@/lib/review-store";

export default async function HomePage() {
  const [workflows, outDir] = await Promise.all([listWorkflows(), resolveOutDir()]);

  const overridesPath = path.join(
    resolveProjectRoot(),
    "profiles",
    "serious_science",
    "profile_overrides.json",
  );
  let globalOverrides: Record<string, any> = {};
  try {
    if (existsSync(overridesPath)) {
      globalOverrides = JSON.parse(await fs.readFile(overridesPath, "utf-8"));
    }
  } catch {}

  return (
    <main className="shell">
      <div className="page-header">
        <div className="hero-eyebrow">KnowBreak Pipeline</div>
        <h1 className="hero-title">开启全新短视频二创</h1>
        <p className="hero-sub">
          输入长视频 YouTube 链接，或直接输入创作主题，流水线将自动运行 ASR、选题拆解、口播脚本与分镜设计。
        </p>
      </div>

      <StartForm workflows={workflows} globalOverrides={globalOverrides} />

      <div className="footer-info">
        <span className="info-label">本地产出目录：</span>
        <code className="info-path">{outDir}</code>
      </div>
    </main>
  );
}

