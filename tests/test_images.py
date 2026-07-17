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


def test_images_skips_text_only_card_shot_only_when_enabled(tmp_path: Path, monkeypatch) -> None:
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
                    title="洗冤集录测试",
                    shots=[
                        StoryboardShot(
                            index=0,
                            narration="",
                            visual="",
                            broll="",
                            subtitle="《洗冤集录》说明文字",
                            duration=12.0,
                        ),
                        StoryboardShot(
                            index=1,
                            narration="《洗冤集录》系列：测试案。",
                            visual="宋代案卷摆在桌上，近景",
                            broll="song dynasty forensic documents",
                            subtitle="《洗冤集录》系列：测试案。",
                            duration=3.0,
                        ),
                    ],
                )
            ],
        ).model_dump_json(),
        encoding="utf-8",
    )
    cfg = Config(
        llm=LLMConfig(base_url="http://example.invalid/v1", api_key="test", model="test"),
        asr=ASRConfig(provider="openai", model="test"),
        tts=TTSConfig(),
        intro=IntroConfig(),
        out_dir=out_dir,
        project_root=tmp_path,
        image_providers=("pollinations",),
    )

    class FakeLLM:
        def __init__(self, _cfg):
            pass

        def chat_json(self, _system_prompt, _user_prompt, schema, **_kwargs):
            return schema(
                cover_keywords=["song dynasty forensic"],
                cover_generation_prompt="cover prompt",
                shots=[
                    {"index": 0, "keywords": ["ancient book"], "generation_prompt": "should be skipped"},
                    {"index": 1, "keywords": ["song dynasty archive"], "generation_prompt": "story shot"},
                ],
            )

    calls: list[Path] = []

    def fake_fetch_cover_image(*_args, **_kwargs):
        return None

    def fake_fetch_with_fallbacks(_cfg, _providers, _queries, out_path, _used_source_urls, *, gen_prompt=None):
        calls.append(out_path)
        out_path.write_bytes(b"fake-jpeg")
        return {
            "provider": "pollinations",
            "mode": "generate",
            "query": "song dynasty archive",
            "prompt": gen_prompt or "",
        }

    monkeypatch.setattr(images, "LLM", FakeLLM)
    monkeypatch.setattr(images, "_fetch_cover_image", fake_fetch_cover_image)
    monkeypatch.setattr(images, "_fetch_with_fallbacks", fake_fetch_with_fallbacks)

    result = images.run(storyboards_path, cfg, prompt="test")

    assert calls == [
        pdir / "images" / "0" / "shot_000.jpg",
        pdir / "images" / "0" / "shot_001.jpg",
    ]
    assert [shot["shot_index"] for shot in result[0]["shots"]] == [0, 1]

    calls.clear()
    result = images.run(storyboards_path, cfg, prompt="test", skip_text_only_cards=True)

    assert calls == [pdir / "images" / "0" / "shot_001.jpg"]
    assert len(result[0]["shots"]) == 1
    shot_image = result[0]["shots"][0]
    assert shot_image["shot_index"] == 1
    assert shot_image["image_path"] == "video123/images/0/shot_001.jpg"
    assert shot_image["provider"] == "pollinations"
    assert shot_image["query"] == "song dynasty archive"
    assert "Core scene: story shot" in shot_image["prompt"]
    assert "Storyboard visual: 宋代案卷摆在桌上，近景" in shot_image["prompt"]


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


def test_generated_provider_uses_contextual_prompt_and_preserves_query(tmp_path: Path, monkeypatch) -> None:
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
        image_providers=("cloudflare_workers",),
        cloudflare_account_id="account",
        cloudflare_api_token="token",
    )
    shot = StoryboardShot(
        index=3,
        narration="宋慈发现骨头上的伤痕不是棺木压出来的。",
        visual="宋慈蹲在坟边检查一根肋骨",
        broll="bamboo steamer, vinegar jar, rib bone evidence",
        subtitle="伤痕会说话",
        duration=3.0,
    )
    generated_prompt = images._build_shot_generated_prompt("宋代法医谜案", shot, "rib bone forensic")
    captured: dict[str, str] = {}

    def fake_generate_text_to_image(cfg, prompt: str, *, provider: str, width: int = 1080, height: int = 1920):
        captured["prompt"] = prompt
        return GeneratedImage(
            content=b"fake-jpeg",
            metadata={
                "mode": "generate",
                "source_url": "",
                "creator": "ai_generated",
                "license": "provider_terms",
                "prompt": prompt,
                "model": cfg.cloudflare_image_model,
                "width": width,
                "height": height,
            },
        )

    monkeypatch.setattr(images, "generate_text_to_image", fake_generate_text_to_image)

    meta = images._fetch_with_fallbacks(
        cfg,
        ["cloudflare_workers"],
        ["rib bone forensic"],
        out_path,
        set(),
        gen_prompt=generated_prompt,
    )

    assert captured["prompt"].startswith("Create one vertical 9:16 image")
    assert "Core scene: 宋慈蹲在坟边检查一根肋骨" in captured["prompt"]
    assert "- B-roll / reference material: bamboo steamer, vinegar jar, rib bone evidence" in captured["prompt"]
    assert meta is not None
    assert meta["provider"] == "cloudflare_workers"
    assert meta["query"] == "rib bone forensic"
    assert meta["prompt"] == captured["prompt"]


def test_search_provider_ignores_generated_prompt(tmp_path: Path, monkeypatch) -> None:
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
        image_providers=("pexels",),
        pexels_api_key="pexels_key",
    )
    captured: dict[str, str] = {}

    def fake_fetch_pexels(api_key: str, query: str, out_path: Path, used_source_urls: set[str]):
        captured["query"] = query
        out_path.write_bytes(b"fake-jpeg")
        return {
            "mode": "search",
            "source_url": "https://example.invalid/photo",
            "creator": "tester",
            "license": "Pexels License",
            "width": 1080,
            "height": 1920,
        }

    monkeypatch.setattr(images, "_fetch_pexels", fake_fetch_pexels)

    meta = images._fetch_with_fallbacks(
        cfg,
        ["pexels"],
        ["short search keywords"],
        out_path,
        set(),
        gen_prompt="Create one vertical 9:16 image with lots of context.",
    )

    assert captured["query"] == "short search keywords"
    assert meta is not None
    assert meta["provider"] == "pexels"
    assert meta["query"] == "short search keywords"
    assert "prompt" not in meta
