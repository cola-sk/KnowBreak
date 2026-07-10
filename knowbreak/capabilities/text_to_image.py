"""Text-to-image capability.

This module owns provider-specific generation details and returns bytes plus
metadata. Pipeline stages decide where to write files and how to reference them.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote

import httpx

from ..config import Config

POLLINATIONS_IMAGE = "https://image.pollinations.ai/prompt"


@dataclass(frozen=True)
class GeneratedImage:
    content: bytes
    metadata: dict


def generate_text_to_image(
    cfg: Config,
    prompt: str,
    *,
    provider: str = "pollinations",
    width: int = 1080,
    height: int = 1920,
) -> GeneratedImage:
    if provider != "pollinations":
        raise ValueError(f"Unsupported text-to-image provider: {provider}")
    return _generate_pollinations(cfg, prompt, width=width, height=height)


def _generate_pollinations(
    cfg: Config,
    prompt: str,
    *,
    width: int,
    height: int,
) -> GeneratedImage:
    params = {
        "width": str(width),
        "height": str(height),
        "nologo": "true",
        "private": "true",
        "safe": "true",
    }
    if cfg.pollinations_image_model:
        params["model"] = cfg.pollinations_image_model
    headers = {"Authorization": f"Bearer {cfg.pollinations_api_key}"} if cfg.pollinations_api_key else None
    url = f"{POLLINATIONS_IMAGE}/{quote(prompt)}"
    r = httpx.get(url, params=params, headers=headers, timeout=90, follow_redirects=True)
    r.raise_for_status()
    content_type = r.headers.get("content-type", "")
    if not content_type.startswith("image/"):
        raise ValueError(f"Pollinations returned non-image content: {content_type}")
    return GeneratedImage(
        content=r.content,
        metadata={
            "mode": "generate",
            "source_url": "",
            "creator": "ai_generated",
            "license": "provider_terms",
            "prompt": prompt,
            "model": cfg.pollinations_image_model or "pollinations",
            "width": width,
            "height": height,
        },
    )
