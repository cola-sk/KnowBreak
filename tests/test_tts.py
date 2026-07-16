import base64
from pathlib import Path

from knowbreak.config import ASRConfig, Config, IntroConfig, LLMConfig, TTSConfig
from knowbreak.models import Script, ScriptLine, Scripts
from knowbreak.stages import tts


def _config(out_dir: Path, tts_cfg: TTSConfig) -> Config:
    return Config(
        llm=LLMConfig(base_url="http://example.invalid/v1", api_key="test", model="test"),
        asr=ASRConfig(provider="openai", model="test"),
        tts=tts_cfg,
        intro=IntroConfig(cover_narration_enabled=False),
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
    requests: list[dict] = []

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
        requests.append(kwargs)
        return StreamResponse()

    monkeypatch.setattr(tts.httpx, "stream", fake_stream)
    out = tmp_path / "line.mp3"
    cfg = _config(tmp_path / "out", TTSConfig(volc_api_key="key", speed=1.5))

    tts._synth_volcengine("测试", out, cfg)

    assert out.read_bytes() == payload
    assert requests[0]["json"]["req_params"]["audio_params"]["speech_rate"] == 50


def test_tts_empty_line_generates_silence_without_provider(tmp_path: Path, monkeypatch) -> None:
    out_dir = tmp_path / "out"
    pdir = out_dir / "video123"
    pdir.mkdir(parents=True)
    scripts_path = pdir / "scripts.json"
    scripts_path.write_text(
        Scripts(
            video_id="video123",
            scripts=[
                Script(
                    topic_index=0,
                    title="测试",
                    lines=[ScriptLine(text="", estimated_seconds=2.5)],
                    total_duration=2.5,
                )
            ],
        ).model_dump_json(),
        encoding="utf-8",
    )
    silence_calls: list[tuple[Path, float]] = []

    def fake_silence(path: Path, duration: float) -> None:
        silence_calls.append((path, duration))
        path.write_bytes(b"silent")

    monkeypatch.setattr(tts, "_synth_silence", fake_silence)
    monkeypatch.setattr(tts, "_probe_duration", lambda _path: 2.5)
    monkeypatch.setattr(tts, "_concat_mp3", lambda _paths, out_path, _out_dir: out_path.write_bytes(b"full"))
    monkeypatch.setattr(tts, "_synth", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("provider should not be called")))

    result = tts.run(scripts_path, _config(out_dir, TTSConfig()))

    assert silence_calls == [(pdir / "tts" / "0" / "line_000.mp3", 2.5)]
    assert result.scripts[0].lines[0].text == ""
    assert result.scripts[0].lines[0].duration == 2.5
