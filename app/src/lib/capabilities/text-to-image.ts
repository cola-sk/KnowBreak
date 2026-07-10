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
  if (provider === "pollinations") {
    return generatePollinationsImage(request);
  }
  if (provider === "cloudflare_workers") {
    return generateCloudflareWorkersImage(request);
  }
  if (provider === "huggingface") {
    return generateHuggingFaceImage(request);
  }
  throw new Error(`Unsupported text-to-image provider: ${provider}`);
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

async function generateCloudflareWorkersImage(request: TextToImageRequest): Promise<TextToImageResult> {
  const prompt = cleanPrompt(request.prompt);
  const width = request.width ?? 1080;
  const height = request.height ?? 1920;
  const accountId = process.env.KB_CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.KB_CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error("Cloudflare Workers AI requires KB_CLOUDFLARE_ACCOUNT_ID and KB_CLOUDFLARE_API_TOKEN");
  }

  const resolvedModel = request.model?.trim()
    || process.env.KB_CLOUDFLARE_IMAGE_MODEL
    || "@cf/black-forest-labs/flux-1-schnell";
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${resolvedModel}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, width, height }),
    },
  );
  if (!response.ok) {
    throw new Error(`Cloudflare Workers AI generation failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.startsWith("application/json")) {
    const data = (await response.json()) as { result?: { image?: string }; image?: string };
    const imageBase64 = data.result?.image ?? data.image;
    if (!imageBase64) {
      throw new Error("Cloudflare Workers AI returned JSON without result.image");
    }
    const bytes = new Uint8Array(Buffer.from(imageBase64, "base64"));
    const detectedType = bytes[0] === 0xff && bytes[1] === 0xd8
      ? "image/jpeg"
      : bytes[0] === 0x89 && bytes[1] === 0x50
        ? "image/png"
        : "image/png";
    return {
      bytes,
      contentType: detectedType,
      metadata: {
        provider: "cloudflare_workers",
        mode: "generate",
        prompt,
        model: resolvedModel,
        width,
        height,
        source_url: "",
        creator: "ai_generated",
        license: "provider_terms",
      },
    };
  }
  if (!contentType.startsWith("image/")) {
    throw new Error(`Cloudflare Workers AI returned non-image content: ${contentType || "unknown"}`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType,
    metadata: {
      provider: "cloudflare_workers",
      mode: "generate",
      prompt,
      model: resolvedModel,
      width,
      height,
      source_url: "",
      creator: "ai_generated",
      license: "provider_terms",
    },
  };
}

async function generateHuggingFaceImage(request: TextToImageRequest): Promise<TextToImageResult> {
  const prompt = cleanPrompt(request.prompt);
  const width = request.width ?? 1080;
  const height = request.height ?? 1920;
  const apiToken = process.env.KB_HUGGINGFACE_API_TOKEN
    || process.env.HUGGINGFACE_API_TOKEN
    || process.env.HF_TOKEN;
  if (!apiToken) {
    throw new Error("Hugging Face image generation requires KB_HUGGINGFACE_API_TOKEN or HF_TOKEN");
  }

  const resolvedModel = request.model?.trim()
    || process.env.KB_HUGGINGFACE_IMAGE_MODEL
    || "black-forest-labs/FLUX.1-schnell";
  const baseUrl = (process.env.KB_HUGGINGFACE_IMAGE_BASE_URL || "https://router.huggingface.co/hf-inference/models")
    .replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/${resolvedModel}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "image/png",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: { width, height },
    }),
  });
  if (!response.ok) {
    throw new Error(`Hugging Face image generation failed: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Hugging Face returned non-image content: ${contentType || "unknown"} ${detail}`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType,
    metadata: {
      provider: "huggingface",
      mode: "generate",
      prompt,
      model: resolvedModel,
      width,
      height,
      source_url: "",
      creator: "ai_generated",
      license: "model_terms",
    },
  };
}
