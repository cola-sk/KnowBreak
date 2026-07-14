type PromptSourceKey = "title" | "visual" | "narration" | "script" | "broll" | "subtitle" | "query" | "prompt" | "fallback";
type ContextSourceKey = Exclude<PromptSourceKey, "prompt">;

interface PromptSources {
  title?: string;
  visual?: string;
  narration?: string;
  script?: string;
  broll?: string;
  subtitle?: string;
  query?: string;
  prompt?: string;
  fallback?: string;
}

const SOURCE_LABELS: Record<ContextSourceKey, string> = {
  title: "Topic title",
  visual: "Storyboard visual",
  narration: "Storyboard narration",
  script: "Spoken script",
  broll: "B-roll / reference material",
  subtitle: "Subtitle",
  query: "Image search keywords",
  fallback: "Default fallback",
};

function compactText(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}...` : trimmed;
}

export function buildContextualImagePrompt({
  corePrompt,
  itemTitle,
  promptSource,
  sources,
}: {
  corePrompt: string;
  itemTitle: string;
  promptSource: string;
  sources: PromptSources;
}): string {
  const core = compactText(corePrompt, 520) ?? corePrompt;
  const contextLines = (Object.entries(SOURCE_LABELS) as Array<[ContextSourceKey, string]>)
    .filter(([key]) => key !== promptSource)
    .map(([key, label]) => {
      const value = compactText(sources[key], 240);
      return value ? `- ${label}: ${value}` : "";
    })
    .filter(Boolean);

  const parts = [
    "Create one vertical 9:16 image for a Chinese knowledge short video.",
    "Use the core scene as the main subject. Follow the full context for period, place, people, objects, atmosphere, and visual logic.",
    "If the context implies a historical period or non-modern setting, keep it period-accurate. Do not add modern clothing, cars, phones, computers, neon signs, glass offices, modern streets, or contemporary city elements unless explicitly requested.",
    "Style: documentary cinematic realism, natural light, rich environmental detail, no text overlays, no subtitles, no watermark, no logo.",
    `Shot/item: ${compactText(itemTitle, 120) ?? itemTitle}`,
    `Core scene: ${core}`,
  ];

  if (contextLines.length > 0) {
    parts.push("Context:", ...contextLines);
  }

  return parts.join("\n");
}
