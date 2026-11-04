"""Provider OpenAI và OpenAI-compatible (OpenRouter, xAI, DeepSeek, vLLM…) qua SDK `openai`, Chat Completions.

Một class cho cả hai: khác nhau ở cờ `official` (max_completion_tokens, detail ảnh, reasoning_effort, strict
json_schema) và `structured_output` (json_schema | json_object)."""

from __future__ import annotations

import base64
import copy
import json
import re
from typing import Any
from urllib.parse import urlparse

import openai

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

OFFICIAL_BASE_URL = "https://api.openai.com/v1"
_FORMAT_ERROR = re.compile(r"response_format|json_schema", re.IGNORECASE)
# 429 do hết hạn mức/ngân sách: thử lại không khôi phục được → auth (không retry), tránh lặp vô hạn.
_QUOTA_CODES = {"insufficient_quota", "credit_balance_exhausted"}
# `rate_limit_exceeded` là rate limit thường (đáng thử lại) nên chỉ khớp hậu tố spend/usage.
_QUOTA_SUFFIXES = ("_spend_limit_exceeded", "_usage_limit_exceeded")
_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL | re.IGNORECASE)


def strict_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Bản strict cho OpenAI: mọi property nằm trong `required`; property vốn optional → nullable.
    Deepcopy, không đụng schema gốc (anthropic/gemini dùng chung)."""
    out = copy.deepcopy(schema)

    def walk(node: dict[str, Any]) -> None:
        if node.get("type") == "object":
            required = set(node.get("required", []))
            for key, prop in node["properties"].items():
                walk(prop)
                if key not in required and "type" in prop:
                    t = prop["type"]
                    prop["type"] = [t, "null"] if isinstance(t, str) else [*t, "null"]
                    if "enum" in prop:
                        prop["enum"] = [*prop["enum"], None]
            node["required"] = list(node["properties"])
            node["additionalProperties"] = False
        elif node.get("type") == "array":
            walk(node["items"])

    walk(out)
    return out


def _is_quota(e: openai.APIStatusError) -> bool:
    for v in (getattr(e, "code", None), getattr(e, "type", None)):
        if isinstance(v, str) and (v in _QUOTA_CODES or v.endswith(_QUOTA_SUFFIXES)):
            return True
    return False


class OpenAIProvider:
    def __init__(
        self,
        name: str,
        model: str,
        api_key: str,
        base_url: str | None = None,
        structured_output: str = "json_schema",
        reasoning: bool = False,
        client: Any = None,
    ):
        if structured_output not in ("json_schema", "json_object"):
            raise ValueError(f"structured_output không hợp lệ: {structured_output}")
        self.name = name
        self.model = model
        self.official = name == "openai"
        self.structured_output = structured_output
        self.reasoning = reasoning
        # DeepSeek bật "thinking" mặc định: token suy luận ăn hết trần token ra (2048/3072/4096) → job fail mà vẫn tính
        # tiền. Tắt trừ khi admin đánh dấu model là reasoning.
        self.disable_thinking = urlparse(base_url or "").hostname == "api.deepseek.com" and not reasoning
        # api_key/base_url luôn tường minh: SDK không được tự đọc OPENAI_API_KEY / OPENAI_BASE_URL từ env.
        self.client = (
            client
            if client is not None
            else openai.OpenAI(
                api_key=api_key, base_url=base_url or OFFICIAL_BASE_URL, max_retries=0, timeout=90
            )
        )

    # ---- request ----

    def _kwargs(
        self, system: str, content: list[dict[str, Any]], schema: dict[str, Any], max_tokens: int
    ) -> dict[str, Any]:
        kw: dict[str, Any] = {"model": self.model}
        if self.structured_output == "json_schema":
            kw["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "response",
                    "strict": True,
                    "schema": strict_schema(schema) if self.official else schema,
                },
            }
        else:
            kw["response_format"] = {"type": "json_object"}
            system = f"{system}\n\nTrả về DUY NHẤT một JSON object đúng schema sau: {json.dumps(schema)}"
        kw["messages"] = [{"role": "system", "content": system}, {"role": "user", "content": content}]
        kw["max_completion_tokens" if self.official else "max_tokens"] = max_tokens
        if self.official and self.reasoning:
            kw["reasoning_effort"] = "low"
        if self.disable_thinking:
            kw["extra_body"] = {"thinking": {"type": "disabled"}}
        return kw

    def _should_downgrade(self, e: openai.APIStatusError) -> bool:
        # OpenAI chính chủ cố định json_schema: 400 ở đó là lỗi thật, không phải endpoint thiếu tính năng.
        return (
            not self.official
            and self.structured_output == "json_schema"
            and e.status_code in (400, 422)
            and bool(_FORMAT_ERROR.search(f"{e.message} {e.body}"))
        )

    def _map_status(self, e: openai.APIStatusError) -> ProviderError:
        status = e.status_code
        kw: dict[str, Any] = {"provider": self.name, "status": status}
        text = f"{self.name} {status}: {e.message}"
        if status == 402 or (status == 429 and _is_quota(e)):
            return ProviderError("auth", text, retryable=False, **kw)
        if status == 429:
            retry_after = parse_retry_after(e.response.headers.get("retry-after"))
            return ProviderError("rate_limit", text, retry_after, **kw)
        error_class, retryable = classify_status(status)
        return ProviderError(error_class, text, retryable=retryable, **kw)

    def _create(self, system: str, content: list[dict[str, Any]], schema: dict[str, Any], max_tokens: int):
        for attempt in (0, 1):
            try:
                return self.client.chat.completions.create(
                    **self._kwargs(system, content, schema, max_tokens)
                )
            except openai.APIStatusError as e:
                if attempt == 0 and self._should_downgrade(e):
                    self.structured_output = "json_object"
                    continue
                raise self._map_status(e) from e
            except openai.APIConnectionError as e:  # gồm APITimeoutError
                raise ProviderError("provider", f"{self.name} transport: {e}", provider=self.name) from e
        raise AssertionError("unreachable")  # pragma: no cover

    def _call(
        self,
        system: str,
        content: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int,
        guard: int | None = None,
    ) -> tuple[str, TokenUsage]:
        resp = self._create(system, content, schema, max_tokens)
        # Một số endpoint compatible trả lỗi trong body HTTP 200: không có choices/usage thì ledger không đúng được.
        if not getattr(resp, "choices", None) or resp.usage is None:
            raise ProviderError(
                "provider", f"{self.name} trả thiếu choices/usage", retryable=False, provider=self.name
            )
        usage = TokenUsage(
            provider=self.name,
            model=self.model,
            input_tokens=resp.usage.prompt_tokens or 0,
            # completion_tokens đã gồm token reasoning — không cộng thêm.
            output_tokens=resp.usage.completion_tokens or 0,
        )
        guard_output_tokens(usage, guard)
        choice = resp.choices[0]
        msg = choice.message
        if choice.finish_reason in ("length", "content_filter") or getattr(msg, "refusal", None):
            raise ProviderError(
                "schema",
                f"{self.name} dừng với {choice.finish_reason}",
                usage=[usage],
                provider=self.name,
            )
        text = (msg.content or "").strip()
        if not text:
            raise ProviderError("schema", f"{self.name} trả rỗng", usage=[usage], provider=self.name)
        if self.structured_output == "json_object":
            m = _FENCE.match(text)
            if m:
                text = m.group(1)
        return text, usage

    # ---- nội dung ----

    def _image(self, data: bytes, mime: str) -> dict[str, Any]:
        url = f"data:{mime};base64,{base64.standard_b64encode(data).decode('ascii')}"
        image_url: dict[str, Any] = {"url": url}
        if self.official:
            image_url["detail"] = "high"
        return {"type": "image_url", "image_url": image_url}

    def ocr_page(self, req: OcrRequest) -> OcrResult:
        content: list[dict[str, Any]] = [{"type": "text", "text": ocr_user_text(req)}]
        for c in req.crops:
            content.append({"type": "text", "text": f"id={c.id}"})
            content.append(self._image(c.png, "image/png"))
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
            content.append(self._image(img, "image/jpeg"))
        text, usage = self._call(
            load_prompt("proofread_page"),
            content,
            PROOFREAD_SCHEMA,
            PROOFREAD_MAX_OUTPUT_TOKENS,
            PROOFREAD_OUTPUT_TOKENS_GUARD,
        )
        return parse_proofread(text, usage)
