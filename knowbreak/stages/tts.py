"""阶段 8：TTS 配音。

输入：scripts.json
输出：每个选题每句一个 mp3 + 拼接后的完整 mp3 + tts.json

支持 OpenAI / 火山 Seed Audio / MiniMax / edge-tts。非 edge provider 失败后自动切到 edge 兜底。
"""

from __future__ import annotations

import asyncio
import base64
import json
import subprocess
import uuid
from pathlib import Path

import httpx
from openai import OpenAI

from ..config import Config
from ..models import Scripts, TTSLine, TTSResult, TTSScript
from ._common import save_json

SUPPORTED_PROVIDERS = {"edge", "openai", "volcengine", "minimax"}


def _get_tts_config_dict(cfg: Config, provider: str) -> dict:
    d = {"provider": provider}
    if provider == "edge":
        d.update({
            "voice": cfg.tts.voice,
            "rate": cfg.tts.rate,
            "volume": cfg.tts.volume,
        })
    elif provider == "openai":
        d.update({
            "model": cfg.tts.openai_model,
            "voice": cfg.tts.openai_voice,
            "speed": cfg.tts.speed,
        })
    elif provider == "volcengine":
        d.update({
            "model": cfg.tts.volc_model,
            "speaker": cfg.tts.volc_speaker,
            "context": cfg.tts.volc_context,
            "sample_rate": cfg.tts.volc_sample_rate,
            "speech_rate": cfg.tts.volc_speech_rate,
            "loudness_rate": cfg.tts.volc_loudness_rate,
            "pitch_rate": cfg.tts.volc_pitch_rate,
        })
    elif provider == "minimax":
        d.update({
            "model": cfg.tts.minimax_model,
            "voice_id": cfg.tts.minimax_voice_id,
            "speed": cfg.tts.speed,
        })
    return d


def _get_hash(text: str, config_dict: dict) -> str:
    import hashlib
    data = {
        "text": text,
        "config": config_dict
    }
    dumped = json.dumps(data, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(dumped.encode("utf-8")).hexdigest()


def run(scripts_path: Path, cfg: Config) -> TTSResult:
    import shutil
    scripts: Scripts = Scripts.model_validate_json(scripts_path.read_text(encoding="utf-8"))
    pdir = scripts_path.resolve().parent
    tts_dir = pdir / "tts"
    tts_dir.mkdir(exist_ok=True)
    provider = _normalize_provider(cfg.tts.provider)

    # Initialize cache under out_dir/.cache/tts
    cache_dir = cfg.out_dir / ".cache" / "tts"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_index_path = cache_dir / "index.json"
    if cache_index_path.exists():
        try:
            cache_index = json.loads(cache_index_path.read_text(encoding="utf-8"))
        except Exception:
            cache_index = {}
    else:
        cache_index = {}

    result_scripts: list[TTSScript] = []
    for script in scripts.scripts:
        script_dir = tts_dir / str(script.topic_index)
        script_dir.mkdir(exist_ok=True)

        line_audios: list[TTSLine] = []
        for i, line in enumerate(script.lines):
            mp3 = script_dir / f"line_{i:03d}.mp3"
            
            # Compute cache key based on text and provider config
            prov_config = _get_tts_config_dict(cfg, provider)
            cache_key = _get_hash(line.text, prov_config)
            
            cached_item = cache_index.get(cache_key)
            cached_file = cache_dir / f"{cache_key}.mp3"
            
            if cached_item and cached_file.exists():
                shutil.copy(cached_file, mp3)
                actual_provider = cached_item["actual_provider"]
                dur = cached_item["duration"]
                print(f"  ✓ [TTS Cache Hit] topic {script.topic_index} line {i}: {actual_provider} (duration: {dur}s)")
            else:
                actual_provider = _synth(line.text, mp3, cfg, provider)
                dur = _probe_duration(mp3)
                
                # Copy to cache
                shutil.copy(mp3, cached_file)
                # Update index
                cache_index[cache_key] = {
                    "text": line.text,
                    "requested_provider": provider,
                    "actual_provider": actual_provider,
                    "duration": dur,
                }
                try:
                    cache_index_path.write_text(
                        json.dumps(cache_index, ensure_ascii=False, indent=2),
                        encoding="utf-8"
                    )
                except Exception as e:
                    print(f"  Warning: failed to save tts cache index: {e}")

            line_audios.append(TTSLine(
                index=i,
                text=line.text,
                audio_path=str(mp3.relative_to(cfg.out_dir)),
                duration=dur,
            ))

        full_mp3 = script_dir / "full.mp3"
        _concat_mp3([la.audio_path for la in line_audios], full_mp3, cfg.out_dir)
        full_dur = _probe_duration(full_mp3)

        result_scripts.append(TTSScript(
            topic_index=script.topic_index,
            title=script.title,
            lines=line_audios,
            full_audio_path=str(full_mp3.relative_to(cfg.out_dir)),
            total_duration=full_dur,
        ))

    result = TTSResult(video_id=scripts.video_id, scripts=result_scripts)
    save_json(result, pdir / "tts.json")
    return result


def _normalize_provider(provider: str) -> str:
    normalized = provider.strip().lower()
    aliases = {
        "volc": "volcengine",
        "volcano": "volcengine",
        "huoshan": "volcengine",
        "mini-max": "minimax",
        "mini_max": "minimax",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in SUPPORTED_PROVIDERS:
        raise ValueError(
            f"未知 TTS provider: {provider}，支持: {', '.join(sorted(SUPPORTED_PROVIDERS))}"
        )
    return normalized


def _synth(text: str, out_path: Path, cfg: Config, provider: str) -> str:
    if provider == "edge":
        _synth_edge(text, out_path, cfg)
        return provider
    try:
        if provider == "openai":
            _synth_openai(text, out_path, cfg)
        elif provider == "volcengine":
            _synth_volcengine(text, out_path, cfg)
        elif provider == "minimax":
            _synth_minimax(text, out_path, cfg)
        return provider
    except Exception as e:
        print(f"  - TTS provider {provider} 失败，切换 edge 兜底: {e!r}")
        _synth_edge(text, out_path, cfg)
        return "edge"


def _synth_edge(text: str, out_path: Path, cfg: Config) -> None:
    asyncio.run(_synth_edge_async(text, out_path, cfg))


async def _synth_edge_async(text: str, out_path: Path, cfg: Config) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(
        text,
        voice=cfg.tts.voice,
        rate=cfg.tts.rate,
        volume=cfg.tts.volume,
    )
    await communicate.save(str(out_path))


def _synth_openai(text: str, out_path: Path, cfg: Config) -> None:
    if not cfg.tts.openai_api_key:
        raise RuntimeError("未配置 KB_OPENAI_TTS_API_KEY 或 OPENAI_API_KEY")
    client = OpenAI(
        api_key=cfg.tts.openai_api_key,
        base_url=cfg.tts.openai_base_url,
        timeout=cfg.tts.timeout,
    )
    resp = client.audio.speech.create(
        model=cfg.tts.openai_model,
        voice=cfg.tts.openai_voice,
        input=text,
        response_format="mp3",
        speed=cfg.tts.speed,
    )
    resp.write_to_file(out_path)


def _synth_volcengine(text: str, out_path: Path, cfg: Config) -> None:
    if not cfg.tts.volc_api_key:
        raise RuntimeError("未配置 KB_VOLC_TTS_API_KEY")
    payload: dict = {
        "user": {"uid": "knowbreak"},
        "req_params": {
            "text": text,
            "speaker": cfg.tts.volc_speaker,
            "audio_params": {
                "format": "mp3",
                "sample_rate": cfg.tts.volc_sample_rate,
                "speech_rate": cfg.tts.volc_speech_rate,
                "loudness_rate": cfg.tts.volc_loudness_rate,
                "pitch_rate": cfg.tts.volc_pitch_rate,
            },
        },
    }
    if cfg.tts.volc_context:
        payload["req_params"]["context_texts"] = [cfg.tts.volc_context]

    audio_chunks: list[bytes] = []
    with httpx.stream(
        "POST",
        cfg.tts.volc_url,
        headers={
            "X-Api-Key": cfg.tts.volc_api_key,
            "X-Api-Resource-Id": cfg.tts.volc_model,
            "X-Api-Request-Id": str(uuid.uuid4()),
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=cfg.tts.timeout,
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            chunk = _parse_volcengine_chunk(line)
            if chunk:
                audio_chunks.append(chunk)
    if not audio_chunks:
        raise RuntimeError("火山 Seed TTS 响应缺少音频数据")
    out_path.write_bytes(b"".join(audio_chunks))


def _parse_volcengine_chunk(line: str | bytes) -> bytes | None:
    if isinstance(line, bytes):
        line = line.decode("utf-8", errors="ignore")
    line = line.strip()
    if not line or line == "[DONE]":
        return None
    data = json.loads(line)
    code = data.get("code")
    if code not in (0, 20000000, None):
        raise RuntimeError(f"火山 Seed TTS 返回错误: {data}")
    audio_b64 = _find_first_string(data, {"audio", "data"})
    if not audio_b64:
        return None
    return base64.b64decode(audio_b64)


def _find_first_string(value, keys: set[str]) -> str | None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in keys and isinstance(item, str) and item:
                return item
        for item in value.values():
            found = _find_first_string(item, keys)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_first_string(item, keys)
            if found:
                return found
    return None


def _synth_minimax(text: str, out_path: Path, cfg: Config) -> None:
    if not cfg.tts.minimax_api_key:
        raise RuntimeError("未配置 KB_MINIMAX_TTS_API_KEY")
    params = {"GroupId": cfg.tts.minimax_group_id} if cfg.tts.minimax_group_id else None
    payload = {
        "model": cfg.tts.minimax_model,
        "text": text,
        "stream": False,
        "voice_setting": {
            "voice_id": cfg.tts.minimax_voice_id,
            "speed": cfg.tts.speed,
            "vol": 1.0,
            "pitch": 0,
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
    }
    resp = httpx.post(
        cfg.tts.minimax_url,
        params=params,
        headers={
            "Authorization": f"Bearer {cfg.tts.minimax_api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=cfg.tts.timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    status_code = (data.get("base_resp") or {}).get("status_code")
    if status_code not in (0, None):
        raise RuntimeError(f"MiniMax TTS 返回错误: {data}")
    audio_hex = (data.get("data") or {}).get("audio") or data.get("audio")
    if not audio_hex:
        raise RuntimeError(f"MiniMax TTS 响应缺少音频数据: {data}")
    out_path.write_bytes(bytes.fromhex(audio_hex))


def _probe_duration(mp3: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(mp3)],
        check=True, capture_output=True, text=True,
    )
    return float(out.stdout.strip())


def _concat_mp3(rel_paths: list[str], out_path: Path, out_dir: Path) -> None:
    """用 ffmpeg concat demuxer 拼接 mp3。"""
    list_file = out_path.parent / "concat_list.txt"
    list_file.write_text(
        "\n".join(f"file '{(out_dir / p).resolve()}'" for p in rel_paths),
        encoding="utf-8",
    )
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
         "-i", str(list_file), "-c", "copy", str(out_path)],
        check=True, capture_output=True,
    )
    list_file.unlink(missing_ok=True)
