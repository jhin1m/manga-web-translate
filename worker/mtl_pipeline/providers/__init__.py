"""Provider LLM cho OCR (giai đoạn 1) và dịch (giai đoạn 2)."""

from __future__ import annotations

import os

from .base import LLMProvider, ProviderError

DEFAULT_PROVIDER = "gemini"
COMPARE_PROVIDER = "anthropic"


def make_provider(name: str, tier: str = "standard") -> LLMProvider:
    """Tạo provider theo tên; model đổi qua env MTL_GEMINI_MODEL / MTL_ANTHROPIC_MODEL. tier="premium" (model AI hiệu
    đính Premium) dùng MTL_GEMINI_PREMIUM_MODEL / MTL_ANTHROPIC_PREMIUM_MODEL.

    Mặc định pin model ID cụ thể (không dùng alias *-latest): giá và nhánh tắt thinking phụ thuộc model."""
    premium = tier == "premium"
    if name == "gemini":
        from .gemini import GeminiProvider

        env, default = (
            ("MTL_GEMINI_PREMIUM_MODEL", "gemini-2.5-pro")
            if premium
            else ("MTL_GEMINI_MODEL", "gemini-2.5-flash")
        )
        return GeminiProvider(model=os.environ.get(env, default))
    if name == "anthropic":
        from .anthropic import AnthropicProvider

        env, default = (
            ("MTL_ANTHROPIC_PREMIUM_MODEL", "claude-sonnet-5-5")
            if premium
            else ("MTL_ANTHROPIC_MODEL", "claude-haiku-5-5")
        )
        return AnthropicProvider(model=os.environ.get(env, default))
    raise ValueError(f"provider không hỗ trợ: {name}")


__all__ = ["LLMProvider", "ProviderError", "make_provider", "DEFAULT_PROVIDER", "COMPARE_PROVIDER"]
