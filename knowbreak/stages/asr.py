"""阶段 1：语音转写（ASR）。

输入：视频 URL 或本地文件路径
输出：Transcript JSON
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from openai import OpenAI

from ..config import Config
from ..models import Transcript, TranscriptSegment
from ._common import project_dir, save_json, video_id_from_source


def run(source: str, cfg: Config) -> Transcript:
    video_id = video_id_from_source(source)
    pdir = project_dir(cfg.out_dir, video_id)

    audio_path = _ensure_audio(source, pdir, cfg)
    segments = _transcribe(audio_path, cfg)
    duration = segments[-1].end if segments else 0.0
    transcript = Transcript(
        video_id=video_id,
        source=source,
        duration=duration,
        language="zh",
        segments=segments,
    )
    save_json(transcript, pdir / "transcript.json")
    return transcript


def _ensure_audio(source: str, pdir: Path, cfg: Config) -> Path:
    """返回 16kHz 单声道 wav 路径。"""
    raw = pdir / "source.mp4"
    wav = pdir / "audio.wav"

    if not raw.exists():
        if source.startswith(("http://", "https://")):
            subprocess.run(
                ["yt-dlp", "-f", "ba", "-o", str(raw), source],
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
    client = OpenAI()
    with open(wav, "rb") as f:
        resp = client.audio.transcriptions.create(
            model=cfg.asr.model,
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
        )
    segs = []
    for s in getattr(resp, "segments", []) or []:
        segs.append(TranscriptSegment(start=s.start, end=s.end, text=s.text))
    return segs


def _transcribe_local(wav: Path, cfg: Config) -> list[TranscriptSegment]:
    from faster_whisper import WhisperModel

    model = WhisperModel(cfg.asr.local_model, device=cfg.asr.local_device, compute_type="int8")
    segs_gen, _ = model.transcribe(str(wav), language="zh", vad_filter=True)
    return [TranscriptSegment(start=s.start, end=s.end, text=s.text.strip()) for s in segs_gen]
