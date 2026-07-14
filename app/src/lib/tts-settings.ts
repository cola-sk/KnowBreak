export type TtsProvider = "volcengine" | "edge" | "openai" | "minimax";

export interface TtsRuntimeOverrides {
  provider?: string;
  model?: string;
  speaker?: string;
  // Backward compatibility for existing project_runtime_overrides.json files.
  volcModel?: string;
  volcSpeaker?: string;
  voice?: string;
}

export interface ProjectRuntimeOverrides {
  tts?: TtsRuntimeOverrides;
}

export interface TtsRuntimeDefaults {
  provider: string;
  model: string;
  speaker: string;
}

export interface TtsHistoryItem extends TtsRuntimeDefaults {
  label: string;
  lastUsedAt: string;
}

export const TTS_PROVIDER_OPTIONS: Array<{ value: TtsProvider; label: string; modelLabel: string; speakerLabel: string }> = [
  { value: "volcengine", label: "火山豆包", modelLabel: "Resource / Model", speakerLabel: "Speaker / 音色" },
  { value: "edge", label: "Edge TTS", modelLabel: "Model（可空）", speakerLabel: "Voice" },
  { value: "openai", label: "OpenAI TTS", modelLabel: "Model", speakerLabel: "Voice" },
  { value: "minimax", label: "MiniMax TTS", modelLabel: "Model", speakerLabel: "Voice ID" },
];

export const FALLBACK_TTS_RUNTIME_DEFAULTS: TtsRuntimeDefaults = {
  provider: "volcengine",
  model: "seed-tts-2.0",
  speaker: "zh_female_xiaohe_uranus_bigtts",
};

const DEFAULT_MODEL_BY_PROVIDER: Record<TtsProvider, string> = {
  volcengine: "seed-tts-2.0",
  edge: "",
  openai: "gpt-4o-mini-tts",
  minimax: "speech-02-turbo",
};

const DEFAULT_SPEAKER_BY_PROVIDER: Record<TtsProvider, string> = {
  volcengine: "zh_female_xiaohe_uranus_bigtts",
  edge: "zh-CN-XiaoxiaoNeural",
  openai: "alloy",
  minimax: "Chinese (Mandarin)_News_Anchor",
};

export function normalizeProvider(value: string | undefined): TtsProvider {
  const normalized = (value || "volcengine").trim().toLowerCase();
  if (normalized === "volc" || normalized === "volcano" || normalized === "huoshan") {
    return "volcengine";
  }
  if (normalized === "mini-max" || normalized === "mini_max") {
    return "minimax";
  }
  return TTS_PROVIDER_OPTIONS.some((item) => item.value === normalized)
    ? normalized as TtsProvider
    : "volcengine";
}

export function normalizeTtsSettings(value: TtsRuntimeDefaults): TtsRuntimeDefaults {
  const provider = normalizeProvider(value.provider);
  let model = value.model.trim();
  let speaker = value.speaker.trim();

  if (provider === "volcengine" && model.startsWith("zh_") && model.endsWith("_bigtts")) {
    speaker = model;
    model = "seed-tts-2.0";
  }

  return {
    provider,
    model: model || DEFAULT_MODEL_BY_PROVIDER[provider],
    speaker: speaker || DEFAULT_SPEAKER_BY_PROVIDER[provider],
  };
}

export function effectiveTtsSettings(
  defaults: TtsRuntimeDefaults,
  overrides: ProjectRuntimeOverrides | undefined,
): TtsRuntimeDefaults {
  const provider = normalizeProvider(overrides?.tts?.provider || defaults.provider);
  const legacyModel = provider === "volcengine" ? overrides?.tts?.volcModel : undefined;
  const legacySpeaker = provider === "volcengine" ? overrides?.tts?.volcSpeaker : undefined;
  return normalizeTtsSettings({
    provider,
    model: overrides?.tts?.model || legacyModel || defaults.model || DEFAULT_MODEL_BY_PROVIDER[provider],
    speaker: overrides?.tts?.speaker || legacySpeaker || overrides?.tts?.voice || defaults.speaker || DEFAULT_SPEAKER_BY_PROVIDER[provider],
  });
}

export function countRuntimeOverrideLeaves(value: ProjectRuntimeOverrides | undefined): number {
  if (!value?.tts) {
    return 0;
  }
  return ["provider", "model", "speaker"].filter((key) => {
    const item = value.tts?.[key as keyof TtsRuntimeOverrides];
    return typeof item === "string" && item.trim();
  }).length;
}

export function compactRuntimeOverrides(value: ProjectRuntimeOverrides): ProjectRuntimeOverrides {
  const effective = effectiveTtsSettings(FALLBACK_TTS_RUNTIME_DEFAULTS, value);
  return {
    tts: {
      provider: effective.provider,
      model: effective.model,
      speaker: effective.speaker,
    },
  };
}

export function runtimeOverridesToEnv(value: ProjectRuntimeOverrides | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  if (!value?.tts) {
    return env;
  }

  const effective = effectiveTtsSettings(FALLBACK_TTS_RUNTIME_DEFAULTS, value);
  env.KB_TTS_PROVIDER = effective.provider;

  if (effective.provider === "volcengine") {
    env.KB_VOLC_TTS_MODEL = effective.model;
    env.KB_VOLC_TTS_SPEAKER = effective.speaker;
  } else if (effective.provider === "edge") {
    env.KB_TTS_VOICE = effective.speaker;
  } else if (effective.provider === "openai") {
    env.KB_OPENAI_TTS_MODEL = effective.model;
    env.KB_OPENAI_TTS_VOICE = effective.speaker;
  } else if (effective.provider === "minimax") {
    env.KB_MINIMAX_TTS_MODEL = effective.model;
    env.KB_MINIMAX_TTS_VOICE_ID = effective.speaker;
  }

  return env;
}

export function ttsHistoryKey(): string {
  return "knowbreak.tts.history.v1";
}

export function ttsHistoryItemId(item: Pick<TtsRuntimeDefaults, "provider" | "model" | "speaker">): string {
  return [item.provider, item.model, item.speaker].join("::");
}

export function labelForTtsSettings(item: Pick<TtsRuntimeDefaults, "provider" | "model" | "speaker">): string {
  return `${item.provider} / ${item.model || "-"} / ${item.speaker || "-"}`;
}

export function saveTtsHistoryItem(settings: TtsRuntimeDefaults): void {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = normalizeTtsSettings(settings);
  const item: TtsHistoryItem = {
    ...normalized,
    label: labelForTtsSettings(normalized),
    lastUsedAt: new Date().toISOString(),
  };
  try {
    const raw = window.localStorage.getItem(ttsHistoryKey());
    const parsed = raw ? JSON.parse(raw) : [];
    const existing = Array.isArray(parsed) ? parsed as TtsHistoryItem[] : [];
    const next = [
      item,
      ...existing.filter((old) => ttsHistoryItemId(old) !== ttsHistoryItemId(item)),
    ].slice(0, 20);
    window.localStorage.setItem(ttsHistoryKey(), JSON.stringify(next));
  } catch {
    // History is a convenience feature; localStorage failures should not block generation.
  }
}
