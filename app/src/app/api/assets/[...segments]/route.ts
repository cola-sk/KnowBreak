import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

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
  if (ext === ".mp4") {
    return "video/mp4";
  }
  if (ext === ".webm") {
    return "video/webm";
  }
  if (ext === ".mp3") {
    return "audio/mpeg";
  }
  if (ext === ".wav") {
    return "audio/wav";
  }
  return "application/octet-stream";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ segments: string[] }> },
) {
  const { segments } = await context.params;
  const filePath = await resolveAssetPath(segments);
  if (!filePath) {
    return new Response("Not Found", { status: 404 });
  }

  const stat = await fs.stat(filePath);
  const range = request.headers.get("range");
  const type = contentType(filePath);
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return new Response("Invalid Range", { status: 416 });
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= stat.size) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: {
          "Content-Range": `bytes */${stat.size}`,
        },
      });
    }

    const stream = Readable.toWeb(createReadStream(filePath, { start, end }));
    return new Response(stream as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  const data = await fs.readFile(filePath);
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=60",
    },
  });
}
