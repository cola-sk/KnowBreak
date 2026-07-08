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

from ..config import Config
from ..llm import LLM
from ..models import Storyboards

PEXELS_SEARCH = "https://api.pexels.com/v1/search"
PIXABAY_SEARCH = "https://pixabay.com/api/"
MIN_DIM = 1080  # 至少 1080px 宽


class _ShotKw(BaseModel):
    index: int
    keywords: list[str]


class _Schema(BaseModel):
    cover_keywords: list[str] = Field(default_factory=list)
    shots: list[_ShotKw]


_SYSTEM = """你是短视频配图策划。
任务：为每个分镜生成 2-3 个英文搜索关键词，用于在免版权图库上找竖向配图。

【最重要的规则】不要把比喻当字面意思：
中文脚本里常有比喻，例如：
- "成骨细胞像建筑队" → ✗ 不要搜 "construction worker"（会拿到真人工地照片），✓ 搜 "bone formation illustration" 或 "skeleton anatomy"
- "维生素D是搬运工" → ✗ 不要搜 "porter"，✓ 搜 "vitamin D supplement" 或 "calcium absorption"
- "破骨细胞是拆迁队" → ✗ 不要搜 "demolition"，✓ 搜 "bone resorption" 或 "osteoporosis"
- "锁住钙" → ✗ 不要搜 "lock"，✓ 搜 "calcium bone mineralization"

判断依据的优先级：
1. subtitle（字幕，最精炼，是画面真实主题）
2. visual（画面描述，可能含比喻）
3. broll（最可能含比喻，仅辅助）

关键词要求：
- 必须英文、具体、可视化
- 描述该 shot 真实想表达的概念，不是比喻本身
- 2-3 个词，便于在图库里找到匹配图
- 另外给出 cover_keywords，用于视频开头封面图，要更有冲击力、适合做点击封面

输出 JSON：{"cover_keywords": ["milk calcium bone health"], "shots": [{"index": 0, "keywords": ["bone density", "skeleton illustration"]}]}"""


def run(
    storyboards_path: Path,
    cfg: Config,
    only_topic: int | None = None,
    cover_only: bool = False,
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
        cover_keywords, kw_map = _keywords_for_board(llm, board) if llm else ([], {})

        topic_dir = images_dir / str(board.topic_index)
        topic_dir.mkdir(exist_ok=True)

        used_source_urls: set[str] = set()
        cover = _fetch_cover_image(cfg, providers, board, cover_keywords, topic_dir, used_source_urls)
        shot_images: list[dict] = []
        if cover_only:
            shot_images = existing_map.get(board.topic_index, {}).get("shots", [])
        else:
            for shot in board.shots:
                kws = kw_map.get(shot.index, [])
                query = " ".join(kws[:2]) if kws else shot.broll[:60]
                img_path = topic_dir / f"shot_{shot.index:03d}.jpg"
                meta = _fetch_with_fallbacks(
                    cfg,
                    providers,
                    [query, shot.broll[:60]],
                    img_path,
                    used_source_urls,
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
        else:
            print(f"  - 跳过未知图片 provider：{provider}")
    if not providers:
        print("  - 未配置可用图片 provider，images 阶段只写空清单，compose 将使用纯色背景")
    return providers


def _keywords_for_board(llm: LLM, board) -> tuple[list[str], dict[int, list[str]]]:
    shots_blob = "\n".join(
        f"shot {s.index}: subtitle={s.subtitle} | visual={s.visual} | broll={s.broll}"
        for s in board.shots
    )
    schema = llm.chat_json(
        _SYSTEM,
        f"选题：{board.title}\n分镜：\n{shots_blob}\n",
        _Schema,
    )
    return schema.cover_keywords, {s.index: s.keywords for s in schema.shots}


def _fetch_cover_image(
    cfg: Config,
    providers: list[str],
    board,
    cover_keywords: list[str],
    topic_dir: Path,
    used_source_urls: set[str],
) -> dict | None:
    query = " ".join(cover_keywords[:3]) if cover_keywords else board.title
    first_broll = board.shots[0].broll if board.shots else ""
    cover_path = topic_dir / "cover.jpg"
    meta = _fetch_with_fallbacks(
        cfg,
        _cover_provider_order(providers),
        [query, first_broll, board.title],
        cover_path,
        used_source_urls,
    )
    if meta:
        print(f"  ✓ topic {board.topic_index} cover: {meta['provider']} / {meta['query']}")
        return {
            "image_path": str(cover_path.relative_to(cfg.out_dir)),
            **meta,
        }
    print(f"  ✗ topic {board.topic_index} cover: {query} (no result)")
    return None


def _cover_provider_order(providers: list[str]) -> list[str]:
    """封面跟随 KB_IMAGE_PROVIDERS 顺序，便于按需切换 Pexels/Pixabay 优先级。"""
    return providers


def _fetch_with_fallbacks(
    cfg: Config,
    providers: list[str],
    queries: list[str],
    out_path: Path,
    used_source_urls: set[str],
) -> dict | None:
    seen: set[tuple[str, str]] = set()
    for query in [q.strip() for q in queries if q.strip()]:
        for provider in providers:
            key = (provider, query)
            if key in seen:
                continue
            seen.add(key)
            if provider == "pexels" and cfg.pexels_api_key:
                meta = _fetch_pexels(cfg.pexels_api_key, query, out_path, used_source_urls)
            elif provider == "pixabay" and cfg.pixabay_api_key:
                meta = _fetch_pixabay(cfg.pixabay_api_key, query, out_path, used_source_urls)
            else:
                meta = None
            if meta:
                source_url = meta.get("source_url")
                if source_url:
                    used_source_urls.add(source_url)
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
