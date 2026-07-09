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


def run(transcript_path: Path, cfg: Config, *, prompt: str | None = None) -> Scripts:
    transcript = Transcript.model_validate_json(transcript_path.read_text(encoding="utf-8"))
    transcript_blob = _render_transcript(transcript)
    duration_min = cfg.profile.rewrite.target_duration_min
    duration_max = cfg.profile.rewrite.target_duration_max
    chars_per_second = cfg.profile.rewrite.spoken_chars_per_second
    target_chars_min = int(duration_min * chars_per_second)
    target_chars_max = int(duration_max * chars_per_second)
    system_prompt = prompt or cfg.profile.require_prompt("rewrite_system")
    llm = LLM(cfg.llm)
    retry_feedback: str | None = None
    schema: _RewriteSchema | None = None
    total = 0.0
    total_chars = 0
    for _ in range(2):
        schema = llm.chat_json(
            system_prompt,
            _build_user_prompt(
                transcript.duration,
                duration_min,
                duration_max,
                target_chars_min,
                target_chars_max,
                transcript_blob,
                retry_feedback,
            ),
            _RewriteSchema,
            temperature=cfg.profile.generation.rewrite_temperature,
        )
        total = sum(line.estimated_seconds for line in schema.lines)
        total_chars = sum(len(line.text) for line in schema.lines)
        if total_chars <= target_chars_max * 1.15 and total <= duration_max * 1.2:
            break
        retry_feedback = (
            f"上一次输出过长：{total_chars} 字、estimated_seconds={total:.1f}s。"
            f"请在不改变原结构和关键知识点顺序的前提下，压缩到 {target_chars_max} 字以内，"
            "只保留每个论证环节的最关键一句。"
        )
    else:
        raise RuntimeError(
            f"rewrite 阶段输出过长：{total_chars} 字、{total:.1f}s。"
            "请调整 prompts/rewrite.md 或 profile.toml 的 [rewrite] 目标时长后重跑。"
        )
    if schema is None:
        raise RuntimeError("rewrite 阶段没有返回脚本")
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


def _build_user_prompt(
    transcript_duration: float,
    duration_min: int,
    duration_max: int,
    target_chars_min: int,
    target_chars_max: int,
    transcript_blob: str,
    retry_feedback: str | None,
) -> str:
    feedback = f"\n二次压缩要求：{retry_feedback}\n" if retry_feedback else ""
    return (
        f"视频逐字稿（duration={transcript_duration}s）：\n"
        f"目标成片口播时长：{duration_min}-{duration_max} 秒\n"
        f"建议口播正文总字数：{target_chars_min}-{target_chars_max} 个中文字符\n"
        "建议句数：15-20 句，每句只表达一个信息点\n"
        "要求：保留原视频结构和知识点顺序，但必须压缩重复表达，输出一条适合短视频的脚本。"
        f"{feedback}\n"
        f"{transcript_blob}"
    )
