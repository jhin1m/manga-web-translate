"""Provider LLM cho OCR (giai đoạn 1) và dịch (giai đoạn 2)."""

from __future__ import annotations

import os

from .base import LLMProvider, ProviderError

DEFAULT_PROVIDER = "gemini"
COMPARE_PROVIDER = "anthropic"


def make_provider(name: str) -> LLMProvider:
    """Tạo provider theo tên; model đổi qua env MTL_GEMINI_MODEL / MTL_ANTHROPIC_MODEL.

    Mặc định pin model ID cụ thể (không dùng alias *-latest): giá và nhánh tắt thinking phụ thuộc model."""
    if name == "gemini":
        from .gemini import GeminiProvider

        return GeminiProvider(model=os.environ.get("MTL_GEMINI_MODEL", "gemini-2.5-flash"))
    if name == "anthropic":
        from .anthropic import AnthropicProvider

        return AnthropicProvider(model=os.environ.get("MTL_ANTHROPIC_MODEL", "claude-haiku-5-5"))
    raise ValueError(f"provider không hỗ trợ: {name}")


__all__ = ["LLMProvider", "ProviderError", "make_provider", "DEFAULT_PROVIDER", "COMPARE_PROVIDER"]
