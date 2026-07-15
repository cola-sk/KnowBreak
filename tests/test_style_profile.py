from pathlib import Path

import pytest

from knowbreak.style_profile import load_style_profile


def test_load_builtin_style_profile() -> None:
    project_root = Path(__file__).resolve().parent.parent

    profile = load_style_profile(project_root, "serious_science", None)

    assert profile.name == "serious_science"
    assert profile.base_dir == project_root / "profiles"
    assert "严肃科普" in profile.description
    assert "抖音严肃科普账号" in profile.prompts.script_system
    assert profile.generation.script_temperature is None
    assert profile.intro.enabled is True
    assert profile.intro.duration == 1.2
    assert profile.topics.count == 1
    assert profile.topics.target_duration_min == 60
    assert profile.topics.target_duration_max == 90
    assert profile.rewrite.target_duration_min == 60
    assert profile.rewrite.target_duration_max == 90
    assert profile.rewrite.spoken_chars_per_second == 5.0
    assert profile.tts.speed == 1.0
    assert profile.compose.brand == "知点拆解局"
    assert profile.compose.video_w == 1080


def test_load_style_profile_from_custom_path(tmp_path: Path) -> None:
    prompt_path = tmp_path / "script.md"
    prompt_path.write_text("custom prompt", encoding="utf-8")
    profile_path = tmp_path / "custom.toml"
    profile_path.write_text(
        """
name = "custom"

[prompts]
script_system = "script.md"

[compose]
brand = "自定义账号"
subtitle_font_size = 54
bg_color = [1, 2, 3]
""".strip(),
        encoding="utf-8",
    )

    profile = load_style_profile(tmp_path, "ignored", str(profile_path))

    assert profile.name == "custom"
    assert profile.base_dir == tmp_path
    assert profile.prompts.script_system == "custom prompt"
    assert profile.compose.brand == "自定义账号"
    assert profile.compose.subtitle_font_size == 54
    assert profile.compose.bg_color == (1, 2, 3)


def test_load_style_profile_from_directory(tmp_path: Path) -> None:
    profile_dir = tmp_path / "profiles"
    prompts_dir = profile_dir / "prompts"
    prompts_dir.mkdir(parents=True)
    (prompts_dir / "script.md").write_text("directory prompt", encoding="utf-8")
    (profile_dir / "profile.toml").write_text(
        """
name = "directory-custom"

[prompts]
script_system = "prompts/script.md"
""".strip(),
        encoding="utf-8",
    )

    profile = load_style_profile(tmp_path, "custom", None)

    assert profile.name == "directory-custom"
    assert profile.base_dir == profile_dir
    assert profile.prompts.script_system == "directory prompt"


def test_require_prompt_fails_when_missing(tmp_path: Path) -> None:
    profile_path = tmp_path / "custom.toml"
    profile_path.write_text('name = "custom"', encoding="utf-8")
    profile = load_style_profile(tmp_path, "ignored", str(profile_path))

    with pytest.raises(RuntimeError, match="缺少 prompts.script_system"):
        profile.require_prompt("script_system")
