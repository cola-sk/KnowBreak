"""阶段 3：选题拆分。

输入：Knowledge JSON
输出：Topics JSON（3-5 个短视频选题）
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from ..config import Config
from ..llm import LLM
from ..models import Knowledge, Topic, Topics
from ._common import project_dir, save_json


class _TopicItem(BaseModel):
    title: str
    hook: str
    angle: str
    knowledge_refs: list[int]
    target_duration: int = 75


class _TopicsSchema(BaseModel):
    topics: list[_TopicItem]


_SYSTEM = """你是短视频科普选题策划。
任务：基于一组知识点，设计 3-5 个独立的短视频选题。

要求：
- 每个 topic 必须包含：title(≤20 字，吸引但不标题党), hook(开场 3 秒钩子，问句或反常识), angle(切入角度), knowledge_refs(关联知识点在输入列表中的 index), target_duration(60-90 秒)
- 选题之间不要重复，覆盖知识点的不同侧面
- 不要绑定任何原作者信息；选题要能独立成立
- hook 要有钩性但不能虚假承诺
"""


def run(knowledge_path: Path, cfg: Config) -> Topics:
    knowledge: Knowledge = Knowledge.model_validate_json(
        knowledge_path.read_text(encoding="utf-8")
    )
    points_blob = "\n".join(
        f"[{i}] {p.title}: {p.summary}" for i, p in enumerate(knowledge.points)
    )
    llm = LLM(cfg.llm)
    schema = llm.chat_json(
        _SYSTEM,
        f"原视频主题：{knowledge.title}\n知识点列表：\n{points_blob}\n",
        _TopicsSchema,
    )
    topics = Topics(
        video_id=knowledge.video_id,
        topics=[
            Topic(index=i, **t.model_dump())
            for i, t in enumerate(schema.topics)
        ],
    )
    pdir = project_dir(cfg.out_dir, knowledge.video_id)
    save_json(topics, pdir / "topics.json")
    return topics
