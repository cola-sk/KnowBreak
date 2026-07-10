import { ProfileEditor } from "@/components/profile-editor";
import { readProfileBase, readProfileOverrides } from "@/lib/profile-server";
import { resolveOutDir, resolveProjectRoot } from "@/lib/review-store";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const overridesPath = path.join(
    resolveProjectRoot(),
    "profiles",
    "serious_science",
    "profile_overrides.json",
  );
  const [initial, base] = await Promise.all([
    readProfileOverrides(),
    readProfileBase(),
  ]);

  return (
    <main className="shell">
      <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>profile 参数设置</div>
        <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>
          所有改动写入 <code>profiles/serious_science/profile_overrides.json</code>，Python CLI 加载时会覆盖
          <code>profile.toml</code> 的同名字段。空值表示不覆盖（沿用 TOML 默认）。
        </div>
        <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>
          本地目录：{resolveOutDir()}
        </div>
      </div>
      <ProfileEditor initial={initial} base={base} />
    </main>
  );
}
