"""配置加载：从 .env 和环境变量读取。"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class LLMConfig:
    base_url: str
    api_key: str
    model: str
    temperature: float = 0.7


@dataclass(frozen=True)
class ASRConfig:
    provider: str  # "openai" | "local"
    model: str
    base_url: str | None = None
    api_key: str | None = None
    local_model: str = "medium"
    local_device: str = "cpu"


@dataclass(frozen=True)
class Config:
    llm: LLMConfig
    asr: ASRConfig
    out_dir: Path
    project_root: Path
    cookies_browser: str | None = None  # yt-dlp --cookies-from-browser: chrome/safari/firefox/brave/edge
    cookies_file: Path | None = None  # yt-dlp --cookies: 优先于 cookies_browser

    @property
    def inputs_dir(self) -> Path:
        return self.project_root / "inputs"


def _env(key: str, default: str | None = None) -> str:
    v = os.getenv(key, default)
    if v is None:
        raise RuntimeError(f"环境变量 {key} 未设置，请检查 .env")
    return v


def _optional_env(key: str) -> str | None:
    v = os.getenv(key)
    return v if v else None


def _resolve_optional_path(v: str | None) -> Path | None:
    if not v:
        return None
    p = Path(v)
    if not p.is_absolute():
        p = (Path(__file__).resolve().parent.parent / p).resolve()
    return p


def load_config() -> Config:
    project_root = Path(__file__).resolve().parent.parent
    return Config(
        llm=LLMConfig(
            base_url=_env("KB_LLM_BASE_URL"),
            api_key=_env("KB_LLM_API_KEY"),
            model=_env("KB_LLM_MODEL"),
        ),
        asr=ASRConfig(
            provider=_env("KB_ASR_PROVIDER", "openai"),
            model=_env("KB_ASR_MODEL", "whisper-1"),
            base_url=_optional_env("KB_ASR_BASE_URL"),
            api_key=_optional_env("KB_ASR_API_KEY"),
            local_model=_env("KB_ASR_LOCAL_MODEL", "medium"),
            local_device=_env("KB_ASR_LOCAL_DEVICE", "cpu"),
        ),
        out_dir=Path(_env("KB_OUT_DIR", "./out")).resolve(),
        project_root=project_root,
        cookies_browser=_optional_env("KB_COOKIES_BROWSER"),
        cookies_file=_resolve_optional_path(_optional_env("KB_COOKIES_FILE")),
    )
