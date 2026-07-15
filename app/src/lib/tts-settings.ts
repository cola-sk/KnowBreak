export type TtsProvider = "volcengine" | "edge" | "openai" | "minimax";
export type ImageProvider = "pexels" | "pixabay" | "pollinations" | "cloudflare_workers" | "huggingface";

export interface TtsRuntimeOverrides {
  provider?: string;
  model?: string;
  speaker?: string;
  speed?: number;
  // Backward compatibility for existing project_runtime_overrides.json files.
  volcModel?: string;
  volcSpeaker?: string;
  voice?: string;
}

export interface ProjectRuntimeOverrides {
  tts?: TtsRuntimeOverrides;
  image?: ImageRuntimeOverrides;
}

export interface TtsRuntimeDefaults {
  provider: string;
  model: string;
  speaker: string;
}

export interface ImageRuntimeOverrides {
  providers?: string[];
  // Backward-compatible loose keys for hand-edited runtime_overrides.json files.
  provider?: string;
  pollinationsModel?: string;
  pollinations_model?: string;
  cloudflareModel?: string;
  cloudflare_model?: string;
  huggingfaceModel?: string;
  huggingface_model?: string;
  huggingfaceBaseUrl?: string;
  huggingface_base_url?: string;
}

export interface ImageRuntimeDefaults {
  providers: string[];
  pollinationsModel: string;
  cloudflareModel: string;
  huggingfaceModel: string;
  huggingfaceBaseUrl: string;
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

export const IMAGE_PROVIDER_OPTIONS: Array<{ value: ImageProvider; label: string; kind: "search" | "generate" }> = [
  { value: "pexels", label: "Pexels 搜索", kind: "search" },
  { value: "pixabay", label: "Pixabay 搜索", kind: "search" },
  { value: "pollinations", label: "Pollinations 生成", kind: "generate" },
  { value: "cloudflare_workers", label: "Cloudflare Workers AI", kind: "generate" },
  { value: "huggingface", label: "Hugging Face", kind: "generate" },
];

export const FALLBACK_IMAGE_RUNTIME_DEFAULTS: ImageRuntimeDefaults = {
  providers: ["pexels", "pixabay"],
  pollinationsModel: "",
  cloudflareModel: "@cf/black-forest-labs/flux-1-schnell",
  huggingfaceModel: "black-forest-labs/FLUX.1-schnell",
  huggingfaceBaseUrl: "https://router.huggingface.co/hf-inference/models",
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

export function normalizeImageProvider(value: string | undefined): ImageProvider | null {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "cloudflare" || normalized === "cloudflare-workers") {
    return "cloudflare_workers";
  }
  if (normalized === "hf") {
    return "huggingface";
  }
  return IMAGE_PROVIDER_OPTIONS.some((item) => item.value === normalized)
    ? normalized as ImageProvider
    : null;
}

export function normalizeImageProviders(value: unknown, fallback: string[] = FALLBACK_IMAGE_RUNTIME_DEFAULTS.providers): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : fallback;
  const providers: string[] = [];
  for (const item of raw) {
    const normalized = normalizeImageProvider(typeof item === "string" ? item : undefined);
    if (normalized && !providers.includes(normalized)) {
      providers.push(normalized);
    }
  }
  return providers.length > 0 ? providers : fallback;
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

export function effectiveImageSettings(
  defaults: ImageRuntimeDefaults,
  overrides: ProjectRuntimeOverrides | undefined,
): ImageRuntimeDefaults {
  const image = overrides?.image;
  const providerValue = image?.providers ?? image?.provider;
  return {
    providers: normalizeImageProviders(providerValue, defaults.providers),
    pollinationsModel:
      image?.pollinationsModel
      || image?.pollinations_model
      || defaults.pollinationsModel
      || "",
    cloudflareModel:
      image?.cloudflareModel
      || image?.cloudflare_model
      || defaults.cloudflareModel
      || FALLBACK_IMAGE_RUNTIME_DEFAULTS.cloudflareModel,
    huggingfaceModel:
      image?.huggingfaceModel
      || image?.huggingface_model
      || defaults.huggingfaceModel
      || FALLBACK_IMAGE_RUNTIME_DEFAULTS.huggingfaceModel,
    huggingfaceBaseUrl:
      image?.huggingfaceBaseUrl
      || image?.huggingface_base_url
      || defaults.huggingfaceBaseUrl
      || FALLBACK_IMAGE_RUNTIME_DEFAULTS.huggingfaceBaseUrl,
  };
}

export function countRuntimeOverrideLeaves(value: ProjectRuntimeOverrides | undefined): number {
  let count = 0;
  if (value?.tts) {
    count += ["provider", "model", "speaker"].filter((key) => {
      const item = value.tts?.[key as keyof TtsRuntimeOverrides];
      return typeof item === "string" && item.trim();
    }).length;
    if (typeof value.tts?.speed === "number" && value.tts.speed !== 1) {
      count += 1;
    }
  }
  if (value?.image) {
    if (Array.isArray(value.image.providers) && value.image.providers.length > 0) {
      count += 1;
    }
    count += [
      "pollinationsModel",
      "cloudflareModel",
      "huggingfaceModel",
      "huggingfaceBaseUrl",
    ].filter((key) => {
      const item = value.image?.[key as keyof ImageRuntimeOverrides];
      return typeof item === "string" && item.trim();
    }).length;
  }
  return count;
}

export function compactRuntimeOverrides(value: ProjectRuntimeOverrides): ProjectRuntimeOverrides {
  const next: ProjectRuntimeOverrides = {};
  if (value.tts) {
    const effective = effectiveTtsSettings(FALLBACK_TTS_RUNTIME_DEFAULTS, value);
    next.tts = {
      provider: effective.provider,
      model: effective.model,
      speaker: effective.speaker,
      speed: value.tts.speed,
    };
  }
  if (value.image) {
    const effective = effectiveImageSettings(FALLBACK_IMAGE_RUNTIME_DEFAULTS, value);
    next.image = {
      providers: effective.providers,
      pollinationsModel: effective.pollinationsModel,
      cloudflareModel: effective.cloudflareModel,
      huggingfaceModel: effective.huggingfaceModel,
      huggingfaceBaseUrl: effective.huggingfaceBaseUrl,
    };
  }
  return next;
}

export function runtimeOverridesToEnv(value: ProjectRuntimeOverrides | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  if (!value) {
    return env;
  }

  if (value.tts) {
    const effective = effectiveTtsSettings(FALLBACK_TTS_RUNTIME_DEFAULTS, value);
    env.KB_TTS_PROVIDER = effective.provider;

    if (value.tts.speed && value.tts.speed !== 1) {
      env.KB_TTS_SPEED = String(value.tts.speed);
    }

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
  }

  if (value.image) {
    const effective = effectiveImageSettings(FALLBACK_IMAGE_RUNTIME_DEFAULTS, value);
    env.KB_IMAGE_PROVIDERS = effective.providers.join(",");
    env.KB_POLLINATIONS_IMAGE_MODEL = effective.pollinationsModel;
    env.KB_CLOUDFLARE_IMAGE_MODEL = effective.cloudflareModel;
    env.KB_HUGGINGFACE_IMAGE_MODEL = effective.huggingfaceModel;
    env.KB_HUGGINGFACE_IMAGE_BASE_URL = effective.huggingfaceBaseUrl;
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
