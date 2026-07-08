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
from ._common import project_dir, save_json


class _ExtractSchema(BaseModel):
    title: str
    domain: str | None = None
    points: list[dict]


_SYSTEM = """你是一个知识拆解助手。
你的任务：阅读一段视频逐字稿，提炼出 5-12 个独立、可单独讲清楚的知识点。

要求：
- 每个 point 必须包含字段：title(str), summary(str 一句话), key_statements(list[str]), examples(list[str]), source_excerpt(str 原文片段)
- title ≤ 20 字，要适合做科普选题
- summary 要让普通人能看懂
- key_statements 是这个知识点的核心论断，2-4 条
- source_excerpt 是逐字稿里支持该点的一段原文，便于后续追溯
- 不要把整段视频都塞进一个点；按知识点切分
"""


def run(transcript_path: Path, cfg: Config) -> Knowledge:
    transcript = Transcript.model_validate_json(transcript_path.read_text(encoding="utf-8"))
    full_text = _render_transcript(transcript)
    llm = LLM(cfg.llm)
    schema = llm.chat_json(
        _SYSTEM,
        f"视频逐字稿（duration={transcript.duration}s）：\n\n{full_text}",
        _ExtractSchema,
    )
    knowledge = Knowledge(
        video_id=transcript.video_id,
        title=schema.title,
        domain=schema.domain,
        points=schema.points,  # type: ignore[arg-type]
    )
    pdir = project_dir(cfg.out_dir, transcript.video_id)
    save_json(knowledge, pdir / "knowledge.json")
    return knowledge


def _render_transcript(t: Transcript) -> str:
    lines = []
    for seg in t.segments:
        mm, ss = divmod(int(seg.start), 60)
        lines.append(f"[{mm:02d}:{ss:02d}] {seg.text}")
    return "\n".join(lines)
