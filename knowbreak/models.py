"""流水线各阶段的数据模型。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TranscriptSegment(BaseModel):
    start: float  # 秒
    end: float
    text: str


class Transcript(BaseModel):
    video_id: str
    source: str  # 原始 URL 或文件路径
    duration: float
    language: str | None = None
    segments: list[TranscriptSegment]


class KnowledgePoint(BaseModel):
    """从原视频中提炼的一个知识点。"""

    title: str
    summary: str  # 一两句话概括
    key_statements: list[str]  # 核心论断
    examples: list[str] = Field(default_factory=list)
    source_excerpt: str  # 原视频引用片段（用于追溯）


class Knowledge(BaseModel):
    video_id: str
    title: str  # 原视频主题
    domain: str | None = None  # 学科领域
    points: list[KnowledgePoint]


class Topic(BaseModel):
    """一个短视频选题。"""

    index: int
    title: str  # 短视频标题（≤20 字）
    hook: str  # 开场钩子，3 秒抓人
    knowledge_refs: list[int] = Field(default_factory=list)  # 关联的 KnowledgePoint index
    target_duration: int = 75  # 秒
    angle: str  # 切入角度


class Topics(BaseModel):
    video_id: str
    topics: list[Topic]


class ScriptLine(BaseModel):
    """口播脚本的一句/一段。"""

    text: str
    estimated_seconds: float


class Script(BaseModel):
    topic_index: int
    title: str
    lines: list[ScriptLine]
    total_duration: float  # 估算总时长
    hashtags: list[str] = Field(default_factory=list)


class Scripts(BaseModel):
    video_id: str
    scripts: list[Script]


class StoryboardShot(BaseModel):
    """一个分镜。"""

    index: int
    narration: str  # 对应口播文字
    visual: str  # 画面描述
    broll: str  # B-roll / 素材建议
    subtitle: str  # 字幕（可精简）
    duration: float


class Storyboard(BaseModel):
    topic_index: int
    title: str
    shots: list[StoryboardShot]


class Storyboards(BaseModel):
    video_id: str
    storyboards: list[Storyboard]


class AssetSuggestion(BaseModel):
    """一条资源建议。"""

    kind: Literal["image", "ppt", "animation", "broll", "music"]
    description: str
    search_keywords: list[str]
    source_url: str | None = None  # 候选素材链接


class AssetList(BaseModel):
    topic_index: int
    assets: list[AssetSuggestion]


class ProjectState(BaseModel):
    """单个视频项目的完整状态，用于断点续跑。"""

    video_id: str
    source: str
    created_at: datetime
    stages: dict[str, str] = Field(default_factory=dict)  # stage_name -> artifact filename
    current_stage: str | None = None
