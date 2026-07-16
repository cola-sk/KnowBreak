"""阶段 5：画面分镜。

输入：Scripts JSON
输出：Storyboards JSON
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from ..config import Config
from ..llm import LLM
from ..models import Scripts, Storyboard, Storyboards, StoryboardShot
from ._common import save_json


class _ShotItem(BaseModel):
    narration: str
    visual: str
    broll: str
    subtitle: str
    duration: float


class _StoryboardSchema(BaseModel):
    shots: list[_ShotItem]


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
                shots=[
                    StoryboardShot(
                        index=i,
                        narration=shot.narration,
                        visual=shot.visual,
                        broll=shot.broll,
                        subtitle=shot.subtitle if shot.subtitle.strip() else shot.narration,
                        duration=shot.duration,
                    )
                    for i, shot in enumerate(schema.shots)
                ],
            )
        )
    out = Storyboards(video_id=scripts.video_id, storyboards=boards)
    pdir = scripts_path.resolve().parent
    save_json(out, pdir / "storyboards.json")
    return out
