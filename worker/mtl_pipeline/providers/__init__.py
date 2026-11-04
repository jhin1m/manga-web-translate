"""Provider LLM cho OCR (giai đoạn 1) và dịch (giai đoạn 2)."""

from __future__ import annotations

import os
from typing import Any

from .base import LLMProvider, ProviderError

DEFAULT_PROVIDER = "gemini"
COMPARE_PROVIDER = "anthropic"


def make_provider(name: str, tier: str = "standard") -> LLMProvider:
    """Tạo provider theo tên; model đổi qua env MTL_GEMINI_MODEL / MTL_ANTHROPIC_MODEL / MTL_OPENAI_MODEL (openai_compatible: MTL_OPENAI_COMPAT_*, không có tier). tier="premium" (model AI hiệu
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
    if name == "openai":
        from .openai import OpenAIProvider

        env, default = (
            ("MTL_OPENAI_PREMIUM_MODEL", "gpt-4.1") if premium else ("MTL_OPENAI_MODEL", "gpt-4.1-mini")
        )
        return OpenAIProvider(
            name="openai",
            model=os.environ.get(env, default),
            api_key=_required_env("OPENAI_API_KEY", name),
            reasoning=_flag("MTL_OPENAI_REASONING"),
        )
    if name == "openai_compatible":
        from .openai import OpenAIProvider

        return OpenAIProvider(
            name="openai_compatible",
            model=_required_env("MTL_OPENAI_COMPAT_MODEL", name),
            api_key=_required_env("MTL_OPENAI_COMPAT_API_KEY", name),
            base_url=_required_env("MTL_OPENAI_COMPAT_BASE_URL", name),
            structured_output=os.environ.get("MTL_OPENAI_COMPAT_JSON", "json_schema").strip(),
            reasoning=_flag("MTL_OPENAI_REASONING"),
        )
    raise ValueError(f"provider không hỗ trợ: {name}")


ANTHROPIC_BASE_URL = "https://api.anthropic.com"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/"


def provider_from_config(cfg: dict[str, Any]) -> LLMProvider:
    """Dựng provider từ cấu hình cấp job (`claim.llm.<slot>`): key truyền tường minh vào client, không đọc env."""
    kind, model, api_key = cfg["type"], cfg["model"], cfg["api_key"]
    if kind == "anthropic":
        import anthropic

        from .anthropic import AnthropicProvider

        # base_url tường minh: SDK không được tự đọc ANTHROPIC_BASE_URL (key của DB không được gửi tới host lạ).
        return AnthropicProvider(
            model,
            client=anthropic.Anthropic(api_key=api_key, base_url=ANTHROPIC_BASE_URL, max_retries=0),
        )
    if kind == "gemini":
        from google import genai
        from google.genai import types

        from .gemini import GeminiProvider

        # base_url + vertexai tường minh: GOOGLE_GEMINI_BASE_URL / GOOGLE_GENAI_USE_VERTEXAI không được đổi đích.
        client = genai.Client(
            api_key=api_key,
            vertexai=False,
            http_options=types.HttpOptions(base_url=GEMINI_BASE_URL),
        )
        return GeminiProvider(model, client=client)
    if kind in ("openai", "openai_compatible"):
        from .openai import OpenAIProvider

        return OpenAIProvider(
            name=kind,
            model=model,
            api_key=api_key,
            base_url=cfg.get("base_url"),
            structured_output=cfg.get("structured_output", "json_schema"),
            reasoning=bool(cfg.get("reasoning", False)),
        )
    raise ValueError(f"provider không hỗ trợ: {kind}")


# Biến env chứa key của từng provider (cấu hình dự phòng khi job không có slot DB).
ENV_KEY_VARS: dict[str, tuple[str, ...]] = {
    "gemini": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    "anthropic": ("ANTHROPIC_API_KEY",),
    "openai": ("OPENAI_API_KEY",),
    "openai_compatible": ("MTL_OPENAI_COMPAT_API_KEY",),
}


def has_env_key(name: str) -> bool:
    return any(os.environ.get(v, "").strip() for v in ENV_KEY_VARS.get(name, ()))


def _required_env(var: str, provider: str) -> str:
    value = os.environ.get(var, "").strip()
    if not value:
        raise ValueError(f"provider {provider} cần biến môi trường {var}")
    return value


def _flag(var: str) -> bool:
    return os.environ.get(var, "").strip().lower() in ("1", "true", "yes")


__all__ = [
    "LLMProvider",
    "ProviderError",
    "make_provider",
    "provider_from_config",
    "has_env_key",
    "DEFAULT_PROVIDER",
    "COMPARE_PROVIDER",
]
