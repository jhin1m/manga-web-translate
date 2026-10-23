"""Provider so sánh: Claude Haiku 5.5 qua SDK anthropic, structured output (output_config.format), tắt thinking."""

from __future__ import annotations

import base64
from typing import Any

import anthropic

from ..schema import (
    OcrRequest,
    OcrResult,
    ProofreadRequest,
    ProofreadResult,
    TokenUsage,
    TranslateRequest,
    TranslateResult,
)
from .base import (
    OCR_MAX_OUTPUT_TOKENS,
    OCR_SCHEMA,
    PROOFREAD_MAX_OUTPUT_TOKENS,
    PROOFREAD_OUTPUT_TOKENS_GUARD,
    PROOFREAD_SCHEMA,
    TRANSLATE_MAX_OUTPUT_TOKENS,
    TRANSLATE_SCHEMA,
    ProviderError,
    classify_status,
    guard_output_tokens,
    load_prompt,
    ocr_user_text,
    parse_ocr,
    parse_proofread,
    parse_retry_after,
    parse_translate,
    proofread_user_text,
    translate_user_text,
)


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, model: str, client: Any = None):
        self.model = model
        self.client = client if client is not None else anthropic.Anthropic(max_retries=0)

    def _call(
        self,
        system: str,
        content: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int,
        guard: int | None = None,
    ):
        try:
            params: dict[str, Any] = {
                "model": self.model,
                "max_tokens": max_tokens,
                "system": system,
                # Haiku 5.5 chỉ cho tắt thinking ở effort ≤ high; dùng low cho tác vụ chép/dịch ngắn.
                "thinking": {"type": "disabled"},
                "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": schema}},
                "messages": [{"role": "user", "content": content}],
            }
            resp = self.client.messages.create(**params)
        except anthropic.RateLimitError as e:
            raise ProviderError(
                "rate_limit", str(e), parse_retry_after(e.response.headers.get("retry-after"))
            ) from e
        except anthropic.APIStatusError as e:
            error_class, retryable = classify_status(e.status_code)
            raise ProviderError(
                error_class, f"anthropic {e.status_code}: {e.message}", retryable=retryable
            ) from e
        except anthropic.APIConnectionError as e:
            raise ProviderError("provider", f"anthropic transport: {e}") from e
        usage = TokenUsage(
            provider=self.name,
            model=self.model,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
        )
        guard_output_tokens(usage, guard)
        if resp.stop_reason in ("refusal", "max_tokens"):
            raise ProviderError("schema", f"anthropic dừng với {resp.stop_reason}", usage=[usage])
        text = next((b.text for b in resp.content if b.type == "text"), "")
        return text, usage

    def ocr_page(self, req: OcrRequest) -> OcrResult:
        content: list[dict[str, Any]] = [{"type": "text", "text": ocr_user_text(req)}]
        for c in req.crops:
            content.append({"type": "text", "text": f"id={c.id}"})
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": base64.standard_b64encode(c.png).decode("ascii"),
                    },
                }
            )
        text, usage = self._call(load_prompt("ocr_page"), content, OCR_SCHEMA, OCR_MAX_OUTPUT_TOKENS)
        return parse_ocr(text, usage)

    def translate_batch(self, req: TranslateRequest) -> TranslateResult:
        content = [{"type": "text", "text": translate_user_text(req)}]
        text, usage = self._call(
            load_prompt("translate_batch"), content, TRANSLATE_SCHEMA, TRANSLATE_MAX_OUTPUT_TOKENS
        )
        return parse_translate(text, usage)

    def proofread_page(self, req: ProofreadRequest) -> ProofreadResult:
        content: list[dict[str, Any]] = [{"type": "text", "text": proofread_user_text(req)}]
        for img in req.images:
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": base64.standard_b64encode(img).decode("ascii"),
                    },
                }
            )
        text, usage = self._call(
            load_prompt("proofread_page"),
            content,
            PROOFREAD_SCHEMA,
            PROOFREAD_MAX_OUTPUT_TOKENS,
            PROOFREAD_OUTPUT_TOKENS_GUARD,
        )
        return parse_proofread(text, usage)
