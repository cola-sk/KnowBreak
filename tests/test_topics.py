from pathlib import Path

from knowbreak.config import ASRConfig, Config, IntroConfig, LLMConfig, TTSConfig
from knowbreak.models import Knowledge
from knowbreak.stages import topics
from knowbreak.style_profile import PromptProfile, StyleProfile


def _config(out_dir: Path) -> Config:
    return Config(
        llm=LLMConfig(base_url="http://example.invalid/v1", api_key="test", model="test"),
        asr=ASRConfig(provider="openai", model="test"),
        tts=TTSConfig(),
        intro=IntroConfig(),
        out_dir=out_dir,
        project_root=out_dir.parent,
        profile=StyleProfile(prompts=PromptProfile(topics_system="test prompt")),
    )


def test_topics_respects_profile_count(tmp_path: Path, monkeypatch) -> None:
    knowledge_path = tmp_path / "knowledge.json"
    knowledge_path.write_text(
        Knowledge(
            video_id="video123",
            title="测试主题",
            points=[
                {
                    "title": "知识点",
                    "summary": "摘要",
                    "key_statements": ["论断"],
                    "examples": [],
                    "source_excerpt": "原文",
                }
            ],
        ).model_dump_json(),
        encoding="utf-8",
    )

    class FakeLLM:
        def __init__(self, cfg):
            self.cfg = cfg

        def chat_json(self, system, user, schema_model, *, temperature=None):
            return schema_model.model_validate(
                {
                    "topics": [
                        {
                            "title": "第一个选题",
                            "hook": "钩子",
                            "angle": "角度",
                            "knowledge_refs": [0],
                            "target_duration": 75,
                        },
                        {
                            "title": "第二个选题",
                            "hook": "钩子",
                            "angle": "角度",
                            "knowledge_refs": [0],
                            "target_duration": 75,
                        },
                    ]
                }
            )

    monkeypatch.setattr(topics, "LLM", FakeLLM)

    result = topics.run(knowledge_path, _config(tmp_path / "out"))

    assert len(result.topics) == 1
    assert result.topics[0].title == "第一个选题"
