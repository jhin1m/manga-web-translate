"""Hợp đồng chung cho provider LLM: prompt, JSON schema, payload, phân loại lỗi, tính chi phí."""

from __future__ import annotations

import json
import os
from importlib import resources
from typing import Any, Protocol

from pydantic import ValidationError

from ..langs import lang_label
from ..schema import (
    ErrorClass,
    OcrRequest,
    OcrResult,
    ProofreadRequest,
    ProofreadResult,
    TokenUsage,
    TranslateRequest,
    TranslateResult,
)

# Giá USD / 1M token (vào, ra). Phải kiểm lại lúc chạy bench — giá provider thay đổi.
PRICES_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-haiku-5-5": (0.10, 0.50),
    "gemini-2.5-flash": (0.30, 2.50),
    # Premium (AI hiệu đính) — khớp apps/api/src/billing/prices.ts.
    "gemini-2.5-pro": (1.25, 10.0),
    "claude-sonnet-5-5": (3.0, 15.0),
}

OCR_MAX_OUTPUT_TOKENS = 2048
TRANSLATE_MAX_OUTPUT_TOKENS = 4096
PROOFREAD_MAX_OUTPUT_TOKENS = 3072
# Trang dày chữ (~25 khối) + thinking tối thiểu của 2.5 Pro vượt guard chung 2000 → guard riêng (server clamp 4096/call).
PROOFREAD_OUTPUT_TOKENS_GUARD = PROOFREAD_MAX_OUTPUT_TOKENS + 256
# Guardrail chi phí (red team #14): token ra thật của 1 call vượt ngưỡng (thinking lọt, model lặp) → lỗi schema
# không thử lại trong job; hàng đợi tính attempt. Server vẫn clamp riêng (apps/api/src/billing/prices.ts).
OUTPUT_TOKENS_GUARD = int(os.environ.get("MTL_MAX_OUTPUT_TOKENS_PER_CALL", "2000"))

OCR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "source": {"type": "string"},
                    "is_sfx": {"type": "boolean"},
                    "empty": {"type": "boolean"},
                    "confidence": {"type": "number"},
                },
                "required": ["id", "source", "is_sfx", "empty", "confidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}

TRANSLATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "translation": {"type": "string"},
                    "speaker": {"type": "string"},
                },
                "required": ["id", "translation", "speaker"],
                "additionalProperties": False,
            },
        },
        "context_notes": {"type": "string"},
    },
    "required": ["items", "context_notes"],
    "additionalProperties": False,
}


PROOFREAD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "suggestion": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["id", "suggestion", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}


class ProviderError(RuntimeError):
    """Lỗi gọi LLM đã phân loại. Phase 3: rate_limit/provider không tính attempt; schema thì tính.

    retryable=False: lỗi vĩnh viễn (4xx khác 408/409/429: sai key, model không có, request quá lớn) — chạy lại
    vô ích, hàng đợi phải fail job thay vì thử mãi. usage: token đã bị tính tiền trước khi lỗi (ghi vào ledger)."""

    def __init__(
        self,
        error_class: ErrorClass,
        message: str,
        retry_after: float | None = None,
        retryable: bool = True,
        usage: list[TokenUsage] | None = None,
    ):
        super().__init__(message)
        self.error_class = error_class
        self.retry_after = retry_after
        self.retryable = retryable
        self.usage: list[TokenUsage] = list(usage or [])

    #: False → ocr/translate không gọi lại provider trong cùng job (lặp lại chỉ tốn thêm token).
    retry_in_job = True


class OutputTokensExceeded(ProviderError):
    retry_in_job = False


def guard_output_tokens(usage: TokenUsage, limit: int | None = None) -> None:
    limit = OUTPUT_TOKENS_GUARD if limit is None else limit
    if usage.output_tokens > limit:
        raise OutputTokensExceeded(
            "schema", f"output_tokens {usage.output_tokens} > {limit}/call (guardrail)", usage=[usage]
        )


class UnknownPrice(KeyError):
    """Model không có trong bảng giá — không được coi chi phí bằng 0."""


class LLMProvider(Protocol):
    @property
    def name(self) -> str: ...

    @property
    def model(self) -> str: ...

    def ocr_page(self, req: OcrRequest) -> OcrResult: ...

    def translate_batch(self, req: TranslateRequest) -> TranslateResult: ...


class ProofreadProvider(LLMProvider, Protocol):
    """Provider có thêm AI hiệu đính (gemini, anthropic)."""

    def proofread_page(self, req: ProofreadRequest) -> ProofreadResult: ...


def load_prompt(name: str) -> str:
    return resources.files("mtl_pipeline.prompts").joinpath(f"{name}.md").read_text(encoding="utf-8")


def ocr_user_text(req: OcrRequest) -> str:
    ids = ", ".join(c.id for c in req.crops)
    return (
        f"source_lang={lang_label(req.source_lang)}. "
        f"Trang {req.page_ord}. Các crop theo thứ tự, mỗi ảnh đi sau nhãn id của nó. Danh sách id: {ids}."
    )


def translate_user_text(req: TranslateRequest) -> str:
    """Payload giai đoạn 2 dạng JSON (thứ tự trang/vùng giữ nguyên, khoá sắp xếp để prompt ổn định)."""
    payload = {
        "pages": [p.model_dump() for p in req.pages],
        "source_lang": lang_label(req.source_lang),
        "target_lang": lang_label(req.target_lang),
        "glossary": req.glossary,
        "pronoun_rules": req.pronoun_rules,
        "honorific_policy": req.honorific_policy,
        "context": req.context.model_dump() if req.context else None,
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def proofread_user_text(req: ProofreadRequest) -> str:
    payload = {
        "source_lang": lang_label(req.source_lang),
        "target_lang": lang_label(req.target_lang),
        "regions": [r.model_dump() for r in req.regions],
        "glossary": req.glossary,
        "pronoun_rules": req.pronoun_rules,
        "honorific_policy": req.honorific_policy,
        "context": [c.model_dump() for c in req.context],
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def parse_proofread(text: str, usage: TokenUsage) -> ProofreadResult:
    try:
        data = json.loads(text)
        return ProofreadResult.model_validate({"items": data["items"], "usage": [usage]})
    except (json.JSONDecodeError, KeyError, TypeError, ValidationError) as e:
        raise ProviderError("schema", f"hiệu đính trả JSON sai hợp đồng: {e}", usage=[usage]) from e


def parse_ocr(text: str, usage: TokenUsage) -> OcrResult:
    try:
        data = json.loads(text)
        return OcrResult.model_validate({"items": data["items"], "usage": [usage]})
    except (json.JSONDecodeError, KeyError, TypeError, ValidationError) as e:
        raise ProviderError("schema", f"OCR trả JSON sai hợp đồng: {e}", usage=[usage]) from e


def parse_translate(text: str, usage: TokenUsage) -> TranslateResult:
    try:
        data = json.loads(text)
        return TranslateResult.model_validate(
            {"items": data["items"], "context_notes": data.get("context_notes", ""), "usage": [usage]}
        )
    except (json.JSONDecodeError, KeyError, TypeError, ValidationError) as e:
        raise ProviderError("schema", f"dịch trả JSON sai hợp đồng: {e}", usage=[usage]) from e


def classify_status(status: int | None) -> tuple[ErrorClass, bool]:
    """HTTP status → (lớp lỗi, có nên thử lại)."""
    if status == 429:
        return "rate_limit", True
    if status is None or status in (408, 409) or status >= 500:
        return "provider", True
    return "provider", False


def parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def cost_usd(usages: list[TokenUsage]) -> float:
    total = 0.0
    for u in usages:
        if u.model not in PRICES_PER_MTOK:
            raise UnknownPrice(f"chưa có giá cho model {u.model}; thêm vào PRICES_PER_MTOK")
        price_in, price_out = PRICES_PER_MTOK[u.model]
        total += u.input_tokens * price_in / 1e6 + u.output_tokens * price_out / 1e6
    return total
