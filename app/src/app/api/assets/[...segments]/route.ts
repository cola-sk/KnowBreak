import fs from "node:fs/promises";
import path from "node:path";

import { resolveAssetPath } from "@/lib/review-store";

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  return "application/octet-stream";
}

export async function GET(
  _: Request,
  context: { params: Promise<{ segments: string[] }> },
) {
  const { segments } = await context.params;
  const filePath = await resolveAssetPath(segments);
  if (!filePath) {
    return new Response("Not Found", { status: 404 });
  }

  const data = await fs.readFile(filePath);
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": contentType(filePath),
      "Cache-Control": "public, max-age=60",
    },
  });
}
