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
from ._common import project_dir, save_json


class _LineItem(BaseModel):
    text: str
    estimated_seconds: float


class _ScriptSchema(BaseModel):
    lines: list[_LineItem]
    hashtags: list[str] = []


_SYSTEM = """你是短视频口播脚本作者。
任务：为一个短视频选题写原创口播脚本。

要求：
- 时长控制在 target_duration 附近（按中文口播 4-5 字/秒估算字数）
- 第一句必须是钩子，3 秒内抓住注意力
- 全程原创表达，不能整段改写原视频逐字稿
- 语言口语化，适合 60-90 秒短视频
- 结尾给出一句金句或反思
- 同时给出 3-5 个 hashtag
"""


def run(topics_path: Path, cfg: Config) -> Scripts:
    topics: Topics = Topics.model_validate_json(topics_path.read_text(encoding="utf-8"))
    kpath = topics_path.parent / "knowledge.json"
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
            _SYSTEM,
            f"选题标题：{topic.title}\n钩子方向：{topic.hook}\n切入角度：{topic.angle}\n目标时长：{topic.target_duration}s\n参考知识点：\n{points_blob}\n",
            _ScriptSchema,
            temperature=0.8,
        )
        total = sum(line.estimated_seconds for line in schema.lines)
        scripts.append(
            Script(
                topic_index=topic.index,
                title=topic.title,
                lines=[ScriptLine(text=l.text, estimated_seconds=l.estimated_seconds) for l in schema.lines],
                total_duration=total,
                hashtags=schema.hashtags,
            )
        )
    out = Scripts(video_id=topics.video_id, scripts=scripts)
    pdir = project_dir(cfg.out_dir, topics.video_id)
    save_json(out, pdir / "scripts.json")
    return out
