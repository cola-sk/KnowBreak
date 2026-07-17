import json
from pathlib import Path

from knowbreak.workflow import load_workflow, write_workflow_plan


def test_load_rewrite_workflow() -> None:
    project_root = Path(__file__).resolve().parent.parent
    profile_dir = project_root / "profiles"

    workflow = load_workflow(profile_dir, "workflow_e4bb517257")

    assert workflow.id == "Youtube视频洗稿"
    assert workflow.steps == ["asr", "rewrite", "storyboard", "images", "tts", "compose"]
    assert workflow.capabilities["rewrite"].prompt == "prompts/rewrite.md"
    assert workflow.capabilities["rewrite"].outputs == ["scripts.json"]


def test_write_workflow_plan(tmp_path: Path) -> None:
    project_root = Path(__file__).resolve().parent.parent
    profile_dir = project_root / "profiles"
    workflow = load_workflow(profile_dir, "custom/serious_science_one")

    write_workflow_plan(workflow, profile_name="serious_science", output_dir=tmp_path)

    data = json.loads((tmp_path / "workflow_plan.json").read_text(encoding="utf-8"))
    assert data["workflow"] == workflow.id
    assert data["profile"] == "serious_science"
    assert data["steps"][1]["capability"] == "extract"
    assert data["steps"][1]["prompt"] == "prompts/extract.md"


def test_typhoon_tape_myth_workflow_has_review_gates() -> None:
    project_root = Path(__file__).resolve().parent.parent
    profile_dir = project_root / "profiles"

    workflow = load_workflow(profile_dir, "topics/workflow_04013f4ee5")

    assert workflow.steps == [
        "topic_seed",
        "script",
        "script_review",
        "storyboard",
        "storyboard_review",
        "images",
        "tts",
        "compose",
    ]
    assert workflow.capabilities["script_review"].inputs == ["scripts.json"]
    assert workflow.capabilities["storyboard_review"].inputs == ["storyboards.json"]
    assert workflow.capabilities["images"].params == {"skip_text_only_cards": "true"}


def test_all_workflow_prompt_paths_exist() -> None:
    project_root = Path(__file__).resolve().parent.parent
    profile_dir = project_root / "profiles"
    workflows_dir = profile_dir / "workflows"

    for wf_path in workflows_dir.rglob("*.toml"):
        workflow_name = str(wf_path.relative_to(workflows_dir).with_suffix(""))
        workflow = load_workflow(profile_dir, workflow_name)
        for step, cap in workflow.capabilities.items():
            prompt = cap.prompt
            if not prompt:
                continue
            if prompt.startswith("prompts/") or "/" in prompt or prompt.endswith(".md"):
                prompt_path = profile_dir / prompt
                assert prompt_path.exists() and prompt_path.is_file(), (
                    f"workflow={workflow_name} step={step} 引用的 prompt 不存在: {prompt}"
                )
