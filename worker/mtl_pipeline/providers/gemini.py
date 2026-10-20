"""Provider Gemini (Flash-class) qua google-genai: JSON schema, tắt thinking, ghi token thật."""

from __future__ import annotations

from typing import Any

import httpx
from google import genai
from google.genai import errors, types

from ..schema import OcrRequest, OcrResult, TokenUsage, TranslateRequest, TranslateResult
from .base import (
    OCR_MAX_OUTPUT_TOKENS,
    OCR_SCHEMA,
    TRANSLATE_MAX_OUTPUT_TOKENS,
    TRANSLATE_SCHEMA,
    ProviderError,
    classify_status,
    guard_output_tokens,
    load_prompt,
    ocr_user_text,
    parse_ocr,
    parse_retry_after,
    parse_translate,
    translate_user_text,
)


def thinking_config(model: str) -> types.ThinkingConfig:
    # Gemini 3 dùng thinking_level (thấp nhất "minimal"); thế hệ 2.5 tắt hẳn bằng budget 0.
    if model.startswith("gemini-3"):
        return types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL)
    return types.ThinkingConfig(thinking_budget=0)


class GeminiProvider:
    name = "gemini"

    def __init__(self, model: str, client: Any = None):
        self.model = model
        # client inject được để test hợp đồng không cần API key.
        self.client = client if client is not None else genai.Client()

    def _config(self, system: str, schema: dict[str, Any], max_tokens: int) -> types.GenerateContentConfig:
        return types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_json_schema=schema,
            thinking_config=thinking_config(self.model),
            max_output_tokens=max_tokens,
            temperature=0.2,
        )

    def _call(self, contents: list[Any], config: types.GenerateContentConfig) -> tuple[str, TokenUsage]:
        try:
            resp = self.client.models.generate_content(model=self.model, contents=contents, config=config)
        except errors.APIError as e:
            headers = getattr(getattr(e, "response", None), "headers", None) or {}
            error_class, retryable = classify_status(e.code)
            raise ProviderError(
                error_class,
                f"gemini {e.code}: {e}",
                parse_retry_after(headers.get("retry-after")),
                retryable=retryable,
            ) from e
        except (httpx.HTTPError, OSError, TimeoutError) as e:  # lỗi mạng/timeout của transport
            raise ProviderError("provider", f"gemini transport: {e}") from e
        um = resp.usage_metadata
        usage = TokenUsage(
            provider=self.name,
            model=self.model,
            input_tokens=(um.prompt_token_count or 0) if um else 0,
            # Token thinking tính tiền như output.
            output_tokens=((um.candidates_token_count or 0) + (um.thoughts_token_count or 0)) if um else 0,
        )
        guard_output_tokens(usage)
        if not resp.text:
            raise ProviderError("schema", "gemini trả rỗng", usage=[usage])
        return resp.text, usage

    def ocr_page(self, req: OcrRequest) -> OcrResult:
        contents: list[Any] = [ocr_user_text(req)]
        for c in req.crops:
            contents.append(f"id={c.id}")
            contents.append(types.Part.from_bytes(data=c.png, mime_type="image/png"))
        text, usage = self._call(
            contents, self._config(load_prompt("ocr_page"), OCR_SCHEMA, OCR_MAX_OUTPUT_TOKENS)
        )
        return parse_ocr(text, usage)

    def translate_batch(self, req: TranslateRequest) -> TranslateResult:
        config = self._config(load_prompt("translate_batch"), TRANSLATE_SCHEMA, TRANSLATE_MAX_OUTPUT_TOKENS)
        text, usage = self._call([translate_user_text(req)], config)
        return parse_translate(text, usage)
