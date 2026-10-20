from __future__ import annotations

import unicodedata

import cv2
import numpy as np

from mtl_pipeline.fonts import metrics_for, vietnamese_chars
from mtl_pipeline.render import layout_lines, line_advance, line_ink_bboxes, render_page
from mtl_pipeline.schema import BBox, Region, Stroke, TextBox
from mtl_pipeline.typeset import (
    LINE_HEIGHT,
    PAD,
    block_height,
    fit_text,
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
    assert tb.w * tb.h > 0 and tb.lines and tb.stroke is None and tb.fill == "#000000"
    assert tb.w > text.bbox.w  # nới ra lòng bóng
    out = render_page(clean, [tb])
    assert (out != clean).any()
    for bb in line_ink_bboxes(tb):
        assert bb is not None and bb[0] >= 20 and bb[2] <= 380


def test_text_free_gets_contrast_stroke():
    clean = np.full((200, 300, 3), 80, np.uint8)
    r = Region(id="r0", kind="text_free", bbox=BBox(x=20, y=20, w=260, h=80), score=1.0)
    tb = typeset_region(clean, r, None, "Đêm đó", FONT)
    assert tb.stroke is not None and tb.stroke.width >= 1.5


def test_all_fonts_cover_vietnamese():
    from mtl_pipeline.fonts import FONTS_DIR, missing_glyphs

    chars = vietnamese_chars()
    assert len(chars) == 2 + 2 * 12 * 6
    for p in FONTS_DIR.glob("*.ttf"):
        assert missing_glyphs(p, chars) == [], p.name


def test_line_height_default():
    assert LINE_HEIGHT == 1.15
