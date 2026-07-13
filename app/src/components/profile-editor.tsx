"use client";

import Link from "next/link";
import { type PointerEvent, useMemo, useRef, useState } from "react";

import { PROFILE_DEFAULTS, type ColorTriple, type FieldSpec } from "@/lib/profile-defaults";

interface Props {
  initial: Record<string, unknown>;
  base: Record<string, unknown>;
}

export function getNested(state: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = state;
  for (const part of parts) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function setNested(state: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const parts = key.split(".");
  const next = structuredClone(state) as Record<string, unknown>;
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
  return next;
}

function setManyNested(state: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  let next = state;
  for (const [key, value] of Object.entries(updates)) {
    next = setNested(next, key, value);
  }
  return next;
}

export function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const next = structuredClone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    const existing = next[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      next[key] = deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function clearNested(state: Record<string, unknown>, key: string): Record<string, unknown> {
  const parts = key.split(".");
  const next = structuredClone(state) as Record<string, unknown>;
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      return next;
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  delete cursor[parts[parts.length - 1]];
  for (let depth = parts.length - 2; depth >= 0; depth -= 1) {
    let parent: Record<string, unknown> = next;
    for (let i = 0; i < depth; i += 1) {
      parent = parent[parts[i]] as Record<string, unknown>;
    }
    const keyPart = parts[depth];
    const child = parent[keyPart];
    if (child && typeof child === "object" && !Array.isArray(child) && Object.keys(child).length === 0) {
      delete parent[keyPart];
    }
  }
  return next;
}

export function countOverrideLeaves(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value === undefined ? 0 : 1;
  }
  return Object.values(value as Record<string, unknown>).reduce<number>((total, child) => total + countOverrideLeaves(child), 0);
}

const ALL_FIELD_SPECS = PROFILE_DEFAULTS.flatMap((group) => group.fields);
const FIELD_BY_KEY = new Map(ALL_FIELD_SPECS.map((field) => [field.key, field]));
const VISUAL_PARAM_KEYS = new Set([
  "compose.subtitle_center_x_ratio",
  "compose.subtitle_center_ratio",
  "compose.subtitle_overlay_half_height",
  "compose.bottom_overlay_alpha",
  "compose.content_title_y",
  "compose.top_bar_height",
  "compose.top_gradient_height",
  "compose.top_bar_alpha",
  "compose.progress_bar_enabled",
  "compose.progress_bar_ratio",
  "compose.progress_bar_width_ratio",
  "compose.subtitle_font_size",
  "compose.title_font_size",
  "compose.max_chars_per_line",
  "compose.cover_title_center_x_ratio",
  "compose.cover_title_center_ratio",
  "compose.cover_title_overlay_half_height",
  "compose.cover_title_overlay_alpha",
  "compose.cover_overlay_alpha",
  "compose.cover_brand_y",
  "compose.cover_title_font_size",
  "compose.cover_brand_font_size",
  "compose.cover_max_chars_per_line",
]);

function fields(keys: string[]): FieldSpec[] {
  return keys.map((key) => FIELD_BY_KEY.get(key)).filter(Boolean) as FieldSpec[];
}

const DEFAULT_PARAM_SECTIONS = [
  {
    title: "生成与时长",
    fields: fields([
      "intro.enabled",
      "intro.duration",
      "intro.cover_narration_enabled",
      "topics.count",
      "topics.target_duration_min",
      "topics.target_duration_max",
      "rewrite.target_duration_min",
      "rewrite.target_duration_max",
      "rewrite.spoken_chars_per_second",
    ]),
  },
  {
    title: "视频基础",
    fields: fields([
      "compose.video_w",
      "compose.video_h",
      "compose.brand",
    ]),
  },
  {
    title: "内容画面",
    fields: fields([
      "compose.bg_color",
      "compose.title_color",
      "compose.text_color",
      "compose.stroke_color",
      "compose.progress_bg_color",
      "compose.progress_fg_color",
    ]),
  },
  {
    title: "封面",
    fields: fields([
      "compose.cover_brand_color",
      "compose.cover_title_color",
    ]),
  },
];

const VISUAL_PARAM_SECTIONS = [
  {
    title: "内容可视化参数",
    fields: fields([
      "compose.subtitle_center_x_ratio",
      "compose.subtitle_center_ratio",
      "compose.subtitle_overlay_half_height",
      "compose.bottom_overlay_alpha",
      "compose.content_title_y",
      "compose.top_bar_height",
      "compose.top_gradient_height",
      "compose.top_bar_alpha",
      "compose.progress_bar_enabled",
      "compose.progress_bar_ratio",
      "compose.progress_bar_width_ratio",
      "compose.subtitle_font_size",
      "compose.title_font_size",
      "compose.max_chars_per_line",
    ]),
  },
  {
    title: "封面可视化参数",
    fields: fields([
      "compose.cover_title_center_x_ratio",
      "compose.cover_title_center_ratio",
      "compose.cover_title_overlay_half_height",
      "compose.cover_title_overlay_alpha",
      "compose.cover_overlay_alpha",
      "compose.cover_brand_y",
      "compose.cover_title_font_size",
      "compose.cover_brand_font_size",
      "compose.cover_max_chars_per_line",
    ]),
  },
];

function formatDefault(spec: FieldSpec): string {
  if (spec.kind === "color") {
    const c = spec.default as ColorTriple;
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  }
  if (typeof spec.default === "boolean") {
    return spec.default ? "true" : "false";
  }
  return String(spec.default);
}

function formatValue(value: unknown, fallback: FieldSpec): string {
  if (Array.isArray(value) && value.length === 3) {
    return `rgb(${value.map((item) => Number(item)).join(", ")})`;
  }
  if (value === undefined) {
    return formatDefault(fallback);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function defaultValueForField(spec: FieldSpec, baseValue: unknown): unknown {
  if (baseValue !== undefined) {
    return baseValue;
  }
  if (spec.kind === "color") {
    const c = spec.default as ColorTriple;
    return [c.r, c.g, c.b];
  }
  return spec.default;
}

export function ProfileEditor({ initial, base }: Props) {
  const [state, setState] = useState<Record<string, unknown>>(initial);
  const effective = useMemo(() => deepMerge(base, state), [base, state]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "保存失败");
      }
      setMessage("已写入 profile_overrides.json，新跑的流水线会生效。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const resetField = (spec: FieldSpec) => {
    setState((prev) => clearNested(prev, spec.key));
  };

  const useDefault = (spec: FieldSpec) => {
    setState((prev) => setNested(prev, spec.key, defaultValueForField(spec, getNested(base, spec.key))));
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <VisualLayoutEditor
        effective={effective}
        onChange={(key, value) => setState((prev) => setNested(prev, key, value))}
        onChangeMany={(updates) => setState((prev) => setManyNested(prev, updates))}
      />

      <div className="param-section-stack">
        {DEFAULT_PARAM_SECTIONS.map((group) => (
          <section key={group.title} className="panel param-group-panel">
            <div style={{ fontWeight: 700, fontSize: 16 }}>{group.title}</div>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {group.fields.map((spec) => (
                <FieldRow
                  key={spec.key}
                  spec={spec}
                  value={getNested(state, spec.key)}
                  effectiveValue={getNested(effective, spec.key)}
                  baseValue={getNested(base, spec.key)}
                  onChange={(value) => setState((prev) => setNested(prev, spec.key, value))}
                  onClear={() => resetField(spec)}
                  onUseDefault={() => useDefault(spec)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <details className="panel all-params-details">
        <summary>
          <span>查看可视化参数明细</span>
          <span className="badge">{VISUAL_PARAM_KEYS.size} 项</span>
        </summary>
        <div className="all-params-stack">
          {VISUAL_PARAM_SECTIONS.map((group) => (
            <section key={group.title} className="param-group-panel">
              <div style={{ fontWeight: 700, fontSize: 16 }}>{group.title}</div>
              <div className="section-subtitle" style={{ marginTop: 4 }}>这些字段已经可以在上方可视化区域调整，默认折叠避免重复。</div>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {group.fields.map((spec) => (
                  <FieldRow
                    key={spec.key}
                    spec={spec}
                    value={getNested(state, spec.key)}
                    effectiveValue={getNested(effective, spec.key)}
                    baseValue={getNested(base, spec.key)}
                    onChange={(value) => setState((prev) => setNested(prev, spec.key, value))}
                    onClear={() => resetField(spec)}
                    onUseDefault={() => useDefault(spec)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </details>

      <div className="panel" style={{ padding: 14 }}>
        <div className="row" style={{ alignItems: "center" }}>
          <button className="approve-btn" disabled={saving} onClick={save}>
            {saving ? "保存中..." : "保存到 profile_overrides.json"}
          </button>
          {message ? <span className="badge approved">{message}</span> : null}
          {error ? <span className="badge rejected">{error}</span> : null}
        </div>
        <div style={{ marginTop: 8 }}>
          <Link className="tab " href="/">返回首页</Link>
          <Link className="tab " href="/projects">项目列表</Link>
        </div>
      </div>
    </div>
  );
}

interface FieldRowProps {
  spec: FieldSpec;
  value: unknown;
  effectiveValue: unknown;
  baseValue: unknown;
  onChange: (value: unknown) => void;
  onClear: () => void;
  onUseDefault: () => void;
}

type VisualMode = "content" | "cover";
type DragTarget = "subtitle" | "contentTitle" | "progress" | "coverTitle" | "coverBrand";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asColor(value: unknown, fallback: string): string {
  if (Array.isArray(value) && value.length === 3) {
    const [r, g, b] = value.map((item) => clamp(Math.round(Number(item)), 0, 255));
    return `rgb(${r}, ${g}, ${b})`;
  }
  return fallback;
}

interface VisualLayoutEditorProps {
  effective: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onChangeMany: (updates: Record<string, unknown>) => void;
}

export function VisualLayoutEditor({ effective, onChange, onChangeMany }: VisualLayoutEditorProps) {
  const [mode, setMode] = useState<VisualMode>("content");
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const videoW = Math.max(360, asNumber(getNested(effective, "compose.video_w"), 1080));
  const videoH = Math.max(640, asNumber(getNested(effective, "compose.video_h"), 1920));
  const brand = asString(getNested(effective, "compose.brand"), "知点拆解局");
  const bgColor = asColor(getNested(effective, "compose.bg_color"), "rgb(14, 14, 18)");
  const titleColor = asColor(getNested(effective, "compose.title_color"), "rgb(220, 220, 224)");
  const textColor = asColor(getNested(effective, "compose.text_color"), "rgb(255, 255, 255)");
  const coverBrandColor = asColor(getNested(effective, "compose.cover_brand_color"), "rgb(235, 235, 238)");
  const coverTitleColor = asColor(getNested(effective, "compose.cover_title_color"), "rgb(255, 255, 255)");
  const progressBgColor = asColor(getNested(effective, "compose.progress_bg_color"), "rgb(40, 40, 50)");
  const progressFgColor = asColor(getNested(effective, "compose.progress_fg_color"), "rgb(120, 160, 240)");

  const topBarHeight = asNumber(getNested(effective, "compose.top_bar_height"), 150);
  const topGradientHeight = asNumber(getNested(effective, "compose.top_gradient_height"), 70);
  const contentTitleY = asNumber(getNested(effective, "compose.content_title_y"), 70);
  const subtitleX = asNumber(getNested(effective, "compose.subtitle_center_x_ratio"), 0.5);
  const subtitleY = asNumber(getNested(effective, "compose.subtitle_center_ratio"), 0.45);
  const subtitleHalfHeight = asNumber(getNested(effective, "compose.subtitle_overlay_half_height"), 220);
  const progressY = asNumber(getNested(effective, "compose.progress_bar_ratio"), 0.59);
  const progressWidth = asNumber(getNested(effective, "compose.progress_bar_width_ratio"), 0.6);
  const progressEnabled = asBool(getNested(effective, "compose.progress_bar_enabled"), true);
  const coverTitleX = asNumber(getNested(effective, "compose.cover_title_center_x_ratio"), 0.5);
  const coverTitleY = asNumber(getNested(effective, "compose.cover_title_center_ratio"), 0.45);
  const coverBrandY = asNumber(getNested(effective, "compose.cover_brand_y"), 200);
  const coverTitleHalfHeight = asNumber(getNested(effective, "compose.cover_title_overlay_half_height"), 260);
  const topBarAlpha = asNumber(getNested(effective, "compose.top_bar_alpha"), 170);
  const bottomOverlayAlpha = asNumber(getNested(effective, "compose.bottom_overlay_alpha"), 150);
  const coverOverlayAlpha = asNumber(getNested(effective, "compose.cover_overlay_alpha"), 120);
  const coverTitleOverlayAlpha = asNumber(getNested(effective, "compose.cover_title_overlay_alpha"), 175);

  const updateFromPointer = (event: PointerEvent, target: DragTarget) => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const xRatio = clamp((event.clientX - rect.left) / rect.width, 0.05, 0.95);
    const yRatio = clamp((event.clientY - rect.top) / rect.height, 0.02, 0.98);
    if (target === "subtitle") {
      onChangeMany({
        "compose.subtitle_center_x_ratio": Number(xRatio.toFixed(3)),
        "compose.subtitle_center_ratio": Number(yRatio.toFixed(3)),
      });
    } else if (target === "coverTitle") {
      onChangeMany({
        "compose.cover_title_center_x_ratio": Number(xRatio.toFixed(3)),
        "compose.cover_title_center_ratio": Number(yRatio.toFixed(3)),
      });
    } else if (target === "contentTitle") {
      onChange("compose.content_title_y", Math.round(yRatio * videoH));
    } else if (target === "progress") {
      onChange("compose.progress_bar_ratio", Number(yRatio.toFixed(3)));
    } else if (target === "coverBrand") {
      onChange("compose.cover_brand_y", Math.round(yRatio * videoH));
    }
  };

  const beginDrag = (event: PointerEvent, target: DragTarget) => {
    event.preventDefault();
    setDragTarget(target);
    updateFromPointer(event, target);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (dragTarget) {
      updateFromPointer(event, dragTarget);
    }
  };

  const onPointerUp = () => setDragTarget(null);

  return (
    <section className="panel visual-config-panel">
      <div className="visual-config-head">
        <div>
          <div className="section-title">画面可视化配置</div>
          <div className="section-subtitle">拖动预览中的锚点或使用滑块；保存后，新跑的流水线会按这些参数渲染。</div>
        </div>
        <div className="segmented-control">
          <button type="button" className={mode === "content" ? "active" : ""} onClick={() => setMode("content")}>内容页</button>
          <button type="button" className={mode === "cover" ? "active" : ""} onClick={() => setMode("cover")}>封面</button>
        </div>
      </div>

      <div className="visual-config-grid">
        <div className="visual-phone-wrap">
          <div
            ref={previewRef}
            className={`visual-phone ${mode}`}
            style={{ aspectRatio: `${videoW} / ${videoH}`, background: bgColor }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {mode === "content" ? (
              <ContentPreview
                topBarHeight={topBarHeight}
                topGradientHeight={topGradientHeight}
                topBarAlpha={topBarAlpha}
                bottomOverlayAlpha={bottomOverlayAlpha}
                contentTitleY={contentTitleY}
                subtitleX={subtitleX}
                subtitleY={subtitleY}
                subtitleHalfHeight={subtitleHalfHeight}
                progressY={progressY}
                progressWidth={progressWidth}
                progressEnabled={progressEnabled}
                titleColor={titleColor}
                textColor={textColor}
                progressBgColor={progressBgColor}
                progressFgColor={progressFgColor}
                videoH={videoH}
                onDragStart={beginDrag}
              />
            ) : (
              <CoverPreview
                brand={brand}
                coverOverlayAlpha={coverOverlayAlpha}
                coverTitleOverlayAlpha={coverTitleOverlayAlpha}
                coverTitleX={coverTitleX}
                coverTitleY={coverTitleY}
                coverBrandY={coverBrandY}
                coverTitleHalfHeight={coverTitleHalfHeight}
                coverBrandColor={coverBrandColor}
                coverTitleColor={coverTitleColor}
                videoH={videoH}
                onDragStart={beginDrag}
              />
            )}
          </div>
          <div className="visual-help">
            预览为参数示意，不加载真实素材；位置、蒙层和比例与合成阶段使用同一套字段。
          </div>
        </div>

        <div className="visual-control-stack">
          {mode === "content" ? (
            <ContentControls
              values={{
                topBarHeight,
                topGradientHeight,
                contentTitleY,
                subtitleX,
                subtitleY,
                subtitleHalfHeight,
                progressY,
                progressWidth,
                progressEnabled,
                topBarAlpha,
                bottomOverlayAlpha,
                subtitleFontSize: asNumber(getNested(effective, "compose.subtitle_font_size"), 62),
                titleFontSize: asNumber(getNested(effective, "compose.title_font_size"), 38),
                maxChars: asNumber(getNested(effective, "compose.max_chars_per_line"), 16),
              }}
              videoH={videoH}
              onChange={onChange}
            />
          ) : (
            <CoverControls
              values={{
                coverTitleX,
                coverTitleY,
                coverBrandY,
                coverTitleHalfHeight,
                coverOverlayAlpha,
                coverTitleOverlayAlpha,
                coverTitleFontSize: asNumber(getNested(effective, "compose.cover_title_font_size"), 88),
                coverBrandFontSize: asNumber(getNested(effective, "compose.cover_brand_font_size"), 36),
                coverMaxChars: asNumber(getNested(effective, "compose.cover_max_chars_per_line"), 10),
              }}
              videoH={videoH}
              onChange={onChange}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function alphaCss(alpha: number): string {
  return `rgba(0, 0, 0, ${clamp(alpha, 0, 255) / 255})`;
}

function yPercent(px: number, videoH: number): number {
  return clamp((px / videoH) * 100, 0, 100);
}

function ContentPreview(props: {
  topBarHeight: number;
  topGradientHeight: number;
  topBarAlpha: number;
  bottomOverlayAlpha: number;
  contentTitleY: number;
  subtitleX: number;
  subtitleY: number;
  subtitleHalfHeight: number;
  progressY: number;
  progressWidth: number;
  progressEnabled: boolean;
  titleColor: string;
  textColor: string;
  progressBgColor: string;
  progressFgColor: string;
  videoH: number;
  onDragStart: (event: PointerEvent, target: DragTarget) => void;
}) {
  const subtitleOverlayTop = (props.subtitleY * 100) - yPercent(props.subtitleHalfHeight, props.videoH);
  const subtitleOverlayHeight = yPercent(props.subtitleHalfHeight * 2, props.videoH);
  return (
    <>
      <div className="visual-image-suggestion" />
      <div className="visual-top-bar" style={{ height: `${yPercent(props.topBarHeight, props.videoH)}%`, background: alphaCss(props.topBarAlpha) }} />
      <div
        className="visual-top-gradient"
        style={{
          top: `${yPercent(props.topBarHeight, props.videoH)}%`,
          height: `${yPercent(props.topGradientHeight, props.videoH)}%`,
          background: `linear-gradient(${alphaCss(props.topBarAlpha)}, rgba(0,0,0,0))`,
        }}
      />
      <div className="visual-overlay-band" style={{ top: `${subtitleOverlayTop}%`, height: `${subtitleOverlayHeight}%`, background: alphaCss(props.bottomOverlayAlpha) }} />
      <div className="visual-title-text" style={{ top: `${yPercent(props.contentTitleY, props.videoH)}%`, color: props.titleColor }}>
        台风为什么经常改路线
      </div>
      <button
        type="button"
        className="visual-anchor title-anchor"
        style={{ left: "50%", top: `${yPercent(props.contentTitleY, props.videoH)}%` }}
        title="拖动设置内容标题 Y"
        onPointerDown={(event) => props.onDragStart(event, "contentTitle")}
      />
      <div className="visual-subtitle-text" style={{ left: `${props.subtitleX * 100}%`, top: `${props.subtitleY * 100}%`, color: props.textColor }}>
        副热带高压、冷空气和地形，都会改变台风的引导气流。
      </div>
      <button
        type="button"
        className="visual-anchor subtitle-anchor"
        style={{ left: `${props.subtitleX * 100}%`, top: `${props.subtitleY * 100}%` }}
        title="拖动设置字幕中心"
        onPointerDown={(event) => props.onDragStart(event, "subtitle")}
      />
      {props.progressEnabled ? (
        <>
          <div
            className="visual-progress-bg"
            style={{ left: `${(1 - props.progressWidth) * 50}%`, width: `${props.progressWidth * 100}%`, top: `${props.progressY * 100}%`, background: props.progressBgColor }}
          >
            <div className="visual-progress-fg" style={{ width: "42%", background: props.progressFgColor }} />
          </div>
          <button
            type="button"
            className="visual-anchor progress-anchor"
            style={{ left: "50%", top: `${props.progressY * 100}%` }}
            title="拖动设置进度条 Y"
            onPointerDown={(event) => props.onDragStart(event, "progress")}
          />
        </>
      ) : null}
    </>
  );
}

function CoverPreview(props: {
  brand: string;
  coverOverlayAlpha: number;
  coverTitleOverlayAlpha: number;
  coverTitleX: number;
  coverTitleY: number;
  coverBrandY: number;
  coverTitleHalfHeight: number;
  coverBrandColor: string;
  coverTitleColor: string;
  videoH: number;
  onDragStart: (event: PointerEvent, target: DragTarget) => void;
}) {
  const titleOverlayTop = (props.coverTitleY * 100) - yPercent(props.coverTitleHalfHeight, props.videoH);
  const titleOverlayHeight = yPercent(props.coverTitleHalfHeight * 2, props.videoH);
  return (
    <>
      <div className="visual-cover-suggestion" />
      <div className="visual-full-overlay" style={{ background: alphaCss(props.coverOverlayAlpha) }} />
      <div className="visual-overlay-band" style={{ top: `${titleOverlayTop}%`, height: `${titleOverlayHeight}%`, background: alphaCss(props.coverTitleOverlayAlpha) }} />
      <div className="visual-cover-brand" style={{ top: `${yPercent(props.coverBrandY, props.videoH)}%`, color: props.coverBrandColor }}>
        {props.brand}
      </div>
      <button
        type="button"
        className="visual-anchor brand-anchor"
        style={{ left: "12%", top: `${yPercent(props.coverBrandY, props.videoH)}%` }}
        title="拖动设置封面品牌 Y"
        onPointerDown={(event) => props.onDragStart(event, "coverBrand")}
      />
      <div className="visual-cover-title" style={{ left: `${props.coverTitleX * 100}%`, top: `${props.coverTitleY * 100}%`, color: props.coverTitleColor }}>
        台风为什么<br />总会跑偏？
      </div>
      <button
        type="button"
        className="visual-anchor cover-title-anchor"
        style={{ left: `${props.coverTitleX * 100}%`, top: `${props.coverTitleY * 100}%` }}
        title="拖动设置封面标题中心"
        onPointerDown={(event) => props.onDragStart(event, "coverTitle")}
      />
    </>
  );
}

function VisualSlider(props: {
  label: string;
  field: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  effect: string;
  onChange: (key: string, value: unknown) => void;
}) {
  const valueLabel = `${props.value}${props.suffix ?? ""}`;
  return (
    <label className="visual-slider">
      <div className="visual-slider-head">
        <span>{props.label}</span>
        <code>{valueLabel}</code>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          props.onChange(props.field, Number.isFinite(parsed) ? parsed : props.min);
        }}
      />
      <div className="visual-effect">{props.effect}</div>
    </label>
  );
}

function ContentControls(props: {
  values: {
    topBarHeight: number;
    topGradientHeight: number;
    contentTitleY: number;
    subtitleX: number;
    subtitleY: number;
    subtitleHalfHeight: number;
    progressY: number;
    progressWidth: number;
    progressEnabled: boolean;
    topBarAlpha: number;
    bottomOverlayAlpha: number;
    subtitleFontSize: number;
    titleFontSize: number;
    maxChars: number;
  };
  videoH: number;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <>
      <div className="visual-control-note">内容页影响每句字幕图片：顶部标题条、正文字幕位置、字幕横带和进度条都会在最终 MP4 中体现。</div>
      <VisualSlider label="字幕水平中心" field="compose.subtitle_center_x_ratio" value={props.values.subtitleX} min={0.1} max={0.9} step={0.01} effect="左移或右移口播字幕块，适合避开人物或画面主体。" onChange={props.onChange} />
      <VisualSlider label="字幕垂直中心" field="compose.subtitle_center_ratio" value={props.values.subtitleY} min={0.12} max={0.9} step={0.01} effect="决定字幕在画面上中下的位置，字幕蒙层也会跟随移动。" onChange={props.onChange} />
      <VisualSlider label="字幕蒙层半高" field="compose.subtitle_overlay_half_height" value={props.values.subtitleHalfHeight} min={80} max={Math.round(props.videoH * 0.45)} step={10} suffix="px" effect="数值越大，字幕背后的黑色横带越厚，可读性更强但遮挡画面更多。" onChange={props.onChange} />
      <VisualSlider label="底部蒙层透明度" field="compose.bottom_overlay_alpha" value={props.values.bottomOverlayAlpha} min={0} max={255} step={5} effect="控制字幕横带暗度，0 为透明，255 为全黑。" onChange={props.onChange} />
      <VisualSlider label="内容标题 Y" field="compose.content_title_y" value={props.values.contentTitleY} min={0} max={Math.round(props.videoH * 0.25)} step={5} suffix="px" effect="控制顶部标题文字距离画面顶部的位置。" onChange={props.onChange} />
      <VisualSlider label="顶部条高度" field="compose.top_bar_height" value={props.values.topBarHeight} min={0} max={Math.round(props.videoH * 0.25)} step={5} suffix="px" effect="顶部黑色条越高，标题越稳，但会占用更多画面。" onChange={props.onChange} />
      <VisualSlider label="顶部渐变高度" field="compose.top_gradient_height" value={props.values.topGradientHeight} min={0} max={260} step={5} suffix="px" effect="增加标题条向下过渡的柔和程度。" onChange={props.onChange} />
      <VisualSlider label="顶部条透明度" field="compose.top_bar_alpha" value={props.values.topBarAlpha} min={0} max={255} step={5} effect="控制顶部标题背景暗度，影响标题可读性。" onChange={props.onChange} />
      <label className="visual-toggle">
        <input type="checkbox" checked={props.values.progressEnabled} onChange={(event) => props.onChange("compose.progress_bar_enabled", event.target.checked)} />
        <span>显示进度条</span>
        <em>关闭后每句字幕图不再绘制底部进度。</em>
      </label>
      <VisualSlider label="进度条 Y" field="compose.progress_bar_ratio" value={props.values.progressY} min={0.2} max={0.92} step={0.01} effect="决定进度条在画面中的垂直位置。" onChange={props.onChange} />
      <VisualSlider label="进度条宽度" field="compose.progress_bar_width_ratio" value={props.values.progressWidth} min={0.2} max={0.95} step={0.01} effect="控制进度条横向占屏比例。" onChange={props.onChange} />
      <VisualSlider label="字幕字号" field="compose.subtitle_font_size" value={props.values.subtitleFontSize} min={32} max={110} step={1} suffix="px" effect="影响口播字幕的字号和换行高度。" onChange={props.onChange} />
      <VisualSlider label="标题字号" field="compose.title_font_size" value={props.values.titleFontSize} min={24} max={76} step={1} suffix="px" effect="影响顶部标题字号。" onChange={props.onChange} />
      <VisualSlider label="字幕每行字数" field="compose.max_chars_per_line" value={props.values.maxChars} min={8} max={26} step={1} effect="数值越小换行越频繁，字幕块更窄更高。" onChange={props.onChange} />
    </>
  );
}

function CoverControls(props: {
  values: {
    coverTitleX: number;
    coverTitleY: number;
    coverBrandY: number;
    coverTitleHalfHeight: number;
    coverOverlayAlpha: number;
    coverTitleOverlayAlpha: number;
    coverTitleFontSize: number;
    coverBrandFontSize: number;
    coverMaxChars: number;
  };
  videoH: number;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <>
      <div className="visual-control-note">封面配置影响开头 intro.png：整图暗度、标题横带、品牌位置和封面标题排版都会直接进成片片头。</div>
      <VisualSlider label="封面标题水平中心" field="compose.cover_title_center_x_ratio" value={props.values.coverTitleX} min={0.1} max={0.9} step={0.01} effect="左右移动封面大标题，适合避开背景图主体。" onChange={props.onChange} />
      <VisualSlider label="封面标题垂直中心" field="compose.cover_title_center_ratio" value={props.values.coverTitleY} min={0.18} max={0.82} step={0.01} effect="上下移动封面大标题，标题横带会跟随移动。" onChange={props.onChange} />
      <VisualSlider label="封面标题蒙层半高" field="compose.cover_title_overlay_half_height" value={props.values.coverTitleHalfHeight} min={100} max={Math.round(props.videoH * 0.45)} step={10} suffix="px" effect="控制标题背后横带厚度，增强标题识别但会压暗背景。" onChange={props.onChange} />
      <VisualSlider label="封面标题横带透明度" field="compose.cover_title_overlay_alpha" value={props.values.coverTitleOverlayAlpha} min={0} max={255} step={5} effect="控制标题横带暗度。" onChange={props.onChange} />
      <VisualSlider label="封面整体蒙层透明度" field="compose.cover_overlay_alpha" value={props.values.coverOverlayAlpha} min={0} max={255} step={5} effect="控制整张封面的压暗程度，数值越大越突出文字。" onChange={props.onChange} />
      <VisualSlider label="封面品牌 Y" field="compose.cover_brand_y" value={props.values.coverBrandY} min={0} max={Math.round(props.videoH * 0.5)} step={5} suffix="px" effect="控制品牌文字距离顶部的位置。" onChange={props.onChange} />
      <VisualSlider label="封面标题字号" field="compose.cover_title_font_size" value={props.values.coverTitleFontSize} min={48} max={140} step={1} suffix="px" effect="影响封面主标题的视觉冲击力和占用高度。" onChange={props.onChange} />
      <VisualSlider label="封面品牌字号" field="compose.cover_brand_font_size" value={props.values.coverBrandFontSize} min={20} max={72} step={1} suffix="px" effect="影响品牌标识的存在感。" onChange={props.onChange} />
      <VisualSlider label="封面每行字数" field="compose.cover_max_chars_per_line" value={props.values.coverMaxChars} min={5} max={18} step={1} effect="数值越小，封面标题换行越多，更像短视频封面大字。" onChange={props.onChange} />
    </>
  );
}

export function ProjectProfileConfigModal({
  title,
  description,
  base,
  value,
  onChange,
  onClose,
}: {
  title: string;
  description: string;
  base: Record<string, unknown>;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const effective = useMemo(() => deepMerge(base, value), [base, value]);
  const updateOne = (key: string, nextValue: unknown) => {
    if (nextValue === undefined || nextValue === "") {
      onChange(clearNested(value, key));
      return;
    }
    onChange(setNested(value, key, nextValue));
  };

  const updateMany = (updates: Record<string, unknown>) => {
    onChange(setManyNested(value, updates));
  };

  const applyPreset = (preset: "inherit" | "vertical" | "horizontal" | "square") => {
    if (preset === "inherit") {
      onChange(clearNested(clearNested(value, "compose.video_w"), "compose.video_h"));
      return;
    }
    const sizes = {
      vertical: [1080, 1920],
      horizontal: [1920, 1080],
      square: [1080, 1080],
    }[preset];
    onChange(setManyNested(value, {
      "compose.video_w": sizes[0],
      "compose.video_h": sizes[1],
    }));
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="project-config-modal" role="dialog" aria-modal="true" aria-labelledby="project-config-title" onClick={(event) => event.stopPropagation()}>
        <div className="project-config-modal-head">
          <div>
            <div id="project-config-title" className="section-title">{title}</div>
            <div className="section-subtitle">{description}</div>
          </div>
          <button type="button" className="btn secondary-btn compact-btn" onClick={onClose}>完成</button>
        </div>

        <div className="project-config-modal-body">
          <div className="project-config-toolbar">
            <span className="badge">{countOverrideLeaves(value)} 项项目覆盖</span>
            <button type="button" className="btn secondary-btn compact-btn" onClick={() => onChange({})} disabled={countOverrideLeaves(value) === 0}>
              清空项目覆盖
            </button>
            <button type="button" className="btn secondary-btn compact-btn" onClick={() => applyPreset("inherit")}>继承尺寸</button>
            <button type="button" className="btn secondary-btn compact-btn" onClick={() => applyPreset("vertical")}>9:16</button>
            <button type="button" className="btn secondary-btn compact-btn" onClick={() => applyPreset("horizontal")}>16:9</button>
            <button type="button" className="btn secondary-btn compact-btn" onClick={() => applyPreset("square")}>1:1</button>
          </div>

          <VisualLayoutEditor
            effective={effective}
            onChange={updateOne}
            onChangeMany={updateMany}
          />

          <div className="param-section-stack">
            {DEFAULT_PARAM_SECTIONS.map((group) => (
              <section key={group.title} className="panel param-group-panel">
                <div style={{ fontWeight: 700, fontSize: 16 }}>{group.title}</div>
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  {group.fields.map((spec) => (
                    <OverrideFieldRow
                      key={spec.key}
                      spec={spec}
                      value={getNested(value, spec.key)}
                      inheritedValue={getNested(base, spec.key)}
                      onChange={(fieldValue) => updateOne(spec.key, fieldValue)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <details className="panel all-params-details">
            <summary>
              <span>查看可视化参数明细</span>
              <span className="badge">{VISUAL_PARAM_KEYS.size} 项</span>
            </summary>
            <div className="all-params-stack">
              {VISUAL_PARAM_SECTIONS.map((group) => (
                <section key={group.title} className="param-group-panel">
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{group.title}</div>
                  <div className="section-subtitle" style={{ marginTop: 4 }}>这些字段已经可以在上方可视化区域调整，默认折叠避免重复。</div>
                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    {group.fields.map((spec) => (
                      <OverrideFieldRow
                        key={spec.key}
                        spec={spec}
                        value={getNested(value, spec.key)}
                        inheritedValue={getNested(base, spec.key)}
                        onChange={(fieldValue) => updateOne(spec.key, fieldValue)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function OverrideFieldRow({
  spec,
  value,
  inheritedValue,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  inheritedValue: unknown;
  onChange: (value: unknown) => void;
}) {
  const isOverridden = value !== undefined;
  const defaultHint = `继承: ${formatValue(inheritedValue, spec)}`;

  if (spec.kind === "bool") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500 }}>{spec.label}</label>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            <code>{spec.key}</code> · {defaultHint}{spec.hint ? ` · ${spec.hint}` : ""}
          </div>
        </div>
        <select
          value={value === undefined ? "inherit" : value ? "true" : "false"}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === "inherit" ? undefined : raw === "true");
          }}
          style={{ maxWidth: 180 }}
        >
          <option value="inherit">继承</option>
          <option value="true">是</option>
          <option value="false">否</option>
        </select>
        {isOverridden ? <button type="button" className="badge warning" onClick={() => onChange(undefined)} style={{ padding: "6px 12px", height: 38 }}>清除</button> : <span style={{ width: 44 }} />}
      </div>
    );
  }

  if (spec.kind === "color") {
    const inherited = Array.isArray(inheritedValue) && inheritedValue.length === 3
      ? inheritedValue.map((item) => Number(item))
      : defaultValueForField(spec, inheritedValue) as number[];
    const arr = Array.isArray(value) && value.length === 3
      ? (value as number[]).map((item) => Number(item))
      : inherited;
    const handleColor = (idx: number, raw: string) => {
      const parsed = Number(raw);
      const next = [...arr];
      next[idx] = Number.isFinite(parsed) ? clamp(Math.round(parsed), 0, 255) : 0;
      onChange(next);
    };
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500 }}>{spec.label}</label>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              <code>{spec.key}</code> · {defaultHint}
            </div>
          </div>
          {isOverridden ? <button type="button" className="badge warning" onClick={() => onChange(undefined)} style={{ padding: "6px 12px" }}>清除</button> : null}
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          {(["R", "G", "B"] as const).map((label, idx) => (
            <div key={label} style={{ display: "grid", gap: 2, maxWidth: 90 }}>
              <label style={{ fontSize: 11, color: "var(--muted)" }}>{label}</label>
              <input
                type="number"
                min={0}
                max={255}
                value={isOverridden ? arr[idx] : ""}
                placeholder={String(arr[idx])}
                onChange={(event) => handleColor(idx, event.target.value)}
                style={{ maxWidth: 90 }}
              />
            </div>
          ))}
          <span className="badge" style={{ background: `rgb(${arr[0]}, ${arr[1]}, ${arr[2]})`, color: arr[0] + arr[1] + arr[2] > 384 ? "#000" : "#fff", border: "1px solid var(--line)" }}>
            {arr.join(",")}{isOverridden ? " 已覆盖" : ""}
          </span>
        </div>
      </div>
    );
  }

  const fieldValue = value !== undefined ? value : "";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
      <div>
        <label style={{ fontSize: 13, fontWeight: 500 }}>{spec.label}</label>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          <code>{spec.key}</code> · {defaultHint}{spec.hint ? ` · ${spec.hint}` : ""}
        </div>
      </div>
      <input
        type={spec.kind === "string" ? "text" : "number"}
        step={spec.kind === "float" ? "0.01" : "1"}
        value={typeof fieldValue === "string" || typeof fieldValue === "number" ? fieldValue : ""}
        placeholder={formatValue(inheritedValue, spec)}
        onChange={(event) => {
          if (event.target.value === "") {
            onChange(undefined);
            return;
          }
          if (spec.kind === "string") {
            onChange(event.target.value);
            return;
          }
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        style={{ maxWidth: 180 }}
      />
      {isOverridden ? <button type="button" className="badge warning" onClick={() => onChange(undefined)} style={{ padding: "6px 12px", height: 38 }}>清除</button> : <span style={{ width: 44 }} />}
    </div>
  );
}

function FieldRow({ spec, value, effectiveValue, baseValue, onChange, onClear, onUseDefault }: FieldRowProps) {
  const isOverridden = value !== undefined;
  const defaultHint = `TOML: ${formatValue(baseValue, spec)}`;

  if (spec.kind === "bool") {
    const checked = typeof effectiveValue === "boolean" ? effectiveValue : Boolean(spec.default);
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500 }}>{spec.label}</label>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            <code>{spec.key}</code> · {defaultHint}{spec.hint ? ` · ${spec.hint}` : ""}
          </div>
        </div>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          style={{ width: "auto" }}
        />
        {isOverridden ? <button className="tab " onClick={onClear}>清除覆盖</button> : <button className="tab " onClick={onUseDefault}>写入当前值</button>}
      </div>
    );
  }

  if (spec.kind === "color") {
    const arr = Array.isArray(effectiveValue) && effectiveValue.length === 3
      ? (effectiveValue as number[]).map((n) => Number(n))
      : (function () {
          const c = spec.default as ColorTriple;
          return [c.r, c.g, c.b];
        })();
    const handleChange = (idx: number, raw: string) => {
      const parsed = Number(raw);
      const next = [...arr] as number[];
      next[idx] = Number.isFinite(parsed) ? Math.max(0, Math.min(255, Math.round(parsed))) : 0;
      onChange(next);
    };
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500 }}>{spec.label}</label>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            <code>{spec.key}</code> · {defaultHint}
          </div>
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          {(["R", "G", "B"] as const).map((label, idx) => (
            <div key={label} style={{ display: "grid", gap: 2, maxWidth: 90 }}>
              <label style={{ fontSize: 11, color: "var(--muted)" }}>{label}</label>
              <input
                type="number"
                min={0}
                max={255}
                value={arr[idx]}
                onChange={(event) => handleChange(idx, event.target.value)}
                style={{ maxWidth: 90 }}
              />
            </div>
          ))}
          <span className="badge" style={{ background: `rgb(${arr[0]}, ${arr[1]}, ${arr[2]})`, color: arr[0] + arr[1] + arr[2] > 384 ? "#000" : "#fff", border: "1px solid var(--line)" }}>
            {arr.join(",")}
          </span>
          {isOverridden ? <button className="tab " onClick={onClear}>清除</button> : null}
        </div>
      </div>
    );
  }

  const numValue = typeof effectiveValue === "number" ? String(effectiveValue) : "";
  const strValue = typeof effectiveValue === "string" ? effectiveValue : "";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
      <div>
        <label style={{ fontSize: 13, fontWeight: 500 }}>{spec.label}</label>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          <code>{spec.key}</code> · {defaultHint}{spec.hint ? ` · ${spec.hint}` : ""}
        </div>
      </div>
      <input
        type={spec.kind === "string" ? "text" : "number"}
        step={spec.kind === "float" ? "0.01" : "1"}
        value={spec.kind === "string" ? strValue : numValue}
        placeholder={formatDefault(spec)}
        onChange={(event) => {
          if (spec.kind === "string") {
            onChange(event.target.value);
            return;
          }
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        style={{ maxWidth: 180 }}
      />
      {isOverridden ? <button className="tab " onClick={onClear}>清除</button> : <button className="tab " onClick={onUseDefault}>默认</button>}
    </div>
  );
}
