from pathlib import Path

import pytest

from knowbreak.config import ASRConfig, Config, IntroConfig, LLMConfig, TTSConfig
from knowbreak.pipeline import _video_id_from_run_dir, artifact_path, resolve_project_run_dir, run_full
from knowbreak.stages.review import _review_url
from knowbreak.stages.compose import _load_images_map, _load_script_title_map


def _config(out_dir: Path) -> Config:
    return Config(
        llm=LLMConfig(base_url="http://example.invalid/v1", api_key="test", model="test"),
        asr=ASRConfig(provider="openai", model="test"),
        tts=TTSConfig(),
        intro=IntroConfig(),
        out_dir=out_dir,
        project_root=out_dir.parent,
    )


def test_create_version_auto_increments(tmp_path: Path) -> None:
    cfg = _config(tmp_path / "out")

    p1, v1 = resolve_project_run_dir(cfg, "video123", "create", None)
    p2, v2 = resolve_project_run_dir(cfg, "video123", "create", None)

    assert v1 == "v001"
    assert v2 == "v002"
    assert p1 == tmp_path / "out" / "video123" / "v001"
    assert p2 == tmp_path / "out" / "video123" / "v002"


def test_update_requires_existing_version(tmp_path: Path) -> None:
    cfg = _config(tmp_path / "out")

    with pytest.raises(FileNotFoundError):
        resolve_project_run_dir(cfg, "video123", "update", "draft")

    created, _ = resolve_project_run_dir(cfg, "video123", "create", "draft")
    updated, version = resolve_project_run_dir(cfg, "video123", "update", "draft")

    assert updated == created
    assert version == "draft"


def test_artifact_path_supports_version(tmp_path: Path) -> None:
    cfg = _config(tmp_path / "out")

    assert artifact_path("video123", "asr", cfg, version="v001") == (
        tmp_path / "out" / "video123" / "v001" / "transcript.json"
    )
    assert artifact_path("video123", "extract", cfg, version="v001") == (
        tmp_path / "out" / "video123" / "v001" / "knowledge.json"
    )
    assert artifact_path("video123", "script", cfg, version="v001") == (
        tmp_path / "out" / "video123" / "v001" / "scripts.json"
    )


def test_create_version_disallows_start_from(tmp_path: Path) -> None:
    cfg = _config(tmp_path / "out")

    with pytest.raises(ValueError, match="create 模式必须从头完整生成"):
        run_full("video123", cfg, start_from="extract", version_mode="create")


def test_compose_loads_versioned_image_paths(tmp_path: Path) -> None:
    out_dir = tmp_path / "out"
    pdir = out_dir / "video123" / "v001"
    pdir.mkdir(parents=True)
    images_json = pdir / "images.json"
    images_json.write_text(
        """[
          {
            "topic_index": 0,
            "cover": {"image_path": "video123/v001/images/0/cover.jpg"},
            "shots": [
              {"shot_index": 0, "image_path": "video123/v001/images/0/shot_000.jpg"}
            ]
          }
        ]""",
        encoding="utf-8",
    )

    shots, covers = _load_images_map(images_json, out_dir)

    assert covers[0] == str(out_dir / "video123" / "v001" / "images" / "0" / "cover.jpg")
    assert shots[0][0] == str(out_dir / "video123" / "v001" / "images" / "0" / "shot_000.jpg")


def test_compose_loads_latest_script_titles(tmp_path: Path) -> None:
    scripts_json = tmp_path / "scripts.json"
    scripts_json.write_text(
        """{
          "video_id": "video123",
          "scripts": [
            {"topic_index": 0, "title": "新的封面标题"},
            {"topic_index": 1, "title": ""}
          ]
        }""",
        encoding="utf-8",
    )

    assert _load_script_title_map(scripts_json) == {0: "新的封面标题"}


def test_video_id_from_run_dir_handles_legacy_and_versioned_dirs(tmp_path: Path) -> None:
    out_dir = tmp_path / "custom-out"

    assert _video_id_from_run_dir(out_dir / "video123", out_dir) == "video123"
    assert _video_id_from_run_dir(out_dir / "video123" / "v001", out_dir) == "video123"


def test_review_url_handles_custom_out_dir_for_legacy_and_versioned_runs(tmp_path: Path) -> None:
    out_dir = tmp_path / "custom-out"

    assert _review_url(out_dir / "video123", "script_review", out_dir=out_dir) == (
        "http://localhost:8800/projects/video123/legacy/script"
    )
    assert _review_url(out_dir / "video123" / "v001", "script_review", out_dir=out_dir) == (
        "http://localhost:8800/projects/video123/v001/script"
    )
