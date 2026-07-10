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
    model: str | None = None,
    width: int = 1080,
    height: int = 1920,
) -> GeneratedImage:
    if provider == "pollinations":
        return _generate_pollinations(cfg, prompt, model=model, width=width, height=height)
    if provider == "cloudflare_workers":
        return _generate_cloudflare_workers(cfg, prompt, model=model, width=width, height=height)
    if provider == "huggingface":
        return _generate_huggingface(cfg, prompt, model=model, width=width, height=height)
    raise ValueError(f"Unsupported text-to-image provider: {provider}")


def _generate_pollinations(
    cfg: Config,
    prompt: str,
    *,
    model: str | None,
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
    resolved_model = model or cfg.pollinations_image_model
    if resolved_model:
        params["model"] = resolved_model
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
            "model": resolved_model or "pollinations",
            "width": width,
            "height": height,
        },
    )


def _generate_cloudflare_workers(
    cfg: Config,
    prompt: str,
    *,
    model: str | None,
    width: int,
    height: int,
) -> GeneratedImage:
    if not cfg.cloudflare_account_id or not cfg.cloudflare_api_token:
        raise ValueError("Cloudflare Workers AI requires KB_CLOUDFLARE_ACCOUNT_ID and KB_CLOUDFLARE_API_TOKEN")
    resolved_model = model or cfg.cloudflare_image_model
    url = (
        "https://api.cloudflare.com/client/v4/accounts/"
        f"{cfg.cloudflare_account_id}/ai/run/{resolved_model}"
    )
    r = httpx.post(
        url,
        headers={"Authorization": f"Bearer {cfg.cloudflare_api_token}"},
        json={"prompt": prompt, "width": width, "height": height},
        timeout=90,
    )
    r.raise_for_status()
    content_type = r.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        data = r.json()
        image_b64 = data.get("result", {}).get("image") or data.get("image")
        if not image_b64:
            raise ValueError("Cloudflare Workers AI returned JSON without result.image")
        import base64

        content = base64.b64decode(image_b64)
        content_type = "image/png"
    else:
        content = r.content
    if not content_type.startswith("image/"):
        raise ValueError(f"Cloudflare Workers AI returned non-image content: {content_type}")
    return GeneratedImage(
        content=content,
        metadata={
            "mode": "generate",
            "source_url": "",
            "creator": "ai_generated",
            "license": "provider_terms",
            "prompt": prompt,
            "model": resolved_model,
            "width": width,
            "height": height,
        },
    )


def _generate_huggingface(
    cfg: Config,
    prompt: str,
    *,
    model: str | None,
    width: int,
    height: int,
) -> GeneratedImage:
    if not cfg.huggingface_api_token:
        raise ValueError("Hugging Face image generation requires KB_HUGGINGFACE_API_TOKEN or HF_TOKEN")
    resolved_model = model or cfg.huggingface_image_model
    base_url = cfg.huggingface_image_base_url.rstrip("/")
    url = f"{base_url}/{resolved_model}"
    r = httpx.post(
        url,
        headers={
            "Authorization": f"Bearer {cfg.huggingface_api_token}",
            "Accept": "image/png",
        },
        json={
            "inputs": prompt,
            "parameters": {
                "width": width,
                "height": height,
            },
        },
        timeout=120,
    )
    r.raise_for_status()
    content_type = r.headers.get("content-type", "")
    if not content_type.startswith("image/"):
        detail = r.text[:300]
        raise ValueError(f"Hugging Face returned non-image content: {content_type} {detail}")
    return GeneratedImage(
        content=r.content,
        metadata={
            "mode": "generate",
            "source_url": "",
            "creator": "ai_generated",
            "license": "model_terms",
            "prompt": prompt,
            "model": resolved_model,
            "width": width,
            "height": height,
        },
    )
