from pathlib import Path

import pytest

from knowbreak.capabilities import text_to_image
from knowbreak.config import ASRConfig, Config, IntroConfig, LLMConfig, TTSConfig


def _config(tmp_path: Path, **overrides) -> Config:
    values = {
        "llm": LLMConfig(base_url="http://example.invalid/v1", api_key="test", model="test"),
        "asr": ASRConfig(provider="openai", model="test"),
        "tts": TTSConfig(),
        "intro": IntroConfig(),
        "out_dir": tmp_path / "out",
        "project_root": tmp_path,
    }
    values.update(overrides)
    return Config(**values)


class _Response:
    def __init__(self, *, status_code=200, payload=None, content=b"", content_type="application/json"):
        self.status_code = status_code
        self._payload = payload
        self.content = content
        self.headers = {"content-type": content_type}
        self.text = "" if payload is None else str(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def test_volcengine_generation_downloads_ark_image(tmp_path: Path, monkeypatch) -> None:
    cfg = _config(
        tmp_path,
        volcengine_image_api_key="secret",
        volcengine_image_model="ep-test",
        volcengine_image_base_url="https://ark.example/api/v3/",
        volcengine_image_size="2K",
    )
    request: dict = {}

    def fake_post(url, *, headers, json, timeout):
        request.update(url=url, headers=headers, json=json, timeout=timeout)
        return _Response(payload={"data": [{"url": "https://image.example/result.png"}]})

    def fake_get(url, *, timeout, follow_redirects):
        assert url == "https://image.example/result.png"
        assert timeout == 180
        assert follow_redirects is True
        return _Response(content=b"\x89PNG\r\n\x1a\nimage", content_type="image/png")

    monkeypatch.setattr(text_to_image.httpx, "post", fake_post)
    monkeypatch.setattr(text_to_image.httpx, "get", fake_get)

    generated = text_to_image.generate_text_to_image(
        cfg,
        "a volcano cloud over an ancient city",
        provider="volcengine",
        width=1080,
        height=1920,
    )

    assert request["url"] == "https://ark.example/api/v3/images/generations"
    assert request["headers"]["Authorization"] == "Bearer secret"
    assert request["json"] == {
        "model": "ep-test",
        "prompt": "a volcano cloud over an ancient city",
        "sequential_image_generation": "disabled",
        "response_format": "url",
        "size": "2K",
        "stream": False,
        "watermark": False,
    }
    assert generated.content.startswith(b"\x89PNG")
    assert generated.metadata["model"] == "ep-test"
    assert generated.metadata["width"] == 1080
    assert generated.metadata["height"] == 1920


def test_volcengine_generation_requires_api_key(tmp_path: Path) -> None:
    cfg = _config(tmp_path)

    with pytest.raises(ValueError, match="KB_VOLCENGINE_IMAGE_API_KEY"):
        text_to_image.generate_text_to_image(cfg, "test", provider="volcengine")
