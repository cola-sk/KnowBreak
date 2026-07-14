function extensionFromMimeType(type: string): string {
  if (type === "image/png") {
    return "png";
  }
  if (type === "image/webp") {
    return "webp";
  }
  if (type === "image/gif") {
    return "gif";
  }
  return "jpg";
}

export async function readImageFileFromClipboard(): Promise<File | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) {
    return null;
  }

  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith("image/"));
    if (!imageType) {
      continue;
    }
    const blob = await item.getType(imageType);
    const type = blob.type || imageType;
    return new File([blob], `pasted-image.${extensionFromMimeType(type)}`, { type });
  }

  return null;
}
