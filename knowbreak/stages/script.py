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
    cover_narration: str = ""  # 封面口播：疑问句式读标题，10-20 字
    lines: list[_LineItem]
    hashtags: list[str] = []


def _fallback_cover_narration(title: str) -> str:
    """LLM 没给 cover_narration 时，用标题兜底：确保以疑问语气收尾。"""
    t = title.strip()
    if not t:
        return ""
    if not t.endswith(("？", "?", "！", "!")):
        t = f"{t}？"
    return t


def run(topics_path: Path, cfg: Config, *, prompt: str | None = None) -> Scripts:
    topics: Topics = Topics.model_validate_json(topics_path.read_text(encoding="utf-8"))
    kpath = _knowledge_path_for(topics_path)
    # topic_seed 路径下没有 knowledge.json：仅靠 topic title/hook/angle 出脚本即可。
    knowledge: Knowledge | None = None
    if kpath.exists():
        knowledge = Knowledge.model_validate_json(kpath.read_text(encoding="utf-8"))

    system_prompt = prompt or cfg.profile.require_prompt("script_system")
    llm = LLM(cfg.llm)
    scripts: list[Script] = []
    for topic in topics.topics:
        points_blob = ""
        if knowledge:
            points_blob = "\n".join(
                f"- {knowledge.points[i].title}: {knowledge.points[i].summary}\n  论断: {'; '.join(knowledge.points[i].key_statements)}"
                for i in topic.knowledge_refs
                if 0 <= i < len(knowledge.points)
            )
        schema = llm.chat_json(
            system_prompt,
            f"选题标题：{topic.title}\n钩子方向：{topic.hook}\n切入角度：{topic.angle}\n目标时长：{topic.target_duration}s\n参考知识点：\n{points_blob}\n\n额外要求：在 cover_narration 字段给出一行封面口播——以疑问句式重写或强化标题（如「为什么台风总在夏天生成？」），10-20 字，用于封面帧 TTS 朗读，吸引人且不与正文首句重复。",
            _ScriptSchema,
            temperature=cfg.profile.generation.script_temperature,
        )
        cover_narration = (schema.cover_narration or "").strip() or _fallback_cover_narration(topic.title)
        total = sum(line.estimated_seconds for line in schema.lines)
        scripts.append(
            Script(
                topic_index=topic.index,
                title=topic.title,
                cover_narration=cover_narration,
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
