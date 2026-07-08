"""阶段公共工具：路径、artifact 持久化、视频 id 生成。"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from pydantic import BaseModel


def video_id_from_source(source: str) -> str:
    """从 URL 或文件路径生成稳定的 video id。"""
    m = re.search(r"(/[a-zA-Z0-9_-]{6,})", source)
    key = m.group(1) if m else source
    return hashlib.sha256(key.encode()).hexdigest()[:10]


def project_dir(out_dir: Path, video_id: str) -> Path:
    p = out_dir / video_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_json(model: BaseModel, path: Path) -> None:
    path.write_text(model.model_dump_json(indent=2), encoding="utf-8")


def load_json(path: Path, model_cls: type[BaseModel]) -> BaseModel:
    return model_cls.model_validate_json(path.read_text(encoding="utf-8"))
