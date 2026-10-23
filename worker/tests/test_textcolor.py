from __future__ import annotations

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

from mtl_pipeline.schema import BBox, Region
from mtl_pipeline.textcolor import (
    assign_colors,
    contrast_ratio,
    contrast_stroke,
    glyph_colors,
    parse_hex,
    resolve_colors,
    snap_bw,
)
from mtl_pipeline.textmask import polarity_fallback_mask
from mtl_pipeline.typeset import style_for, typeset_region

FONT = ImageFont.load_default(size=40)
SIZE = (260, 100)
WHITE = (255, 255, 255)


def _draw(bg, fill, outline=None) -> np.ndarray:
    im = Image.new("RGB", SIZE, bg)
    ImageDraw.Draw(im).text(
        (20, 25), "HELLO", font=FONT, fill=fill, stroke_width=3 if outline else 0, stroke_fill=outline
    )
    return np.asarray(im)


def _glyph_mask(img: np.ndarray, plain: np.ndarray) -> np.ndarray:
    """Mask nét chữ chưa giãn: pixel của ảnh khác ảnh không chữ + viền (tức chỉ phần fill khi có viền thì dùng `plain`)."""
    return ((np.abs(img.astype(int) - plain.astype(int)).sum(axis=2) > 30) * 255).astype(np.uint8)


def _colors(bg, fill, outline=None):
    """Đo màu như prepare: mask nét chữ = chỗ ảnh có chữ-không-viền khác nền; bg sạch = màu nền phẳng."""
    img = _draw(bg, fill, outline)
    fill_only = _draw(bg, fill)
    mask = _glyph_mask(fill_only, np.asarray(Image.new("RGB", SIZE, bg)))
    glyph = glyph_colors(img, mask)
    assert glyph is not None
    return glyph, bg


def _region(**kw) -> Region:
    return Region(id="r1", kind="text_bubble", bbox=BBox(x=0, y=0, w=SIZE[0], h=SIZE[1]), score=1.0, **kw)


def test_red_text_on_white_bubble_keeps_red_with_white_stroke():
    (text, ring), bg = _colors(WHITE, (220, 20, 20))
    text_hex, outline = resolve_colors(text, ring, bg)
    assert outline is None
    r, g, b = parse_hex(text_hex)
    assert r > 200 and g < 60 and b < 60
    fill, stroke = style_for(_region(text_color=text_hex, outline_color=outline), 24, bg)
    assert fill == text_hex
    assert stroke.color == "#ffffff"


def test_white_text_black_outline_on_saturated_art():
    art = (230, 120, 20)
    (text, ring), bg = _colors(art, WHITE, outline=(0, 0, 0))
    text_hex, outline = resolve_colors(text, ring, bg)
    assert text_hex == "#ffffff"
    assert outline == "#000000"
    fill, stroke = style_for(_region(text_color=text_hex, outline_color=outline), 24, bg)
    assert (fill, stroke.color) == ("#ffffff", "#000000")


def test_pale_yellow_on_white_without_outline_falls_back_to_black():
    (text, ring), bg = _colors(WHITE, (250, 240, 150))
    text_hex, outline = resolve_colors(text, ring, bg)
    assert outline is None
    assert contrast_ratio(parse_hex(text_hex), bg) < 3
    fill, stroke = style_for(_region(text_color=text_hex, outline_color=outline), 24, bg)
    assert (fill, stroke.color) == ("#000000", "#ffffff")


def test_pale_text_with_readable_outline_keeps_text_color():
    fill, stroke = style_for(_region(text_color="#fff0a0", outline_color="#5a3010"), 24, (40, 160, 70))
    assert fill == "#fff0a0"
    assert stroke.color == "#5a3010"


def test_near_black_snaps_to_pure_black():
    (text, ring), bg = _colors(WHITE, (11, 10, 12))
    assert resolve_colors(text, ring, bg)[0] == "#000000"
    assert snap_bw((247, 248, 250)) == (255, 255, 255)
    assert snap_bw((200, 30, 30)) == (200, 30, 30)


def test_outline_same_as_background_is_not_an_outline():
    # Chữ đen trên bóng trắng: dải quanh nét chính là nền.
    (text, ring), bg = _colors(WHITE, (0, 0, 0))
    assert resolve_colors(text, ring, bg)[1] is None


def test_region_without_colors_matches_polarity_rule():
    for polarity, want in (
        ("dark_on_light", ("#000000", "#ffffff")),
        ("light_on_dark", ("#ffffff", "#000000")),
    ):
        r = _region(polarity=polarity)
        for bg in (None, (30, 30, 30), WHITE):
            fill, stroke = style_for(r, 20, bg)
            assert (fill, stroke.color) == want
        # Có màu nhưng chưa biết nền → cũng giữ quy tắc cũ.
        assert style_for(_region(polarity=polarity, text_color="#ff0000"), 20)[0] == want[0]


def test_malformed_stored_color_falls_back():
    fill, _ = style_for(_region(text_color="red", outline_color=None), 20, WHITE)
    assert fill == "#000000"


def test_contrast_stroke_threshold():
    assert contrast_stroke((255, 255, 255)) == "#000000"
    assert contrast_stroke((0, 0, 0)) == "#ffffff"
    assert contrast_stroke((255, 0, 0)) == "#ffffff"
    assert contrast_stroke((255, 255, 0)) == "#000000"


def test_glyph_colors_empty_mask_returns_none():
    assert glyph_colors(np.zeros((10, 10, 3), np.uint8), np.zeros((10, 10), np.uint8)) is None


def test_assign_colors_from_polarity_fallback_mask_and_typeset():
    img = _draw(WHITE, (200, 20, 20))
    gray = np.asarray(Image.fromarray(img).convert("L"))
    mask, _ = polarity_fallback_mask(gray)
    r = _region()
    r._glyph_rgb = glyph_colors(img, mask)
    assign_colors([r], np.full_like(img, 255))
    assert r.text_color is not None and parse_hex(r.text_color)[0] > 150
    assert r.outline_color is None
    box = typeset_region(np.full_like(img, 255), r, None, "Xin chào", "Bangers-Regular")
    assert box.fill == r.text_color


def test_color_fields_not_serialized_as_glyph_and_default_none():
    r = _region()
    assert r.text_color is None and r.outline_color is None
    assert "glyph" not in "".join(r.model_dump())


@pytest.mark.parametrize("bad", ["#12", "123456", "#gggggg"])
def test_parse_hex_rejects_malformed(bad):
    with pytest.raises(ValueError):
        parse_hex(bad)
