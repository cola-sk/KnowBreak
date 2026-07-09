"""阶段 4：口播脚本生成。

输入：Topics JSON + Knowledge JSON
输出：Scripts JSON（每个选题的原创逐字口播脚本）
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from ..config import Config
from ..llm import LLM
from ..models import Knowledge, Script, ScriptLine, Scripts, Topics
from ._common import save_json


class _LineItem(BaseModel):
    text: str
    estimated_seconds: float


class _ScriptSchema(BaseModel):
    lines: list[_LineItem]
    hashtags: list[str] = []


def run(topics_path: Path, cfg: Config) -> Scripts:
    topics: Topics = Topics.model_validate_json(topics_path.read_text(encoding="utf-8"))
    kpath = _knowledge_path_for(topics_path)
    knowledge: Knowledge = Knowledge.model_validate_json(kpath.read_text(encoding="utf-8"))

    llm = LLM(cfg.llm)
    scripts: list[Script] = []
    for topic in topics.topics:
        points_blob = "\n".join(
            f"- {knowledge.points[i].title}: {knowledge.points[i].summary}\n  论断: {'; '.join(knowledge.points[i].key_statements)}"
            for i in topic.knowledge_refs
            if 0 <= i < len(knowledge.points)
        )
        schema = llm.chat_json(
            cfg.profile.require_prompt("script_system"),
            f"选题标题：{topic.title}\n钩子方向：{topic.hook}\n切入角度：{topic.angle}\n目标时长：{topic.target_duration}s\n参考知识点：\n{points_blob}\n",
            _ScriptSchema,
            temperature=cfg.profile.generation.script_temperature,
        )
        total = sum(line.estimated_seconds for line in schema.lines)
        scripts.append(
            Script(
                topic_index=topic.index,
                title=topic.title,
                lines=[
                    ScriptLine(text=line.text, estimated_seconds=line.estimated_seconds)
                    for line in schema.lines
                ],
                total_duration=total,
                hashtags=schema.hashtags,
            )
        )
    out = Scripts(video_id=topics.video_id, scripts=scripts)
    pdir = topics_path.parent
    save_json(out, pdir / "scripts.json")
    return out


def _knowledge_path_for(topics_path: Path) -> Path:
    local = topics_path.parent / "knowledge.json"
    if local.exists():
        return local
    shared = topics_path.parent.parent / "knowledge.json"
    if shared.exists():
        return shared
    return local
