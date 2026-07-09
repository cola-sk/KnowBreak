"""阶段 0：手工主题播种。

输入：一个手工给定的主题字符串（来自 workflow params 或 CLI --topic）
输出：topics.json（单个 Topic）

用途：当不想从原视频 ASR/提取/选题、而是直接围绕一个已知主题做原创短视频时，
用这个阶段跳过前半段，直接进入 script/storyboard/images/tts/compose。
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from ..config import Config
from ..llm import LLM
from ..models import Topic, Topics
from ._common import save_json


class _TopicSeed(BaseModel):
    title: str  # 短视频标题（≤20 字）
    hook: str  # 开场钩子，3 秒抓人
    angle: str  # 切入角度


def run(
    pdir: Path,
    cfg: Config,
    *,
    topic: str | None,
    hook: str | None = None,
    angle: str | None = None,
    target_duration: int | None = None,
    video_id: str | None = None,
) -> Topics:
    if not topic:
        raise ValueError("topic_seed 阶段需要主题字符串：在 workflow [capabilities.topic_seed].params.topic 里配置，或通过 CLI --topic 传入")

    # 如果 workflow 没有烤死 hook/angle，让 LLM 根据主题先生成一版标题/钩子/角度。
    # 这样既能支持“workflow 与主题完全绑定”（params 里给齐 topic/hook/angle），
    # 也能支持“通用 workflow + CLI 临时主题”（只给 topic，剩下交给模型）。
    if hook and angle:
        seed = _TopicSeed(title=_clip_title(topic), hook=hook, angle=angle)
    else:
        llm = LLM(cfg.llm)
        seed = llm.chat_json(
            cfg.profile.require_prompt("topic_seed_system"),
            f"主题：{topic}\n"
            "请给出：\n"
            "1) 一个 ≤20 字、适合抖音信息流的短视频标题\n"
            "2) 一句 3 秒能抓住注意力的开场钩子（指出反常识、误区或具体后果）\n"
            "3) 一句话切入角度（这条视频从哪个角度回答这个主题）\n",
            _TopicSeed,
            temperature=cfg.profile.generation.script_temperature,
        )

    # target_duration 优先级：workflow params > profile.topics.target_duration_min
    resolved_duration = target_duration or cfg.profile.topics.target_duration_min

    topics = Topics(
        video_id=video_id or pdir.name,
        topics=[
            Topic(
                index=0,
                title=seed.title,
                hook=seed.hook,
                angle=seed.angle,
                knowledge_refs=[],
                target_duration=resolved_duration,
            )
        ],
    )
    save_json(topics, pdir / "topics.json")
    return topics


def _clip_title(topic: str) -> str:
    # workflow 直接给 topic 当标题用时，截到 20 字以内
    return topic if len(topic) <= 20 else topic[:20]
