"""OpenAIProvider bằng client giả: shape request, structured output + tự hạ, phân loại lỗi, strict_schema, make_provider."""

from __future__ import annotations

import copy
import json
from types import SimpleNamespace

import httpx2
import openai
import pytest

from mtl_pipeline.providers import make_provider
from mtl_pipeline.providers.base import OCR_SCHEMA, TRANSLATE_SCHEMA, ProviderError
from mtl_pipeline.providers.openai import OpenAIProvider, strict_schema
from mtl_pipeline.schema import (
    OcrCrop,
    OcrRequest,
    PageText,
    ProofreadRegion,
    ProofreadRequest,
    RegionText,
    TranslateRequest,
)

OCR_JSON = {"items": [{"id": "r1", "source": "안녕", "is_sfx": False, "empty": False, "confidence": 0.9}]}
TR_JSON = {
    "items": [{"id": "p0.r1", "translation": "Chào", "speaker": "A", "style": None}],
    "context_notes": "",
}
PR_JSON = {"items": [{"id": "t0", "suggestion": "Xin chào", "reason": "dấu"}]}
REQ = httpx2.Request("POST", "https://x/v1/chat/completions")


def reply(payload=None, *, content=None, finish="stop", refusal=None, usage="default", choices=True):
    text = content if content is not None else json.dumps(payload, ensure_ascii=False)
    usage_obj = SimpleNamespace(prompt_tokens=100, completion_tokens=20) if usage == "default" else usage
    msg = SimpleNamespace(content=text, refusal=refusal)
    return SimpleNamespace(
        choices=[SimpleNamespace(message=msg, finish_reason=finish)] if choices else [], usage=usage_obj
    )


def status_error(status, body=None, message="boom", headers=None):
    resp = httpx2.Response(status, headers=headers or {}, request=REQ)
    return openai.APIStatusError(message, response=resp, body=body)


class FakeOpenAI:
    def __init__(self, *steps):
        self.steps = list(steps)
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=self)

    def create(self, **kw):
        self.calls.append(copy.deepcopy(kw))
        step = self.steps.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def ocr_req():
    return OcrRequest(page_ord=0, crops=[OcrCrop(id="r1", png=b"\x89PNG fake")])


def tr_req():
    page = PageText(
        ord=0, regions=[RegionText(id="r1", kind="text_bubble", bbox_norm=[0, 0, 1, 1], source="안녕")]
    )
    return TranslateRequest(pages=[page])


def pr_req():
    regions = [ProofreadRegion(id="t0", kind="text_bubble", source="안녕", translation="Xin chao")]
    return ProofreadRequest(page_ord=0, regions=regions, images=[b"\xff\xd8jpeg"])


def official(client, **kw):
    return OpenAIProvider("openai", "gpt-4.1-mini", "sk-test", client=client, **kw)


def compat(client, **kw):
    return OpenAIProvider(
        "openai_compatible", "some-model", "k", base_url="https://x/v1", client=client, **kw
    )


def raised(fn) -> ProviderError:
    with pytest.raises(ProviderError) as ei:
        fn()
    return ei.value


# ---------- request shape ----------


def test_official_request_shape_and_usage():
    fake = FakeOpenAI(reply(OCR_JSON))
    res = official(fake).ocr_page(ocr_req())
    kw = fake.calls[0]
    assert kw["max_completion_tokens"] == 2048 and "max_tokens" not in kw
    assert "temperature" not in kw and "reasoning_effort" not in kw
    fmt = kw["response_format"]
    assert fmt["type"] == "json_schema" and fmt["json_schema"]["strict"] is True
    user = kw["messages"][1]["content"]
    assert user[1] == {"type": "text", "text": "id=r1"}
    assert user[2]["image_url"]["detail"] == "high"
    assert user[2]["image_url"]["url"].startswith("data:image/png;base64,")
    assert (res.usage[0].provider, res.usage[0].model) == ("openai", "gpt-4.1-mini")
    assert (res.usage[0].input_tokens, res.usage[0].output_tokens) == (100, 20)


def test_official_translate_schema_is_strict_with_nullable_style():
    fake = FakeOpenAI(reply(TR_JSON))
    res = official(fake).translate_batch(tr_req())
    schema = fake.calls[0]["response_format"]["json_schema"]["schema"]
    item = schema["properties"]["items"]["items"]
    assert item["required"] == list(item["properties"]) and "style" in item["required"]
    assert "null" in item["properties"]["style"]["type"]
    assert res.items[0].translation == "Chào" and res.items[0].style == "normal"


def test_reasoning_flag_sets_effort_only_on_official():
    fake = FakeOpenAI(reply(OCR_JSON))
    official(fake, reasoning=True).ocr_page(ocr_req())
    assert fake.calls[0]["reasoning_effort"] == "low"
    fake = FakeOpenAI(reply(OCR_JSON))
    compat(fake, reasoning=True).ocr_page(ocr_req())
    assert "reasoning_effort" not in fake.calls[0]


def test_compatible_request_shape_json_object_instruction_and_fence():
    fenced = "```json\n" + json.dumps(OCR_JSON) + "\n```"
    fake = FakeOpenAI(reply(content=fenced))
    res = compat(fake, structured_output="json_object").ocr_page(ocr_req())
    kw = fake.calls[0]
    assert kw["max_tokens"] == 2048 and "max_completion_tokens" not in kw
    assert kw["response_format"] == {"type": "json_object"}
    assert json.dumps(OCR_SCHEMA) in kw["messages"][0]["content"]
    assert "detail" not in kw["messages"][1]["content"][2]["image_url"]
    assert res.items[0].source == "안녕"


def test_compatible_json_schema_sends_original_schema():
    fake = FakeOpenAI(reply(TR_JSON))
    compat(fake).translate_batch(tr_req())
    sent = fake.calls[0]["response_format"]["json_schema"]["schema"]
    assert sent == TRANSLATE_SCHEMA


def test_proofread_uses_jpeg_data_uri():
    fake = FakeOpenAI(reply(PR_JSON))
    res = official(fake).proofread_page(pr_req())
    assert fake.calls[0]["messages"][1]["content"][1]["image_url"]["url"].startswith(
        "data:image/jpeg;base64,"
    )
    assert res.items[0].suggestion == "Xin chào"


# ---------- structured output downgrade ----------


def test_compatible_downgrades_once_on_response_format_error_and_remembers():
    err = status_error(400, body={"message": "response_format json_schema is not supported"})
    fake = FakeOpenAI(err, reply(OCR_JSON), reply(OCR_JSON))
    prov = compat(fake)
    prov.ocr_page(ocr_req())
    assert [c["response_format"]["type"] for c in fake.calls] == ["json_schema", "json_object"]
    prov.ocr_page(ocr_req())
    assert fake.calls[2]["response_format"]["type"] == "json_object"


def test_downgrade_happens_at_most_once():
    err = status_error(422, body={"message": "bad response_format"})
    fake = FakeOpenAI(err, status_error(400, body={"message": "bad response_format"}))
    e = raised(lambda: compat(fake).ocr_page(ocr_req()))
    assert len(fake.calls) == 2 and e.error_class == "provider" and e.retryable is False


def test_unrelated_400_is_permanent_provider_error():
    fake = FakeOpenAI(status_error(400, body={"message": "context too long"}))
    e = raised(lambda: compat(fake).ocr_page(ocr_req()))
    assert len(fake.calls) == 1
    assert (e.error_class, e.retryable, e.status, e.provider) == ("provider", False, 400, "openai_compatible")


def test_official_never_downgrades():
    fake = FakeOpenAI(status_error(400, body={"message": "invalid response_format schema"}))
    e = raised(lambda: official(fake).ocr_page(ocr_req()))
    assert len(fake.calls) == 1 and e.retryable is False


# ---------- stop reasons ----------


@pytest.mark.parametrize(
    "kw",
    [
        {"finish": "length", "content": ""},
        {"finish": "content_filter", "content": ""},
        {"refusal": "no"},
        {"content": "   "},
    ],
)
def test_incomplete_replies_are_schema_errors_with_usage(kw):
    e = raised(lambda: official(FakeOpenAI(reply(OCR_JSON, **kw))).ocr_page(ocr_req()))
    assert e.error_class == "schema" and e.usage[0].output_tokens == 20


def test_missing_usage_or_choices_is_permanent_provider_error():
    for r in (reply(OCR_JSON, usage=None), reply(OCR_JSON, choices=False)):
        e = raised(lambda r=r: official(FakeOpenAI(r)).ocr_page(ocr_req()))
        assert e.error_class == "provider" and e.retryable is False


def test_output_token_guard_applies():
    big = reply(OCR_JSON, usage=SimpleNamespace(prompt_tokens=1, completion_tokens=999_999))
    e = raised(lambda: official(FakeOpenAI(big)).ocr_page(ocr_req()))
    assert e.error_class == "schema" and e.retry_in_job is False


# ---------- error mapping ----------


@pytest.mark.parametrize(
    "body",
    [
        {"code": "insufficient_quota"},
        {"type": "insufficient_quota"},
        {"code": "monthly_spend_limit_exceeded"},
    ],
)
def test_quota_429_is_auth_not_retryable(body):
    e = raised(lambda: official(FakeOpenAI(status_error(429, body=body))).ocr_page(ocr_req()))
    assert (e.error_class, e.retryable, e.status) == ("auth", False, 429)


def test_plain_429_is_rate_limit_with_retry_after():
    err = status_error(429, body={"code": "rate_limit_exceeded"}, headers={"retry-after": "7"})
    e = raised(lambda: official(FakeOpenAI(err)).ocr_page(ocr_req()))
    assert (e.error_class, e.retry_after, e.retryable) == ("rate_limit", 7, True)


@pytest.mark.parametrize(
    ("status", "cls", "retryable"),
    [
        (402, "auth", False),
        (401, "auth", False),
        (403, "auth", False),
        (500, "provider", True),
        (404, "provider", False),
    ],
)
def test_status_mapping(status, cls, retryable):
    e = raised(lambda: official(FakeOpenAI(status_error(status))).ocr_page(ocr_req()))
    assert (e.error_class, e.retryable, e.status) == (cls, retryable, status)


def test_connection_and_timeout_errors_are_retryable_provider():
    for err in (openai.APIConnectionError(request=REQ), openai.APITimeoutError(request=REQ)):
        e = raised(lambda err=err: official(FakeOpenAI(err)).ocr_page(ocr_req()))
        assert (e.error_class, e.retryable, e.status) == ("provider", True, None)


def test_public_message_has_no_provider_text():
    err = status_error(401, message="Incorrect API key sk-proj-abcdef1234567890")
    e = raised(lambda: official(FakeOpenAI(err)).ocr_page(ocr_req()))
    assert e.public_message() == "openai HTTP 401 auth" and "sk-proj" not in e.public_message()


# ---------- strict_schema / make_provider ----------


def test_strict_schema_requires_all_properties_and_keeps_original():
    before = copy.deepcopy(TRANSLATE_SCHEMA)
    out = strict_schema(TRANSLATE_SCHEMA)
    assert (
        before == TRANSLATE_SCHEMA
        and "style" not in TRANSLATE_SCHEMA["properties"]["items"]["items"]["required"]
    )
    item = out["properties"]["items"]["items"]
    assert item["required"] == list(item["properties"])
    assert item["properties"]["style"]["type"] == ["string", "null"]
    assert item["properties"]["style"]["enum"] == ["normal", "thought", "note", None]
    assert item["properties"]["id"]["type"] == "string"
    assert out["required"] == list(out["properties"])


def test_make_provider_openai_passes_credentials_explicitly(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env-key-123456")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://evil.example/v1")
    monkeypatch.delenv("MTL_OPENAI_MODEL", raising=False)
    monkeypatch.delenv("MTL_OPENAI_PREMIUM_MODEL", raising=False)
    monkeypatch.setenv("MTL_OPENAI_REASONING", "1")
    prov = make_provider("openai")
    assert prov.model == "gpt-4.1-mini" and prov.reasoning is True
    assert prov.client.api_key == "sk-env-key-123456"
    assert str(prov.client.base_url).startswith("https://api.openai.com/v1")
    assert prov.client.max_retries == 0
    assert make_provider("openai", "premium").model == "gpt-4.1"


def test_make_provider_openai_requires_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        make_provider("openai")


def test_make_provider_compatible_reads_env(monkeypatch):
    monkeypatch.setenv("MTL_OPENAI_COMPAT_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.setenv("MTL_OPENAI_COMPAT_API_KEY", "k-123456")
    monkeypatch.setenv("MTL_OPENAI_COMPAT_MODEL", "vendor/model")
    monkeypatch.setenv("MTL_OPENAI_COMPAT_JSON", "json_object")
    monkeypatch.delenv("MTL_OPENAI_REASONING", raising=False)
    prov = make_provider("openai_compatible")
    assert (prov.name, prov.model, prov.structured_output, prov.official) == (
        "openai_compatible",
        "vendor/model",
        "json_object",
        False,
    )
    assert str(prov.client.base_url).startswith("https://openrouter.ai/api/v1")
    monkeypatch.delenv("MTL_OPENAI_COMPAT_BASE_URL")
    with pytest.raises(ValueError, match="MTL_OPENAI_COMPAT_BASE_URL"):
        make_provider("openai_compatible")


def test_make_provider_compatible_rejects_bad_json_mode(monkeypatch):
    monkeypatch.setenv("MTL_OPENAI_COMPAT_BASE_URL", "https://x/v1")
    monkeypatch.setenv("MTL_OPENAI_COMPAT_API_KEY", "k-123456")
    monkeypatch.setenv("MTL_OPENAI_COMPAT_MODEL", "m")
    monkeypatch.setenv("MTL_OPENAI_COMPAT_JSON", "yaml")
    with pytest.raises(ValueError, match="structured_output"):
        make_provider("openai_compatible")
