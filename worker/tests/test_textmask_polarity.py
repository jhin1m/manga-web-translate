from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from mtl_pipeline.schema import BBox, Region
from mtl_pipeline.textmask import (
    build_text_mask,
    dilation_px,
    estimate_polarity,
    normalize_polarity,
    polarity_fallback_mask,
)

FONT = ImageFont.load_default(size=28)


def _crop(bg, fg, outline=None, art=False) -> np.ndarray:
    im = Image.new("RGB", (220, 80), bg)
    d = ImageDraw.Draw(im)
    if art:
        for x in range(0, 220, 12):
            d.line((x, 0, x + 40, 80), fill=(90, 140, 90), width=3)
    if outline:
        d.rectangle((0, 0, 219, 79), outline=outline, width=3)
    d.text((30, 22), "HELLO", font=FONT, fill=fg, stroke_width=0)
    return np.asarray(im)


TIERS = {
    "white": (_crop("white", "black", outline="black"), "dark_on_light"),
    "color": (_crop((250, 220, 160), (40, 20, 10)), "dark_on_light"),
    "inverted": (_crop((15, 15, 25), "white"), "light_on_dark"),
}


def test_fallback_mask_polarity_per_tier():
    for name, (crop, want) in TIERS.items():
        gray = np.asarray(Image.fromarray(crop).convert("L"))
        mask, pol = polarity_fallback_mask(gray)
        assert pol == want, name
        assert mask.any(), name
        # Viền bóng (chạm mép crop) không được vào mask chữ.
        assert not mask[0].any() and not mask[-1].any() and not mask[:, 0].any(), name


def test_estimate_polarity_uses_ink_not_dilated_background():
    gray = np.full((60, 200), 20, np.uint8)
    gray[25:35, 40:160:4] = 250  # nét chữ trắng mảnh
    mask = np.zeros_like(gray)
    mask[15:45, 30:170] = 255  # mask đã giãn, phần lớn là nền tối
    assert estimate_polarity(gray, mask) == "light_on_dark"
    assert estimate_polarity(255 - gray, mask) == "dark_on_light"


def test_normalize_polarity_inverts_only_light_on_dark():
    crop = TIERS["inverted"][0]
    assert normalize_polarity(crop, "light_on_dark").mean() > 128
    assert np.array_equal(normalize_polarity(crop, "dark_on_light"), crop)


def test_build_mask_fallback_keeps_bubble_outline_and_dilates_within_limits():
    page = np.full((300, 400, 3), 200, np.uint8)
    page[50:130, 100:320] = TIERS["white"][0]
    r = Region(id="r0", kind="text_bubble", bbox=BBox(x=100, y=50, w=220, h=80), score=1.0)
    bubble = Region(id="r1", kind="bubble", bbox=BBox(x=90, y=40, w=240, h=100), score=1.0)
    mask = build_text_mask(page, np.zeros((300, 400), np.uint8), [r, bubble])
    assert r.mask_source == "polarity_fallback" and r.polarity == "dark_on_light"
    d = dilation_px(r.bbox)
    assert 2 <= d <= 6
    ys, xs = np.nonzero(mask)
    assert ys.min() >= 50 - d and ys.max() < 130 + d
    # Viền bóng ở hàng y=50..52 (mép crop) không bị xoá.
    assert not mask[50, 200:220].any()


def test_build_mask_over_art_tier_has_text_mask():
    page = np.full((200, 300, 3), 120, np.uint8)
    page[40:120, 40:260] = _crop((170, 200, 170), "black", art=True)
    r = Region(id="r0", kind="text_free", bbox=BBox(x=40, y=40, w=220, h=80), score=1.0)
    mask = build_text_mask(page, np.zeros((200, 300), np.uint8), [r])
    assert mask.any()
    assert r.polarity == "dark_on_light"


def test_sfx_regions_are_not_masked():
    page = np.full((200, 300, 3), 255, np.uint8)
    page[40:120, 40:260] = TIERS["white"][0]
    r = Region(id="r0", kind="text_free", bbox=BBox(x=40, y=40, w=220, h=80), score=1.0, is_sfx=True)
    assert not build_text_mask(page, np.zeros((200, 300), np.uint8), [r]).any()


def test_fallback_handles_box_tight_around_text():
    # Box detector ôm sát chữ: nét chữ chạm mép box nhưng vẫn phải vào mask (cửa sổ được nới).
    page = np.full((200, 300, 3), 255, np.uint8)
    page[60:100, 40:260] = 255
    from PIL import Image as _I

    im = _I.fromarray(page)
    ImageDraw.Draw(im).text((50, 60), "HELLO", font=FONT, fill="black")
    page = np.asarray(im)
    ys, xs = np.nonzero(page.min(axis=2) < 128)
    tight = BBox(
        x=int(xs.min()), y=int(ys.min()), w=int(xs.max() - xs.min() + 1), h=int(ys.max() - ys.min() + 1)
    )
    r = Region(id="r0", kind="text_bubble", bbox=tight, score=1.0)
    mask = build_text_mask(page, np.zeros((200, 300), np.uint8), [r])
    assert r.mask_source == "polarity_fallback"
    ink = page.min(axis=2) < 128
    assert (mask[ink] > 0).mean() > 0.95


def test_fallback_drops_bubble_outline_inside_window():
    gray = np.full((80, 220), 255, np.uint8)
    gray[2:4, :] = 0  # nét viền bóng chạy ngang gần hết cửa sổ
    gray[30:50, 60:70] = 0  # một "chữ"
    mask, _ = polarity_fallback_mask(gray)
    assert not mask[2:4].any() and mask[30:50, 60:70].all()
