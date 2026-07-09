"""流水线编排：把六个阶段串起来，支持断点续跑。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

from rich.console import Console

from .config import Config
from .stages import asr, extract, topics, script, storyboard, assets, images, tts, compose, rewrite
from .stages._common import project_dir, project_version_dir, video_id_from_source
from .workflow import WorkflowConfig, load_workflow, write_workflow_plan

console = Console()

STAGES = [
    "asr",
    "extract",
    "topics",
    "rewrite",
    "script",
    "storyboard",
    "assets",
    "images",
    "tts",
    "compose",
]
SHARED_STAGES: set[str] = set()
VersionMode = Literal["legacy", "create", "update"]
DEFAULT_WORKFLOW = "serious_science_one"


def run_full(
    source: str,
    cfg: Config,
    start_from: str | None = None,
    version_mode: VersionMode = "legacy",
    version: str | None = None,
    workflow_name: str = DEFAULT_WORKFLOW,
) -> tuple[str, str | None]:
    """全流程跑一个视频。返回 video_id。"""
    if version_mode == "create" and start_from is not None:
        raise ValueError("create 模式必须从头完整生成；局部重跑请使用 update --from 或单阶段命令")
    workflow = load_workflow(cfg.profile.base_dir, workflow_name)
    if start_from is not None and start_from not in workflow.steps:
        raise ValueError(f"workflow {workflow.id} 不包含阶段 {start_from}")
    video_id = video_id_from_source(source)
    pdir, resolved_version = resolve_project_run_dir(cfg, video_id, version_mode, version)
    source_cache_dir = project_dir(cfg.out_dir, video_id) if resolved_version else None
    write_workflow_plan(workflow, profile_name=cfg.profile.name, output_dir=pdir)

    start_idx = 0 if start_from is None else workflow.steps.index(start_from)
    _run_workflow_steps(workflow, start_idx, source, cfg, pdir, source_cache_dir)

    console.print(f"[green]✓ 完成[/] 产出目录: {pdir}")
    return video_id, resolved_version


def _run_workflow_steps(
    workflow: WorkflowConfig,
    start_idx: int,
    source: str,
    cfg: Config,
    pdir: Path,
    source_cache_dir: Path | None,
) -> None:
    for idx, step in enumerate(workflow.steps[start_idx:], start=start_idx):
        console.print(f"[cyan]▸ 阶段 {idx + 1}/{len(workflow.steps)} {step}[/]")
        _run_capability(step, source, cfg, pdir, source_cache_dir)


def _run_capability(
    step: str,
    source: str,
    cfg: Config,
    pdir: Path,
    source_cache_dir: Path | None,
) -> None:
    if step == "asr":
        asr.run(source, cfg, pdir=pdir, source_cache_dir=source_cache_dir)
    elif step == "extract":
        extract.run(pdir / "transcript.json", cfg)
    elif step == "topics":
        topics.run(pdir / "knowledge.json", cfg, output_dir=pdir)
    elif step == "rewrite":
        rewrite.run(pdir / "transcript.json", cfg)
    elif step == "script":
        script.run(pdir / "topics.json", cfg)
    elif step == "storyboard":
        storyboard.run(pdir / "scripts.json", cfg)
    elif step == "assets":
        assets.run(pdir / "storyboards.json", cfg)
    elif step == "images":
        images.run(pdir / "storyboards.json", cfg)
    elif step == "tts":
        tts.run(pdir / "scripts.json", cfg)
    elif step == "compose":
        compose.run(pdir / "tts.json", cfg)
    else:
        raise ValueError(f"未知 capability: {step}")


def resolve_project_run_dir(
    cfg: Config,
    video_id: str,
    mode: VersionMode,
    version: str | None,
) -> tuple[Path, str | None]:
    if mode == "legacy":
        if version:
            raise ValueError("legacy 模式不接受 --version；请使用 --version-mode create/update")
        return project_dir(cfg.out_dir, video_id), None

    if version:
        _validate_version(version)

    if mode == "create":
        resolved = version or _next_version(cfg.out_dir, video_id)
        pdir = cfg.out_dir / video_id / resolved
        if pdir.exists():
            raise FileExistsError(f"版本已存在，不能 create 覆盖: {pdir}")
        return project_version_dir(cfg.out_dir, video_id, resolved), resolved

    if mode == "update":
        if not version:
            raise ValueError("update 模式必须传 --version，例如 --version v001")
        pdir = cfg.out_dir / video_id / version
        if not pdir.exists():
            raise FileNotFoundError(f"要更新的版本不存在: {pdir}")
        return pdir, version

    raise ValueError(f"未知 version mode: {mode}")


def _validate_version(version: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", version):
        raise ValueError("version 只能包含字母、数字、点、下划线和中划线")


def _next_version(out_dir: Path, video_id: str) -> str:
    base = project_dir(out_dir, video_id)
    max_n = 0
    for p in base.iterdir():
        if not p.is_dir():
            continue
        m = re.fullmatch(r"v(\d{3,})", p.name)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"v{max_n + 1:03d}"


def artifact_path(video_id: str, stage: str, cfg: Config, version: str | None = None) -> Path:
    project = project_dir(cfg.out_dir, video_id)
    pdir = project if version is None or stage in SHARED_STAGES else project / version
    return {
        "asr": pdir / "transcript.json",
        "extract": pdir / "knowledge.json",
        "topics": pdir / "topics.json",
        "rewrite": pdir / "scripts.json",
        "script": pdir / "scripts.json",
        "storyboard": pdir / "storyboards.json",
        "assets": pdir / "assets.json",
        "images": pdir / "images.json",
        "tts": pdir / "tts.json",
        "compose": pdir / "compose.json",
    }[stage]


def list_projects(cfg: Config) -> list[Path]:
    if not cfg.out_dir.exists():
        return []
    return sorted(p for p in cfg.out_dir.iterdir() if p.is_dir())
