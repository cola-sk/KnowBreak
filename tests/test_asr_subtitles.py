from pathlib import Path

from knowbreak.config import ASRConfig, Config, IntroConfig, LLMConfig, TTSConfig
from knowbreak.stages import asr


def _config(out_dir: Path) -> Config:
    return Config(
        llm=LLMConfig(base_url="http://example.invalid/v1", api_key="test", model="test"),
        asr=ASRConfig(provider="openai", model="test"),
        tts=TTSConfig(),
        intro=IntroConfig(),
        out_dir=out_dir,
        project_root=out_dir.parent,
    )


def test_run_prefers_local_sidecar_srt(tmp_path: Path) -> None:
    video = tmp_path / "source.mp4"
    video.write_bytes(b"not a real video")
    video.with_suffix(".srt").write_text(
        """1
00:00:01,000 --> 00:00:02,500
第一句字幕

2
00:00:03,000 --> 00:00:05,000
第二句字幕
""",
        encoding="utf-8",
    )

    transcript = asr.run(str(video), _config(tmp_path / "out"))

    assert transcript.method == "subtitle"
    assert transcript.duration == 5.0
    assert [segment.text for segment in transcript.segments] == ["第一句字幕", "第二句字幕"]
    assert Path(transcript.transcript_source or "").name == "source.srt"
