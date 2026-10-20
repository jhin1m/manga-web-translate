"""Auto-typeset: hình chữ nhật nội tiếp lòng bóng (distance transform) → binary search cỡ chữ → wrap greedy theo từ."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .fonts import metrics_for
from .render import line_advance, nfc
from .schema import BBox, Region, Stroke, TextBox

MIN_SIZE = 10
MAX_SIZE = 64
LINE_HEIGHT = 1.15
PAD = 4.0
INTERIOR_TOL = 18


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    w: int
    h: int


def inscribed_rect(mask: np.ndarray) -> Rect | None:
    """Hình chữ nhật trục song song lớn (tham lam) quanh điểm xa biên nhất của mask (uint8, >0 = dùng được)."""
    m = (mask > 0).astype(np.uint8)
    if not m.any():
        return None
    dist = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    cy, cx = np.unravel_index(int(np.argmax(dist)), dist.shape)
    integral = cv2.integral(m)

    def full(x0: int, y0: int, x1: int, y1: int) -> bool:
        if x0 < 0 or y0 < 0 or x1 > m.shape[1] or y1 > m.shape[0]:
            return False
        s = integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0]
        return int(s) == (x1 - x0) * (y1 - y0)

    x0, y0, x1, y1 = int(cx), int(cy), int(cx) + 1, int(cy) + 1
    grew = True
    while grew:
        grew = False
        # Nới cạnh ngang trước (chữ ngang cần bề rộng), rồi cạnh dọc.
        for dx0, dy0, dx1, dy1 in ((-1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)):
            if full(x0 + dx0, y0 + dy0, x1 + dx1, y1 + dy1):
                x0, y0, x1, y1 = x0 + dx0, y0 + dy0, x1 + dx1, y1 + dy1
                grew = True
    return Rect(x0, y0, x1 - x0, y1 - y0)


def bubble_interior(clean_rgb: np.ndarray, bubble: BBox, seed: tuple[int, int]) -> np.ndarray:
    """Mask lòng bóng: vùng cùng màu nối với seed trên ảnh đã xoá chữ, trong khung bóng."""
    crop = clean_rgb[bubble.y : bubble.y2, bubble.x : bubble.x2]
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    sx = int(np.clip(seed[0] - bubble.x, 0, gray.shape[1] - 1))
    sy = int(np.clip(seed[1] - bubble.y, 0, gray.shape[0] - 1))
    ff = np.zeros((gray.shape[0] + 2, gray.shape[1] + 2), np.uint8)
    flags = 4 | cv2.FLOODFILL_MASK_ONLY | cv2.FLOODFILL_FIXED_RANGE | (255 << 8)
    cv2.floodFill(gray, ff, (sx, sy), 0, INTERIOR_TOL, INTERIOR_TOL, flags)
    interior = ff[1:-1, 1:-1]
    # Lùi khỏi viền bóng vài px cho chữ không chạm nét viền.
    return cv2.erode(interior, np.ones((3, 3), np.uint8), iterations=3)


def available_rect(clean_rgb: np.ndarray, region: Region, bubble: Region | None) -> Rect:
    b = region.bbox
    if bubble is not None:
        seed = (b.x + b.w // 2, b.y + b.h // 2)
        r = inscribed_rect(bubble_interior(clean_rgb, bubble.bbox, seed))
        # Lòng bóng nhỏ hơn vùng chữ gốc (bóng không kín, art) → dùng box chữ gốc.
        if r is not None and r.w * r.h >= b.area():
            return Rect(bubble.bbox.x + r.x, bubble.bbox.y + r.y, r.w, r.h)
    return Rect(b.x, b.y, b.w, b.h)


def wrap_words(text: str, font_id: str, size: float, max_w: float) -> list[str] | None:
    """Wrap greedy theo từ; từ đơn dài hơn max_w → None (cỡ này không vừa)."""
    lines: list[str] = []
    cur = ""
    for word in nfc(text).split():
        if line_advance(font_id, size, word) > max_w:
            return None
        cand = f"{cur} {word}" if cur else word
        if line_advance(font_id, size, cand) <= max_w:
            cur = cand
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def block_height(font_id: str, size: float, n_lines: int, line_height: float = LINE_HEIGHT) -> float:
    m = metrics_for(font_id)
    asc, desc = m.ascent_px(size), m.descent_px(size)
    return asc + desc + max(0, n_lines - 1) * (asc + desc) * line_height


def fit_text(
    text: str, font_id: str, w: float, h: float, pad: float = PAD, line_height: float = LINE_HEIGHT
) -> tuple[float, list[str]]:
    """Binary search cỡ chữ nguyên lớn nhất vừa (w, h). Không vừa cả MIN_SIZE → MIN_SIZE, cắt cứng theo ký tự."""
    inner_w, inner_h = w - 2 * pad, h - 2 * pad
    lo, hi, best = MIN_SIZE, MAX_SIZE, None
    while lo <= hi:
        mid = (lo + hi) // 2
        lines = wrap_words(text, font_id, mid, inner_w)
        if lines is not None and block_height(font_id, mid, len(lines), line_height) <= inner_h:
            best = (float(mid), lines)
            lo = mid + 1
        else:
            hi = mid - 1
    if best:
        return best
    return float(MIN_SIZE), hard_wrap(text, font_id, MIN_SIZE, inner_w)


def hard_wrap(text: str, font_id: str, size: float, max_w: float) -> list[str]:
    lines, cur = [], ""
    for ch in nfc(text):
        if cur and line_advance(font_id, size, cur + ch) > max_w:
            lines.append(cur.rstrip())
            cur = ch.lstrip()
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def style_for(region: Region, size: float) -> tuple[str, Stroke | None]:
    if region.kind == "text_free":
        # Chữ ngoài bóng đè art: viền tương phản để đọc được trên mọi nền.
        light = region.polarity == "light_on_dark"
        return ("#ffffff" if light else "#000000"), Stroke(
            color="#000000" if light else "#ffffff", width=round(max(1.5, size * 0.12), 1)
        )
    return ("#ffffff" if region.polarity == "light_on_dark" else "#000000"), None


def typeset_region(
    clean_rgb: np.ndarray, region: Region, bubble: Region | None, text: str, font_id: str
) -> TextBox:
    rect = available_rect(clean_rgb, region, bubble)
    size, lines = fit_text(text, font_id, rect.w, rect.h)
    text_h = block_height(font_id, size, len(lines)) + 2 * PAD
    # Căn giữa theo chiều dọc: box ôm khối chữ, đặt giữa vùng khả dụng.
    y = rect.y + max(0.0, (rect.h - text_h) / 2)
    fill, stroke = style_for(region, size)
    return TextBox(
        id=f"tb-{region.id}",
        region_id=region.id,
        x=float(rect.x),
        y=round(y, 2),
        w=float(rect.w),
        h=round(text_h, 2),
        font_family=font_id,
        font_size=size,
        line_height=LINE_HEIGHT,
        pad=PAD,
        fill=fill,
        stroke=stroke,
        text=nfc(text),
        lines=lines,
    )
