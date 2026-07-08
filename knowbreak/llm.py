"""LLM 客户端：OpenAI 兼容协议。"""

from __future__ import annotations

import json
from typing import TypeVar

from openai import OpenAI
from pydantic import BaseModel

from .config import LLMConfig

T = TypeVar("T", bound=BaseModel)


class LLM:
    def __init__(self, cfg: LLMConfig):
        self.cfg = cfg
        self.client = OpenAI(base_url=cfg.base_url, api_key=cfg.api_key)

    def chat(self, system: str, user: str, *, temperature: float | None = None) -> str:
        resp = self.client.chat.completions.create(
            model=self.cfg.model,
            temperature=self.cfg.temperature if temperature is None else temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return resp.choices[0].message.content or ""

    def chat_json(self, system: str, user: str, schema_model: type[T], *, temperature: float | None = None) -> T:
        """请求 JSON 输出并解析到 pydantic 模型。"""
        schema_hint = json.dumps(
            schema_model.model_json_schema(), ensure_ascii=False, indent=2
        )
        full_system = (
            f"{system}\n\n"
            f"严格输出符合以下 JSON Schema 的 JSON，不要任何额外文字、不要 markdown 代码块：\n"
            f"{schema_hint}"
        )
        raw = self.chat(full_system, user, temperature=temperature)
        return _parse_json(raw, schema_model)


def _parse_json(raw: str, model: type[T]) -> T:
    text = raw.strip()
    # 去掉可能的 markdown 代码块包裹
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
        if text.endswith("```"):
            text = text[:-3]
    return model.model_validate_json(text)
