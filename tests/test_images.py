from pathlib import Path

from knowbreak.config import ASRConfig, Config, IntroConfig, LLMConfig, TTSConfig
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
