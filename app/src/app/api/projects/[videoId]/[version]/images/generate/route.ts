import { NextResponse } from "next/server";

import { generateTextToImage } from "@/lib/capabilities/text-to-image";
import { replaceImageWithGeneratedImageForReviewItem } from "@/lib/review-store";

export const runtime = "nodejs";

interface GenerateImageRequest {
  action?: "preview" | "insert";
  itemId?: string;
  prompt?: string;
  provider?: string;
  model?: string;
  imageBase64?: string;
  metadata?: {
    provider?: string;
    mode?: "generate";
    prompt?: string;
    model?: string;
    width?: number;
    height?: number;
    source_url?: string;
    creator?: string;
    license?: string;
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ videoId: string; version: string }> },
) {
  try {
    const { videoId, version } = await context.params;
    const body = (await request.json()) as GenerateImageRequest;
    const action = body.action === "insert" ? "insert" : "preview";

    if (action === "preview") {
      const generated = await generateTextToImage({
        provider: body.provider,
        prompt: body.prompt ?? "",
        model: body.model,
      });
      return NextResponse.json({
        preview: {
          imageBase64: Buffer.from(generated.bytes).toString("base64"),
          contentType: generated.contentType,
          metadata: generated.metadata,
        },
      });
    }

    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    if (!itemId) {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    }
    if (!body.imageBase64 || !body.metadata?.prompt || !body.metadata.provider) {
      return NextResponse.json({ error: "generated image payload is required" }, { status: 400 });
    }

    const imageData = new Uint8Array(Buffer.from(body.imageBase64, "base64"));
    const data = await replaceImageWithGeneratedImageForReviewItem(videoId, version, itemId, imageData, {
      provider: body.metadata.provider,
      mode: "generate",
      prompt: body.metadata.prompt,
      model: body.metadata.model,
      width: body.metadata.width,
      height: body.metadata.height,
      source_url: body.metadata.source_url,
      creator: body.metadata.creator,
      license: body.metadata.license,
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate image" },
      { status: 400 },
    );
  }
}
