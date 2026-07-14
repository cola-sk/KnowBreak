import { FALLBACK_TTS_RUNTIME_DEFAULTS, normalizeTtsSettings, type TtsRuntimeDefaults } from "@/lib/tts-settings";

export async function readTtsRuntimeDefaults(): Promise<TtsRuntimeDefaults> {
  return normalizeTtsSettings(FALLBACK_TTS_RUNTIME_DEFAULTS);
}
