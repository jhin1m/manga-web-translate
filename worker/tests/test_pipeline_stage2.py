"""Giai đoạn 2 trên artifact giai đoạn 1 (clean.png, regions.json, ocr.json) với provider giả."""

from __future__ import annotations

import json

import cv2
import numpy as np

from mtl_pipeline.images import open_rgb, save_png
from mtl_pipeline.pipeline import translate_dir, write_regions
from mtl_pipeline.schema import BBox, OcrItem, OcrResult, PageAiState, Region, TranslateItem, TranslateResult
from mtl_pipeline.translate import SeriesSettings


class EchoTranslator:
    name = "fake"
    model = "fake-model"

    def __init__(self):
        self.reqs = []

    def ocr_page(self, req):
        raise AssertionError("giai đoạn 2 không gọi OCR")

    def translate_batch(self, req):
        self.reqs.append(req)
        items = [
            TranslateItem(id=r.id, translation=f"Câu dịch {r.source}", speaker="?")
            for p in req.pages
            for r in p.regions
        ]
        return TranslateResult(items=items, context_notes="")


def _make_page(d, ord_):
    d.mkdir(parents=True)
    clean = np.full((600, 400, 3), 140, np.uint8)
    cv2.ellipse(clean, (200, 200), (170, 110), 0, 0, 360, (255, 255, 255), -1)
    save_png(clean, d / "clean.png")
    regions = [
        Region(id="r0", kind="bubble", bbox=BBox(x=30, y=90, w=340, h=220), score=1),
        Region(id="r1", kind="text_bubble", bbox=BBox(x=130, y=170, w=140, h=60), score=1, bubble_id="r0"),
        Region(id="r2", kind="text_free", bbox=BBox(x=40, y=450, w=300, h=60), score=1, is_sfx=True),
    ]
    write_regions(d, regions, 400, 600, ord_, f"{ord_}.png")
    ocr = OcrResult(
        items=[
            OcrItem(id="r1", source=f"안녕 {ord_}", confidence=0.9),
            OcrItem(id="r2", source="쾅", is_sfx=True),
        ]
    )
    (d / "ocr.json").write_text(ocr.model_dump_json())


def test_translate_dir_end_to_end(tmp_path):
    for i in (0, 1, 2, 10):
        _make_page(tmp_path / f"p{i}", i)
    prov = EchoTranslator()
    states = translate_dir(tmp_path, prov, SeriesSettings(), "rolling")
    assert [s.page_ord for s in states] == [0, 1, 2, 10]
    # SFX không gửi dịch; id đủ điều kiện duy nhất cả chương.
    sent = [r.id for req in prov.reqs for p in req.pages for r in p.regions]
    assert sent == ["p0.r1", "p1.r1", "p2.r1", "p10.r1"]
    st = PageAiState.model_validate_json((tmp_path / "p10" / "state.json").read_text())
    assert st.meta["context_used"] == "rolling"
    assert [t.id for t in st.translations] == ["r1"] and st.translations[0].translation == "Câu dịch 안녕 10"
    assert len(st.boxes) == 1 and st.boxes[0].lines
    final = open_rgb(tmp_path / "p10" / "final.png")
    assert (final != open_rgb(tmp_path / "p10" / "clean.png")).any()
    assert json.loads((tmp_path / "translate_usage.json").read_text()) == []


def test_translate_dir_refuses_pages_without_ocr(tmp_path):
    import pytest

    _make_page(tmp_path / "p0", 0)
    _make_page(tmp_path / "p1", 1)
    (tmp_path / "p1" / "ocr.json").unlink()
    with pytest.raises(FileNotFoundError, match="p1"):
        translate_dir(tmp_path, EchoTranslator(), SeriesSettings())


def test_restore_sfx_puts_back_original_pixels_except_other_text():
    from mtl_pipeline.pipeline import restore_sfx

    img = np.full((300, 300, 3), 50, np.uint8)
    clean = np.full((300, 300, 3), 200, np.uint8)
    mask = np.full((300, 300), 255, np.uint8)
    sfx = Region(id="r0", kind="text_free", bbox=BBox(x=20, y=20, w=100, h=60), score=1, is_sfx=True)
    talk = Region(id="r1", kind="text_bubble", bbox=BBox(x=20, y=200, w=100, h=60), score=1)
    c2, m2 = restore_sfx(img, clean, mask, [sfx, talk])
    assert (c2[20:80, 20:120] == 50).all() and not m2[20:80, 20:120].any()
    assert (c2[200:260, 20:120] == 200).all() and m2[200:260, 20:120].all()
    assert (clean == 200).all()  # không sửa mảng đầu vào
