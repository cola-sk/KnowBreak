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

async function providerRequestError(response: Response, providerLabel: string): Promise<Error> {
  const raw = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 500);
  let detail = raw;
  if (raw) {
    try {
      const payload = JSON.parse(raw) as {
        error?: string | { code?: string; message?: string };
        errors?: Array<{ code?: string; message?: string }>;
        message?: string;
      };
      const firstError = payload.errors?.[0];
      if (typeof payload.error === "string") {
        detail = payload.error;
      } else if (payload.error?.message) {
        detail = payload.error.code
          ? `${payload.error.code}: ${payload.error.message}`
          : payload.error.message;
      } else if (firstError?.message) {
        detail = firstError.code ? `${firstError.code}: ${firstError.message}` : firstError.message;
      } else if (payload.message) {
        detail = payload.message;
      }
    } catch {
      // Keep the response excerpt when the provider did not return JSON.
    }
  }
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  return new Error(`${providerLabel} 请求失败（${status}）${detail ? `：${detail}` : ""}`);
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
  if (provider === "volcengine") {
    return generateVolcengineImage(request);
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
    throw await providerRequestError(response, "Pollinations");
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
    throw await providerRequestError(response, "Cloudflare Workers AI");
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
    throw await providerRequestError(response, "Hugging Face");
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

async function generateVolcengineImage(request: TextToImageRequest): Promise<TextToImageResult> {
  const prompt = cleanPrompt(request.prompt);
  const width = request.width ?? 1080;
  const height = request.height ?? 1920;
  const apiKey = process.env.KB_VOLCENGINE_IMAGE_API_KEY
    || process.env.KB_VOLC_IMAGE_API_KEY
    || process.env.ARK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Volcengine image generation requires KB_VOLCENGINE_IMAGE_API_KEY, KB_VOLC_IMAGE_API_KEY, or ARK_API_KEY",
    );
  }

  const resolvedModel = request.model?.trim()
    || process.env.KB_VOLCENGINE_IMAGE_MODEL
    || "doubao-seedream-4-0-250828";
  const resolvedSize = process.env.KB_VOLCENGINE_IMAGE_SIZE?.trim() || "2K";
  const baseUrl = (process.env.KB_VOLCENGINE_IMAGE_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3")
    .replace(/\/$/, "");
  const endpoint = baseUrl.endsWith("/images/generations")
    ? baseUrl
    : `${baseUrl}/images/generations`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolvedModel,
      prompt,
      sequential_image_generation: "disabled",
      response_format: "url",
      size: resolvedSize,
      stream: false,
      watermark: false,
    }),
  });
  if (!response.ok) {
    throw await providerRequestError(response, "火山引擎方舟");
  }

  const payload = (await response.json()) as {
    data?: Array<{ url?: string; b64_json?: string }>;
  };
  const item = payload.data?.[0];
  if (!item) {
    throw new Error("Volcengine returned JSON without data[0]");
  }

  let bytes: Uint8Array;
  let contentType: string;
  if (item.url) {
    const imageResponse = await fetch(item.url);
    if (!imageResponse.ok) {
      throw new Error(`Volcengine image download failed: ${imageResponse.status}`);
    }
    bytes = new Uint8Array(await imageResponse.arrayBuffer());
    contentType = imageResponse.headers.get("content-type") ?? "";
  } else if (item.b64_json) {
    bytes = new Uint8Array(Buffer.from(item.b64_json, "base64"));
    contentType = "image/png";
  } else {
    throw new Error("Volcengine returned data[0] without url or b64_json");
  }

  const looksLikeImage = contentType.startsWith("image/")
    || (bytes[0] === 0xff && bytes[1] === 0xd8)
    || (bytes[0] === 0x89 && bytes[1] === 0x50)
    || (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46);
  if (!looksLikeImage) {
    throw new Error(`Volcengine returned non-image content: ${contentType || "unknown"}`);
  }
  if (!contentType.startsWith("image/")) {
    contentType = bytes[0] === 0xff ? "image/jpeg" : bytes[0] === 0x52 ? "image/webp" : "image/png";
  }

  return {
    bytes,
    contentType,
    metadata: {
      provider: "volcengine",
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
