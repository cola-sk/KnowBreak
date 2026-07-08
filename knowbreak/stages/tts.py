"""阶段 7：TTS 配音。

输入：scripts.json
输出：每个选题每句一个 mp3 + 拼接后的完整 mp3 + tts.json

用 edge-tts（免费，无需 API key），中文音色默认 zh-CN-XiaoxiaoNeural。
"""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

from ..config import Config
from ..models import Scripts, TTSLine, TTSResult, TTSScript
from ._common import project_dir, save_json


def run(scripts_path: Path, cfg: Config) -> TTSResult:
    scripts: Scripts = Scripts.model_validate_json(scripts_path.read_text(encoding="utf-8"))
    pdir = project_dir(cfg.out_dir, scripts.video_id)
    tts_dir = pdir / "tts"
    tts_dir.mkdir(exist_ok=True)

    result_scripts: list[TTSScript] = []
    for script in scripts.scripts:
        script_dir = tts_dir / str(script.topic_index)
        script_dir.mkdir(exist_ok=True)

        line_audios: list[TTSLine] = []
        for i, line in enumerate(script.lines):
            mp3 = script_dir / f"line_{i:03d}.mp3"
            asyncio.run(_synth(line.text, mp3, cfg))
            dur = _probe_duration(mp3)
            line_audios.append(TTSLine(
                index=i,
                text=line.text,
                audio_path=str(mp3.relative_to(cfg.out_dir)),
                duration=dur,
            ))

        full_mp3 = script_dir / "full.mp3"
        _concat_mp3([la.audio_path for la in line_audios], full_mp3, cfg.out_dir)
        full_dur = _probe_duration(full_mp3)

        result_scripts.append(TTSScript(
            topic_index=script.topic_index,
            title=script.title,
            lines=line_audios,
            full_audio_path=str(full_mp3.relative_to(cfg.out_dir)),
            total_duration=full_dur,
        ))

    result = TTSResult(video_id=scripts.video_id, scripts=result_scripts)
    save_json(result, pdir / "tts.json")
    return result


async def _synth(text: str, out_path: Path, cfg: Config) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(
        text,
        voice=cfg.tts.voice,
        rate=cfg.tts.rate,
        volume=cfg.tts.volume,
    )
    await communicate.save(str(out_path))


def _probe_duration(mp3: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(mp3)],
        check=True, capture_output=True, text=True,
    )
    return float(out.stdout.strip())


def _concat_mp3(rel_paths: list[str], out_path: Path, out_dir: Path) -> None:
    """用 ffmpeg concat demuxer 拼接 mp3。"""
    list_file = out_path.parent / "concat_list.txt"
    list_file.write_text(
        "\n".join(f"file '{(out_dir / p).resolve()}'" for p in rel_paths),
        encoding="utf-8",
    )
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
         "-i", str(list_file), "-c", "copy", str(out_path)],
        check=True, capture_output=True,
    )
    list_file.unlink(missing_ok=True)
