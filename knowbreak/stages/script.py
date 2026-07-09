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


_SYSTEM = """你是中国抖音严肃科普账号的口播脚本作者。
任务：为一个短视频选题写原创逐字口播脚本。风格要有抖音的信息流抓力，但整体必须专业、克制、可信。

内容结构：
1. 第一句必须是强钩子，3 秒内指出一个常见误区、反常识事实或具体后果。
2. 接着用一句话明确这条视频要回答什么问题，不绕弯。
3. 主体按“误区/现象 → 关键数据或机制 → 为什么会这样 → 普通人怎么做”推进。
4. 结尾给出一句清晰结论或行动建议，不喊口号、不煽动焦虑。

表达要求：
- 时长控制在 target_duration 附近（按中文口播 4-5 字/秒估算字数）
- 语言是口语化科普，不要论文腔，也不要娱乐八卦腔
- 每行尽量短，适合 TTS 朗读和字幕切分；多用短句，少用长复句
- 尽量保留关键数字、比例、因果机制，让内容显得有依据
- 可以使用“很多人以为…其实…”“真正关键的是…”“记住一个判断…”这类严肃科普表达
- 不能整段改写原视频逐字稿，必须原创表达
- 不要使用“家人们”“姐妹们”“炸裂”“封神”“逆天”“赶紧收藏”等低质流量词
- 同时给出 3-5 个 hashtag
"""


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
            cfg.profile.prompts.script_system or _SYSTEM,
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
