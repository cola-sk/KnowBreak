"""阶段 3：选题拆分。

输入：Knowledge JSON
输出：Topics JSON（按 profile 配置数量生成短视频选题）
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from ..config import Config
from ..llm import LLM
from ..models import Knowledge, Topic, Topics
from ._common import save_json


class _TopicItem(BaseModel):
    title: str
    hook: str
    angle: str
    knowledge_refs: list[int]
    target_duration: int = 75


class _TopicsSchema(BaseModel):
    topics: list[_TopicItem]


def run(knowledge_path: Path, cfg: Config, output_dir: Path | None = None) -> Topics:
    knowledge: Knowledge = Knowledge.model_validate_json(
        knowledge_path.read_text(encoding="utf-8")
    )
    points_blob = "\n".join(
        f"[{i}] {p.title}: {p.summary}" for i, p in enumerate(knowledge.points)
    )
    count = cfg.profile.topics.count
    duration_min = cfg.profile.topics.target_duration_min
    duration_max = cfg.profile.topics.target_duration_max
    llm = LLM(cfg.llm)
    schema = llm.chat_json(
        cfg.profile.require_prompt("topics_system"),
        (
            f"原视频主题：{knowledge.title}\n"
            f"本次生成数量：{count} 个 topic\n"
            f"每个 topic 的 target_duration 范围：{duration_min}-{duration_max} 秒\n"
            f"知识点列表：\n{points_blob}\n"
        ),
        _TopicsSchema,
        temperature=cfg.profile.generation.topics_temperature,
    )
    if len(schema.topics) < count:
        raise RuntimeError(f"topics 阶段只生成了 {len(schema.topics)} 个 topic，少于配置的 {count} 个")
    selected = schema.topics[:count]
    topics = Topics(
        video_id=knowledge.video_id,
        topics=[
            Topic(index=i, **t.model_dump())
            for i, t in enumerate(selected)
        ],
    )
    pdir = output_dir or knowledge_path.parent
    pdir.mkdir(parents=True, exist_ok=True)
    save_json(topics, pdir / "topics.json")
    return topics
