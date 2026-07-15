// Profile 默认值镜像表，与 knowbreak/style_profile.py 的 pydantic 默认一一对应。
// 仅用于 /settings 页 UI 占位提示（"默认: X"），不参与运行时合并。
// Python CLI 以 profile.toml + profile_overrides.json 合并结果为准。

export interface ColorTriple {
  r: number;
  g: number;
  b: number;
}

type FieldKind = "int" | "float" | "string" | "bool" | "color";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  default: number | string | boolean | ColorTriple;
  hint?: string;
}

export interface FieldGroup {
  title: string;
  fields: FieldSpec[];
}

export const PROFILE_DEFAULTS: FieldGroup[] = [
  {
    title: "时长 / 数量",
    fields: [
      { key: "intro.enabled", label: "片头启用", kind: "bool", default: true },
      { key: "intro.duration", label: "片头时长(秒)", kind: "float", default: 2.0 },
      { key: "intro.cover_narration_enabled", label: "封面朗读标题", kind: "bool", default: true },
      { key: "topics.count", label: "选题数量", kind: "int", default: 1 },
      { key: "topics.target_duration_min", label: "选题目标最短(秒)", kind: "int", default: 60 },
      { key: "topics.target_duration_max", label: "选题目标最长(秒)", kind: "int", default: 90 },
      { key: "rewrite.target_duration_min", label: "改写目标最短(秒)", kind: "int", default: 60 },
      { key: "rewrite.target_duration_max", label: "改写目标最长(秒)", kind: "int", default: 90 },
      { key: "rewrite.spoken_chars_per_second", label: "口播字/秒", kind: "float", default: 5.0 },
      { key: "tts.speed", label: "TTS 语速倍率", kind: "float", default: 1.0, hint: "1.0=正常，1.15=加快15%" },
    ],
  },
  {
    title: "视频尺寸",
    fields: [
      { key: "compose.video_w", label: "宽度", kind: "int", default: 1080 },
      { key: "compose.video_h", label: "高度", kind: "int", default: 1920 },
    ],
  },
  {
    title: "品牌",
    fields: [
      { key: "compose.brand", label: "品牌文字", kind: "string", default: "知点拆解局" },
    ],
  },
  {
    title: "字体大小",
    fields: [
      { key: "compose.subtitle_font_size", label: "字幕字号", kind: "int", default: 62 },
      { key: "compose.title_font_size", label: "标题字号", kind: "int", default: 38 },
      { key: "compose.cover_title_font_size", label: "封面标题字号", kind: "int", default: 88 },
      { key: "compose.cover_brand_font_size", label: "封面品牌字号", kind: "int", default: 36 },
    ],
  },
  {
    title: "字幕位置",
    fields: [
      { key: "compose.subtitle_center_x_ratio", label: "字幕水平中心", kind: "float", default: 0.5 },
      { key: "compose.subtitle_center_ratio", label: "字幕垂直中心", kind: "float", default: 0.45, hint: "0.0=顶部, 1.0=底部" },
      { key: "compose.max_chars_per_line", label: "字幕每行最大字数", kind: "int", default: 16 },
      { key: "compose.subtitle_overlay_half_height", label: "字幕蒙层半高", kind: "int", default: 220 },
    ],
  },
  {
    title: "封面标题",
    fields: [
      { key: "compose.cover_title_center_x_ratio", label: "封面标题水平中心", kind: "float", default: 0.5 },
      { key: "compose.cover_title_center_ratio", label: "封面标题垂直中心", kind: "float", default: 0.45 },
      { key: "compose.cover_max_chars_per_line", label: "封面每行最大字数", kind: "int", default: 10 },
      { key: "compose.cover_brand_y", label: "封面品牌 Y", kind: "int", default: 200 },
      { key: "compose.cover_title_overlay_half_height", label: "封面标题蒙层半高", kind: "int", default: 260 },
    ],
  },
  {
    title: "进度条",
    fields: [
      { key: "compose.progress_bar_enabled", label: "进度条启用", kind: "bool", default: true },
      { key: "compose.progress_bar_ratio", label: "进度条 Y 比例", kind: "float", default: 0.59 },
      { key: "compose.progress_bar_width_ratio", label: "进度条宽度比例", kind: "float", default: 0.6 },
      { key: "compose.progress_bg_color", label: "进度条背景色", kind: "color", default: { r: 40, g: 40, b: 50 } },
      { key: "compose.progress_fg_color", label: "进度条前景色", kind: "color", default: { r: 120, g: 160, b: 240 } },
    ],
  },
  {
    title: "颜色",
    fields: [
      { key: "compose.bg_color", label: "背景色", kind: "color", default: { r: 14, g: 14, b: 18 } },
      { key: "compose.title_color", label: "标题色", kind: "color", default: { r: 220, g: 220, b: 224 } },
      { key: "compose.text_color", label: "字幕文字色", kind: "color", default: { r: 255, g: 255, b: 255 } },
      { key: "compose.stroke_color", label: "描边色", kind: "color", default: { r: 0, g: 0, b: 0 } },
      { key: "compose.cover_brand_color", label: "封面品牌色", kind: "color", default: { r: 235, g: 235, b: 238 } },
      { key: "compose.cover_title_color", label: "封面标题色", kind: "color", default: { r: 255, g: 255, b: 255 } },
    ],
  },
  {
    title: "蒙层 / 布局",
    fields: [
      { key: "compose.top_bar_alpha", label: "顶部条透明度", kind: "int", default: 170 },
      { key: "compose.bottom_overlay_alpha", label: "底部蒙层透明度", kind: "int", default: 150 },
      { key: "compose.cover_overlay_alpha", label: "封面蒙层透明度", kind: "int", default: 120 },
      { key: "compose.cover_title_overlay_alpha", label: "封面标题蒙层透明度", kind: "int", default: 175 },
      { key: "compose.top_bar_height", label: "顶部条高度", kind: "int", default: 150 },
      { key: "compose.top_gradient_height", label: "顶部渐变高度", kind: "int", default: 70 },
      { key: "compose.content_title_y", label: "内容标题 Y", kind: "int", default: 70 },
    ],
  },
];
