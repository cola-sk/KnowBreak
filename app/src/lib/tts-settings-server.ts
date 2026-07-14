import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { buildRuntimeEnv } from "@/lib/runtime-env";
import { resolveProjectRoot } from "@/lib/review-store";
import {
  effectiveTtsSettings,
  normalizeTtsSettings,
  normalizeProvider,
  type ProjectRuntimeOverrides,
  type TtsProvider,
  type TtsRuntimeDefaults,
} from "@/lib/tts-settings";

const RUNTIME_OVERRIDES_FILE = "runtime_overrides.json";

export function globalRuntimeOverridesPath(_profileName = "default"): string {
  return path.join(resolveProjectRoot(), "profiles", RUNTIME_OVERRIDES_FILE);
}

export async function readGlobalRuntimeOverrides(profileName = "default"): Promise<ProjectRuntimeOverrides> {
  const filePath = globalRuntimeOverridesPath(profileName);
  try {
    if (!existsSync(filePath)) {
      return {};
    }
    const parsed = JSON.parse(await fs.readFile(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as ProjectRuntimeOverrides;
  } catch {
    return {};
  }
}

export async function writeGlobalRuntimeOverrides(
  value: ProjectRuntimeOverrides,
  profileName = "default",
): Promise<void> {
  const filePath = globalRuntimeOverridesPath(profileName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

function envValue(env: NodeJS.ProcessEnv, key: string, fallback = ""): string {
  return env[key] || fallback;
}

export async function readTtsRuntimeBaseDefaults(): Promise<TtsRuntimeDefaults> {
  const env = await buildRuntimeEnv(resolveProjectRoot());
  const provider = normalizeProvider(envValue(env, "KB_TTS_PROVIDER", "edge")) as TtsProvider;
  if (provider === "volcengine") {
    return normalizeTtsSettings({
      provider,
      model: envValue(env, "KB_VOLC_TTS_MODEL", "seed-tts-2.0"),
      speaker: envValue(env, "KB_VOLC_TTS_SPEAKER", "zh_female_xiaohe_uranus_bigtts"),
    });
  }
  if (provider === "openai") {
    return normalizeTtsSettings({
      provider,
      model: envValue(env, "KB_OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
      speaker: envValue(env, "KB_OPENAI_TTS_VOICE", "alloy"),
    });
  }
  if (provider === "minimax") {
    return normalizeTtsSettings({
      provider,
      model: envValue(env, "KB_MINIMAX_TTS_MODEL", "speech-02-turbo"),
      speaker: envValue(env, "KB_MINIMAX_TTS_VOICE_ID", "Chinese (Mandarin)_News_Anchor"),
    });
  }
  return normalizeTtsSettings({
    provider,
    model: "",
    speaker: envValue(env, "KB_TTS_VOICE", "zh-CN-XiaoxiaoNeural"),
  });
}

export async function readTtsRuntimeDefaults(): Promise<TtsRuntimeDefaults> {
  return effectiveTtsSettings(await readTtsRuntimeBaseDefaults(), await readGlobalRuntimeOverrides());
}
