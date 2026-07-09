"""阶段 1：转写。

输入：视频 URL 或本地文件路径
输出：Transcript JSON
"""

from __future__ import annotations

import html
import json
import re
import subprocess
from pathlib import Path

from openai import OpenAI

from ..config import Config
from ..models import Transcript, TranscriptSegment
from ._common import project_dir, save_json, video_id_from_source

SUBTITLE_EXTENSIONS = {".srt", ".vtt", ".ass"}
SUBTITLE_LANGS = "zh-Hans,zh-CN,zh-Hant,zh,en"


def run(
    source: str,
    cfg: Config,
    pdir: Path | None = None,
    source_cache_dir: Path | None = None,
) -> Transcript:
    video_id = video_id_from_source(source)
    pdir = pdir or project_dir(cfg.out_dir, video_id)

    subtitle_path = _find_or_fetch_subtitle(source, pdir, cfg)
    subtitle_segments = _parse_subtitle(subtitle_path) if subtitle_path else []
    if subtitle_segments:
        segments = subtitle_segments
        method = "subtitle"
        transcript_source = str(subtitle_path)
    else:
        audio_path = _ensure_audio(source, pdir, cfg, source_cache_dir=source_cache_dir)
        segments = _transcribe(audio_path, cfg)
        method = "asr"
        transcript_source = str(audio_path)

    duration = segments[-1].end if segments else 0.0
    transcript = Transcript(
        video_id=video_id,
        source=source,
        duration=duration,
        language="zh",
        method=method,
        transcript_source=transcript_source,
        segments=segments,
    )
    save_json(transcript, pdir / "transcript.json")
    return transcript


def _find_or_fetch_subtitle(source: str, pdir: Path, cfg: Config) -> Path | None:
    """优先返回可解析的字幕文件；URL 会尝试下载字幕轨。"""
    subtitle_path = _find_local_subtitle(source)
    if subtitle_path:
        return subtitle_path

    if source.startswith(("http://", "https://")):
        _download_subtitles(source, pdir, cfg)
        return _best_subtitle_candidate(pdir)

    return None


def _find_local_subtitle(source: str) -> Path | None:
    path = Path(source)
    if path.suffix.lower() in SUBTITLE_EXTENSIONS and path.exists():
        return path

    if not path.exists():
        return None

    candidates: list[Path] = []
    candidates.extend(path.with_suffix(ext) for ext in SUBTITLE_EXTENSIONS)
    for ext in SUBTITLE_EXTENSIONS:
        candidates.extend(path.parent.glob(f"{path.stem}.*{ext}"))

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _download_subtitles(source: str, pdir: Path, cfg: Config) -> None:
    subprocess.run(
        [
            "yt-dlp",
            *_cookies_args(cfg),
            "--remote-components",
            "ejs:github",
            "--skip-download",
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs",
            SUBTITLE_LANGS,
            "--sub-format",
            "vtt/srt/best",
            "-o",
            str(pdir / "subtitle"),
            source,
        ],
        check=False,
        capture_output=True,
        text=True,
    )


def _cookies_args(cfg: Config) -> list[str]:
    if cfg.cookies_file:
        return ["--cookies", str(cfg.cookies_file)]
    if cfg.cookies_browser:
        return ["--cookies-from-browser", cfg.cookies_browser]
    return []


def _best_subtitle_candidate(pdir: Path) -> Path | None:
    candidates = [
        p
        for p in pdir.iterdir()
        if p.is_file() and p.suffix.lower() in SUBTITLE_EXTENSIONS
    ]
    if not candidates:
        return None

    def score(path: Path) -> tuple[int, str]:
        name = path.name.lower()
        if "zh-hans" in name or "zh-cn" in name:
            return (0, name)
        if "zh-hant" in name or "zh" in name:
            return (1, name)
        if "en" in name:
            return (2, name)
        return (3, name)

    return sorted(candidates, key=score)[0]


def _ensure_audio(
    source: str,
    pdir: Path,
    cfg: Config,
    source_cache_dir: Path | None = None,
) -> Path:
    """返回 16kHz 单声道 wav 路径。"""
    raw_dir = source_cache_dir or pdir
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw = raw_dir / "source.mp4"
    wav = pdir / "audio.wav"

    if not raw.exists():
        if source.startswith(("http://", "https://")):
            subprocess.run(
                [
                    "yt-dlp",
                    *_cookies_args(cfg),
                    "--remote-components",
                    "ejs:github",
                    "-f",
                    "ba",
                    "-o",
                    str(raw),
                    source,
                ],
                check=True,
            )
        else:
            raw = Path(source)

    if not wav.exists():
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(raw),
                "-vn", "-ac", "1", "-ar", "16000",
                "-f", "wav", str(wav),
            ],
            check=True,
        )
    return wav


def _transcribe(wav: Path, cfg: Config) -> list[TranscriptSegment]:
    if cfg.asr.provider == "openai":
        return _transcribe_openai(wav, cfg)
    if cfg.asr.provider == "local":
        return _transcribe_local(wav, cfg)
    raise ValueError(f"未知 ASR provider: {cfg.asr.provider}")


def _transcribe_openai(wav: Path, cfg: Config) -> list[TranscriptSegment]:
    client_kwargs = {}
    if cfg.asr.base_url:
        client_kwargs["base_url"] = cfg.asr.base_url
    if cfg.asr.api_key:
        client_kwargs["api_key"] = cfg.asr.api_key
    client = OpenAI(**client_kwargs)

    duration = _probe_duration(wav)
    # 单块上限 5 分钟（16kHz mono 16-bit ≈ 9.6MB，远低于 25MB 限制）
    chunk_seconds = 300.0
    n_chunks = max(1, int(duration // chunk_seconds) + (1 if duration % chunk_seconds > 0 else 0))

    all_segments: list[TranscriptSegment] = []
    for i in range(n_chunks):
        offset = i * chunk_seconds
        chunk_path = wav.parent / f"chunk_{i:03d}.wav"
        chunk_dur = min(chunk_seconds, duration - offset) if duration else chunk_seconds
        _extract_chunk(wav, chunk_path, offset, chunk_dur)
        if chunk_path.stat().st_size == 0:
            continue
        segs = _transcribe_one_chunk(client, cfg.asr.model, chunk_path, offset, chunk_dur)
        all_segments.extend(segs)
        chunk_path.unlink(missing_ok=True)
    return all_segments


def _transcribe_one_chunk(client, model: str, chunk_path: Path, offset: float, chunk_dur: float) -> list[TranscriptSegment]:
    """转写单个分块，优先 verbose_json，400 时回退到 text。"""
    try:
        with open(chunk_path, "rb") as f:
            resp = client.audio.transcriptions.create(
                model=model,
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )
        segs = []
        for s in getattr(resp, "segments", []) or []:
            segs.append(TranscriptSegment(
                start=offset + s.start,
                end=offset + s.end,
                text=_clean_asr_text(s.text),
            ))
        if segs:
            return segs
    except Exception as e:
        if "400" not in str(e) and "BadRequest" not in str(e):
            raise
    # 回退：text 格式，整块作为一个 segment
    with open(chunk_path, "rb") as f:
        text = _clean_asr_text(
            client.audio.transcriptions.create(model=model, file=f, response_format="text") or ""
        ).strip()
    return [TranscriptSegment(start=offset, end=offset + chunk_dur, text=text)] if text else []


_ASR_TAG_RE = re.compile(r"</?asr_text>", re.IGNORECASE)
_ASR_LANG_RE = re.compile(r"language\s+[A-Za-z_]+", re.IGNORECASE)


def _clean_asr_text(text: str) -> str:
    """清理 ASR 输出里的标签垃圾。

    qwen3-asr 的 text 响应格式实际返回 JSON 字符串：
      {"text":"language Chinese<asr_text>正文</asr_text>","usage":{"seconds":300}}
    需要三层清理：JSON 外壳、<asr_text> 标签、散落的 `language X` 标记。
    """
    if not text:
        return text
    out = text.strip()
    # 1) 解 JSON 外壳，提取 text 字段
    if out.startswith("{"):
        try:
            obj = json.loads(out)
            if isinstance(obj, dict) and "text" in obj:
                out = obj["text"]
        except json.JSONDecodeError:
            pass
    # 2) 去 <asr_text> / </asr_text> 标签
    out = _ASR_TAG_RE.sub("", out)
    # 3) 去散落的 `language Chinese` 等标记
    out = _ASR_LANG_RE.sub("", out)
    return out.strip()


def _extract_chunk(src: Path, dst: Path, offset: float, duration: float) -> None:
    """从 src 提取 [offset, offset+duration] 区间到 dst。"""
    subprocess.run(
        [
            "ffmpeg", "-y", "-ss", str(offset), "-t", str(duration),
            "-i", str(src),
            "-vn", "-ac", "1", "-ar", "16000",
            "-f", "wav", str(dst),
        ],
        check=True, capture_output=True,
    )


def _probe_duration(wav: Path) -> float:
    """用 ffprobe 取音频时长（秒）。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(wav)],
            check=True, capture_output=True, text=True,
        )
        return float(out.stdout.strip())
    except Exception:
        return 0.0


def _transcribe_local(wav: Path, cfg: Config) -> list[TranscriptSegment]:
    from faster_whisper import WhisperModel

    model = WhisperModel(cfg.asr.local_model, device=cfg.asr.local_device, compute_type="int8")
    segs_gen, _ = model.transcribe(str(wav), language="zh", vad_filter=True)
    return [TranscriptSegment(start=s.start, end=s.end, text=s.text.strip()) for s in segs_gen]


def _parse_subtitle(path: Path) -> list[TranscriptSegment]:
    suffix = path.suffix.lower()
    if suffix == ".ass":
        return _parse_ass(path)
    return _parse_srt_or_vtt(path)


def _parse_srt_or_vtt(path: Path) -> list[TranscriptSegment]:
    text = path.read_text(encoding="utf-8-sig", errors="ignore")
    blocks = re.split(r"\n\s*\n", text.replace("\r\n", "\n").replace("\r", "\n"))
    segments: list[TranscriptSegment] = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines or lines[0].upper().startswith(("WEBVTT", "NOTE", "STYLE")):
            continue

        timing_index = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if timing_index is None:
            continue

        start_text, end_text = lines[timing_index].split("-->", 1)
        start = _parse_timestamp(start_text)
        end = _parse_timestamp(end_text.split()[0])
        caption = _clean_caption(" ".join(lines[timing_index + 1 :]))
        if caption and end > start:
            segments.append(TranscriptSegment(start=start, end=end, text=caption))
    return _merge_duplicate_segments(segments)


def _parse_ass(path: Path) -> list[TranscriptSegment]:
    text = path.read_text(encoding="utf-8-sig", errors="ignore")
    format_fields: list[str] | None = None
    segments: list[TranscriptSegment] = []
    in_events = False

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line == "[Events]":
            in_events = True
            continue
        if not in_events:
            continue
        if line.startswith("Format:"):
            format_fields = [field.strip().lower() for field in line[7:].split(",")]
            continue
        if not line.startswith("Dialogue:") or not format_fields:
            continue

        values = line[9:].split(",", len(format_fields) - 1)
        if len(values) != len(format_fields):
            continue
        data = dict(zip(format_fields, values, strict=False))
        start = _parse_timestamp(data.get("start", ""))
        end = _parse_timestamp(data.get("end", ""))
        caption = _clean_caption(data.get("text", "").replace("\\N", " "))
        if caption and end > start:
            segments.append(TranscriptSegment(start=start, end=end, text=caption))
    return _merge_duplicate_segments(segments)


def _parse_timestamp(value: str) -> float:
    cleaned = value.strip().replace(",", ".")
    match = re.search(r"(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)", cleaned)
    if not match:
        return 0.0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2))
    seconds = float(match.group(3))
    return hours * 3600 + minutes * 60 + seconds


def _clean_caption(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\{[^}]*}", "", text)
    text = text.replace("\\N", " ").replace("\\n", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _merge_duplicate_segments(segments: list[TranscriptSegment]) -> list[TranscriptSegment]:
    merged: list[TranscriptSegment] = []
    for segment in segments:
        if merged and segment.text == merged[-1].text and segment.start <= merged[-1].end + 0.1:
            merged[-1] = merged[-1].model_copy(update={"end": max(merged[-1].end, segment.end)})
            continue
        merged.append(segment)
    return merged
