"""配置加载：从 .env 和环境变量读取。"""

from __future__ import annotations

import os
import json
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

from .style_profile import StyleProfile, load_style_profile

load_dotenv()


@dataclass(frozen=True)
class LLMConfig:
    base_url: str
    api_key: str
    model: str
    temperature: float | None = None
    timeout: float = 300.0


@dataclass(frozen=True)
class ASRConfig:
    provider: str  # "openai" | "local"
    model: str
    base_url: str | None = None
    api_key: str | None = None
    local_model: str = "medium"
    local_device: str = "cpu"


@dataclass(frozen=True)
class TTSConfig:
    provider: str = "edge"
    voice: str = "zh-CN-XiaoxiaoNeural"
    rate: str = "+0%"  # 语速，如 +10% / -5%
    volume: str = "+0%"
    speed: float = 1.0
    timeout: float = 60.0
    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini-tts"
    openai_voice: str = "alloy"
    volc_api_key: str | None = None
    volc_model: str = "seed-tts-2.0"
    volc_url: str = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
    volc_speaker: str = "zh_female_xiaohe_uranus_bigtts"
    volc_context: str = "自然、清晰、克制的中文科普男声，语速适中，不要背景音乐和音效。"
    volc_sample_rate: int = 24000
    volc_speech_rate: int = 0
    volc_loudness_rate: int = 0
    volc_pitch_rate: int = 0
    minimax_api_key: str | None = None
    minimax_group_id: str | None = None
    minimax_model: str = "speech-02-turbo"
    minimax_voice_id: str = "Chinese (Mandarin)_News_Anchor"
    minimax_url: str = "https://api.minimaxi.com/v1/t2a_v2"


@dataclass(frozen=True)
class IntroConfig:
    enabled: bool = True
    duration: float = 2.0
    cover_narration_enabled: bool = True  # 封面帧是否朗读标题口播


@dataclass(frozen=True)
class Config:
    llm: LLMConfig
    asr: ASRConfig
    tts: TTSConfig
    intro: IntroConfig
    out_dir: Path
    project_root: Path
    profile: StyleProfile = field(default_factory=StyleProfile)
    cookies_browser: str | None = None  # yt-dlp --cookies-from-browser: chrome/safari/firefox/brave/edge
    cookies_file: Path | None = None  # yt-dlp --cookies: 优先于 cookies_browser
    image_providers: tuple[str, ...] = ("pexels", "pixabay")
    pexels_api_key: str | None = None
    pixabay_api_key: str | None = None
    pollinations_api_key: str | None = None
    pollinations_image_model: str | None = None
    cloudflare_account_id: str | None = None
    cloudflare_api_token: str | None = None
    cloudflare_image_model: str = "@cf/black-forest-labs/flux-1-schnell"
    huggingface_api_token: str | None = None
    huggingface_image_model: str = "black-forest-labs/FLUX.1-schnell"
    huggingface_image_base_url: str = "https://router.huggingface.co/hf-inference/models"
    volcengine_image_api_key: str | None = None
    volcengine_image_model: str = "doubao-seedream-4-0-250828"
    volcengine_image_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    volcengine_image_size: str = "2K"

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


def _project_runtime_overrides_section(section: str) -> dict:
    raw = os.getenv("KB_PROJECT_RUNTIME_OVERRIDES")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    value = parsed.get(section)
    return value if isinstance(value, dict) else {}


def _global_runtime_overrides_section(project_root: Path, profile_name: str, section: str) -> dict:
    overrides_path = project_root / "profiles" / "runtime_overrides.json"
    if not overrides_path.is_file():
        return {}
    try:
        parsed = json.loads(overrides_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    value = parsed.get(section)
    return value if isinstance(value, dict) else {}


def _merged_runtime_overrides_section(project_root: Path, profile_name: str, section: str) -> dict:
    merged = dict(_global_runtime_overrides_section(project_root, profile_name, section))
    merged.update(_project_runtime_overrides_section(section))
    return merged


def _runtime_tts_env(
    overrides: dict,
    field_names: tuple[str, ...],
    env_key: str,
    default: str | None = None,
) -> str:
    for field_name in field_names:
        value = overrides.get(field_name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return _env(env_key, default)


def _runtime_optional_env(
    overrides: dict,
    field_names: tuple[str, ...],
    env_key: str,
) -> str | None:
    for field_name in field_names:
        value = overrides.get(field_name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return _optional_env(env_key)


def _runtime_env(
    overrides: dict,
    field_names: tuple[str, ...],
    env_key: str,
    default: str | None = None,
) -> str:
    for field_name in field_names:
        value = overrides.get(field_name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return _env(env_key, default)


def _normalize_volc_model_speaker(model: str, speaker: str) -> tuple[str, str]:
    # BigTTS voice IDs are speakers, not X-Api-Resource-Id values.
    # Keep older mistaken env/project settings usable by moving them into speaker.
    if model.startswith("zh_") and model.endswith("_bigtts"):
        return "seed-tts-2.0", model
    return model, speaker


def _resolve_optional_path(v: str | None) -> Path | None:
    if not v:
        return None
    p = Path(v)
    if not p.is_absolute():
        p = (Path(__file__).resolve().parent.parent / p).resolve()
    return p


def _image_providers(runtime_image: dict) -> tuple[str, ...]:
    raw_override = runtime_image.get("providers")
    if isinstance(raw_override, list):
        raw = ",".join(str(item) for item in raw_override)
    elif isinstance(raw_override, str):
        raw = raw_override
    elif isinstance(runtime_image.get("provider"), str):
        raw = runtime_image["provider"]
    else:
        raw = _env("KB_IMAGE_PROVIDERS", "pexels,pixabay")
    aliases = {
        "volc": "volcengine",
        "volcano": "volcengine",
        "volc_engine": "volcengine",
        "ark": "volcengine",
        "doubao": "volcengine",
    }
    providers = tuple(
        aliases.get(normalized, normalized)
        for p in raw.split(",")
        if (normalized := p.strip().lower().replace("-", "_"))
    )
    return providers or ("pexels", "pixabay")


def _float_env(key: str, default: float) -> float:
    v = os.getenv(key)
    if not v:
        return default
    return float(v)


def _tts_speed(profile_speed: float = 1.0) -> float:
    # 优先级：profile [tts].speed > .env KB_TTS_SPEED/KB_TTS_RATE > 1.0
    if profile_speed != 1.0:
        # profile 设了非默认值，优先使用；.env 可显式覆盖
        raw_speed = os.getenv("KB_TTS_SPEED")
        if raw_speed:
            return float(raw_speed)
        return profile_speed
    # profile 没设（默认1.0），看 .env
    raw_speed = os.getenv("KB_TTS_SPEED")
    if raw_speed:
        return float(raw_speed)
    raw_rate = os.getenv("KB_TTS_RATE", "+0%").strip()
    if raw_rate.endswith("%"):
        return 1.0 + float(raw_rate[:-1]) / 100
    return 1.0


def load_config() -> Config:
    # Web 服务进程可能持有启动时的旧 env；每次加载配置时让 .env 重新成为当前运行配置。
    load_dotenv(override=True)
    project_root = Path(__file__).resolve().parent.parent
    profile_name = _env("KB_STYLE_PROFILE", "default")
    runtime_tts = _merged_runtime_overrides_section(project_root, profile_name, "tts")
    runtime_image = _merged_runtime_overrides_section(project_root, profile_name, "image")
    profile = load_style_profile(
        project_root,
        profile_name,
        _optional_env("KB_STYLE_PROFILE_PATH"),
    )
    tts_provider = _runtime_tts_env(runtime_tts, ("provider",), "KB_TTS_PROVIDER", "edge").lower()
    generic_model = runtime_tts.get("model") if isinstance(runtime_tts.get("model"), str) else None
    generic_speaker = runtime_tts.get("speaker") if isinstance(runtime_tts.get("speaker"), str) else None
    volc_model, volc_speaker = _normalize_volc_model_speaker(
        (generic_model.strip() if tts_provider == "volcengine" and generic_model and generic_model.strip() else _runtime_tts_env(
            runtime_tts,
            ("volcModel", "volc_model"),
            "KB_VOLC_TTS_MODEL",
            "seed-tts-2.0",
        )),
        (generic_speaker.strip() if tts_provider == "volcengine" and generic_speaker and generic_speaker.strip() else _runtime_tts_env(
            runtime_tts,
            ("volcSpeaker", "volc_speaker"),
            "KB_VOLC_TTS_SPEAKER",
            "zh_female_xiaohe_uranus_bigtts",
        )),
    )
    edge_voice = generic_speaker.strip() if tts_provider == "edge" and generic_speaker and generic_speaker.strip() else _runtime_tts_env(
        runtime_tts, ("voice",), "KB_TTS_VOICE", "zh-CN-XiaoxiaoNeural"
    )
    openai_model = generic_model.strip() if tts_provider == "openai" and generic_model and generic_model.strip() else _env("KB_OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
    openai_voice = generic_speaker.strip() if tts_provider == "openai" and generic_speaker and generic_speaker.strip() else _env("KB_OPENAI_TTS_VOICE", "alloy")
    minimax_model = generic_model.strip() if tts_provider == "minimax" and generic_model and generic_model.strip() else _env("KB_MINIMAX_TTS_MODEL", "speech-02-turbo")
    minimax_voice_id = generic_speaker.strip() if tts_provider == "minimax" and generic_speaker and generic_speaker.strip() else _env("KB_MINIMAX_TTS_VOICE_ID", "Chinese (Mandarin)_News_Anchor")
    return Config(
        llm=LLMConfig(
            base_url=_env("KB_LLM_BASE_URL"),
            api_key=_env("KB_LLM_API_KEY"),
            model=_env("KB_LLM_MODEL"),
            timeout=_float_env("KB_LLM_TIMEOUT", 300.0),
        ),
        asr=ASRConfig(
            provider=_env("KB_ASR_PROVIDER", "openai"),
            model=_env("KB_ASR_MODEL", "whisper-1"),
            base_url=_optional_env("KB_ASR_BASE_URL"),
            api_key=_optional_env("KB_ASR_API_KEY"),
            local_model=_env("KB_ASR_LOCAL_MODEL", "medium"),
            local_device=_env("KB_ASR_LOCAL_DEVICE", "cpu"),
        ),
        tts=TTSConfig(
            provider=tts_provider,
            voice=edge_voice,
            rate=_env("KB_TTS_RATE", "+0%"),
            volume=_env("KB_TTS_VOLUME", "+0%"),
            speed=_tts_speed(profile.tts.speed),
            timeout=_float_env("KB_TTS_TIMEOUT", 60.0),
            openai_api_key=_optional_env("KB_OPENAI_TTS_API_KEY")
            or _optional_env("OPENAI_API_KEY"),
            openai_base_url=_env("KB_OPENAI_TTS_BASE_URL", "https://api.openai.com/v1"),
            openai_model=openai_model,
            openai_voice=openai_voice,
            volc_api_key=_optional_env("KB_VOLC_TTS_API_KEY"),
            volc_model=volc_model,
            volc_url=_env(
                "KB_VOLC_TTS_URL",
                "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
            ),
            volc_speaker=volc_speaker,
            volc_context=_env(
                "KB_VOLC_TTS_CONTEXT",
                "自然、清晰、克制的中文科普男声，语速适中，不要背景音乐和音效。",
            ),
            volc_sample_rate=int(_env("KB_VOLC_TTS_SAMPLE_RATE", "24000")),
            volc_speech_rate=int(_env("KB_VOLC_TTS_SPEECH_RATE", "0")),
            volc_loudness_rate=int(_env("KB_VOLC_TTS_LOUDNESS_RATE", "0")),
            volc_pitch_rate=int(_env("KB_VOLC_TTS_PITCH_RATE", "0")),
            minimax_api_key=_optional_env("KB_MINIMAX_TTS_API_KEY"),
            minimax_group_id=_optional_env("KB_MINIMAX_TTS_GROUP_ID"),
            minimax_model=minimax_model,
            minimax_voice_id=minimax_voice_id,
            minimax_url=_env("KB_MINIMAX_TTS_URL", "https://api.minimaxi.com/v1/t2a_v2"),
        ),
        intro=IntroConfig(
            enabled=profile.intro.enabled,
            duration=profile.intro.duration,
            cover_narration_enabled=profile.intro.cover_narration_enabled,
        ),
        profile=profile,
        out_dir=Path(_env("KB_OUT_DIR", "./out")).resolve(),
        project_root=project_root,
        cookies_browser=_optional_env("KB_COOKIES_BROWSER"),
        cookies_file=_resolve_optional_path(_optional_env("KB_COOKIES_FILE")),
        image_providers=_image_providers(runtime_image),
        pexels_api_key=_optional_env("PEXELS_API_KEY") or _optional_env("KB_PEXELS_API_KEY"),
        pixabay_api_key=_optional_env("PIXABAY_API_KEY") or _optional_env("KB_PIXABAY_API_KEY"),
        pollinations_api_key=_optional_env("POLLINATIONS_API_KEY")
        or _optional_env("KB_POLLINATIONS_API_KEY"),
        pollinations_image_model=_runtime_optional_env(
            runtime_image,
            ("pollinationsModel", "pollinations_model"),
            "KB_POLLINATIONS_IMAGE_MODEL",
        ),
        cloudflare_account_id=_optional_env("KB_CLOUDFLARE_ACCOUNT_ID")
        or _optional_env("CLOUDFLARE_ACCOUNT_ID"),
        cloudflare_api_token=_optional_env("KB_CLOUDFLARE_API_TOKEN")
        or _optional_env("CLOUDFLARE_API_TOKEN"),
        cloudflare_image_model=_runtime_env(
            runtime_image,
            ("cloudflareModel", "cloudflare_model"),
            "KB_CLOUDFLARE_IMAGE_MODEL",
            "@cf/black-forest-labs/flux-1-schnell",
        ),
        huggingface_api_token=_optional_env("KB_HUGGINGFACE_API_TOKEN")
        or _optional_env("HUGGINGFACE_API_TOKEN")
        or _optional_env("HF_TOKEN"),
        huggingface_image_model=_runtime_env(
            runtime_image,
            ("huggingfaceModel", "huggingface_model"),
            "KB_HUGGINGFACE_IMAGE_MODEL",
            "black-forest-labs/FLUX.1-schnell",
        ),
        huggingface_image_base_url=_runtime_env(
            runtime_image,
            ("huggingfaceBaseUrl", "huggingface_base_url"),
            "KB_HUGGINGFACE_IMAGE_BASE_URL",
            "https://router.huggingface.co/hf-inference/models",
        ),
        volcengine_image_api_key=_optional_env("KB_VOLCENGINE_IMAGE_API_KEY")
        or _optional_env("KB_VOLC_IMAGE_API_KEY")
        or _optional_env("ARK_API_KEY"),
        volcengine_image_model=_runtime_env(
            runtime_image,
            ("volcengineModel", "volcengine_model", "volcModel", "volc_model"),
            "KB_VOLCENGINE_IMAGE_MODEL",
            "doubao-seedream-4-0-250828",
        ),
        volcengine_image_base_url=_runtime_env(
            runtime_image,
            ("volcengineBaseUrl", "volcengine_base_url", "volcBaseUrl", "volc_base_url"),
            "KB_VOLCENGINE_IMAGE_BASE_URL",
            "https://ark.cn-beijing.volces.com/api/v3",
        ),
        volcengine_image_size=_runtime_env(
            runtime_image,
            ("volcengineSize", "volcengine_size", "volcSize", "volc_size"),
            "KB_VOLCENGINE_IMAGE_SIZE",
            "2K",
        ),
    )
