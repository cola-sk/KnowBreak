"""知点拆解局 CLI。"""

from __future__ import annotations

import json
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from .config import load_config
from .pipeline import DEFAULT_WORKFLOW, SHARED_STAGES, STAGES, artifact_path, list_projects, run_full
from .stages import assets as assets_stage
from .stages import asr as asr_stage
from .stages import compose as compose_stage
from .stages import extract as extract_stage
from .stages import images as images_stage
from .stages import rewrite as rewrite_stage
from .stages import script as script_stage
from .stages import storyboard as storyboard_stage
from .stages import topic_seed as topic_seed_stage
from .stages import topics as topics_stage
from .stages import tts as tts_stage

app = typer.Typer(add_completion=False, help="知点拆解局 — 知识二创短视频生产流水线")
console = Console()


@app.command()
def run(
    source: str = typer.Argument(..., help="视频 URL 或本地文件路径"),
    resume: str = typer.Option(None, "--from", help="从指定阶段续跑: " + "|".join(STAGES)),
    version_mode: str = typer.Option(
        "legacy",
        "--version-mode",
        help="版本模式: legacy|create|update。create 会新建 out/<id>/<version>，update 会覆盖指定版本。",
    ),
    version: str = typer.Option(None, "--version", help="版本号/名称，例如 v001 或 draft-a"),
    workflow: str = typer.Option(
        DEFAULT_WORKFLOW,
        "--workflow",
        help="配置式 workflow 名称，例如 serious_science_one / rewrite_same_structure / topic_seed / ming_plague",
    ),
    topic: str = typer.Option(
        None,
        "--topic",
        help="手工主题字符串：仅 topic_seed 类 workflow 使用；主题绑定 workflow 会在 TOML 里烤死 topic，CLI 此处可省略",
    ),
):
    """全流程：一个视频跑到自动成片 MP4。"""
    cfg = load_config()
    if version_mode not in {"legacy", "create", "update"}:
        raise typer.BadParameter("--version-mode 只能是 legacy/create/update")
    if version_mode == "create" and resume is not None:
        raise typer.BadParameter("create 模式必须从头完整生成；局部重跑请使用 update --from 或单阶段命令")
    vid, resolved_version = run_full(
        source,
        cfg,
        start_from=resume,
        version_mode=version_mode,  # type: ignore[arg-type]
        version=version,
        workflow_name=workflow,
        topic=topic,
    )
    console.print(f"\n[green]video_id[/] = {vid}")
    if resolved_version:
        console.print(f"[green]version[/] = {resolved_version}")


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


@app.command(name="rewrite")
def rewrite_cmd(
    transcript_path: Path = typer.Argument(..., help="transcript.json 路径"),
):
    """按原视频结构洗稿改写为单条口播脚本。"""
    cfg = load_config()
    s = rewrite_stage.run(transcript_path, cfg)
    console.print(f"[green]✓[/] 改写 {len(s.scripts)} 份脚本")


@app.command(name="topic-seed")
def topic_seed_cmd(
    out_dir: Path = typer.Argument(..., help="输出目录（如 out/<video_id>/v001）"),
    topic: str = typer.Option(..., "--topic", help="手工主题字符串"),
    hook: str = typer.Option(None, "--hook", help="开场钩子（可选，不传则由 LLM 生成）"),
    angle: str = typer.Option(None, "--angle", help="切入角度（可选）"),
):
    """阶段 0：手工主题播种，写出 topics.json。"""
    cfg = load_config()
    out_dir.mkdir(parents=True, exist_ok=True)
    t = topic_seed_stage.run(out_dir, cfg, topic=topic, hook=hook, angle=angle, video_id=out_dir.parent.name)
    console.print(f"[green]✓[/] 主题: {t.topics[0].title}")


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


@app.command(name="images")
def images_cmd(
    storyboards_path: Path = typer.Argument(..., help="storyboards.json 路径"),
    topic: int = typer.Option(None, "--topic", help="只处理指定选题"),
    cover_only: bool = typer.Option(False, "--cover-only", help="只重新获取开头封面图，不改分镜配图"),
):
    """阶段 7：图片获取。"""
    cfg = load_config()
    r = images_stage.run(storyboards_path, cfg, only_topic=topic, cover_only=cover_only)
    total = sum(len(t.get("shots", [])) for t in r)
    covers = sum(1 for t in r if t.get("cover"))
    if cover_only:
        console.print(f"[green]✓[/] 更新 {covers} 张封面，保留 {total} 张分镜配图")
    else:
        console.print(f"[green]✓[/] 获取 {covers} 张封面、{total} 张分镜配图，覆盖 {len(r)} 个选题")


@app.command(name="tts")
def tts_cmd(
    scripts_path: Path = typer.Argument(..., help="scripts.json 路径"),
):
    """阶段 8：TTS 配音。"""
    cfg = load_config()
    r = tts_stage.run(scripts_path, cfg)
    total = sum(s.total_duration for s in r.scripts)
    console.print(f"[green]✓[/] 生成 {len(r.scripts)} 份配音, 总时长 {total:.0f}s")


@app.command(name="compose")
def compose_cmd(
    tts_path: Path = typer.Argument(..., help="tts.json 路径"),
    topic: int = typer.Option(None, "--topic", help="只生成指定选题的 MP4"),
):
    """阶段 9：自动成片（配图背景 + 字幕 + 配音 → MP4）。"""
    cfg = load_config()
    r = compose_stage.run(tts_path, cfg, only_topic=topic)
    videos = [v for v in r["videos"] if topic is None or v["topic_index"] == topic]
    console.print(f"[green]✓[/] 生成 {len(videos)} 个 MP4:")
    for v in videos:
        console.print(f"  - 选题 {v['topic_index']}: {v['title']} ({v['duration']:.0f}s) → out/{v['path']}")


@app.command(name="list")
def list_():
    """列出所有项目。"""
    cfg = load_config()
    projects = list_projects(cfg)
    if not projects:
        console.print("[yellow]暂无项目[/]")
        return
    table = Table("video_id", "version", "已完成阶段")
    for p in projects:
        done = [s for s in STAGES if artifact_path(p.name, s, cfg).exists()]
        version_dirs = sorted(d for d in p.iterdir() if d.is_dir())
        has_legacy_outputs = any(s not in SHARED_STAGES for s in done)
        if done and (has_legacy_outputs or not version_dirs):
            table.add_row(p.name, "legacy", " → ".join(done))
        for version_dir in version_dirs:
            vdone = [
                s
                for s in STAGES
                if artifact_path(p.name, s, cfg, version=version_dir.name).exists()
            ]
            if vdone:
                table.add_row(p.name, version_dir.name, " → ".join(vdone))
    console.print(table)


@app.command()
def show(
    video_id: str = typer.Argument(..., help="video id"),
    stage: str = typer.Option(None, "--stage", "-s", help="只看某阶段: " + "|".join(STAGES)),
    version: str = typer.Option(None, "--version", help="查看指定版本，例如 v001；不传则查看 legacy"),
):
    """查看某个项目的产出。"""
    cfg = load_config()
    stages = [stage] if stage else STAGES
    for s in stages:
        p = artifact_path(video_id, s, cfg, version=version)
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
