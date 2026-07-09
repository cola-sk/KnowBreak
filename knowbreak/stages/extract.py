"""阶段 2：知识点提取。

输入：Transcript JSON
输出：Knowledge JSON
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from ..config import Config
from ..llm import LLM
from ..models import Knowledge, Transcript
from ._common import save_json


class _ExtractSchema(BaseModel):
    title: str
    domain: str | None = None
    points: list[dict]


def run(transcript_path: Path, cfg: Config) -> Knowledge:
    transcript = Transcript.model_validate_json(transcript_path.read_text(encoding="utf-8"))
    full_text = _render_transcript(transcript)
    llm = LLM(cfg.llm)
    schema = llm.chat_json(
        cfg.profile.require_prompt("extract_system"),
        f"视频逐字稿（duration={transcript.duration}s）：\n\n{full_text}",
        _ExtractSchema,
        temperature=cfg.profile.generation.extract_temperature,
    )
    knowledge = Knowledge(
        video_id=transcript.video_id,
        title=schema.title,
        domain=schema.domain,
        points=schema.points,  # type: ignore[arg-type]
    )
    pdir = transcript_path.parent
    save_json(knowledge, pdir / "knowledge.json")
    return knowledge


def _render_transcript(t: Transcript) -> str:
    lines = []
    for seg in t.segments:
        mm, ss = divmod(int(seg.start), 60)
        lines.append(f"[{mm:02d}:{ss:02d}] {seg.text}")
    return "\n".join(lines)
