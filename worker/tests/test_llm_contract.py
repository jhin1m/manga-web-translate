"""Hợp đồng provider LLM bằng client giả (chưa có API key): payload gửi đi, parse kết quả, phân loại lỗi,
retry/low_conf ở OCR, gộp lô + ngữ cảnh cuộn ở giai đoạn 2."""

from __future__ import annotations

import json
from types import SimpleNamespace

import anthropic
import httpx2
import numpy as np
import pytest
from google.genai import errors

from mtl_pipeline.ocr import ocr_page
from mtl_pipeline.providers.anthropic import AnthropicProvider
from mtl_pipeline.providers.base import OCR_SCHEMA, TRANSLATE_SCHEMA, ProviderError, cost_usd
from mtl_pipeline.providers.gemini import GeminiProvider, thinking_config
from mtl_pipeline.schema import (
    BBox,
    OcrCrop,
    OcrItem,
    OcrRequest,
    OcrResult,
    PageText,
    Region,
    RegionText,
    TokenUsage,
    TranslateItem,
    TranslateRequest,
    TranslateResult,
)
from mtl_pipeline.translate import (
    CONTEXT_LINES,
    SeriesSettings,
    make_batches,
    qualified_id,
    translate_chapter,
    update_context,
)

OCR_JSON = {"items": [{"id": "r1", "source": "안녕", "is_sfx": False, "empty": False, "confidence": 0.9}]}
TR_JSON = {
    "items": [{"id": "p0.r1", "translation": "Chào", "speaker": "Minjun"}],
    "context_notes": "Minjun: tôi/cậu",
}


# ---------- Anthropic ----------


class FakeAnthropic:
    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.calls: list[dict] = []
        self.messages = self

    def create(self, **kw):
        self.calls.append(kw)
        p = self.payloads.pop(0)
        if isinstance(p, Exception):
            raise p
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=json.dumps(p, ensure_ascii=False))],
            usage=SimpleNamespace(input_tokens=1200, output_tokens=80),
            stop_reason="end_turn",
        )


def _ocr_req():
    return OcrRequest(page_ord=0, crops=[OcrCrop(id="r1", png=b"\x89PNG fake")])


def test_anthropic_ocr_request_shape_and_parse():
    fake = FakeAnthropic([OCR_JSON])
    res = AnthropicProvider("claude-haiku-5-5", client=fake).ocr_page(_ocr_req())
    kw = fake.calls[0]
    assert kw["model"] == "claude-haiku-5-5"
    assert kw["thinking"] == {"type": "disabled"}
    assert kw["output_config"]["format"] == {"type": "json_schema", "schema": OCR_SCHEMA}
    assert kw["output_config"]["effort"] == "low"
    content = kw["messages"][0]["content"]
    assert [c["type"] for c in content] == ["text", "text", "image"]
    assert content[2]["source"]["media_type"] == "image/png"
    assert res.items[0].source == "안녕"
    assert res.usage[0] == TokenUsage(
        provider="anthropic", model="claude-haiku-5-5", input_tokens=1200, output_tokens=80
    )


def test_anthropic_translate_sends_json_payload():
    fake = FakeAnthropic([TR_JSON])
    req = TranslateRequest(
        pages=[
            PageText(
                ord=0,
                regions=[RegionText(id="p0.r1", kind="text_bubble", bbox_norm=[0, 0, 1, 1], source="안녕")],
            )
        ],
        glossary={"민준": "Minjun"},
    )
    res = AnthropicProvider("claude-haiku-5-5", client=fake).translate_batch(req)
    kw = fake.calls[0]
    assert kw["output_config"]["format"]["schema"] == TRANSLATE_SCHEMA
    payload = json.loads(kw["messages"][0]["content"][0]["text"])
    assert payload["glossary"] == {"민준": "Minjun"} and payload["pages"][0]["regions"][0]["id"] == "p0.r1"
    assert res.items[0].translation == "Chào" and res.context_notes


def test_anthropic_rate_limit_classified_with_retry_after():
    resp = httpx2.Response(429, headers={"retry-after": "7"}, request=httpx2.Request("POST", "https://x"))
    fake = FakeAnthropic([anthropic.RateLimitError("rl", response=resp, body=None)])
    with pytest.raises(ProviderError) as ei:
        AnthropicProvider("claude-haiku-5-5", client=fake).ocr_page(_ocr_req())
    assert ei.value.error_class == "rate_limit" and ei.value.retry_after == 7


def test_anthropic_server_error_is_provider_class():
    resp = httpx2.Response(529, request=httpx2.Request("POST", "https://x"))
    fake = FakeAnthropic([anthropic.APIStatusError("overloaded", response=resp, body=None)])
    with pytest.raises(ProviderError) as ei:
        AnthropicProvider("claude-haiku-5-5", client=fake).ocr_page(_ocr_req())
    assert ei.value.error_class == "provider"


def test_schema_violation_is_schema_class():
    fake = FakeAnthropic([{"wrong": []}])
    with pytest.raises(ProviderError) as ei:
        AnthropicProvider("claude-haiku-5-5", client=fake).ocr_page(_ocr_req())
    assert ei.value.error_class == "schema"


# ---------- Gemini ----------


class FakeGemini:
    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.calls: list[dict] = []
        self.models = self

    def generate_content(self, **kw):
        self.calls.append(kw)
        p = self.payloads.pop(0)
        if isinstance(p, Exception):
            raise p
        return SimpleNamespace(
            text=json.dumps(p, ensure_ascii=False),
            usage_metadata=SimpleNamespace(
                prompt_token_count=900, candidates_token_count=60, thoughts_token_count=5
            ),
        )


def test_gemini_ocr_request_shape_thinking_off_and_usage():
    fake = FakeGemini([OCR_JSON])
    res = GeminiProvider("gemini-2.5-flash", client=fake).ocr_page(_ocr_req())
    kw = fake.calls[0]
    cfg = kw["config"]
    assert cfg.response_mime_type == "application/json" and cfg.response_json_schema == OCR_SCHEMA
    assert cfg.thinking_config.thinking_budget == 0
    assert kw["contents"][1] == "id=r1"
    # Token thinking tính như output.
    assert res.usage[0].input_tokens == 900 and res.usage[0].output_tokens == 65


def test_gemini3_uses_minimal_thinking_level():
    assert thinking_config("gemini-3-flash").thinking_level is not None


def test_gemini_429_rate_limit():
    err = errors.ClientError(
        429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}}
    )
    with pytest.raises(ProviderError) as ei:
        GeminiProvider("gemini-2.5-flash", client=FakeGemini([err])).ocr_page(_ocr_req())
    assert ei.value.error_class == "rate_limit"


def test_cost_uses_price_table():
    u = [
        TokenUsage(
            provider="anthropic", model="claude-haiku-5-5", input_tokens=1_000_000, output_tokens=1_000_000
        )
    ]
    assert cost_usd(u) == pytest.approx(0.6)


# ---------- OCR giai đoạn 1 ----------


class ScriptedProvider:
    name = "fake"
    model = "fake-model"

    def __init__(self, ocr=(), tr=()):
        self.ocr_script = list(ocr)
        self.tr_script = list(tr)
        self.ocr_reqs: list[OcrRequest] = []
        self.tr_reqs: list[TranslateRequest] = []

    def ocr_page(self, req):
        self.ocr_reqs.append(req)
        r = self.ocr_script.pop(0)
        if isinstance(r, Exception):
            raise r
        return r(req) if callable(r) else r

    def translate_batch(self, req):
        self.tr_reqs.append(req)
        r = self.tr_script.pop(0)
        if isinstance(r, Exception):
            raise r
        return r(req) if callable(r) else r


def _page():
    img = np.full((400, 300, 3), 255, np.uint8)
    img[60:90, 60:200] = 0  # "chữ" đặc ở vùng r1
    regions = [
        Region(id="r0", kind="bubble", bbox=BBox(x=40, y=40, w=200, h=80), score=1),
        Region(id="r1", kind="text_bubble", bbox=BBox(x=50, y=50, w=160, h=50), score=1, bubble_id="r0"),
        Region(id="r2", kind="text_free", bbox=BBox(x=50, y=250, w=160, h=50), score=1),  # trắng tinh → rỗng
    ]
    return img, regions


def _echo(req, drop=False, sfx=False):
    ids = [c.id for c in req.crops]
    items = [OcrItem(id=i, source="말", is_sfx=sfx, confidence=0.8) for i in ids]
    return OcrResult(items=items[:-1] if drop else items, usage=[TokenUsage(provider="f", model="m")])


def test_ocr_skips_inkless_crop_and_keeps_order():
    img, regions = _page()
    prov = ScriptedProvider(ocr=[_echo])
    res = ocr_page(prov, img, regions, 0)
    assert [c.id for c in prov.ocr_reqs[0].crops] == ["r1"]  # crop rỗng không gửi LLM
    assert [i.id for i in res.items] == ["r1", "r2"]
    assert res.items[1].empty and not res.items[0].low_conf


def test_ocr_missing_id_retries_once_then_low_conf():
    img, regions = _page()
    regions[2] = regions[2].model_copy(update={"bbox": BBox(x=50, y=55, w=160, h=40)})  # thêm vùng có mực
    prov = ScriptedProvider(ocr=[lambda r: _echo(r, drop=True), lambda r: _echo(r, drop=True)])
    res = ocr_page(prov, img, regions, 0)
    assert len(prov.ocr_reqs) == 2
    assert all(i.low_conf for i in res.items)


def test_ocr_retry_succeeds_and_schema_error_retried():
    img, regions = _page()
    prov = ScriptedProvider(ocr=[ProviderError("schema", "bad json"), _echo])
    res = ocr_page(prov, img, regions, 0)
    assert len(prov.ocr_reqs) == 2 and not res.items[0].low_conf


def test_ocr_rate_limit_propagates_without_retry():
    img, regions = _page()
    prov = ScriptedProvider(ocr=[ProviderError("rate_limit", "429", 3)])
    with pytest.raises(ProviderError):
        ocr_page(prov, img, regions, 0)
    assert len(prov.ocr_reqs) == 1


def test_ocr_marks_sfx_on_regions():
    img, regions = _page()
    ocr_page(ScriptedProvider(ocr=[lambda r: _echo(r, sfx=True)]), img, regions, 0)
    assert regions[1].is_sfx


# ---------- Dịch giai đoạn 2 ----------


def _pages(n_pages, per_page):
    return [
        PageText(
            ord=o,
            regions=[
                RegionText(
                    id=qualified_id(o, f"r{i}"),
                    kind="text_bubble",
                    bbox_norm=[0, 0, 1, 1],
                    source=f"src{o}-{i}",
                )
                for i in range(per_page)
            ],
        )
        for o in range(n_pages)
    ]


def test_make_batches_by_pages_and_region_cap():
    assert [len(b) for b in make_batches(_pages(10, 3))] == [4, 4, 2]
    assert [len(b) for b in make_batches(_pages(5, 15))] == [2, 2, 1]  # ≤ 40 vùng/lô
    big = _pages(1, 50)
    assert len(make_batches(big)) == 1


def _tr_all(req, speaker="A"):
    items = [
        TranslateItem(id=r.id, translation=f"vi:{r.source}", speaker=speaker)
        for p in req.pages
        for r in p.regions
    ]
    return TranslateResult(
        items=items,
        context_notes=f"notes{req.pages[0].ord}",
        usage=[TokenUsage(provider="f", model="m", input_tokens=10, output_tokens=5)],
    )


def test_translate_rolling_passes_context_in_page_order():
    pages = _pages(6, 4)
    prov = ScriptedProvider(tr=[_tr_all, _tr_all])
    out = translate_chapter(prov, list(reversed(pages)), SeriesSettings(glossary={"a": "b"}), "rolling")
    assert out.context_used == "rolling" and len(prov.tr_reqs) == 2
    first, second = prov.tr_reqs
    assert [p.ord for p in first.pages] == [0, 1, 2, 3]
    assert first.context is not None and first.context.lines == []
    assert second.context is not None
    assert len(second.context.lines) == CONTEXT_LINES
    assert second.context.lines[-1].translation == "vi:src3-3"
    assert second.context.notes == "notes0" and second.context.characters == ["A"]
    assert second.glossary == {"a": "b"}
    assert out.items["5"][qualified_id(5, "r0")].translation == "vi:src5-0"
    assert len(out.usage) == 2


def test_translate_none_mode_is_per_page_without_context():
    prov = ScriptedProvider(tr=[_tr_all] * 3)
    out = translate_chapter(prov, _pages(3, 2), SeriesSettings(), "none")
    assert len(prov.tr_reqs) == 3 and all(r.context is None for r in prov.tr_reqs)
    assert out.context_used == "none"


def test_translate_missing_id_retry_then_low_conf():
    def partial(req):
        res = _tr_all(req)
        res.items = res.items[:-1]
        return res

    prov = ScriptedProvider(tr=[partial, partial])
    out = translate_chapter(prov, _pages(1, 3), SeriesSettings(), "rolling")
    items = out.items["0"]
    assert len(prov.tr_reqs) == 2
    assert all(i.low_conf for i in items.values())
    assert items[qualified_id(0, "r2")].translation == ""


def test_translate_rejects_duplicate_ids_across_pages():
    pages = [
        PageText(ord=o, regions=[RegionText(id="r0", kind="text_bubble", bbox_norm=[0, 0, 1, 1], source="x")])
        for o in range(2)
    ]
    with pytest.raises(ValueError):
        translate_chapter(ScriptedProvider(), pages, SeriesSettings())


def test_update_context_caps_lines():
    from mtl_pipeline.schema import RollingContext

    batch = _pages(1, 20)
    items = {r.id: TranslateItem(id=r.id, translation="t", speaker="?") for r in batch[0].regions}
    ctx = update_context(RollingContext(), batch, items, "")
    assert len(ctx.lines) == CONTEXT_LINES and ctx.characters == []


def test_permanent_4xx_not_retryable_and_transient_is():
    from mtl_pipeline.providers.base import classify_status

    assert classify_status(429) == ("rate_limit", True)
    assert classify_status(503) == ("provider", True)
    assert classify_status(408) == ("provider", True)
    assert classify_status(401) == ("provider", False)
    assert classify_status(400) == ("provider", False)
    resp = httpx2.Response(404, request=httpx2.Request("POST", "https://x"))
    fake = FakeAnthropic([anthropic.NotFoundError("no model", response=resp, body=None)])
    with pytest.raises(ProviderError) as ei:
        AnthropicProvider("claude-haiku-5-5", client=fake).ocr_page(_ocr_req())
    assert not ei.value.retryable


def test_unknown_model_price_raises():
    from mtl_pipeline.providers.base import UnknownPrice

    with pytest.raises(UnknownPrice):
        cost_usd([TokenUsage(provider="g", model="gemini-9-flash", input_tokens=1)])


def test_schema_error_carries_billed_usage():
    fake = FakeAnthropic([{"wrong": []}])
    with pytest.raises(ProviderError) as ei:
        AnthropicProvider("claude-haiku-5-5", client=fake).ocr_page(_ocr_req())
    assert ei.value.usage and ei.value.usage[0].input_tokens == 1200


def test_ocr_second_attempt_schema_error_falls_back_to_first_result_low_conf():
    img, regions = _page()
    regions[2] = regions[2].model_copy(update={"bbox": BBox(x=50, y=55, w=160, h=40)})
    err = ProviderError("schema", "bad", usage=[TokenUsage(provider="f", model="m", input_tokens=7)])
    prov = ScriptedProvider(ocr=[lambda r: _echo(r, drop=True), err])
    res = ocr_page(prov, img, regions, 0)
    assert all(i.low_conf for i in res.items)
    missing = next(i for i in res.items if i.source == "")
    assert not missing.empty  # id thiếu không bị coi là crop rỗng
    assert sum(u.input_tokens for u in res.usage) == 7


def test_translate_error_mid_chapter_keeps_usage_of_done_batches():
    prov = ScriptedProvider(tr=[_tr_all, ProviderError("rate_limit", "429")])
    with pytest.raises(ProviderError) as ei:
        translate_chapter(prov, _pages(8, 2), SeriesSettings(), "rolling")
    assert sum(u.input_tokens for u in ei.value.usage) == 10
