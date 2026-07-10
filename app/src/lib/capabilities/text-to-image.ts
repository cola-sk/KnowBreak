export interface TextToImageRequest {
  prompt: string;
  provider?: string;
  model?: string;
  width?: number;
  height?: number;
}

export interface TextToImageResult {
  bytes: Uint8Array;
  contentType: string;
  metadata: {
    provider: string;
    mode: "generate";
    prompt: string;
    model: string;
    width: number;
    height: number;
    source_url: string;
    creator: string;
    license: string;
  };
}

function cleanPrompt(prompt: string): string {
  const value = prompt.trim();
  if (!value) {
    throw new Error("prompt is required");
  }
  if (value.length > 2000) {
    throw new Error("prompt is too long");
  }
  return value;
}

export async function generateTextToImage(request: TextToImageRequest): Promise<TextToImageResult> {
  const provider = request.provider?.trim() || "pollinations";
  if (provider !== "pollinations") {
    throw new Error(`Unsupported text-to-image provider: ${provider}`);
  }
  return generatePollinationsImage(request);
}

async function generatePollinationsImage(request: TextToImageRequest): Promise<TextToImageResult> {
  const prompt = cleanPrompt(request.prompt);
  const width = request.width ?? 1080;
  const height = request.height ?? 1920;
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: "true",
    private: "true",
    safe: "true",
  });
  const resolvedModel = request.model?.trim() || process.env.KB_POLLINATIONS_IMAGE_MODEL || "";
  if (resolvedModel) {
    params.set("model", resolvedModel);
  }

  const headers: HeadersInit = {};
  const apiKey = process.env.KB_POLLINATIONS_API_KEY || process.env.POLLINATIONS_API_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(`Pollinations generation failed: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Pollinations returned non-image content: ${contentType || "unknown"}`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType,
    metadata: {
      provider: "pollinations",
      mode: "generate",
      prompt,
      model: resolvedModel || "pollinations",
      width,
      height,
      source_url: "",
      creator: "ai_generated",
      license: "provider_terms",
    },
  };
}
