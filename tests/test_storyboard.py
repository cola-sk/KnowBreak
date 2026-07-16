from pathlib import Path

from knowbreak.config import ASRConfig, Config, IntroConfig, LLMConfig, TTSConfig
from knowbreak.stages import storyboard


def _config(out_dir: Path) -> Config:
    return Config(
        llm=LLMConfig(base_url="http://example.invalid/v1", api_key="test", model="test"),
        asr=ASRConfig(provider="openai", model="test"),
        tts=TTSConfig(),
        intro=IntroConfig(),
        out_dir=out_dir,
        project_root=out_dir.parent,
    )


def test_storyboard_defaults_empty_subtitle_to_narration(tmp_path: Path, monkeypatch) -> None:
    scripts_path = tmp_path / "scripts.json"
    scripts_path.write_text(
        """{
          "video_id": "video123",
          "scripts": [
            {
              "topic_index": 0,
              "title": "测试",
              "lines": [
                {"text": "这是一句口播。", "estimated_seconds": 3}
              ],
              "total_duration": 3
            }
          ]
        }""",
        encoding="utf-8",
    )

    class FakeLLM:
        def __init__(self, _cfg):
            pass

        def chat_json(self, _system_prompt, _user_prompt, schema, **_kwargs):
            return schema(
                shots=[
                    {
                        "narration": "这是一句口播。",
                        "visual": "测试画面",
                        "broll": "test b-roll",
                        "subtitle": "",
                        "duration": 3,
                    }
                ]
            )

    monkeypatch.setattr(storyboard, "LLM", FakeLLM)

    result = storyboard.run(scripts_path, _config(tmp_path / "out"), prompt="test")

    shot = result.storyboards[0].shots[0]
    assert shot.narration == "这是一句口播。"
    assert shot.subtitle == "这是一句口播。"
