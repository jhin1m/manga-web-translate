"""Mask chữ tự động theo khung người kéo (OCR vùng tự xoá chữ gốc): phủ nét chữ, không tràn khỏi khung."""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from mtl_pipeline.detect import TILE_H_RATIO
from mtl_pipeline.schema import BBox
from mtl_pipeline.textmask import BBOX_LOOSE_PRED, _grow_span, bbox_text_mask

FONT = ImageFont.load_default(size=36)


class ZeroMasker:
    """CTD không thấy gì. Ghi lại cỡ cửa sổ được đưa vào."""

    def __init__(self) -> None:
        self.shapes: list[tuple[int, ...]] = []

    def predict(self, img: np.ndarray) -> np.ndarray:
        self.shapes.append(img.shape)
        return np.zeros(img.shape[:2], np.uint8)


class InkMasker(ZeroMasker):
    """CTD thấy chữ ở pixel tối (mực) — giả lập model trên ảnh tổng hợp."""

    def predict(self, img: np.ndarray) -> np.ndarray:
        super().predict(img)
        return np.where(img.mean(axis=2) < 60, 255, 0).astype(np.uint8)


def _page() -> tuple[np.ndarray, BBox]:
    """Nền xám có hoạ tiết sọc (hình vẽ) + chữ đen trong khung (200, 300, 240, 80)."""
    im = Image.new("RGB", (800, 1200), (200, 200, 200))
    d = ImageDraw.Draw(im)
    for x in range(-1200, 800, 16):
        d.line((x, 0, x + 1200, 1200), fill=(150, 150, 150), width=2)
    d.rectangle((200, 300, 440, 380), fill=(235, 235, 235))
    d.text((220, 315), "BOOM", font=FONT, fill="black")
    return np.asarray(im).copy(), BBox(x=200, y=300, w=240, h=80)


def test_mask_covers_glyphs_and_stays_inside_bbox():
    img, b = _page()
    masker = InkMasker()
    mask = bbox_text_mask(img, masker, b)
    assert mask.shape == img.shape[:2]
    gray = img.mean(axis=2)
    glyph = gray < 60
    # Mọi pixel nét chữ được phủ.
    assert (mask[glyph] > 0).mean() > 0.95
    # Không tràn khỏi khung quá dilation tối đa (6px).
    ys, xs = np.nonzero(mask)
    assert xs.min() >= b.x - 6 and xs.max() < b.x2 + 6
    assert ys.min() >= b.y - 6 and ys.max() < b.y2 + 6
    # Không phủ cả khung: chỉ nét chữ đã giãn.
    assert (mask[b.y : b.y2, b.x : b.x2] > 0).mean() < 0.6
    # CTD nhận dải cả bề ngang page, cao đúng tỉ lệ tile như prepare (không phải crop sát khung).
    h, w = masker.shapes[0][:2]
    assert (w, h) == (800, round(TILE_H_RATIO * 800))


def test_bbox_without_text_gives_empty_mask():
    img = np.full((600, 600, 3), 230, np.uint8)
    assert not bbox_text_mask(img, ZeroMasker(), BBox(x=100, y=100, w=120, h=60)).any()


def test_model_sees_nothing_over_art_no_polarity_fallback():
    """Khung đè hình vẽ (nét tối trên nền sáng) mà model không thấy chữ → không xoá gì (ảnh sạch không hoàn tác được)."""
    img, b = _page()
    assert not bbox_text_mask(img, ZeroMasker(), b).any()


class BlobMasker(ZeroMasker):
    """CTD thấy một đốm rõ + một đốm mờ (dưới ngưỡng refine) trong khung, và một đốm rõ ngoài khung."""

    def __init__(self, strong_inside: bool = True) -> None:
        super().__init__()
        self.strong_inside = strong_inside

    def predict(self, img: np.ndarray) -> np.ndarray:
        super().predict(img)
        pred = np.zeros(img.shape[:2], np.uint8)
        if self.strong_inside:
            pred[110:130, 260:280] = 250
        pred[120:140, 300:320] = BBOX_LOOSE_PRED + 40
        pred[120:140, 600:620] = 250
        return pred


def test_faint_model_pixels_inside_bbox_are_kept_but_never_outside():
    img = np.full((1000, 800, 3), 230, np.uint8)
    mask = bbox_text_mask(img, BlobMasker(), BBox(x=250, y=100, w=120, h=60))
    assert (mask[120:140, 300:320] > 0).all()
    assert not mask[:, 400:].any()


def test_only_faint_pixels_means_no_text():
    img = np.full((1000, 800, 3), 230, np.uint8)
    assert not bbox_text_mask(img, BlobMasker(strong_inside=False), BBox(x=250, y=100, w=120, h=60)).any()


def test_window_growth_is_clamped_to_page():
    assert _grow_span(800, 900, 2000, 512) == (594, 594 + 512)  # nới đều hai phía
    assert _grow_span(0, 50, 2000, 512) == (0, 512)
    assert _grow_span(1950, 2000, 2000, 512) == (2000 - 512, 2000)
    assert _grow_span(10, 200, 300, 512) == (0, 300)
    assert _grow_span(0, 900, 2000, 512) == (0, 900)
