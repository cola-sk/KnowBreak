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


_SYSTEM = """你是中国抖音严肃科普账号的短视频分镜师。
任务：把一段口播脚本拆成画面分镜，画面风格要专业、清楚、可信，同时适合竖屏信息流观看。

要求：
- 每个 shot 包含：narration(对应口播文字，可逐句或合并), visual(画面描述，给真人讲/信息图/医学或科学示意/实拍), broll(B-roll 素材建议), subtitle(精简字幕), duration(秒)
- 所有 shot 的 narration 拼起来要覆盖完整口播内容
- subtitle 要精简、有信息密度，不要把 narration 全塞进字幕
- visual 优先选择严肃科普画面：简洁真人讲解、实验/食物/人体示意、数据卡片、对比图、机制流程图
- B-roll 要具体、可搜索，避免把比喻当字面素材
- 不使用任何原视频的画面/截图，全部原创或免版权素材
"""


def run(scripts_path: Path, cfg: Config) -> Storyboards:
    scripts: Scripts = Scripts.model_validate_json(scripts_path.read_text(encoding="utf-8"))
    llm = LLM(cfg.llm)
    boards: list[Storyboard] = []
    for script in scripts.scripts:
        narration_blob = "\n".join(f"- {line.text}" for line in script.lines)
        schema = llm.chat_json(
            cfg.profile.prompts.storyboard_system or _SYSTEM,
            f"选题标题：{script.title}\n口播内容（按行）：\n{narration_blob}\n总时长目标：{script.total_duration}s\n",
            _StoryboardSchema,
            temperature=cfg.profile.generation.storyboard_temperature,
        )
        boards.append(
            Storyboard(
                topic_index=script.topic_index,
                title=script.title,
                shots=[
                    StoryboardShot(index=i, **shot.model_dump())
                    for i, shot in enumerate(schema.shots)
                ],
            )
        )
    out = Storyboards(video_id=scripts.video_id, storyboards=boards)
    pdir = scripts_path.resolve().parent
    save_json(out, pdir / "storyboards.json")
    return out
