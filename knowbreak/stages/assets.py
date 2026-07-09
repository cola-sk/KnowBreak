"""阶段 6：资源清单。

输入：Storyboards JSON
输出：每个 topic 一份 AssetList，导出到 assets.json
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from ..config import Config
from ..llm import LLM
from ..models import AssetList, AssetSuggestion, Storyboards
import json


class _AssetItem(BaseModel):
    kind: str
    description: str
    search_keywords: list[str]
    source_url: str | None = None


class _AssetsSchema(BaseModel):
    items: list[_AssetItem]


def run(storyboards_path: Path, cfg: Config) -> list[AssetList]:
    boards: Storyboards = Storyboards.model_validate_json(
        storyboards_path.read_text(encoding="utf-8")
    )
    llm = LLM(cfg.llm)
    out: list[AssetList] = []
    for board in boards.storyboards:
        shots_blob = "\n".join(
            f"- 画面: {s.visual} | B-roll: {s.broll}" for s in board.shots
        )
        schema = llm.chat_json(
            cfg.profile.require_prompt("assets_system"),
            f"选题：{board.title}\n分镜摘要：\n{shots_blob}\n",
            _AssetsSchema,
            temperature=cfg.profile.generation.assets_temperature,
        )
        out.append(
            AssetList(
                topic_index=board.topic_index,
                assets=[AssetSuggestion(**a.model_dump()) for a in schema.items],
            )
        )
    pdir = storyboards_path.parent
    (pdir / "assets.json").write_text(
        json.dumps([a.model_dump() for a in out], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return out
