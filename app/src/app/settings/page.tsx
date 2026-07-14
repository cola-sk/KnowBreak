import { ProfileEditor } from "@/components/profile-editor";
import { readProfileBase, readProfileOverrides } from "@/lib/profile-server";
import { resolveOutDir } from "@/lib/review-store";
import { readGlobalRuntimeOverrides, readTtsRuntimeBaseDefaults } from "@/lib/tts-settings-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [initial, base, runtimeInitial, ttsDefaults] = await Promise.all([
    readProfileOverrides(),
    readProfileBase(),
    readGlobalRuntimeOverrides(),
    readTtsRuntimeBaseDefaults(),
  ]);

  return (
    <main className="shell">
      <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>profile 参数设置</div>
        <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>
          封面和内容改动写入 <code>profiles/profile_overrides.json</code>，Python CLI 加载时会使用
          <code>profile.toml</code> 的同名字段。空值表示使用 TOML 默认。
        </div>
        <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>
          TTS 全局配置写入 <code>profiles/runtime_overrides.json</code>；启动或重生成时也可以单独修改项目语音。
        </div>
        <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>
          本地目录：{resolveOutDir()}
        </div>
      </div>
      <ProfileEditor initial={initial} base={base} ttsInitial={runtimeInitial} ttsDefaults={ttsDefaults} />
    </main>
  );
}
