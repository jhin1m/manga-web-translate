"""Worker dựng payload/result đúng JSON Schema sinh từ zod (packages/shared) — lệch là fail ở đây, không ở API."""

from __future__ import annotations

import unicodedata

import numpy as np
import pytest

from mtl_pipeline.schema import BBox, ContractError, OcrItem, Region, validate_contract
from mtl_pipeline.typeset import typeset_region
from mtl_worker.handlers import build_page_state
from mtl_worker.runner import region_from_shared, region_to_shared

META = {
    "pipeline_version": "0.3.0",
    "model": "gemini-2.5-flash",
    "glossary_rev": 0,
    "settings_rev": 0,
    "context_used": "rolling",
}


def regions() -> list[Region]:
    return [
        Region(id="b0", kind="bubble", bbox=BBox(x=10, y=10, w=300, h=200), score=0.9),
        Region(id="t0", kind="text_bubble", bbox=BBox(x=60, y=60, w=180, h=80), score=0.9, bubble_id="b0"),
        Region(id="t1", kind="text_free", bbox=BBox(x=20, y=400, w=200, h=60), score=0.8, is_sfx=True),
    ]


def test_ocr_result_and_partial_match_schema():
    regs = regions()
    items = [
        OcrItem(id="t0", source="안녕", confidence=0.9),
        OcrItem(id="t1", source="쾅", is_sfx=True, confidence=0.7, low_conf=True),
    ]
    ocr = {
        "regions": [region_to_shared(r) for r in regs],
        "items": [{**it.model_dump()} for it in items],
    }
    validate_contract("ocr-result", ocr)
    validate_contract(
        "job-result", {"type": "page.prepare", "clean_rev": 3, "mask_rev": 3, "ocr_result": ocr}
    )
    validate_contract("prepare-partial", {"clean_rev": 3, "mask_rev": 3, "regions": ocr["regions"]})
    back = [region_from_shared(d) for d in ocr["regions"]]
    assert [(r.id, r.kind, r.bbox, r.bubble_id) for r in back] == [
        (r.id, r.kind, r.bbox, r.bubble_id) for r in regs
    ]


def test_page_state_from_pipeline_matches_schema_and_is_nfc():
    clean = np.full((600, 400, 3), 255, np.uint8)
    regs = regions()
    nfd = unicodedata.normalize("NFD", "Anh đang làm gì vậy?")
    box = typeset_region(clean, regs[1], regs[0], nfd, "PatrickHand-Regular")
    items = {
        "t0": OcrItem(id="t0", source="안녕", confidence=0.9),
        "t1": OcrItem(id="t1", source="쾅", is_sfx=True),
    }
    state = build_page_state(400, 600, regs, items, {"t0": (nfd, False)}, [box], META)
    validate_contract("page-state", state)
    validate_contract(
        "job-result",
        {
            "type": "chapter.translate",
            "pages": [{"page_id": "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b", "ai_state": state}],
        },
    )
    tb = state["text_boxes"][0]
    assert tb["text"] == unicodedata.normalize("NFC", tb["text"])
    assert {"font_family", "font_size", "pad", "lines"} <= tb.keys()
    assert state["regions"][2]["flags"] == ["sfx"]


def test_contract_violation_raises():
    with pytest.raises(ContractError):
        validate_contract("job-result", {"type": "page.prepare", "clean_rev": -1})
    with pytest.raises(ContractError):
        validate_contract("job-payload", {"type": "page.prepare", "page_id": "x"})
