"""Ngữ cảnh dịch đi qua chuỗi job theo lô: payload `carry` (notes + tên nhân vật) → ngữ cảnh mở đầu, ngữ cảnh cuối
lô → result `carry` cho lô sau."""

from __future__ import annotations

from typing import Any

from mtl_pipeline.schema import TokenUsage, TranslateItem, TranslateResult, validate_contract
from mtl_pipeline.translate import SeriesSettings, translate_chapter
from mtl_worker.handlers import handle_translate
from mtl_worker.runner import JobContext
from tests.test_llm_contract import ScriptedProvider, _pages
from tests.test_worker_runner import FakeClient

CHAPTER = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a60"
PAGE = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a61"


def _tr(notes: str, speaker: str = "Minjun"):
    def run(req):
        items = [
            TranslateItem(id=r.id, translation=f"vi:{r.source}", speaker=speaker)
            for p in req.pages
            for r in p.regions
        ]
        return TranslateResult(
            items=items, context_notes=notes, usage=[TokenUsage(provider="f", model="m", input_tokens=1)]
        )

    return run


class _Deps:
    def __init__(self, provider):
        self.pipeline = None
        self.provider = provider


def _job(carry: dict[str, Any] | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type": "chapter.translate",
        "chapter_id": CHAPTER,
        "page_ids": [PAGE],
        "context": "neighbors",
        "glossary_rev": 0,
        "settings_rev": 0,
        "settings": {
            "glossary": {},
            "pronoun_rules": "",
            "honorific_policy": "",
            "style_prompt": "",
            "font": "Bangers-Regular",
        },
    }
    if carry is not None:
        payload["carry"] = carry
    ocr = {
        "regions": [
            {"id": "t0", "kind": "text_free", "bbox": [2, 2, 40, 20], "polarity": "dark_on_light", "bubble_id": None}
        ],
        "items": [
            {"id": "t0", "source": "안녕", "is_sfx": False, "empty": False, "confidence": 0.9, "low_conf": False}
        ],
    }
    return {
        "id": "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a62",
        "type": "chapter.translate",
        "attempt": 1,
        "lease_token": "t" * 48,
        "lease_expires_at": "x",
        "payload": payload,
        "inputs": {
            "pages": [
                {"page_id": PAGE, "ord": 0, "width": 48, "height": 64, "ocr_result": ocr, "clean": "http://c"}
            ],
            "context_lines": [],
            "fonts": [],
        },
        "outputs": {},
    }


def test_translate_chapter_returns_final_context():
    prov = ScriptedProvider(tr=[_tr("n1", "Minjun"), _tr("n2", "Sora")])
    out = translate_chapter(prov, _pages(5, 1), SeriesSettings(), "rolling")
    assert len(prov.tr_reqs) == 2
    assert out.context.notes == "n2"
    assert out.context.characters == ["Minjun", "Sora"]


def test_handler_seeds_context_from_payload_carry():
    prov = ScriptedProvider(tr=[_tr("")])
    result = handle_translate(JobContext(FakeClient(), _job({"notes": "Minjun", "characters": ["Minjun"]})), _Deps(prov))
    first = prov.tr_reqs[0].context
    assert first is not None and first.notes == "Minjun" and "Minjun" in first.characters
    # Lô không có notes mới → notes cũ đi tiếp sang lô sau.
    assert result["carry"] == {"notes": "Minjun", "characters": ["Minjun"]}


def test_handler_returns_carry_within_limits():
    names = [f"Tên {i}" for i in range(49)] + ["X" * 100]
    prov = ScriptedProvider(tr=[_tr("n" * 5000, speaker="Y" * 80)])
    result = handle_translate(JobContext(FakeClient(), _job({"notes": "", "characters": names})), _Deps(prov))
    carry = result["carry"]
    assert len(carry["notes"]) == 2000
    assert len(carry["characters"]) == 30
    assert all(0 < len(c) <= 64 for c in carry["characters"])
    validate_contract("job-result", result)


def test_payload_without_carry_still_valid():
    job = _job(None)
    validate_contract("job-payload", job["payload"])
    prov = ScriptedProvider(tr=[_tr("ghi chú")])
    result = handle_translate(JobContext(FakeClient(), job), _Deps(prov))
    assert [p["page_id"] for p in result["pages"]] == [PAGE]
    assert result["carry"] == {"notes": "ghi chú", "characters": ["Minjun"]}
    validate_contract("job-result", result)


def test_carry_limits_count_utf16_units_like_the_api():
    # Emoji = 2 đơn vị UTF-16: zod `.max()` đếm như JS, cắt theo code point vẫn vượt trần → API từ chối cả result.
    prov = ScriptedProvider(tr=[_tr("😀" * 1500, speaker="😀" * 40)])
    result = handle_translate(JobContext(FakeClient(), _job(None)), _Deps(prov))
    carry = result["carry"]
    assert len(carry["notes"].encode("utf-16-le")) // 2 == 2000
    assert all(len(c.encode("utf-16-le")) // 2 <= 64 for c in carry["characters"])
