"""知点拆解局 CLI。"""

from __future__ import annotations

import json
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from .config import load_config
from .pipeline import STAGES, artifact_path, list_projects, run_full
from .stages import assets as assets_stage
from .stages import asr as asr_stage
from .stages import extract as extract_stage
from .stages import script as script_stage
from .stages import storyboard as storyboard_stage
from .stages import topics as topics_stage

app = typer.Typer(add_completion=False, help="知点拆解局 — 知识二创短视频生产流水线")
console = Console()


@app.command()
def run(
    source: str = typer.Argument(..., help="视频 URL 或本地文件路径"),
    resume: str = typer.Option(None, "--from", help="从指定阶段续跑: " + "|".join(STAGES)),
):
    """全流程：一个视频跑到分镜表。"""
    cfg = load_config()
    vid = run_full(source, cfg, start_from=resume)
    console.print(f"\n[green]video_id[/] = {vid}")


@app.command(name="asr")
def asr_cmd(
    source: str = typer.Argument(..., help="视频 URL 或本地文件路径"),
):
    """阶段 1：字幕优先，失败后语音转写。"""
    cfg = load_config()
    t = asr_stage.run(source, cfg)
    console.print(f"[green]✓[/] {t.method}, {len(t.segments)} 段, duration={t.duration:.1f}s")


@app.command(name="extract")
def extract_cmd(
    transcript: Path = typer.Argument(..., help="transcript.json 路径"),
):
    """阶段 2：知识点提取。"""
    cfg = load_config()
    k = extract_stage.run(transcript, cfg)
    console.print(f"[green]✓[/] 提取 {len(k.points)} 个知识点")


@app.command(name="topics")
def topics_cmd(
    knowledge: Path = typer.Argument(..., help="knowledge.json 路径"),
):
    """阶段 3：选题拆分。"""
    cfg = load_config()
    t = topics_stage.run(knowledge, cfg)
    console.print(f"[green]✓[/] 生成 {len(t.topics)} 个选题")


@app.command(name="script")
def script_cmd(
    topics_path: Path = typer.Argument(..., help="topics.json 路径"),
):
    """阶段 4：口播脚本。"""
    cfg = load_config()
    s = script_stage.run(topics_path, cfg)
    console.print(f"[green]✓[/] 生成 {len(s.scripts)} 份脚本")


@app.command(name="storyboard")
def storyboard_cmd(
    scripts_path: Path = typer.Argument(..., help="scripts.json 路径"),
):
    """阶段 5：画面分镜。"""
    cfg = load_config()
    b = storyboard_stage.run(scripts_path, cfg)
    console.print(f"[green]✓[/] 生成 {len(b.storyboards)} 份分镜")


@app.command(name="assets")
def assets_cmd(
    storyboards_path: Path = typer.Argument(..., help="storyboards.json 路径"),
):
    """阶段 6：资源清单。"""
    cfg = load_config()
    a = assets_stage.run(storyboards_path, cfg)
    console.print(f"[green]✓[/] 生成 {len(a)} 份资源清单")


@app.command(name="list")
def list_():
    """列出所有项目。"""
    cfg = load_config()
    projects = list_projects(cfg)
    if not projects:
        console.print("[yellow]暂无项目[/]")
        return
    table = Table("video_id", "已完成阶段")
    for p in projects:
        done = [s for s in STAGES if artifact_path(p.name, s, cfg).exists()]
        table.add_row(p.name, " → ".join(done) or "—")
    console.print(table)


@app.command()
def show(
    video_id: str = typer.Argument(..., help="video id"),
    stage: str = typer.Option(None, "--stage", "-s", help="只看某阶段: " + "|".join(STAGES)),
):
    """查看某个项目的产出。"""
    cfg = load_config()
    stages = [stage] if stage else STAGES
    for s in stages:
        p = artifact_path(video_id, s, cfg)
        if not p.exists():
            console.print(f"[dim]— {s}: 未生成[/]")
            continue
        console.print(f"[cyan]▸ {s}[/] ({p.name})")
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, list):
            console.print(f"  list[{len(data)}]")
            for item in data[:3]:
                console.print(f"  - {json.dumps(item, ensure_ascii=False)[:120]}...")
        else:
            console.print(f"  {json.dumps(data, ensure_ascii=False)[:200]}{'...' if len(json.dumps(data, ensure_ascii=False)) > 200 else ''}")


if __name__ == "__main__":
    app()
