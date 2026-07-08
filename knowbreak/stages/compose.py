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
from ._common import project_dir

_FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
]
DEFAULT_FONT_PATH = next((p for p in _FONT_CANDIDATES if Path(p).exists()), None)
TITLE_FONT_PATH = DEFAULT_FONT_PATH

VIDEO_W = 1080
VIDEO_H = 1920
BG_COLOR = (14, 14, 18)  # 0x0E0E12 无图时背景
TITLE_COLOR = (220, 220, 224)
TEXT_COLOR = (255, 255, 255)
STROKE_COLOR = (0, 0, 0)

SUBTITLE_FONT_SIZE = 62
TITLE_FONT_SIZE = 38
COVER_TITLE_FONT_SIZE = 88
COVER_BRAND_FONT_SIZE = 36
MAX_CHARS_PER_LINE = 16  # 中文每行最多字符数，超出换行

# 遮罩透明度（0-255），越大字幕越清晰但背景越暗
TOP_BAR_ALPHA = 170      # 顶部标题条
BOTTOM_OVERLAY_ALPHA = 150  # 字幕区底部遮罩
COVER_OVERLAY_ALPHA = 120


def run(tts_path: Path, cfg: Config, only_topic: int | None = None) -> dict:
    tts: TTSResult = TTSResult.model_validate_json(tts_path.read_text(encoding="utf-8"))
    pdir = project_dir(cfg.out_dir, tts.video_id)
    compose_dir = pdir / "compose"
    compose_dir.mkdir(exist_ok=True)

    images_map, cover_map = _load_images_map(pdir / "images.json")

    videos = []
    for script in tts.scripts:
        if only_topic is not None and script.topic_index != only_topic:
            continue
        script_dir = compose_dir / str(script.topic_index)
        script_dir.mkdir(exist_ok=True)

        shot_imgs = images_map.get(script.topic_index, {})
        cover_img = cover_map.get(script.topic_index)
        images = _render_subtitle_images(
            script_dir, script.title, script.lines, shot_imgs, cfg.out_dir
        )
        durations = _line_durations(script_dir)
        intro_duration = cfg.intro.duration if cfg.intro.enabled else 0.0
        intro_image = None
        if intro_duration > 0:
            intro_image = _render_intro_image(script_dir, script.title, cover_img)
            images.insert(0, intro_image)
            durations.insert(0, intro_duration)
        mp4_path = compose_dir / f"{script.topic_index}.mp4"
        audio_path = cfg.out_dir / script.full_audio_path
        _render_video(script_dir, images, durations, audio_path, mp4_path, intro_duration)

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


def _load_images_map(path: Path) -> tuple[dict[int, dict[int, str]], dict[int, str]]:
    """读 images.json，返回 shot 图和封面图。

    images.json 位于 out/<vid>/images.json，image_path 形如
    "<vid>/images/4/shot_000.jpg"（相对 out_dir），故绝对路径 = path.parent.parent / image_path。
    """
    if not path.exists():
        return {}, {}
    data = json.loads(path.read_text(encoding="utf-8"))
    out_dir = path.parent.parent  # out/<vid>/images.json → out/
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


def _render_subtitle_images(script_dir: Path, title: str, lines,
                            shot_imgs: dict[int, str], out_dir: Path) -> list[Path]:
    """每句生成一张 1080x1920 PNG：可选配图背景 + 顶部标题条 + 居中字幕 + 底部进度条。"""
    if DEFAULT_FONT_PATH is None:
        raise RuntimeError("找不到可用的 CJK 字体，请安装 PingFang/STHeiti/Hiragino 之一")
    font = ImageFont.truetype(DEFAULT_FONT_PATH, SUBTITLE_FONT_SIZE)
    title_font = ImageFont.truetype(TITLE_FONT_PATH, TITLE_FONT_SIZE)

    paths = []
    n = len(lines)
    for i, line in enumerate(lines):
        bg_path = shot_imgs.get(i)
        if bg_path and Path(bg_path).exists():
            try:
                bg = Image.open(bg_path).convert("RGB")
                img = _cover_crop(bg, VIDEO_W, VIDEO_H)
            except Exception:
                img = Image.new("RGB", (VIDEO_W, VIDEO_H), BG_COLOR)
        else:
            img = Image.new("RGB", (VIDEO_W, VIDEO_H), BG_COLOR)

        # 半透明遮罩层（顶部标题条 + 底部字幕区）
        overlay = Image.new("RGBA", (VIDEO_W, VIDEO_H), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        od.rectangle([0, 0, VIDEO_W, 150], fill=(0, 0, 0, TOP_BAR_ALPHA))
        od.rectangle([0, VIDEO_H - 700, VIDEO_W, VIDEO_H],
                     fill=(0, 0, 0, BOTTOM_OVERLAY_ALPHA))
        # 顶部渐变（让标题条边缘更柔和）
        for y in range(150, 220):
            alpha = int(TOP_BAR_ALPHA * (1 - (y - 150) / 70))
            od.rectangle([0, y, VIDEO_W, y + 1], fill=(0, 0, 0, alpha))
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
        draw = ImageDraw.Draw(img)

        # 顶部标题
        tw = draw.textlength(title, font=title_font)
        draw.text(
            ((VIDEO_W - tw) / 2, 70), title,
            font=title_font, fill=TITLE_COLOR,
            stroke_width=2, stroke_fill=STROKE_COLOR,
        )

        # 字幕正文
        wrapped = _wrap_text(line.text, MAX_CHARS_PER_LINE)
        line_height = SUBTITLE_FONT_SIZE + 20
        total_h = len(wrapped) * line_height
        start_y = (VIDEO_H * 2) // 3 - total_h // 2
        for j, text_line in enumerate(wrapped):
            lw = draw.textlength(text_line, font=font)
            draw.text(
                ((VIDEO_W - lw) / 2, start_y + j * line_height),
                text_line, font=font, fill=TEXT_COLOR,
                stroke_width=4, stroke_fill=STROKE_COLOR,
            )

        # 底部进度条
        progress = (i + 1) / n
        bar_w = int(VIDEO_W * 0.6)
        bar_x = (VIDEO_W - bar_w) // 2
        bar_y = VIDEO_H - 120
        draw.rounded_rectangle(
            [bar_x, bar_y, bar_x + bar_w, bar_y + 8],
            radius=4, fill=(40, 40, 50),
        )
        draw.rounded_rectangle(
            [bar_x, bar_y, bar_x + int(bar_w * progress), bar_y + 8],
            radius=4, fill=(120, 160, 240),
        )

        out = script_dir / f"img_{i:03d}.png"
        img.save(out, "PNG")
        paths.append(out)
    return paths


def _render_intro_image(script_dir: Path, title: str, cover_img: str | None) -> Path:
    """生成视频开头 2 秒封面：大标题 + 竖图背景。"""
    if DEFAULT_FONT_PATH is None:
        raise RuntimeError("找不到可用的 CJK 字体，请安装 PingFang/STHeiti/Hiragino 之一")
    if cover_img and Path(cover_img).exists():
        try:
            bg = Image.open(cover_img).convert("RGB")
            img = _cover_crop(bg, VIDEO_W, VIDEO_H)
        except Exception:
            img = Image.new("RGB", (VIDEO_W, VIDEO_H), BG_COLOR)
    else:
        img = Image.new("RGB", (VIDEO_W, VIDEO_H), BG_COLOR)

    overlay = Image.new("RGBA", (VIDEO_W, VIDEO_H), (0, 0, 0, COVER_OVERLAY_ALPHA))
    od = ImageDraw.Draw(overlay)
    od.rectangle([0, 0, VIDEO_W, VIDEO_H], fill=(0, 0, 0, COVER_OVERLAY_ALPHA))
    od.rectangle([0, VIDEO_H - 620, VIDEO_W, VIDEO_H], fill=(0, 0, 0, 175))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    brand_font = ImageFont.truetype(DEFAULT_FONT_PATH, COVER_BRAND_FONT_SIZE)
    title_font = ImageFont.truetype(DEFAULT_FONT_PATH, COVER_TITLE_FONT_SIZE)

    brand = "知点拆解局"
    draw.text(
        (72, 96), brand,
        font=brand_font, fill=(235, 235, 238),
        stroke_width=2, stroke_fill=STROKE_COLOR,
    )

    wrapped = _wrap_text(title, 10)
    line_height = COVER_TITLE_FONT_SIZE + 18
    total_h = len(wrapped) * line_height
    start_y = VIDEO_H - 465 - total_h // 2
    for i, text_line in enumerate(wrapped):
        tw = draw.textlength(text_line, font=title_font)
        draw.text(
            ((VIDEO_W - tw) / 2, start_y + i * line_height),
            text_line,
            font=title_font,
            fill=(255, 255, 255),
            stroke_width=5,
            stroke_fill=STROKE_COLOR,
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


def _wrap_text(text: str, max_chars: int) -> list[str]:
    """中文按字符数硬换行；保留显式 \\n。"""
    lines = []
    for seg in text.split("\n"):
        while len(seg) > max_chars:
            lines.append(seg[:max_chars])
            seg = seg[max_chars:]
        if seg:
            lines.append(seg)
    return lines or [""]


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
