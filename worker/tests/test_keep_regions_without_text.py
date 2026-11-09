"""Vùng không có chữ/số (dấu câu, ký hiệu, OCR rỗng) giữ nguyên ảnh gốc và không đi dịch."""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from mtl_pipeline.images import open_rgb
from mtl_pipeline.local_ocr import ocr_page_local
from mtl_pipeline.ocr import keep_regions_without_text
from mtl_pipeline.schema import BBox, OcrItem, OcrResult, Region, TranslateItem
from mtl_pipeline.translate import ChapterTranslation, RollingContext, qualified_id
from mtl_worker import handlers
from mtl_worker.runner import open_gray, png_bytes, region_to_shared


def _region(rid: str, x: int, kind: str = "text_bubble") -> Region:
    return Region(id=rid, kind=kind, bbox=BBox(x=x, y=20, w=40, h=40), score=0.9)


@pytest.mark.parametrize("source", ["...!", "……！", "?!", "♥", "", "   "])
def test_regions_without_letters_or_digits_keep_the_original(source):
    region = _region("r", 10)
    res = keep_regions_without_text([region], OcrResult(items=[OcrItem(id="r", source=source)]))
    assert res.items[0].is_sfx and region.is_sfx


@pytest.mark.parametrize("source", ["Hello!", "...1", "안녕", "こんにちは…", "你好"])
def test_regions_with_letters_or_digits_are_untouched(source):
    region = _region("r", 10)
    res = keep_regions_without_text([region], OcrResult(items=[OcrItem(id="r", source=source)]))
    assert not res.items[0].is_sfx and not region.is_sfx


def test_keeps_empty_and_low_conf_flags():
    regions = [_region("a", 10), _region("b", 70)]
    items = [OcrItem(id="a", empty=True, confidence=1.0), OcrItem(id="b", low_conf=True)]
    a, b = keep_regions_without_text(regions, OcrResult(items=items)).items
    assert a.is_sfx and a.empty
    assert b.is_sfx and b.low_conf


def test_flags_do_not_report_a_kept_empty_region_as_needing_attention():
    assert handlers._flags(OcrItem(id="r", empty=True, is_sfx=True), False) == ["sfx"]
    assert handlers._flags(OcrItem(id="r", empty=True), False) == ["empty"]


def test_user_drawn_regions_are_not_marked_by_ocr_itself():
    """`page.ocr_region` đi qua OCR nhưng không qua bước prepare → vẫn là chữ."""
    img = np.full((80, 120, 3), 255, np.uint8)
    img[30:50, 20:40] = 0
    engine = SimpleNamespace(name="fake", read=lambda crop: ("...!", 0.9))
    assert not ocr_page_local(engine, img, [_region("r", 10)]).items[0].is_sfx


class _Uploads(dict):
    def __call__(self, name, data):
        self[name] = data


def _run_prepare(monkeypatch, img, clean, mask, regions, *, local=None, provider=None):
    """`handle_prepare` thật với detect/inpaint giả → (kết quả job, clean, mask đã upload)."""
    monkeypatch.setattr(handlers, "local_engine", lambda *a, **k: local)
    monkeypatch.setattr(handlers, "llm_provider", lambda *a, **k: provider)
    uploads = _Uploads()
    ctx = SimpleNamespace(
        outputs={"clean": {"rev": "rev"}},
        payload={},
        inputs={"original": "orig"},
        download=lambda _ref: png_bytes(img)[0],
        report=lambda *a, **k: None,
        upload=uploads,
        add_usage=lambda _usage: None,
    )
    deps = SimpleNamespace(
        pipeline=SimpleNamespace(prepare_image=lambda *a, **k: (regions, mask, clean, None))
    )
    out = handlers.handle_prepare(ctx, deps)
    return out, open_rgb(uploads["clean"]), open_gray(uploads["mask"])


def _prepare(monkeypatch, **engines):
    """Ảnh có mực ở 2 vùng cách xa nhau, cả 2 đã bị xoá trắng."""
    img = np.full((80, 300, 3), 255, np.uint8)
    img[30:50, 20:40] = 0
    img[30:50, 220:240] = 0
    clean = np.full_like(img, 255)
    mask = np.zeros(img.shape[:2], np.uint8)
    mask[20:60, 10:50] = 255
    mask[20:60, 210:250] = 255
    regions = [_region("punct", 10), _region("talk", 210)]
    return (img, *_run_prepare(monkeypatch, img, clean, mask, regions, **engines))


def _assert_only_punctuation_restored(img, out, clean, mask):
    assert np.array_equal(clean[20:60, 10:50], img[20:60, 10:50])
    assert (mask[20:60, 10:50] == 0).all()
    assert (clean[30:50, 220:240] == 255).all()
    assert (mask[30:50, 220:240] == 255).all()
    flags = {it["id"]: it["is_sfx"] for it in out["ocr_result"]["items"]}
    assert flags == {"punct": True, "talk": False}


def test_prepare_with_local_ocr_restores_only_the_punctuation_region(monkeypatch):
    answers = iter([("...!", 0.9), ("Hello", 0.9)])
    engine = SimpleNamespace(name="fake", read=lambda crop: next(answers))
    _assert_only_punctuation_restored(*_prepare(monkeypatch, local=engine))


def test_prepare_with_llm_ocr_restores_punctuation_even_inside_a_bubble(monkeypatch):
    """Đoạn `ocr_page` xoá is_sfx của vùng trong bóng không được làm mất dấu của vùng dấu câu."""

    class Provider:
        name = "fake"

        def ocr_page(self, req):
            text = {"punct": "...!", "talk": "Hello"}
            return OcrResult(items=[OcrItem(id=c.id, source=text[c.id], is_sfx=True) for c in req.crops])

    _assert_only_punctuation_restored(*_prepare(monkeypatch, provider=Provider()))


def test_prepare_keeps_a_region_with_no_ink_when_no_crop_reaches_the_llm(monkeypatch):
    class Provider:
        def ocr_page(self, req):
            raise AssertionError("không crop nào có mực thì không gọi LLM")

    img = np.full((80, 300, 3), 255, np.uint8)
    clean = np.full_like(img, 128)  # inpaint giả khác ảnh gốc để thấy được pixel trả về
    mask = np.zeros(img.shape[:2], np.uint8)
    mask[20:60, 10:50] = 255
    out, kept, kept_mask = _run_prepare(
        monkeypatch, img, clean, mask, [_region("blank", 10)], provider=Provider()
    )
    assert out["ocr_result"]["items"][0]["is_sfx"]
    assert np.array_equal(kept[20:60, 10:50], img[20:60, 10:50])
    assert (kept_mask[20:60, 10:50] == 0).all()


def _translate_boxes(monkeypatch, kept_item: OcrItem) -> tuple[Region, list[dict]]:
    """Dịch 1 trang có bóng chứa câu thoại (trên) và vùng giữ nguyên hình (dưới) → (bóng, box đặt chữ)."""
    img = np.full((200, 200, 3), 255, np.uint8)
    bubble = Region(id="b", kind="bubble", bbox=BBox(x=10, y=10, w=180, h=180), score=0.9)
    talk = Region(id="talk", kind="text_bubble", bbox=BBox(x=50, y=30, w=100, h=40), score=0.9, bubble_id="b")
    kept = Region(id="kept", kind="text_bubble", bbox=BBox(x=70, y=140, w=60, h=30), score=0.9, bubble_id="b")
    regions = [bubble, talk, kept]
    items = [OcrItem(id="talk", source="Hello"), kept_item]
    talk_id = qualified_id(0, "talk")
    tr = ChapterTranslation(
        items={"0": {talk_id: TranslateItem(id=talk_id, translation="Xin chào các bạn nhé", speaker="?")}},
        usage=[],
        context_used="rolling",
        context=RollingContext(),
    )
    monkeypatch.setattr(handlers, "translate_chapter", lambda *a, **k: tr)
    monkeypatch.setattr(handlers, "llm_provider", lambda *a, **k: SimpleNamespace(model="fake"))
    seen: dict[str, list[Region]] = {}
    real = handlers.typeset_region

    def spy(clean, region, bub, text, font, siblings=()):
        seen[region.id] = list(siblings)
        return real(clean, region, bub, text, font, siblings)

    monkeypatch.setattr(handlers, "typeset_region", spy)
    page = {
        "page_id": "p",
        "ord": 0,
        "width": 200,
        "height": 200,
        "clean": "c",
        "ocr_result": {
            "regions": [region_to_shared(r) for r in regions],
            "items": [handlers._ocr_item_to_shared(it) for it in items],
        },
    }
    ctx = SimpleNamespace(
        payload={"settings": _SETTINGS, "context": "rolling", "glossary_rev": 0, "settings_rev": 0},
        inputs={"pages": [page], "context_lines": []},
        download=lambda _ref: png_bytes(img)[0],
        report=lambda *a, **k: None,
        add_usage=lambda _usage: None,
    )
    handlers.handle_translate(ctx, SimpleNamespace())
    return kept, seen["talk"]


_SETTINGS = {
    "glossary": {},
    "pronoun_rules": "",
    "honorific_policy": "",
    "style_prompt": "",
    "font": "KomikaText-Regular",
    "narration_font": "KomikaText-Regular",
}


def test_kept_punctuation_keeps_its_share_of_the_bubble(monkeypatch):
    kept, siblings = _translate_boxes(monkeypatch, OcrItem(id="kept", source="...!", is_sfx=True))
    assert [r.id for r in siblings] == [kept.id]


def test_a_region_with_no_ink_does_not_take_bubble_space(monkeypatch):
    _, siblings = _translate_boxes(monkeypatch, OcrItem(id="kept", empty=True, is_sfx=True))
    assert siblings == []
