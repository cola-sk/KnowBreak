"""阶段 8：自动成片。

输入：tts.json + images.json（可选）
输出：每个选题一个 MP4（1080x1920 竖屏，配音 + 烧入字幕 + 配图背景）

用 PIL 渲染每句字幕为 PNG（避开 ffmpeg 没装 libass/drawtext 的问题），
再用 ffmpeg 的 concat demuxer 按封面和每句的实际 TTS 时长拼成视频。
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ..config import Config
from ..models import TTSResult
from ..style_profile import ComposeProfile

_FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
]
DEFAULT_FONT_PATH = next((p for p in _FONT_CANDIDATES if Path(p).exists()), None)
TITLE_FONT_PATH = DEFAULT_FONT_PATH


def run(tts_path: Path, cfg: Config, only_topic: int | None = None) -> dict:
    tts: TTSResult = TTSResult.model_validate_json(tts_path.read_text(encoding="utf-8"))
    pdir = tts_path.resolve().parent
    compose_dir = pdir / "compose"
    compose_dir.mkdir(exist_ok=True)

    images_map, cover_map = _load_images_map(pdir / "images.json", cfg.out_dir)

    videos = []
    for script in tts.scripts:
        if only_topic is not None and script.topic_index != only_topic:
            continue
        script_dir = compose_dir / str(script.topic_index)
        script_dir.mkdir(exist_ok=True)

        shot_imgs = images_map.get(script.topic_index, {})
        cover_img = cover_map.get(script.topic_index)
        images = _render_subtitle_images(
            script_dir, script.title, script.lines, shot_imgs, cfg.profile.compose
        )
        durations = _line_durations(script_dir)
        intro_duration = cfg.intro.duration if cfg.intro.enabled else 0.0
        # 有封面口播 TTS 时：封面帧时长 = cover 时长，音频无延迟（开头即封面口播）
        # 无封面口播（老数据）：封面静默 cfg.intro.duration 秒，正文 TTS 延后
        has_cover_audio = bool(script.cover_audio_path) and script.cover_duration > 0
        audio_delay = 0.0 if has_cover_audio else intro_duration
        if has_cover_audio:
            intro_duration = script.cover_duration
        intro_image = None
        if intro_duration > 0:
            intro_image = _render_intro_image(script_dir, script.title, cover_img, cfg.profile.compose)
            images.insert(0, intro_image)
            durations.insert(0, intro_duration)
        mp4_path = compose_dir / f"{script.topic_index}.mp4"
        audio_path = cfg.out_dir / script.full_audio_path
        _render_video(script_dir, images, durations, audio_path, mp4_path, audio_delay)

        # 清理中间 PNG
        for img in images:
            img.unlink(missing_ok=True)

        videos.append({
            "topic_index": script.topic_index,
            "title": script.title,
            "path": str(mp4_path.relative_to(cfg.out_dir)),
            "duration": script.total_duration + intro_duration,
            "intro_duration": intro_duration,
        })

    # 合并已存在的 compose.json（仅单题重跑时保留其他）
    compose_json_path = pdir / "compose.json"
    if compose_json_path.exists() and only_topic is not None:
        existing = json.loads(compose_json_path.read_text(encoding="utf-8"))
        vmap = {v["topic_index"]: v for v in existing.get("videos", [])}
        for v in videos:
            vmap[v["topic_index"]] = v
        videos = list(vmap.values())
    result = {"video_id": tts.video_id, "videos": videos}
    compose_json_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return result


def _load_images_map(path: Path, out_dir: Path) -> tuple[dict[int, dict[int, str]], dict[int, str]]:
    """读 images.json，返回 shot 图和封面图。

    image_path 形如 "<vid>/images/4/shot_000.jpg" 或
    "<vid>/<version>/images/4/shot_000.jpg"，统一相对 cfg.out_dir。
    """
    if not path.exists():
        return {}, {}
    data = json.loads(path.read_text(encoding="utf-8"))
    result: dict[int, dict[int, str]] = {}
    covers: dict[int, str] = {}
    for topic in data:
        ti = topic["topic_index"]
        result[ti] = {}
        cover = topic.get("cover") or {}
        if cover.get("image_path"):
            covers[ti] = str(out_dir / cover["image_path"])
        for shot in topic.get("shots", []):
            result[ti][shot["shot_index"]] = str(out_dir / shot["image_path"])
    return result, covers


def _render_subtitle_images(
    script_dir: Path,
    title: str,
    lines,
    shot_imgs: dict[int, str],
    style: ComposeProfile,
) -> list[Path]:
    """每句生成一张 1080x1920 PNG：可选配图背景 + 顶部标题条 + 居中字幕 + 底部进度条。"""
    if DEFAULT_FONT_PATH is None:
        raise RuntimeError("找不到可用的 CJK 字体，请安装 PingFang/STHeiti/Hiragino 之一")
    font = ImageFont.truetype(DEFAULT_FONT_PATH, style.subtitle_font_size)
    title_font = ImageFont.truetype(TITLE_FONT_PATH, style.title_font_size)

    paths = []
    n = len(lines)
    for i, line in enumerate(lines):
        bg_path = shot_imgs.get(i)
        if bg_path and Path(bg_path).exists():
            try:
                bg = Image.open(bg_path).convert("RGB")
                img = _cover_crop(bg, style.video_w, style.video_h)
            except Exception:
                img = Image.new("RGB", (style.video_w, style.video_h), style.bg_color)
        else:
            img = Image.new("RGB", (style.video_w, style.video_h), style.bg_color)

        # 半透明遮罩层（顶部标题条 + 字幕区横带，跟随居中偏上的字幕位置）
        overlay = Image.new("RGBA", (style.video_w, style.video_h), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        od.rectangle(
            [0, 0, style.video_w, style.top_bar_height],
            fill=(0, 0, 0, style.top_bar_alpha),
        )
        sub_center_y = int(style.video_h * style.subtitle_center_ratio)
        od.rectangle(
            [
                0,
                sub_center_y - style.subtitle_overlay_half_height,
                style.video_w,
                sub_center_y + style.subtitle_overlay_half_height,
            ],
            fill=(0, 0, 0, style.bottom_overlay_alpha),
        )
        # 顶部渐变（让标题条边缘更柔和）
        gradient_end = style.top_bar_height + style.top_gradient_height
        for y in range(style.top_bar_height, gradient_end):
            alpha = int(style.top_bar_alpha * (1 - (y - style.top_bar_height) / style.top_gradient_height))
            od.rectangle([0, y, style.video_w, y + 1], fill=(0, 0, 0, alpha))
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
        draw = ImageDraw.Draw(img)

        # 顶部标题
        max_title_width = style.video_w - 2 * style.text_side_margin
        wrapped_title = _wrap_text(title, style.max_chars_per_line, title_font, max_title_width)
        title_line_height = style.title_font_size + 8
        title_start_y = style.content_title_y
        for j, tline in enumerate(wrapped_title):
            tw = draw.textlength(tline, font=title_font)
            draw.text(
                ((style.video_w - tw) / 2, title_start_y + j * title_line_height),
                tline,
                font=title_font,
                fill=style.title_color,
                stroke_width=2,
                stroke_fill=style.stroke_color,
            )

        # 字幕正文
        max_line_width = style.video_w - 2 * style.text_side_margin
        wrapped = _wrap_text(line.text, style.max_chars_per_line, font, max_line_width)
        line_height = style.subtitle_font_size + 20
        total_h = len(wrapped) * line_height
        start_y = int(style.video_h * style.subtitle_center_ratio) - total_h // 2
        center_x = int(style.video_w * style.subtitle_center_x_ratio)
        for j, text_line in enumerate(wrapped):
            lw = draw.textlength(text_line, font=font)
            draw.text(
                (center_x - lw / 2, start_y + j * line_height),
                text_line,
                font=font,
                fill=style.text_color,
                stroke_width=4,
                stroke_fill=style.stroke_color,
            )

        # 进度条
        if style.progress_bar_enabled:
            progress = (i + 1) / n
            bar_w = int(style.video_w * style.progress_bar_width_ratio)
            bar_x = (style.video_w - bar_w) // 2
            bar_y = int(style.video_h * style.progress_bar_ratio)
            draw.rounded_rectangle(
                [bar_x, bar_y, bar_x + bar_w, bar_y + 8],
                radius=4,
                fill=style.progress_bg_color,
            )
            draw.rounded_rectangle(
                [bar_x, bar_y, bar_x + int(bar_w * progress), bar_y + 8],
                radius=4,
                fill=style.progress_fg_color,
            )

        out = script_dir / f"img_{i:03d}.png"
        img.save(out, "PNG")
        paths.append(out)
    return paths


def _render_intro_image(
    script_dir: Path,
    title: str,
    cover_img: str | None,
    style: ComposeProfile,
) -> Path:
    """生成视频开头封面：大标题 + 竖图背景，停留时长由 profile [intro] 控制。"""
    if DEFAULT_FONT_PATH is None:
        raise RuntimeError("找不到可用的 CJK 字体，请安装 PingFang/STHeiti/Hiragino 之一")
    if cover_img and Path(cover_img).exists():
        try:
            bg = Image.open(cover_img).convert("RGB")
            img = _cover_crop(bg, style.video_w, style.video_h)
        except Exception:
            img = Image.new("RGB", (style.video_w, style.video_h), style.bg_color)
    else:
        img = Image.new("RGB", (style.video_w, style.video_h), style.bg_color)

    overlay = Image.new("RGBA", (style.video_w, style.video_h), (0, 0, 0, style.cover_overlay_alpha))
    od = ImageDraw.Draw(overlay)
    od.rectangle([0, 0, style.video_w, style.video_h], fill=(0, 0, 0, style.cover_overlay_alpha))
    # 标题区横带遮罩，跟随居中偏上的标题位置
    title_center_y = int(style.video_h * style.cover_title_center_ratio)
    od.rectangle(
        [
            0,
            title_center_y - style.cover_title_overlay_half_height,
            style.video_w,
            title_center_y + style.cover_title_overlay_half_height,
        ],
        fill=(0, 0, 0, style.cover_title_overlay_alpha),
    )
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    brand_font = ImageFont.truetype(DEFAULT_FONT_PATH, style.cover_brand_font_size)
    title_font = ImageFont.truetype(DEFAULT_FONT_PATH, style.cover_title_font_size)

    draw.text(
        (72, style.cover_brand_y),
        style.brand,
        font=brand_font,
        fill=style.cover_brand_color,
        stroke_width=2,
        stroke_fill=style.stroke_color,
    )

    wrapped = _wrap_text(
        title,
        style.cover_max_chars_per_line,
        title_font,
        style.video_w - 2 * style.text_side_margin,
    )
    line_height = style.cover_title_font_size + 18
    total_h = len(wrapped) * line_height
    start_y = title_center_y - total_h // 2
    center_x = int(style.video_w * style.cover_title_center_x_ratio)
    for i, text_line in enumerate(wrapped):
        tw = draw.textlength(text_line, font=title_font)
        draw.text(
            (center_x - tw / 2, start_y + i * line_height),
            text_line,
            font=title_font,
            fill=style.cover_title_color,
            stroke_width=5,
            stroke_fill=style.stroke_color,
        )

    out = script_dir / "intro.png"
    img.save(out, "PNG")
    return out


def _cover_crop(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """等比放大裁剪到 target_w x target_h（cover 模式）。"""
    src_w, src_h = img.size
    scale = max(target_w / src_w, target_h / src_h)
    new_w = int(src_w * scale)
    new_h = int(src_h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - target_w) // 2
    top = (new_h - target_h) // 2
    return img.crop((left, top, left + target_w, top + target_h))


def _wrap_text(text: str, max_chars: int, font=None, max_width: int | None = None) -> list[str]:
    """中文按字符数硬换行；若提供 font + max_width，则按像素宽度兜底换行，
    保证两侧至少留出 (video_w - max_width) / 2 的边距。保留显式 \\n。"""
    lines = []
    for seg in text.split("\n"):
        cur = ""
        for ch in seg:
            cand = cur + ch
            too_long = len(cand) > max_chars
            if not too_long and font is not None and max_width is not None:
                too_long = too_long or draw_textlength(font, cand) > max_width
            if too_long:
                if cur:
                    lines.append(cur)
                cur = ch
            else:
                cur = cand
        if cur:
            lines.append(cur)
    return lines or [""]


def draw_textlength(font, text: str) -> float:
    """PIL font 在不绑定 draw 时也能测宽度（ImageFont 9+ 支持）。"""
    try:
        return font.getlength(text)
    except AttributeError:
        from PIL import Image, ImageDraw
        tmp = Image.new("RGB", (10, 10))
        return ImageDraw.Draw(tmp).textlength(text, font=font)


def _render_video(
    script_dir: Path,
    images: list[Path],
    durations: list[float],
    audio_path: Path,
    out_path: Path,
    audio_delay: float,
) -> None:
    """用 ffmpeg concat demuxer 按 TTS 实际时长拼 PNG → MP4。"""
    list_file = script_dir / "concat_list.txt"
    lines_text = []
    for img, duration in zip(images, durations, strict=False):
        lines_text.append(f"file '{img.name}'")
        lines_text.append(f"duration {duration:.3f}")
    if images:
        lines_text.append(f"file '{images[-1].name}'")
    list_file.write_text("\n".join(lines_text), encoding="utf-8")

    audio_args = []
    delay_ms = int(audio_delay * 1000)
    if delay_ms > 0:
        audio_args = ["-af", f"adelay={delay_ms}:all=1"]
    total_duration = sum(durations)

    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", str(list_file),
            "-i", str(audio_path),
            "-c:v", "libx264", "-preset", "medium", "-crf", "23",
            "-vf", "fps=30,format=yuv420p",
            *audio_args,
            "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
            "-movflags", "+faststart",
            "-t", f"{total_duration:.3f}",
            "-shortest",
            str(out_path),
        ],
        check=True, capture_output=True,
    )
    list_file.unlink(missing_ok=True)


def _line_durations(script_dir: Path) -> list[float]:
    """从 tts.json 读回每行的实际时长。"""
    tts_path = script_dir.parent.parent / "tts.json"
    tts = json.loads(tts_path.read_text(encoding="utf-8"))
    topic_index = int(script_dir.name)
    for s in tts["scripts"]:
        if s["topic_index"] == topic_index:
            return [line["duration"] for line in s["lines"]]
    return []
