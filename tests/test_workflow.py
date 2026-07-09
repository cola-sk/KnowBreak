import json
from pathlib import Path

from knowbreak.workflow import load_workflow, write_workflow_plan


def test_load_rewrite_workflow() -> None:
    project_root = Path(__file__).resolve().parent.parent
    profile_dir = project_root / "profiles" / "serious_science"

    workflow = load_workflow(profile_dir, "rewrite_same_structure")

    assert workflow.id == "rewrite_same_structure"
    assert workflow.steps == ["asr", "rewrite", "storyboard", "images", "tts", "compose"]
    assert workflow.capabilities["rewrite"].prompt == "prompts/rewrite.md"
    assert workflow.capabilities["rewrite"].outputs == ["scripts.json"]


def test_write_workflow_plan(tmp_path: Path) -> None:
    project_root = Path(__file__).resolve().parent.parent
    profile_dir = project_root / "profiles" / "serious_science"
    workflow = load_workflow(profile_dir, "serious_science_one")

    write_workflow_plan(workflow, profile_name="serious_science", output_dir=tmp_path)

    data = json.loads((tmp_path / "workflow_plan.json").read_text(encoding="utf-8"))
    assert data["workflow"] == "serious_science_one"
    assert data["profile"] == "serious_science"
    assert data["steps"][1]["capability"] == "extract"
    assert data["steps"][1]["prompt"] == "prompts/extract.md"
