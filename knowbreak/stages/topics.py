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
from ._common import save_json


class _TopicItem(BaseModel):
    title: str
    hook: str
    angle: str
    knowledge_refs: list[int]
    target_duration: int = 75


class _TopicsSchema(BaseModel):
    topics: list[_TopicItem]


_SYSTEM = """你是中国抖音严肃科普账号的选题策划。
任务：基于一组知识点，设计 3-5 个独立短视频选题，风格要像专业科普号：可信、克制、有证据，但开头足够抓人。

要求：
- 每个 topic 必须包含：title(≤20 字，抓人但不标题党), hook(开场 3 秒钩子，优先用反常识/误区纠偏/风险后果), angle(切入角度), knowledge_refs(关联知识点在输入列表中的 index), target_duration(60-90 秒)
- title 要适合抖音信息流：短、具体、有冲突感或结果感；避免“震惊”“速看”“不看后悔”等低质标题党
- hook 要先制造认知缺口，再承诺用事实解释；不能虚假承诺、不能制造恐慌
- angle 要体现严肃科普结构：常见误区 → 关键证据/机制 → 可执行结论
- 选题之间不要重复，覆盖知识点的不同侧面
- 不要绑定任何原作者信息；选题要能独立成立
"""


def run(knowledge_path: Path, cfg: Config, output_dir: Path | None = None) -> Topics:
    knowledge: Knowledge = Knowledge.model_validate_json(
        knowledge_path.read_text(encoding="utf-8")
    )
    points_blob = "\n".join(
        f"[{i}] {p.title}: {p.summary}" for i, p in enumerate(knowledge.points)
    )
    llm = LLM(cfg.llm)
    schema = llm.chat_json(
        cfg.profile.prompts.topics_system or _SYSTEM,
        f"原视频主题：{knowledge.title}\n知识点列表：\n{points_blob}\n",
        _TopicsSchema,
        temperature=cfg.profile.generation.topics_temperature,
    )
    topics = Topics(
        video_id=knowledge.video_id,
        topics=[
            Topic(index=i, **t.model_dump())
            for i, t in enumerate(schema.topics)
        ],
    )
    pdir = output_dir or knowledge_path.parent
    pdir.mkdir(parents=True, exist_ok=True)
    save_json(topics, pdir / "topics.json")
    return topics
