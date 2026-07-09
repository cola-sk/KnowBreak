"""阶段 2b：按原视频结构洗稿改写。

输入：Transcript JSON
输出：Scripts JSON（单条原创口播脚本）
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from ..config import Config
from ..llm import LLM
from ..models import Script, ScriptLine, Scripts, Transcript
from ._common import save_json


class _LineItem(BaseModel):
    text: str
    estimated_seconds: float


class _RewriteSchema(BaseModel):
    title: str
    lines: list[_LineItem]
    hashtags: list[str] = []


def run(transcript_path: Path, cfg: Config) -> Scripts:
    transcript = Transcript.model_validate_json(transcript_path.read_text(encoding="utf-8"))
    transcript_blob = _render_transcript(transcript)
    llm = LLM(cfg.llm)
    schema = llm.chat_json(
        cfg.profile.require_prompt("rewrite_system"),
        f"视频逐字稿（duration={transcript.duration}s）：\n\n{transcript_blob}",
        _RewriteSchema,
        temperature=cfg.profile.generation.rewrite_temperature,
    )
    total = sum(line.estimated_seconds for line in schema.lines)
    scripts = Scripts(
        video_id=transcript.video_id,
        scripts=[
            Script(
                topic_index=0,
                title=schema.title,
                lines=[
                    ScriptLine(text=line.text, estimated_seconds=line.estimated_seconds)
                    for line in schema.lines
                ],
                total_duration=total,
                hashtags=schema.hashtags,
            )
        ],
    )
    save_json(scripts, transcript_path.parent / "scripts.json")
    return scripts


def _render_transcript(t: Transcript) -> str:
    lines = []
    for seg in t.segments:
        mm, ss = divmod(int(seg.start), 60)
        lines.append(f"[{mm:02d}:{ss:02d}] {seg.text}")
    return "\n".join(lines)
