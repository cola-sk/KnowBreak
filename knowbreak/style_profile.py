"""Style profile loading for prompts and output-affecting creative knobs."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr

Color = tuple[int, int, int]


class PromptProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    extract_system: str | None = None
    topics_system: str | None = None
    rewrite_system: str | None = None
    script_system: str | None = None
    storyboard_system: str | None = None
    assets_system: str | None = None
    images_system: str | None = None
    topic_seed_system: str | None = None


class GenerationProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    extract_temperature: float | None = None
    topics_temperature: float | None = None
    rewrite_temperature: float | None = None
    script_temperature: float | None = None
    storyboard_temperature: float | None = None
    assets_temperature: float | None = None
    images_temperature: float | None = None


class IntroProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    duration: float = 2.0


class TopicsProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    count: int = 1
    target_duration_min: int = 60
    target_duration_max: int = 90


class RewriteProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_duration_min: int = 60
    target_duration_max: int = 90
    spoken_chars_per_second: float = 5.0


class ComposeProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    brand: str = "知点拆解局"
    video_w: int = 1080
    video_h: int = 1920
    bg_color: Color = (14, 14, 18)
    title_color: Color = (220, 220, 224)
    text_color: Color = (255, 255, 255)
    stroke_color: Color = (0, 0, 0)
    cover_brand_color: Color = (235, 235, 238)
    cover_title_color: Color = (255, 255, 255)
    progress_bg_color: Color = (40, 40, 50)
    progress_fg_color: Color = (120, 160, 240)
    subtitle_font_size: int = 62
    title_font_size: int = 38
    cover_title_font_size: int = 88
    cover_brand_font_size: int = 36
    max_chars_per_line: int = 16
    cover_max_chars_per_line: int = 10
    text_side_margin: int = 80
    top_bar_alpha: int = 170
    bottom_overlay_alpha: int = 150
    cover_overlay_alpha: int = 120
    cover_title_overlay_alpha: int = 175
    subtitle_center_x_ratio: float = 0.5
    subtitle_center_ratio: float = 0.45
    cover_title_center_x_ratio: float = 0.5
    cover_title_center_ratio: float = 0.45
    progress_bar_ratio: float = 0.59
    progress_bar_width_ratio: float = 0.6
    progress_bar_enabled: bool = True
    cover_brand_y: int = 200
    content_title_y: int = 70
    top_bar_height: int = 150
    top_gradient_height: int = 70
    subtitle_overlay_half_height: int = 220
    cover_title_overlay_half_height: int = 260


class StyleProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    _base_dir: Path = PrivateAttr(default=Path("."))

    name: str = "default"
    description: str = ""
    prompts: PromptProfile = Field(default_factory=PromptProfile)
    generation: GenerationProfile = Field(default_factory=GenerationProfile)
    intro: IntroProfile = Field(default_factory=IntroProfile)
    topics: TopicsProfile = Field(default_factory=TopicsProfile)
    rewrite: RewriteProfile = Field(default_factory=RewriteProfile)
    compose: ComposeProfile = Field(default_factory=ComposeProfile)

    @property
    def base_dir(self) -> Path:
        return self._base_dir

    def require_prompt(self, field_name: str) -> str:
        prompt = getattr(self.prompts, field_name)
        if not prompt:
            raise RuntimeError(
                f"profile {self.name} 缺少 prompts.{field_name}，请检查 {self.base_dir / 'profile.toml'}"
            )
        return prompt


def load_style_profile(project_root: Path, profile_name: str, profile_path: str | None) -> StyleProfile:
    path = _resolve_profile_path(project_root, profile_name, profile_path)
    if path.suffix != ".toml":
        raise ValueError(f"不支持的风格 profile 格式: {path}")
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    _expand_prompt_files(data, path.parent)
    _apply_json_overrides(data, path.parent)
    _apply_project_overrides(data)
    profile = StyleProfile.model_validate(data)
    profile._base_dir = path.parent
    return profile


def _apply_project_overrides(data: dict) -> None:
    """Apply project-specific style overrides from environment variables or project files."""
    import os
    import sys

    # 1. Apply overrides from environment variable (passed during process spawn)
    env_overrides = os.getenv("KB_PROJECT_PROFILE_OVERRIDES")
    if env_overrides:
        try:
            overrides = json.loads(env_overrides)
            if isinstance(overrides, dict):
                _deep_merge(data, overrides)
        except Exception:
            pass

    # 2. Search sys.argv to find project_profile_overrides.json in any directory arguments
    for arg in sys.argv:
        try:
            p = Path(arg)
            p_abs = p.resolve()
            curr = p_abs
            # Traverse upwards to find project_profile_overrides.json
            for _ in range(5):
                if not curr or curr == curr.parent:
                    break
                overrides_file = curr / "project_profile_overrides.json"
                if overrides_file.is_file():
                    try:
                        project_overrides = json.loads(overrides_file.read_text(encoding="utf-8"))
                        if isinstance(project_overrides, dict):
                            _deep_merge(data, project_overrides)
                        break
                    except Exception:
                        pass
                curr = curr.parent
        except Exception:
            pass


def _apply_json_overrides(data: dict, base_dir: Path) -> None:
    """Deep-merge profile_overrides.json over the in-memory TOML data dict."""
    overrides_path = base_dir / "profile_overrides.json"
    if not overrides_path.exists():
        return
    try:
        overrides = json.loads(overrides_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(overrides, dict):
        return
    _deep_merge(data, overrides)


def _deep_merge(base: dict, override: dict) -> None:
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


def _resolve_profile_path(project_root: Path, profile_name: str, profile_path: str | None) -> Path:
    if profile_path:
        path = Path(profile_path)
        if not path.is_absolute():
            path = (project_root / path).resolve()
    else:
        path = project_root / "profiles" / profile_name / "profile.toml"
    if path.is_dir():
        path = path / "profile.toml"
    if not path.exists():
        raise FileNotFoundError(f"风格 profile 不存在: {path}")
    return path


def _expand_prompt_files(data: dict, base_dir: Path) -> None:
    prompts = data.get("prompts")
    if not isinstance(prompts, dict):
        return
    for key, value in list(prompts.items()):
        if not isinstance(value, str):
            continue
        prompt_path = Path(value)
        if not prompt_path.is_absolute():
            prompt_path = base_dir / prompt_path
        if prompt_path.exists() and prompt_path.is_file():
            prompts[key] = prompt_path.read_text(encoding="utf-8").strip()
