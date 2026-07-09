"""阶段：人工审核闸门。

在 script/storyboard/images 产出后暂停，等待 Web 审核台把 review 状态改为 approved。
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Literal

from rich.console import Console

console = Console()

ReviewStage = Literal["script_review", "storyboard_review", "image_review"]

ARTIFACT_FILES: dict[ReviewStage, str] = {
    "script_review": "scripts.json",
    "storyboard_review": "storyboards.json",
    "image_review": "images.json",
}

REVIEW_FILES: dict[ReviewStage, str] = {
    "script_review": "script_review.json",
    "storyboard_review": "storyboard_review.json",
    "image_review": "image_review.json",
}

REVIEW_PAGES: dict[ReviewStage, str] = {
    "script_review": "script",
    "storyboard_review": "storyboard",
    "image_review": "images",
}


def run(pdir: Path, stage: ReviewStage, *, out_dir: Path | None = None) -> dict:
    """等待某审核阶段被人工通过。"""
    review_path = pdir / "reviews" / REVIEW_FILES[stage]
    artifact_path = pdir / ARTIFACT_FILES[stage]
    if not artifact_path.exists():
        raise FileNotFoundError(f"审核前置产物不存在: {artifact_path}")

    artifact = _read_json(artifact_path)
    existing = _read_json(review_path) if review_path.exists() else None
    if isinstance(existing, dict) and existing.get("status") == "approved":
        console.print(f"[green]✓[/] {stage} 已通过，跳过等待")
        return existing

    review = _build_or_merge_review(stage, artifact, existing)
    if _auto_approve():
        review["status"] = "approved"
        review["updated_at"] = _now_iso()
    else:
        review["status"] = "in_review"
        review["updated_at"] = _now_iso()
    _write_json(review_path, review)

    if review["status"] == "approved":
        console.print(f"[green]✓[/] {stage} 自动通过 (KB_REVIEW_AUTO_APPROVE)")
        return review

    review_url = _review_url(pdir, stage, out_dir=out_dir)
    console.print(f"[yellow]审核地址[/] {review_url}")
    console.print("[yellow]等待人工审核通过...[/]")

    poll_seconds = _poll_seconds()
    timeout_seconds = _timeout_seconds()
    begin = time.time()
    while True:
        time.sleep(poll_seconds)
        latest = _read_json(review_path)
        if isinstance(latest, dict) and latest.get("status") == "approved":
            console.print(f"[green]✓[/] {stage} 已审核通过，继续后续阶段")
            return latest

        if timeout_seconds > 0 and time.time() - begin >= timeout_seconds:
            raise TimeoutError(
                f"{stage} 等待超时（{timeout_seconds:.0f}s）。请在审核台通过后重试，"
                f"或设置 KB_REVIEW_WAIT_TIMEOUT=0 关闭超时。"
            )


def _build_or_merge_review(stage: ReviewStage, artifact: object, existing: dict | None) -> dict:
    items = _build_items(stage, artifact)
    old_map = {}
    if isinstance(existing, dict):
        for item in existing.get("items", []):
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                old_map[item["id"]] = item

    merged_items = []
    for item in items:
        old = old_map.get(item["id"])
        merged_items.append(
            {
                "id": item["id"],
                "status": old.get("status", "pending") if isinstance(old, dict) else "pending",
                "notes": old.get("notes", "") if isinstance(old, dict) else "",
            }
        )

    version = 1
    if isinstance(existing, dict):
        try:
            version = int(existing.get("version", 1))
        except Exception:
            version = 1

    return {
        "stage": stage,
        "status": "pending",
        "version": version,
        "updated_at": _now_iso(),
        "items": merged_items,
    }


def _build_items(stage: ReviewStage, artifact: object) -> list[dict]:
    items: list[dict] = []
    if stage == "script_review":
        scripts = artifact.get("scripts", []) if isinstance(artifact, dict) else []
        for script in scripts:
            topic_index = script.get("topic_index", 0) if isinstance(script, dict) else 0
            lines = script.get("lines", []) if isinstance(script, dict) else []
            for i, _ in enumerate(lines):
                items.append({"id": f"topic_{topic_index}_line_{i}"})
        return items

    if stage == "storyboard_review":
        boards = artifact.get("storyboards", []) if isinstance(artifact, dict) else []
        for board in boards:
            topic_index = board.get("topic_index", 0) if isinstance(board, dict) else 0
            shots = board.get("shots", []) if isinstance(board, dict) else []
            for i, shot in enumerate(shots):
                shot_idx = shot.get("index", i) if isinstance(shot, dict) else i
                items.append({"id": f"topic_{topic_index}_shot_{shot_idx}"})
        return items

    topics = artifact if isinstance(artifact, list) else []
    for topic in topics:
        if not isinstance(topic, dict):
            continue
        topic_index = topic.get("topic_index", 0)
        if topic.get("cover"):
            items.append({"id": f"topic_{topic_index}_cover"})
        for i, shot in enumerate(topic.get("shots", [])):
            shot_idx = shot.get("shot_index", i) if isinstance(shot, dict) else i
            items.append({"id": f"topic_{topic_index}_shot_{shot_idx}"})
    return items


def _review_url(pdir: Path, stage: ReviewStage, *, out_dir: Path | None = None) -> str:
    base = os.getenv("KB_REVIEW_BASE_URL", "http://localhost:8800").rstrip("/")
    version = "legacy"
    video_id = pdir.name
    if not _is_legacy_run_dir(pdir, out_dir):
        version = pdir.name
        video_id = pdir.parent.name
    return f"{base}/projects/{video_id}/{version}/{REVIEW_PAGES[stage]}"


def _is_legacy_run_dir(pdir: Path, out_dir: Path | None) -> bool:
    if out_dir is not None:
        try:
            return pdir.parent.resolve() == out_dir.resolve()
        except FileNotFoundError:
            return pdir.parent == out_dir
    return pdir.parent.name == "out"


def _poll_seconds() -> float:
    raw = os.getenv("KB_REVIEW_POLL_SECONDS", "3")
    try:
        return max(float(raw), 1.0)
    except Exception:
        return 3.0


def _timeout_seconds() -> float:
    raw = os.getenv("KB_REVIEW_WAIT_TIMEOUT", "0")
    try:
        return max(float(raw), 0.0)
    except Exception:
        return 0.0


def _auto_approve() -> bool:
    return os.getenv("KB_REVIEW_AUTO_APPROVE", "0").lower() in {"1", "true", "yes", "on"}


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")
