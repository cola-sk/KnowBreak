"""阶段 7：配图获取。

输入：storyboards.json
输出：每个分镜一张竖向 JPG + images.json 清单

流程：LLM 为每个分镜生成 2-3 个英文搜索词 → 按配置依次查询 Pexels/Pixabay → 下载第一张可用图
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
from pydantic import BaseModel, Field

from ..capabilities.text_to_image import generate_text_to_image
from ..config import Config
from ..llm import LLM
from ..models import Storyboards

PEXELS_SEARCH = "https://api.pexels.com/v1/search"
PIXABAY_SEARCH = "https://pixabay.com/api/"
MIN_DIM = 1080  # 至少 1080px 宽
GENERATED_IMAGE_PROVIDERS = {"pollinations", "cloudflare_workers", "huggingface", "volcengine"}

CONTEXT_SOURCE_LABELS = {
    "title": "Topic title",
    "visual": "Storyboard visual",
    "narration": "Storyboard narration",
    "broll": "B-roll / reference material",
    "subtitle": "Subtitle",
    "query": "Image search keywords",
    "fallback": "Default fallback",
}


class _ShotKw(BaseModel):
    index: int
    keywords: list[str]
    generation_prompt: str = Field(default="")


class _Schema(BaseModel):
    cover_keywords: list[str] = Field(default_factory=list)
    cover_generation_prompt: str = Field(default="")
    shots: list[_ShotKw]


def run(
    storyboards_path: Path,
    cfg: Config,
    only_topic: int | None = None,
    cover_only: bool = False,
    *,
    prompt: str | None = None,
    skip_text_only_cards: bool = False,
) -> list[dict]:
    boards: Storyboards = Storyboards.model_validate_json(
        storyboards_path.read_text(encoding="utf-8")
    )

    pdir = storyboards_path.resolve().parent
    images_dir = pdir / "images"
    images_dir.mkdir(exist_ok=True)
    providers = _active_providers(cfg)
    llm = LLM(cfg.llm) if providers else None
    images_json_path = pdir / "images.json"
    existing_map = _load_existing_images(images_json_path)

    result: list[dict] = []
    for board in boards.storyboards:
        if only_topic is not None and board.topic_index != only_topic:
            continue
        if llm:
            cover_keywords, cover_gen_prompt, kw_map, gen_prompt_map = _keywords_for_board(cfg, llm, board, prompt=prompt)
        else:
            cover_keywords, cover_gen_prompt, kw_map, gen_prompt_map = ([], "", {}, {})

        topic_dir = images_dir / str(board.topic_index)
        topic_dir.mkdir(exist_ok=True)

        used_source_urls: set[str] = set()
        cover = _fetch_cover_image(
            cfg,
            providers,
            board,
            cover_keywords,
            cover_gen_prompt,
            topic_dir,
            used_source_urls,
            skip_text_only_cards=skip_text_only_cards,
        )
        shot_images: list[dict] = []
        if cover_only:
            shot_images = existing_map.get(board.topic_index, {}).get("shots", [])
        else:
            for shot in board.shots:
                if skip_text_only_cards and _is_text_only_card(shot):
                    print(f"  - topic {board.topic_index} shot {shot.index}: text-only card, skip image")
                    continue
                kws = kw_map.get(shot.index, [])
                query = " ".join(kws[:2]) if kws else shot.broll[:60]
                img_path = topic_dir / f"shot_{shot.index:03d}.jpg"
                gen_prompt = _build_shot_generated_prompt(
                    board.title,
                    shot,
                    query,
                    core_prompt=gen_prompt_map.get(shot.index, ""),
                )
                meta = _fetch_with_fallbacks(
                    cfg,
                    providers,
                    [query, shot.broll[:60]],
                    img_path,
                    used_source_urls,
                    gen_prompt=gen_prompt,
                )
                if meta:
                    shot_images.append({
                        "shot_index": shot.index,
                        "image_path": str(img_path.relative_to(cfg.out_dir)),
                        **meta,
                    })
                    print(
                        f"  ✓ topic {board.topic_index} shot {shot.index}: "
                        f"{meta['provider']} / {meta['query']}"
                    )
                else:
                    print(f"  ✗ topic {board.topic_index} shot {shot.index}: {query} (no result)")

        result.append({
            "topic_index": board.topic_index,
            "title": board.title,
            "cover": cover,
            "shots": shot_images,
        })

    # 合并已存在的 images.json（避免覆盖其他 topic）
    if existing_map and (only_topic is not None or cover_only):
        for r in result:
            existing_map[r["topic_index"]] = r
        result = list(existing_map.values())
    images_json_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return result


def _load_existing_images(path: Path) -> dict[int, dict]:
    if not path.exists():
        return {}
    existing = json.loads(path.read_text(encoding="utf-8"))
    return {e["topic_index"]: e for e in existing}


def _active_providers(cfg: Config) -> list[str]:
    providers: list[str] = []
    for provider in cfg.image_providers:
        if provider == "pexels":
            if cfg.pexels_api_key:
                providers.append(provider)
            else:
                print("  - 跳过 Pexels：未配置 PEXELS_API_KEY")
        elif provider == "pixabay":
            if cfg.pixabay_api_key:
                providers.append(provider)
            else:
                print("  - 跳过 Pixabay：未配置 PIXABAY_API_KEY")
        elif provider == "pollinations":
            providers.append(provider)
        elif provider == "cloudflare_workers":
            if cfg.cloudflare_account_id and cfg.cloudflare_api_token:
                providers.append(provider)
            else:
                print("  - 跳过 Cloudflare Workers AI：未配置 KB_CLOUDFLARE_ACCOUNT_ID/KB_CLOUDFLARE_API_TOKEN")
        elif provider == "huggingface":
            if cfg.huggingface_api_token:
                providers.append(provider)
            else:
                print("  - 跳过 Hugging Face：未配置 KB_HUGGINGFACE_API_TOKEN 或 HF_TOKEN")
        elif provider == "volcengine":
            if cfg.volcengine_image_api_key:
                providers.append(provider)
            else:
                print("  - 跳过火山引擎生图：未配置 KB_VOLCENGINE_IMAGE_API_KEY 或 ARK_API_KEY")
        else:
            print(f"  - 跳过未知图片 provider：{provider}")
    if not providers:
        print("  - 未配置可用图片 provider，images 阶段只写空清单，compose 将使用纯色背景")
    return providers


def _keywords_for_board(cfg: Config, llm: LLM, board, *, prompt: str | None = None) -> tuple[list[str], str, dict[int, list[str]], dict[int, str]]:
    shots_blob = "\n".join(
        f"shot {s.index}: subtitle={s.subtitle} | visual={s.visual} | broll={s.broll}"
        for s in board.shots
    )
    schema = llm.chat_json(
        prompt or cfg.profile.require_prompt("images_system"),
        f"选题：{board.title}\n分镜：\n{shots_blob}\n",
        _Schema,
        temperature=cfg.profile.generation.images_temperature,
    )
    cover_kws = schema.cover_keywords
    cover_gen_prompt = schema.cover_generation_prompt
    kw_map = {s.index: s.keywords for s in schema.shots}
    gen_prompt_map = {s.index: s.generation_prompt for s in schema.shots}
    return cover_kws, cover_gen_prompt, kw_map, gen_prompt_map


def _fetch_cover_image(
    cfg: Config,
    providers: list[str],
    board,
    cover_keywords: list[str],
    cover_gen_prompt: str,
    topic_dir: Path,
    used_source_urls: set[str],
    *,
    skip_text_only_cards: bool = False,
) -> dict | None:
    query = " ".join(cover_keywords[:3]) if cover_keywords else board.title
    reference_shot = next(
        (shot for shot in board.shots if not (skip_text_only_cards and _is_text_only_card(shot))),
        None,
    )
    if reference_shot is None and board.shots:
        reference_shot = board.shots[0]
    first_broll = reference_shot.broll if reference_shot else ""
    cover_path = topic_dir / "cover.jpg"
    prompt_to_use = _build_cover_generated_prompt(
        board.title,
        reference_shot,
        query,
        core_prompt=cover_gen_prompt,
    )
    meta = _fetch_with_fallbacks(
        cfg,
        _cover_provider_order(providers),
        [query, first_broll, board.title],
        cover_path,
        used_source_urls,
        gen_prompt=prompt_to_use,
    )
    if meta:
        print(f"  ✓ topic {board.topic_index} cover: {meta['provider']} / {meta['query']}")
        return {
            "image_path": str(cover_path.relative_to(cfg.out_dir)),
            **meta,
        }
    print(f"  ✗ topic {board.topic_index} cover: {query} (no result)")
    return None


def _is_text_only_card(shot) -> bool:
    """A deliberate card with subtitles only; compose should use a plain background."""
    narration = str(getattr(shot, "narration", "") or "").strip()
    visual = str(getattr(shot, "visual", "") or "").strip()
    broll = str(getattr(shot, "broll", "") or "").strip()
    subtitle = str(getattr(shot, "subtitle", "") or "").strip()
    return not narration and not visual and not broll and bool(subtitle)


def _cover_provider_order(providers: list[str]) -> list[str]:
    """封面跟随 KB_IMAGE_PROVIDERS 顺序，便于按需切换 Pexels/Pixabay 优先级。"""
    return providers


def _fetch_with_fallbacks(
    cfg: Config,
    providers: list[str],
    queries: list[str],
    out_path: Path,
    used_source_urls: set[str],
    *,
    gen_prompt: str | None = None,
) -> dict | None:
    import hashlib
    import shutil

    # Initialize cache under out_dir/.cache/images
    cache_dir = cfg.out_dir / ".cache" / "images"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_index_path = cache_dir / "index.json"

    if cache_index_path.exists():
        try:
            cache_index = json.loads(cache_index_path.read_text(encoding="utf-8"))
        except Exception:
            cache_index = {}
    else:
        cache_index = {}

    gen_prompt = _compact_text(gen_prompt, 4000)
    seen: set[tuple[str, str]] = set()
    for query in [q.strip() for q in queries if q.strip()]:
        for provider in providers:
            # Resolve actual prompt to use for generation or search
            if provider in GENERATED_IMAGE_PROVIDERS:
                prompt_to_use = gen_prompt or query
            else:
                prompt_to_use = query

            key = (provider, prompt_to_use)
            if key in seen:
                continue
            seen.add(key)

            # Compute cache key based on provider, model, and the actual prompt/query.
            cache_key = hashlib.sha256(
                _cache_key_material(cfg, provider, prompt_to_use).encode("utf-8")
            ).hexdigest()
            cached_item = cache_index.get(cache_key)
            cached_file = cache_dir / f"{cache_key}.jpg"

            # Check cache
            if cached_item and cached_file.exists():
                source_url = cached_item.get("source_url")
                # Ensure the image is not already used in this video run
                if not source_url or source_url not in used_source_urls:
                    shutil.copy(cached_file, out_path)
                    if source_url:
                        used_source_urls.add(source_url)
                    print(f"    ✓ [Image Cache Hit] {provider} / {query}")
                    return {"provider": provider, "query": query, **cached_item}

            # Cache miss, fetch normally
            if provider == "pexels" and cfg.pexels_api_key:
                meta = _fetch_pexels(cfg.pexels_api_key, prompt_to_use, out_path, used_source_urls)
            elif provider == "pixabay" and cfg.pixabay_api_key:
                meta = _fetch_pixabay(cfg.pixabay_api_key, prompt_to_use, out_path, used_source_urls)
            elif provider in GENERATED_IMAGE_PROVIDERS:
                meta = _fetch_generated_image(cfg, provider, prompt_to_use, out_path)
            else:
                meta = None

            if meta:
                source_url = meta.get("source_url")
                if source_url:
                    used_source_urls.add(source_url)

                # Copy to cache
                shutil.copy(out_path, cached_file)
                # Update index
                cache_index[cache_key] = meta
                try:
                    cache_index_path.write_text(
                        json.dumps(cache_index, ensure_ascii=False, indent=2),
                        encoding="utf-8"
                    )
                except Exception as e:
                    print(f"  Warning: failed to save image cache index: {e}")

                return {"provider": provider, "query": query, **meta}
    return None


def _fetch_pexels(
    api_key: str,
    query: str,
    out_path: Path,
    used_source_urls: set[str],
) -> dict | None:
    headers = {"Authorization": api_key}
    params = {"query": query, "per_page": 5, "orientation": "portrait", "size": "large"}
    try:
        r = httpx.get(PEXELS_SEARCH, headers=headers, params=params, timeout=20)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  Pexels 请求失败 [{query}]: {e!r}")
        return None

    for photo in data.get("photos", []):
        src = photo.get("src", {})
        url = src.get("large2x") or src.get("large") or src.get("original")
        source_url = photo.get("url")
        w = photo.get("width", 0)
        h = photo.get("height", 0)
        if not url or not source_url or source_url in used_source_urls or w < MIN_DIM or h < MIN_DIM:
            continue
        try:
            img_resp = httpx.get(url, timeout=30)
            img_resp.raise_for_status()
            img_data = img_resp.content
            out_path.write_bytes(img_data)
            return {
                "mode": "search",
                "source_url": source_url,
                "creator": photo.get("photographer"),
                "license": "Pexels License",
                "width": w,
                "height": h,
            }
        except Exception as e:
            print(f"  下载失败 [{query}]: {e!r}")
            continue
    return None


def _fetch_pixabay(
    api_key: str,
    query: str,
    out_path: Path,
    used_source_urls: set[str],
) -> dict | None:
    params = {
        "key": api_key,
        "q": query,
        "image_type": "all",
        "orientation": "vertical",
        "safesearch": "true",
        "per_page": 5,
    }
    try:
        r = httpx.get(PIXABAY_SEARCH, params=params, timeout=20)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  Pixabay 请求失败 [{query}]: {e!r}")
        return None

    for hit in data.get("hits", []):
        url = hit.get("largeImageURL") or hit.get("webformatURL")
        source_url = hit.get("pageURL")
        w = hit.get("imageWidth", 0)
        h = hit.get("imageHeight", 0)
        if not url or not source_url or source_url in used_source_urls or w < MIN_DIM or h < MIN_DIM:
            continue
        try:
            img_resp = httpx.get(url, timeout=30)
            img_resp.raise_for_status()
            out_path.write_bytes(img_resp.content)
            return {
                "mode": "search",
                "source_url": source_url,
                "creator": hit.get("user"),
                "license": "Pixabay Content License",
                "width": w,
                "height": h,
            }
        except Exception as e:
            print(f"  下载失败 [{query}]: {e!r}")
            continue
    return None


def _fetch_generated_image(cfg: Config, provider: str, prompt: str, out_path: Path) -> dict | None:
    try:
        generated = generate_text_to_image(cfg, prompt, provider=provider)
        out_path.write_bytes(generated.content)
        return generated.metadata
    except Exception as e:
        print(f"  {provider} 生成失败 [{prompt}]: {e!r}")
        return None


def _cache_key_material(cfg: Config, provider: str, prompt_or_query: str) -> str:
    if provider == "pollinations":
        model = cfg.pollinations_image_model or "pollinations"
    elif provider == "cloudflare_workers":
        model = cfg.cloudflare_image_model
    elif provider == "huggingface":
        model = cfg.huggingface_image_model
    elif provider == "volcengine":
        model = f"{cfg.volcengine_image_model}:{cfg.volcengine_image_size}"
    else:
        model = ""
    return f"{provider}:{model}:{prompt_or_query}"


def _compact_text(value: str | None, max_length: int) -> str | None:
    if not value:
        return None
    trimmed = " ".join(value.split())
    if not trimmed:
        return None
    if len(trimmed) > max_length:
        return f"{trimmed[:max_length - 1]}..."
    return trimmed


def _first_available_prompt_source(sources: dict[str, str | None], preferred: tuple[str, ...]) -> str:
    for source in preferred:
        if _compact_text(sources.get(source), 1):
            return source
    return "fallback"


def _build_contextual_image_prompt(
    *,
    core_prompt: str,
    item_title: str,
    prompt_source: str,
    sources: dict[str, str | None],
) -> str:
    core = _compact_text(core_prompt, 520) or core_prompt
    parts = [
        "Create one vertical 9:16 image for a Chinese knowledge short video.",
        "Use the core scene as the main subject. Follow the full context for period, place, people, objects, atmosphere, and visual logic.",
        "If the context implies a historical period or non-modern setting, keep it period-accurate. Do not add modern clothing, cars, phones, computers, neon signs, glass offices, modern streets, or contemporary city elements unless explicitly requested.",
        "Style: documentary cinematic realism, natural light, rich environmental detail, no text overlays, no subtitles, no watermark, no logo.",
        f"Shot/item: {_compact_text(item_title, 120) or item_title}",
        f"Core scene: {core}",
    ]

    context_lines: list[str] = []
    for key, label in CONTEXT_SOURCE_LABELS.items():
        if key == prompt_source:
            continue
        value = _compact_text(sources.get(key), 240)
        if value:
            context_lines.append(f"- {label}: {value}")
    if context_lines:
        parts.append("Context:")
        parts.extend(context_lines)
    return "\n".join(parts)


def _build_shot_generated_prompt(
    title: str,
    shot,
    query: str,
    *,
    core_prompt: str | None = None,
) -> str:
    core_prompt = _compact_text(core_prompt, 2000)
    fallback = ", ".join(
        part
        for part in [
            shot.visual,
            shot.broll,
            shot.subtitle,
            "vertical 9:16 documentary science image",
        ]
        if part
    )
    sources = {
        "title": title,
        "visual": shot.visual,
        "narration": shot.narration,
        "broll": shot.broll,
        "subtitle": shot.subtitle,
        "query": query,
        "fallback": fallback,
    }
    prompt_source = "prompt" if _compact_text(core_prompt, 1) else _first_available_prompt_source(
        sources,
        ("visual", "narration", "query", "broll", "subtitle", "fallback"),
    )
    return _build_contextual_image_prompt(
        core_prompt=core_prompt or sources.get(prompt_source) or fallback,
        item_title=f"shot {shot.index}",
        prompt_source=prompt_source,
        sources=sources,
    )


def _build_cover_generated_prompt(
    title: str,
    first_shot,
    query: str,
    *,
    core_prompt: str | None = None,
) -> str:
    core_prompt = _compact_text(core_prompt, 2000)
    fallback = f"{title}, vertical 9:16 documentary science cover image"
    sources = {
        "title": title,
        "visual": first_shot.visual if first_shot else None,
        "narration": first_shot.narration if first_shot else None,
        "broll": first_shot.broll if first_shot else None,
        "subtitle": first_shot.subtitle if first_shot else None,
        "query": query,
        "fallback": fallback,
    }
    prompt_source = "prompt" if _compact_text(core_prompt, 1) else _first_available_prompt_source(
        sources,
        ("query", "title", "narration", "visual", "broll", "subtitle", "fallback"),
    )
    return _build_contextual_image_prompt(
        core_prompt=core_prompt or sources.get(prompt_source) or fallback,
        item_title="cover image",
        prompt_source=prompt_source,
        sources=sources,
    )
