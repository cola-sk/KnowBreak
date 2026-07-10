from pathlib import Path

from knowbreak.config import ASRConfig, Config, IntroConfig, LLMConfig, TTSConfig
from knowbreak.capabilities.text_to_image import GeneratedImage
from knowbreak.models import Storyboard, Storyboards, StoryboardShot
from knowbreak.stages import images


def _config(out_dir: Path) -> Config:
    return Config(
        llm=LLMConfig(base_url="http://example.invalid/v1", api_key="test", model="test"),
        asr=ASRConfig(provider="openai", model="test"),
        tts=TTSConfig(),
        intro=IntroConfig(),
        out_dir=out_dir,
        project_root=out_dir.parent,
    )


def test_images_without_provider_keys_writes_empty_manifest(tmp_path: Path) -> None:
    out_dir = tmp_path / "out"
    pdir = out_dir / "video123"
    pdir.mkdir(parents=True)
    storyboards_path = pdir / "storyboards.json"
    storyboards_path.write_text(
        Storyboards(
            video_id="video123",
            storyboards=[
                Storyboard(
                    topic_index=0,
                    title="测试选题",
                    shots=[
                        StoryboardShot(
                            index=0,
                            narration="测试口播",
                            visual="骨骼示意图",
                            broll="bone density illustration",
                            subtitle="骨密度",
                            duration=3.0,
                        )
                    ],
                )
            ],
        ).model_dump_json(),
        encoding="utf-8",
    )

    result = images.run(storyboards_path, _config(out_dir))

    assert result == [{"topic_index": 0, "title": "测试选题", "cover": None, "shots": []}]
    assert (pdir / "images.json").exists()


def test_pollinations_provider_is_active_without_key(tmp_path: Path) -> None:
    cfg = Config(
        llm=LLMConfig(base_url="http://example.invalid/v1", api_key="test", model="test"),
        asr=ASRConfig(provider="openai", model="test"),
        tts=TTSConfig(),
        intro=IntroConfig(),
        out_dir=tmp_path / "out",
        project_root=tmp_path,
        image_providers=("pollinations",),
    )

    assert images._active_providers(cfg) == ["pollinations"]


def test_generated_providers_require_credentials_for_pipeline(tmp_path: Path) -> None:
    base = dict(
        llm=LLMConfig(base_url="http://example.invalid/v1", api_key="test", model="test"),
        asr=ASRConfig(provider="openai", model="test"),
        tts=TTSConfig(),
        intro=IntroConfig(),
        out_dir=tmp_path / "out",
        project_root=tmp_path,
        image_providers=("cloudflare_workers", "huggingface"),
    )

    assert images._active_providers(Config(**base)) == []
    assert images._active_providers(Config(
        **base,
        cloudflare_account_id="account",
        cloudflare_api_token="token",
        huggingface_api_token="hf_token",
    )) == ["cloudflare_workers", "huggingface"]


def test_generated_provider_fetch_writes_generated_image_metadata(tmp_path: Path, monkeypatch) -> None:
    out_dir = tmp_path / "out"
    out_path = out_dir / "video123" / "images" / "0" / "shot_000.jpg"
    out_path.parent.mkdir(parents=True)
    cfg = Config(
        llm=LLMConfig(base_url="http://example.invalid/v1", api_key="test", model="test"),
        asr=ASRConfig(provider="openai", model="test"),
        tts=TTSConfig(),
        intro=IntroConfig(),
        out_dir=out_dir,
        project_root=tmp_path,
        image_providers=("huggingface",),
        huggingface_api_token="hf_token",
        huggingface_image_model="stabilityai/sdxl",
    )

    def fake_generate_text_to_image(cfg, prompt: str, *, provider: str, width: int = 1080, height: int = 1920):
        assert provider == "huggingface"
        return GeneratedImage(
            content=b"fake-jpeg",
            metadata={
                "mode": "generate",
                "source_url": "",
                "creator": "ai_generated",
                "license": "provider_terms",
                "prompt": prompt,
                "model": cfg.huggingface_image_model,
                "width": width,
                "height": height,
            },
        )

    monkeypatch.setattr(images, "generate_text_to_image", fake_generate_text_to_image)

    meta = images._fetch_with_fallbacks(
        cfg,
        ["huggingface"],
        ["science diagram"],
        out_path,
        set(),
    )

    assert out_path.read_bytes() == b"fake-jpeg"
    assert meta is not None
    assert meta["provider"] == "huggingface"
    assert meta["mode"] == "generate"
    assert meta["prompt"] == "science diagram"
    assert meta["model"] == "stabilityai/sdxl"
