"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";

import { readImageFileFromClipboard } from "@/lib/clipboard-image";

export interface CropEditorState {
  itemId: string;
  title: string;
  objectUrl: string;
  fileName: string;
}

interface ImageCropDialogProps {
  editor: CropEditorState;
  busy: boolean;
  onClose: () => void;
  onSave: (blob: Blob) => Promise<void>;
  onPickAnother: (file: File) => void;
}

const OUTPUT_SIZE = {
  width: 1080,
  height: 1920,
};

function createImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

async function cropImage(src: string, crop: Area): Promise<Blob> {
  const image = await createImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE.width;
  canvas.height = OUTPUT_SIZE.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("当前浏览器不支持 Canvas 裁剪");
  }

  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("裁剪图片生成失败"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      0.92,
    );
  });
}

export function ImageCropDialog({ editor, busy, onClose, onSave, onPickAnother }: ImageCropDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<Area | null>(null);
  const [localMessage, setLocalMessage] = useState("");

  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedPixels(null);
    setLocalMessage("");
  }, [editor.objectUrl]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedPixels(areaPixels);
  }, []);

  const canSave = useMemo(() => Boolean(croppedPixels), [croppedPixels]);

  const saveCropped = async () => {
    if (!croppedPixels) {
      return;
    }
    setLocalMessage("");
    try {
      const blob = await cropImage(editor.objectUrl, croppedPixels);
      await onSave(blob);
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : "裁剪保存失败");
    }
  };

  const pasteAnother = async () => {
    setLocalMessage("");
    try {
      const file = await readImageFileFromClipboard();
      if (!file) {
        setLocalMessage("未读取到剪贴板图片。请先复制图片，再点击从剪贴板换图。");
        return;
      }
      onPickAnother(file);
    } catch {
      setLocalMessage("浏览器未允许直接读取剪贴板。请按 Ctrl/Cmd + V，或选择本地图片。");
    }
  };

  return (
    <div className="crop-modal-backdrop" role="dialog" aria-modal="true">
      <div className="panel crop-modal">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>编辑并裁剪：{editor.title}</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              文件：{editor.fileName}，输出 1080 x 1920。
            </div>
          </div>
          <button type="button" className="secondary compact-btn" disabled={busy} onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="crop-modal-grid">
          <div className="crop-viewport cropper-frame">
            <Cropper
              image={editor.objectUrl}
              crop={crop}
              zoom={zoom}
              aspect={9 / 16}
              objectFit="cover"
              showGrid
              restrictPosition
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>

          <div className="crop-control-panel">
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>放大 / 缩小</label>
              <input
                type="range"
                min={1}
                max={4}
                step={0.01}
                value={zoom}
                disabled={busy}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <div style={{ color: "var(--muted)", fontSize: 12 }}>zoom: {zoom.toFixed(2)}</div>
            </div>

            <div className="row">
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) {
                    return;
                  }
                  onPickAnother(file);
                  event.currentTarget.value = "";
                }}
              />
              <button type="button" className="secondary compact-btn" disabled={busy} onClick={() => inputRef.current?.click()}>
                选择另一张图
              </button>
              <button type="button" className="secondary compact-btn" disabled={busy} onClick={pasteAnother}>
                从剪贴板换图
              </button>
              <button type="button" className="primary-btn compact-btn" disabled={busy || !canSave} onClick={saveCropped}>
                {busy ? "保存中" : "保存裁剪并替换"}
              </button>
            </div>

            {localMessage ? <div style={{ color: "var(--danger)", fontSize: 13 }}>{localMessage}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
