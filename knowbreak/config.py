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
    local_model: str = "medium"
    local_device: str = "cpu"


@dataclass(frozen=True)
class Config:
    llm: LLMConfig
    asr: ASRConfig
    out_dir: Path
    project_root: Path

    @property
    def inputs_dir(self) -> Path:
        return self.project_root / "inputs"


def _env(key: str, default: str | None = None) -> str:
    v = os.getenv(key, default)
    if v is None:
        raise RuntimeError(f"环境变量 {key} 未设置，请检查 .env")
    return v


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
            local_model=_env("KB_ASR_LOCAL_MODEL", "medium"),
            local_device=_env("KB_ASR_LOCAL_DEVICE", "cpu"),
        ),
        out_dir=Path(_env("KB_OUT_DIR", "./out")).resolve(),
        project_root=project_root,
    )
