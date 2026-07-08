"""流水线编排：把六个阶段串起来，支持断点续跑。"""

from __future__ import annotations

from pathlib import Path

from rich.console import Console

from .config import Config
from .stages import asr, extract, topics, script, storyboard, assets
from .stages._common import project_dir, video_id_from_source

console = Console()

STAGES = ["asr", "extract", "topics", "script", "storyboard", "assets"]


def run_full(source: str, cfg: Config, start_from: str | None = None) -> str:
    """全流程跑一个视频。返回 video_id。"""
    video_id = video_id_from_source(source)
    pdir = project_dir(cfg.out_dir, video_id)

    start_idx = 0 if start_from is None else STAGES.index(start_from)

    if start_idx <= 0:
        console.print(f"[cyan]▸ 阶段 1/6 ASR 转写[/]: {source}")
        asr.run(source, cfg)
    if start_idx <= 1:
        console.print("[cyan]▸ 阶段 2/6 知识点提取[/]")
        extract.run(pdir / "transcript.json", cfg)
    if start_idx <= 2:
        console.print("[cyan]▸ 阶段 3/6 选题拆分[/]")
        topics.run(pdir / "knowledge.json", cfg)
    if start_idx <= 3:
        console.print("[cyan]▸ 阶段 4/6 口播脚本[/]")
        script.run(pdir / "topics.json", cfg)
    if start_idx <= 4:
        console.print("[cyan]▸ 阶段 5/6 画面分镜[/]")
        storyboard.run(pdir / "scripts.json", cfg)
    if start_idx <= 5:
        console.print("[cyan]▸ 阶段 6/6 资源清单[/]")
        assets.run(pdir / "storyboards.json", cfg)

    console.print(f"[green]✓ 完成[/] 产出目录: {pdir}")
    return video_id


def artifact_path(video_id: str, stage: str, cfg: Config) -> Path:
    pdir = project_dir(cfg.out_dir, video_id)
    return {
        "asr": pdir / "transcript.json",
        "extract": pdir / "knowledge.json",
        "topics": pdir / "topics.json",
        "script": pdir / "scripts.json",
        "storyboard": pdir / "storyboards.json",
        "assets": pdir / "assets.json",
    }[stage]


def list_projects(cfg: Config) -> list[Path]:
    if not cfg.out_dir.exists():
        return []
    return sorted(p for p in cfg.out_dir.iterdir() if p.is_dir())
