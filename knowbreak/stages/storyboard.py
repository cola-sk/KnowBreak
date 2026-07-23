"""阶段 5：画面分镜。

输入：Scripts JSON
输出：Storyboards JSON
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from ..config import Config
from ..llm import LLM
from ..models import ScriptLine, Scripts, Storyboard, Storyboards, StoryboardShot
from ._common import save_json


class _ShotItem(BaseModel):
    narration: str
    visual: str
    broll: str
    subtitle: str
    duration: float


class _StoryboardSchema(BaseModel):
    shots: list[_ShotItem]


def _align_generated_shots(lines: list[ScriptLine], shots: list[_ShotItem]) -> list[StoryboardShot]:
    """Force one storyboard shot per script line.

    LLMs sometimes add title-card shots or shift narration by one row. The pipeline
    composes by line index, so generated narration/duration must be treated as
    advisory and aligned back to scripts.json here.
    """
    aligned: list[StoryboardShot] = []
    cursor = 0
    used: set[int] = set()

    for index, line in enumerate(lines):
        line_text = line.text
        matched_index: int | None = None
        if line_text.strip():
            for candidate_index in range(cursor, len(shots)):
                if candidate_index in used:
                    continue
                if shots[candidate_index].narration.strip() == line_text.strip():
                    matched_index = candidate_index
                    break
        else:
            for candidate_index in range(cursor, len(shots)):
                if candidate_index in used:
                    continue
                candidate = shots[candidate_index]
                if not candidate.narration.strip() and candidate.subtitle.strip():
                    matched_index = candidate_index
                    break
            if matched_index is None:
                for candidate_index in range(cursor, len(shots)):
                    if candidate_index in used:
                        continue
                    if not shots[candidate_index].narration.strip():
                        matched_index = candidate_index
                        break

        if matched_index is None and index < len(shots) and index not in used:
            matched_index = index

        shot = shots[matched_index] if matched_index is not None else None
        if matched_index is not None:
            used.add(matched_index)
            cursor = max(cursor, matched_index + 1)

        narration = line_text
        subtitle = narration if narration.strip() else (shot.subtitle if shot else "")
        aligned.append(
            StoryboardShot(
                index=index,
                narration=narration,
                visual=shot.visual if shot else "",
                broll=shot.broll if shot else "",
                subtitle=subtitle,
                duration=line.estimated_seconds,
            )
        )

    return aligned


def run(scripts_path: Path, cfg: Config, *, prompt: str | None = None) -> Storyboards:
    scripts: Scripts = Scripts.model_validate_json(scripts_path.read_text(encoding="utf-8"))
    system_prompt = prompt or cfg.profile.require_prompt("storyboard_system")
    llm = LLM(cfg.llm)
    boards: list[Storyboard] = []
    for script in scripts.scripts:
        narration_blob = "\n".join(f"- {line.text}" for line in script.lines)
        schema = llm.chat_json(
            system_prompt,
            f"选题标题：{script.title}\n口播内容（按行）：\n{narration_blob}\n总时长目标：{script.total_duration}s\n",
            _StoryboardSchema,
            temperature=cfg.profile.generation.storyboard_temperature,
        )
        boards.append(
            Storyboard(
                topic_index=script.topic_index,
                title=script.title,
                shots=_align_generated_shots(script.lines, schema.shots),
            )
        )
    out = Storyboards(video_id=scripts.video_id, storyboards=boards)
    pdir = scripts_path.resolve().parent
    save_json(out, pdir / "storyboards.json")
    return out
