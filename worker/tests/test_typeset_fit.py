from __future__ import annotations

import json
import unicodedata

import cv2
import numpy as np

from mtl_pipeline.fonts import DEFAULT_FONT, MANIFEST, metrics_for, vietnamese_chars
from mtl_pipeline.render import layout_lines, line_advance, line_ink_bboxes, render_page
from mtl_pipeline.schema import BBox, Region, Stroke, TextBox
from mtl_pipeline.typeset import (
    LINE_HEIGHT,
    PAD,
    STROKE_BUBBLE,
    block_height,
    bubble_siblings,
    fit_text,
    font_for,
    inscribed_rect,
    typeset_region,
    wrap_words,
)

FONT = "PatrickHand-Regular"
TEXT = "Sao giờ này cậu mới tới? Tớ đợi mãi đấy, ếệỗửữẫ!"


def test_inscribed_rect_inside_ellipse():
    mask = np.zeros((200, 300), np.uint8)
    cv2.ellipse(mask, (150, 100), (140, 90), 0, 0, 360, 255, -1)
    r = inscribed_rect(mask)
    assert r is not None
    assert mask[r.y : r.y + r.h, r.x : r.x + r.w].all()
    # Hình chữ nhật nội tiếp ellipse tối đa ~ 2/π diện tích; tham lam phải đạt phần lớn.
    assert r.w * r.h > 0.45 * (np.pi * 140 * 90)


def test_inscribed_rect_empty_mask():
    assert inscribed_rect(np.zeros((10, 10), np.uint8)) is None


def test_fit_text_lines_fit_box():
    w, h = 220.0, 140.0
    size, lines = fit_text(TEXT, FONT, w, h)
    assert size >= 12
    assert all(line_advance(FONT, size, ln) <= w - 2 * PAD + 1e-6 for ln in lines)
    assert block_height(FONT, size, len(lines)) <= h - 2 * PAD
    # Cỡ +1 thì không vừa nữa (binary search tìm cỡ lớn nhất).
    bigger = wrap_words(TEXT, FONT, size + 1, w - 2 * PAD)
    assert bigger is None or block_height(FONT, size + 1, len(bigger)) > h - 2 * PAD or size + 1 > 64
    assert " ".join(lines) == unicodedata.normalize("NFC", TEXT)


def test_fit_text_too_small_box_hard_wraps_at_min_size():
    size, lines = fit_text("Supercalifragilistic", FONT, 30.0, 400.0)
    assert size == 10 and len(lines) > 1


def test_layout_contract_baseline_formula_and_nfc():
    decomposed = unicodedata.normalize("NFD", "Đường đời")
    box = TextBox(
        id="t",
        region_id="r",
        x=10,
        y=20,
        w=300,
        h=200,
        font_family=FONT,
        font_size=30,
        line_height=1.2,
        pad=5,
        lines=[decomposed, "dòng hai"],
        align="left",
    )
    m = metrics_for(FONT)
    asc, desc = m.ascent * 30 / m.units_per_em, m.descent * 30 / m.units_per_em
    lps = layout_lines(box)
    assert lps[0].text == unicodedata.normalize("NFC", decomposed)
    assert abs(lps[0].baseline - (20 + 5 + asc)) < 1e-9
    assert abs(lps[1].baseline - (20 + 5 + asc + (asc + desc) * 1.2)) < 1e-9
    assert lps[0].x == 15


def test_stroke_extends_ink_outward_by_width():
    base = TextBox(
        id="t",
        region_id="r",
        x=10,
        y=10,
        w=300,
        h=80,
        font_family=FONT,
        font_size=32,
        lines=["Xin chào"],
        align="left",
    )
    plain = line_ink_bboxes(base)[0]
    stroked = line_ink_bboxes(base.model_copy(update={"stroke": Stroke(color="#fff", width=3)}))[0]
    assert plain and stroked
    for i, sign in enumerate((-1, -1, 1, 1)):
        assert abs((stroked[i] - plain[i]) - sign * 3) <= 1


def test_typeset_region_uses_bubble_interior_and_renders():
    clean = np.full((300, 400, 3), 120, np.uint8)
    cv2.ellipse(clean, (200, 150), (180, 110), 0, 0, 360, (255, 255, 255), -1)
    cv2.ellipse(clean, (200, 150), (180, 110), 0, 0, 360, (0, 0, 0), 3)
    bubble = Region(id="r0", kind="bubble", bbox=BBox(x=20, y=40, w=360, h=220), score=1.0)
    text = Region(
        id="r1", kind="text_bubble", bbox=BBox(x=140, y=120, w=120, h=60), score=1.0, bubble_id="r0"
    )
    tb = typeset_region(clean, text, bubble, TEXT, FONT)
    assert tb.w * tb.h > 0 and tb.lines and tb.fill == "#000000"
    # Chữ đen trong bóng: viền trắng dày theo cỡ chữ (chất lettering manga).
    assert tb.stroke is not None and tb.stroke.color == "#ffffff"
    assert tb.stroke.width == round(max(1.5, tb.font_size * STROKE_BUBBLE), 1)
    assert tb.w > text.bbox.w  # nới ra lòng bóng
    out = render_page(clean, [tb])
    assert (out != clean).any()
    for bb in line_ink_bboxes(tb):
        assert bb is not None and bb[0] >= 20 and bb[2] <= 380


def _overlap(a: TextBox, b: TextBox) -> bool:
    return a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h


def _typeset_bubble(clean: np.ndarray, regions: list[Region]) -> dict[str, TextBox]:
    by_id = {r.id: r for r in regions}
    return {
        r.id: typeset_region(
            clean, r, by_id[r.bubble_id], "Ừ, tớ hiểu rồi mà.", FONT, bubble_siblings(r, regions)
        )
        for r in regions
        if r.bubble_id
    }


def test_two_text_regions_in_merged_bubble_get_separate_lobes():
    # Hai bóng dính nhau (hình số 8), mỗi thuỳ một vùng chữ: lòng bóng là một vùng liền nên trước đây cả hai vùng
    # chữ nhận cùng hình chữ nhật quanh điểm xa biên nhất → hai box chồng lên nhau.
    clean = np.full((460, 400, 3), 120, np.uint8)
    lobes = (((200, 130), (170, 110)), ((200, 330), (170, 110)))
    for c, (ax, ay) in lobes:
        cv2.ellipse(clean, c, (ax + 3, ay + 3), 0, 0, 360, (0, 0, 0), -1)
    for c, axes in lobes:
        cv2.ellipse(clean, c, axes, 0, 0, 360, (255, 255, 255), -1)
    regions = [
        Region(id="b", kind="bubble", bbox=BBox(x=27, y=17, w=346, h=426), score=1.0),
        Region(id="t1", kind="text_bubble", bbox=BBox(x=120, y=100, w=160, h=60), score=1.0, bubble_id="b"),
        Region(id="t2", kind="text_bubble", bbox=BBox(x=110, y=300, w=180, h=60), score=1.0, bubble_id="b"),
    ]
    boxes = _typeset_bubble(clean, regions)
    top, bottom = boxes["t1"], boxes["t2"]
    assert not _overlap(top, bottom)
    assert top.y + top.h / 2 < 230 < bottom.y + bottom.h / 2
    for tb in (top, bottom):
        assert all(clean[int(tb.y), int(tb.x) : int(tb.x + tb.w)].min(axis=1) == 255)


def test_stacked_text_regions_in_one_bubble_do_not_overlap():
    # Một bóng elip, vùng chữ mảnh ở trên + vùng chữ chính ở giữa.
    clean = np.full((400, 400, 3), 120, np.uint8)
    cv2.ellipse(clean, (200, 200), (180, 150), 0, 0, 360, (255, 255, 255), -1)
    cv2.ellipse(clean, (200, 200), (180, 150), 0, 0, 360, (0, 0, 0), 3)
    regions = [
        Region(id="b", kind="bubble", bbox=BBox(x=20, y=50, w=360, h=300), score=1.0),
        Region(id="t1", kind="text_bubble", bbox=BBox(x=120, y=90, w=160, h=20), score=1.0, bubble_id="b"),
        Region(id="t2", kind="text_bubble", bbox=BBox(x=100, y=170, w=200, h=70), score=1.0, bubble_id="b"),
    ]
    boxes = _typeset_bubble(clean, regions)
    assert not _overlap(boxes["t1"], boxes["t2"])
    assert boxes["t1"].y < boxes["t2"].y


def test_bubble_siblings_are_other_text_regions_of_same_bubble():
    regions = [
        Region(id="b", kind="bubble", bbox=BBox(x=0, y=0, w=10, h=10), score=1.0),
        Region(id="t1", kind="text_bubble", bbox=BBox(x=1, y=1, w=2, h=2), score=1.0, bubble_id="b"),
        Region(id="t2", kind="text_bubble", bbox=BBox(x=5, y=5, w=2, h=2), score=1.0, bubble_id="b"),
        Region(id="t3", kind="text_bubble", bbox=BBox(x=5, y=5, w=2, h=2), score=1.0, bubble_id="other"),
        Region(id="f", kind="text_free", bbox=BBox(x=5, y=5, w=2, h=2), score=1.0),
    ]
    assert [s.id for s in bubble_siblings(regions[1], regions)] == ["t2"]
    assert bubble_siblings(regions[4], regions) == []


def test_text_free_gets_contrast_stroke():
    clean = np.full((200, 300, 3), 80, np.uint8)
    r = Region(id="r0", kind="text_free", bbox=BBox(x=20, y=20, w=260, h=80), score=1.0)
    tb = typeset_region(clean, r, None, "Đêm đó", FONT)
    assert tb.stroke is not None and tb.stroke.width >= 1.5


def test_text_outside_bubble_uses_narration_font():
    b = BBox(x=0, y=0, w=10, h=10)
    free = Region(id="f", kind="text_free", bbox=b, score=1.0)
    bubble = Region(id="t", kind="text_bubble", bbox=b, score=1.0)
    assert font_for(free, "Bangers-Regular", "BeVietnamPro-Regular") == "BeVietnamPro-Regular"
    assert font_for(bubble, "Bangers-Regular", "BeVietnamPro-Regular") == "Bangers-Regular"


def test_light_text_gets_dark_stroke():
    clean = np.full((200, 300, 3), 20, np.uint8)
    r = Region(
        id="r0", kind="text_bubble", bbox=BBox(x=20, y=20, w=260, h=80), score=1.0, polarity="light_on_dark"
    )
    tb = typeset_region(clean, r, None, "Đêm đó", FONT)
    assert tb.fill == "#ffffff" and tb.stroke is not None and tb.stroke.color == "#000000"


def test_default_font_is_manifest_default_and_covers_vietnamese():
    manifest = json.loads(MANIFEST.read_text())
    assert manifest["defaults"][0] == DEFAULT_FONT
    assert manifest["fonts"][DEFAULT_FONT]["viComplete"] and not manifest["fonts"][DEFAULT_FONT]["missing"]


def test_all_fonts_cover_vietnamese():
    from mtl_pipeline.fonts import FONTS_DIR, missing_glyphs

    chars = vietnamese_chars()
    assert len(chars) == 2 + 2 * 12 * 6
    for p in FONTS_DIR.glob("*.ttf"):
        assert missing_glyphs(p, chars) == [], p.name


def test_line_height_default():
    assert LINE_HEIGHT == 1.15
