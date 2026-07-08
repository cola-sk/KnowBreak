import base64
from pathlib import Path

from knowbreak.config import ASRConfig, Config, IntroConfig, LLMConfig, TTSConfig
from knowbreak.stages import tts


def _config(out_dir: Path, tts_cfg: TTSConfig) -> Config:
    return Config(
        llm=LLMConfig(base_url="http://example.invalid/v1", api_key="test", model="test"),
        asr=ASRConfig(provider="openai", model="test"),
        tts=tts_cfg,
        intro=IntroConfig(),
        out_dir=out_dir,
        project_root=out_dir.parent,
    )


def test_normalize_provider_aliases() -> None:
    assert tts._normalize_provider("edge") == "edge"
    assert tts._normalize_provider("volc") == "volcengine"
    assert tts._normalize_provider("mini_max") == "minimax"


def test_minimax_writes_hex_audio(tmp_path: Path, monkeypatch) -> None:
    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "base_resp": {"status_code": 0},
                "data": {"audio": "000102ff"},
            }

    def fake_post(*args, **kwargs):
        return Response()

    monkeypatch.setattr(tts.httpx, "post", fake_post)
    out = tmp_path / "line.mp3"
    cfg = _config(tmp_path / "out", TTSConfig(minimax_api_key="key"))

    tts._synth_minimax("测试", out, cfg)

    assert out.read_bytes() == bytes([0, 1, 2, 255])


def test_volcengine_seed_writes_chunked_base64_audio(tmp_path: Path, monkeypatch) -> None:
    payload = b"seed-mp3"

    class StreamResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args) -> None:
            return None

        def raise_for_status(self) -> None:
            return None

        def iter_lines(self):
            yield '{"code":0,"data":"' + base64.b64encode(payload).decode("ascii") + '"}'

    def fake_stream(*args, **kwargs):
        return StreamResponse()

    monkeypatch.setattr(tts.httpx, "stream", fake_stream)
    out = tmp_path / "line.mp3"
    cfg = _config(tmp_path / "out", TTSConfig(volc_api_key="key"))

    tts._synth_volcengine("测试", out, cfg)

    assert out.read_bytes() == payload
