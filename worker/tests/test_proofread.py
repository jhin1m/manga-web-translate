"""AI hiệu đính: payload gửi provider (JSON + ảnh), lọc gợi ý, retry JSON sai, handler theo tier model."""

from __future__ import annotations

import json

import numpy as np
import pytest

from mtl_pipeline.images import encode_png
from mtl_pipeline.proofread import page_images, proofread_page, validate_suggestions
from mtl_pipeline.providers import make_provider
from mtl_pipeline.providers.anthropic import AnthropicProvider
from mtl_pipeline.providers.base import PROOFREAD_SCHEMA, ProviderError
from mtl_pipeline.providers.gemini import GeminiProvider, thinking_config
from mtl_pipeline.schema import ProofreadItem, ProofreadRegion, ProofreadRequest, ProofreadResult, TokenUsage
from mtl_worker.handlers import HANDLERS
from mtl_worker.runner import run_job

from .test_llm_contract import FakeAnthropic, FakeGemini
from .test_worker_runner import PAGE, FakeClient

REGIONS = [
    ProofreadRegion(id="t0", kind="text_bubble", source="안녕", translation="Xin chao"),
    ProofreadRegion(id="t1", kind="text_free", source="그래", translation="Được rồi"),
]
PR_JSON = {"items": [{"id": "t0", "suggestion": "Xin chào", "reason": "thiếu dấu"}]}


def _req(**kw):
    return ProofreadRequest(page_ord=0, regions=REGIONS, images=[b"\xff\xd8jpeg"], target_lang="vi", **kw)


def test_validate_drops_unknown_duplicate_empty_and_unchanged():
    items = [
        ProofreadItem(id="t0", suggestion="Xin chào", reason="dấu"),
        ProofreadItem(id="t0", suggestion="Chào", reason="trùng id"),
        ProofreadItem(id="t1", suggestion="  Được   rồi ", reason="chỉ khác khoảng trắng"),
        ProofreadItem(id="zz", suggestion="X", reason="id lạ"),
        ProofreadItem(id="t1", suggestion=" ", reason="rỗng"),
    ]
    assert [(i.id, i.suggestion) for i in validate_suggestions(REGIONS, items)] == [("t0", "Xin chào")]


def test_page_images_chunks_tall_strip_and_caps_count():
    tall = np.full((20000, 800, 3), 200, np.uint8)
    imgs = page_images(tall)
    assert 1 < len(imgs) <= 6 and all(b[:2] == b"\xff\xd8" for b in imgs)
    assert len(page_images(np.full((900, 600, 3), 255, np.uint8))) == 1


def test_gemini_proofread_sends_json_then_images():
    fake = FakeGemini([PR_JSON])
    res = GeminiProvider("gemini-2.5-flash", client=fake).proofread_page(_req())
    kw = fake.calls[0]
    assert kw["config"].response_json_schema == PROOFREAD_SCHEMA
    payload = json.loads(kw["contents"][0])
    assert payload["regions"][0] == {
        "id": "t0",
        "kind": "text_bubble",
        "source": "안녕",
        "translation": "Xin chao",
    }
    assert len(kw["contents"]) == 2  # JSON + 1 ảnh
    assert res.items[0].suggestion == "Xin chào"


def test_anthropic_proofread_includes_jpeg():
    fake = FakeAnthropic([PR_JSON])
    AnthropicProvider("claude-haiku-5-5", client=fake).proofread_page(_req())
    content = fake.calls[0]["messages"][0]["content"]
    assert content[1]["type"] == "image" and content[1]["source"]["media_type"] == "image/jpeg"


def test_premium_tier_picks_premium_models(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    monkeypatch.delenv("MTL_GEMINI_PREMIUM_MODEL", raising=False)
    assert make_provider("gemini", "premium").model == "gemini-2.5-pro"
    assert make_provider("gemini").model == "gemini-2.5-flash"
    # 2.5 Pro không tắt được thinking → budget tối thiểu.
    assert thinking_config("gemini-2.5-pro").thinking_budget == 128


class SeqProvider:
    name, model = "fake", "gemini-2.5-flash"

    def __init__(self, results):
        self.results = list(results)
        self.reqs: list[ProofreadRequest] = []

    def proofread_page(self, req):
        self.reqs.append(req)
        r = self.results.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def _usage():
    return [TokenUsage(provider="fake", model="gemini-2.5-flash", input_tokens=50, output_tokens=10)]


def test_schema_error_retried_once_and_usage_kept():
    bad = ProviderError("schema", "json hỏng", usage=_usage())
    ok = ProofreadResult(items=[ProofreadItem(id="t0", suggestion="Xin chào")], usage=_usage())
    res = proofread_page(SeqProvider([bad, ok]), _req())
    assert [i.id for i in res.items] == ["t0"] and len(res.usage) == 2
    with pytest.raises(ProviderError):
        proofread_page(SeqProvider([ProviderError("rate_limit", "429")]), _req())


def test_handler_proofreads_each_page_with_context_and_tier():
    prov = SeqProvider(
        [
            ProofreadResult(
                items=[ProofreadItem(id="t0", suggestion="Xin chào", reason="dấu")], usage=_usage()
            ),
            ProofreadResult(items=[], usage=_usage()),
        ]
    )

    class Deps:
        tiers: list[str] = []

        def provider_for(self, tier):
            self.tiers.append(tier)
            return prov

    page2 = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6d"
    regions = [r.model_dump() for r in REGIONS]
    job = {
        "id": "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6e",
        "type": "chapter.proofread",
        "attempt": 1,
        "lease_token": "t" * 48,
        "lease_expires_at": "x",
        "payload": {
            "type": "chapter.proofread",
            "chapter_id": PAGE,
            "page_ids": [PAGE, page2],
            "model_tier": "premium",
            "settings": {
                "glossary": {"검": "kiếm"},
                "source_lang": "ko",
                "target_lang": "vi",
                "pronoun_rules": "",
                "honorific_policy": "giữ",
                "style_prompt": "",
                "font": "Bangers-Regular",
            },
        },
        "inputs": {
            "pages": [
                {
                    "page_id": page2,
                    "ord": 1,
                    "width": 48,
                    "height": 64,
                    "image": "http://f/2",
                    "regions": regions,
                },
                {
                    "page_id": PAGE,
                    "ord": 0,
                    "width": 48,
                    "height": 64,
                    "image": "http://f/1",
                    "regions": regions,
                },
            ]
        },
        "outputs": {},
    }

    class Client(FakeClient):
        def download(self, url):
            return encode_png(np.full((64, 48, 3), 255, np.uint8))

    c = Client()
    deps = Deps()
    assert run_job(c, job, HANDLERS, deps) == "succeeded"
    assert deps.tiers == ["premium"]
    # Theo ord: trang 0 trước, trang 1 nhận ngữ cảnh của trang 0.
    assert prov.reqs[0].page_ord == 0 and prov.reqs[1].context[0].translation == "Xin chao"
    assert prov.reqs[0].glossary == {"검": "kiếm"} and prov.reqs[0].images
    result, usage = c.calls[-1][1]
    assert result["suggestions"] == [
        {"page_id": PAGE, "region_id": "t0", "old": "Xin chao", "suggestion": "Xin chào", "reason": "dấu"}
    ]
    assert usage["llm_in"] == 100 and usage["calls"] == 2
