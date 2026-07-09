import { NextResponse } from "next/server";

import { replaceImageForReviewItem } from "@/lib/review-store";

export async function POST(
  request: Request,
  context: { params: Promise<{ videoId: string; version: string }> },
) {
  try {
    const { videoId, version } = await context.params;
    const form = await request.formData();
    const itemId = form.get("itemId");
    const file = form.get("file");

    if (typeof itemId !== "string" || !itemId) {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    }
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) {
      return NextResponse.json({ error: "empty file" }, { status: 400 });
    }

    const data = await replaceImageForReviewItem(videoId, version, itemId, bytes);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to replace image" },
      { status: 400 },
    );
  }
}
