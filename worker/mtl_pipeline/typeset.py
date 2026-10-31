"""Auto-typeset: hình chữ nhật nội tiếp lòng bóng (distance transform) → binary search cỡ chữ → wrap greedy theo từ."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import cv2
import numpy as np

from .fonts import metrics_for
from .render import line_advance, nfc
from .schema import BBox, Region, Stroke, TextBox
from .textcolor import MIN_CONTRAST, RGB, contrast_ratio, contrast_stroke, median_rgb, parse_hex, to_hex

MIN_SIZE = 10
MAX_SIZE = 64
LINE_HEIGHT = 1.15
PAD = 4.0
INTERIOR_TOL = 18
# Khe (px, theo hiệu khoảng cách) giữa phần lòng bóng của các vùng chữ chung bóng.
SPLIT_GAP = 8
# Bề rộng viền / cỡ chữ.
STROKE_BUBBLE = 0.1
STROKE_FREE = 0.12


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    w: int
    h: int


def inscribed_rect(mask: np.ndarray) -> Rect | None:
    """Hình chữ nhật trục song song có diện tích lớn nhất nằm trọn trong mask (uint8, >0 = dùng được).

    Quét từng hàng, giữ chiều cao cột liên tục → bài "hình chữ nhật lớn nhất dưới histogram" bằng ngăn xếp.
    (Mọc tham lam đều 4 phía quanh điểm xa biên nhất cho hình gần vuông trong bóng elip dẹt, và lệch hẳn sang một bên
    khi lòng bóng có lỗ.)"""
    m = mask > 0
    if not m.any():
        return None
    rows, cols = m.shape
    heights = np.zeros(cols, np.int64)
    best = (0, 0, 0, 0, 0)  # area, x, y, w, h
    for y in range(rows):
        heights = np.where(m[y], heights + 1, 0)
        hs = heights.tolist()
        hs.append(0)
        stack: list[int] = []
        for x, hx in enumerate(hs):
            while stack and hs[stack[-1]] >= hx:
                top = stack.pop()
                left = stack[-1] + 1 if stack else 0
                area = hs[top] * (x - left)
                if area > best[0]:
                    best = (area, left, y - hs[top] + 1, x - left, hs[top])
            stack.append(x)
    _, x, y, w, h = best
    return Rect(x, y, w, h)


def _fill_holes(mask: np.ndarray) -> np.ndarray:
    """Lấp các lỗ của mask (vùng 0 không nối ra mép khung)."""
    h, w = mask.shape
    outside = np.zeros((h + 2, w + 2), np.uint8)
    outside[1:-1, 1:-1] = mask > 0
    cv2.floodFill(outside, np.zeros((h + 4, w + 4), np.uint8), (0, 0), 1)
    return ((outside[1:-1, 1:-1] == 0) | (mask > 0)).astype(np.uint8)


def bubble_interior(clean_rgb: np.ndarray, bubble: BBox, text: BBox) -> np.ndarray:
    """Mask lòng bóng chứa vùng chữ `text`, trên ảnh đã xoá chữ, trong khung bóng.

    Inpaint hay để lại vệt chữ mờ: màu nền lấy median vùng chữ (không lấy 1 pixel seed — rơi trúng vệt mờ thì lòng
    bóng chỉ còn vài px), chọn mảng cùng màu phủ vùng chữ nhiều nhất, rồi lấp lỗ do vệt mờ đục."""
    crop = clean_rgb[bubble.y : bubble.y2, bubble.x : bubble.x2]
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    tx0, ty0 = max(0, text.x - bubble.x), max(0, text.y - bubble.y)
    tx1, ty1 = min(gray.shape[1], text.x2 - bubble.x), min(gray.shape[0], text.y2 - bubble.y)
    if tx1 <= tx0 or ty1 <= ty0:
        return np.zeros(gray.shape, np.uint8)
    bg = int(np.median(gray[ty0:ty1, tx0:tx1]))
    same = (np.abs(gray.astype(np.int16) - bg) <= INTERIOR_TOL).astype(np.uint8)
    _, labels = cv2.connectedComponents(same, connectivity=4)
    under_text = labels[ty0:ty1, tx0:tx1]
    ids, counts = np.unique(under_text[under_text > 0], return_counts=True)
    if not len(ids):
        return np.zeros(gray.shape, np.uint8)
    interior = _fill_holes(labels == ids[int(np.argmax(counts))]) * 255
    # Lùi khỏi viền bóng vài px cho chữ không chạm nét viền.
    return cv2.erode(interior.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=3)


def _bbox_distance(shape: tuple[int, int], origin: BBox, b: BBox) -> np.ndarray:
    """Khoảng cách từ mỗi pixel của khung `origin` tới hộp `b` (0 bên trong hộp)."""
    xs = np.arange(origin.x, origin.x + shape[1])[None, :]
    ys = np.arange(origin.y, origin.y + shape[0])[:, None]
    dx = np.maximum(np.maximum(b.x - xs, xs - b.x2), 0)
    dy = np.maximum(np.maximum(b.y - ys, ys - b.y2), 0)
    return np.hypot(dx, dy)


def own_share(interior: np.ndarray, bubble: BBox, own: BBox, others: Sequence[BBox]) -> np.ndarray:
    """Phần lòng bóng gần vùng chữ `own` hơn mọi vùng chữ khác cùng bóng (chia Voronoi theo khoảng cách tới bbox).

    Lòng bóng là một vùng liền (bóng dính nhau, nhiều cụm chữ trong một bóng): không chia thì mọi vùng chữ nhận cùng
    hình chữ nhật quanh điểm xa biên nhất → box chồng nhau. Pixel cách đều hai vùng (±SPLIT_GAP/2) bỏ trống làm khe.
    """
    d_own = _bbox_distance(interior.shape, bubble, own)
    keep = interior > 0
    for o in others:
        keep &= d_own + SPLIT_GAP < _bbox_distance(interior.shape, bubble, o)
    return keep.astype(np.uint8)


def bubble_siblings(region: Region, regions: Sequence[Region]) -> list[Region]:
    """Các vùng chữ khác nằm chung bóng với `region`."""
    if not region.bubble_id:
        return []
    return [r for r in regions if r.bubble_id == region.bubble_id and r.id != region.id]


def available_rect(
    clean_rgb: np.ndarray, region: Region, bubble: Region | None, siblings: Sequence[Region] = ()
) -> Rect:
    b = region.bbox
    if bubble is not None:
        interior = bubble_interior(clean_rgb, bubble.bbox, b)
        if siblings:
            interior = own_share(interior, bubble.bbox, region.bbox, [s.bbox for s in siblings])
        r = inscribed_rect(interior)
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


def font_for(region: Region, dialogue: str, narration: str) -> str:
    """Chữ ngoài bóng (text_free) dùng font dẫn truyện; còn lại font thoại."""
    return narration if region.kind == "text_free" else dialogue


def style_for(region: Region, size: float, bg_rgb: RGB | None = None) -> tuple[str, Stroke]:
    """Chữ luôn có viền màu tương phản (chất lettering manga). Chữ ngoài bóng đè art cần viền dày hơn để đọc được.

    Có màu chữ gốc (text_color) và đọc được trên nền sạch (chữ hoặc viền gốc tương phản ≥ MIN_CONTRAST) → giữ màu gốc;
    ngược lại rơi về quy tắc cực tính."""
    light = region.polarity == "light_on_dark"
    ratio = STROKE_FREE if region.kind == "text_free" else STROKE_BUBBLE
    width = round(max(1.5, size * ratio), 1)
    original = _original_colors(region, bg_rgb)
    if original is not None:
        fill, outline = original
        stroke = (
            outline
            if outline and contrast_ratio(parse_hex(outline), parse_hex(fill)) >= MIN_CONTRAST
            else None
        )
        return fill, Stroke(color=stroke or contrast_stroke(parse_hex(fill)), width=width)
    return ("#ffffff" if light else "#000000"), Stroke(color="#000000" if light else "#ffffff", width=width)


def _original_colors(region: Region, bg_rgb: RGB | None) -> tuple[str, str | None] | None:
    """(fill, outline) của chữ gốc nếu dùng được trên nền `bg_rgb`; không thì None."""
    if region.text_color is None or bg_rgb is None:
        return None
    try:
        fill = parse_hex(region.text_color)
        outline = parse_hex(region.outline_color) if region.outline_color else None
    except ValueError:
        return None
    readable = contrast_ratio(fill, bg_rgb) >= MIN_CONTRAST or (
        outline is not None and contrast_ratio(outline, bg_rgb) >= MIN_CONTRAST
    )
    return (to_hex(fill), to_hex(outline) if outline else None) if readable else None


def typeset_region(
    clean_rgb: np.ndarray,
    region: Region,
    bubble: Region | None,
    text: str,
    font_id: str,
    siblings: Sequence[Region] = (),
) -> TextBox:
    rect = available_rect(clean_rgb, region, bubble, siblings)
    size, lines = fit_text(text, font_id, rect.w, rect.h)
    text_h = block_height(font_id, size, len(lines)) + 2 * PAD
    # Căn giữa theo chiều dọc: box ôm khối chữ, đặt giữa vùng khả dụng.
    y = rect.y + max(0.0, (rect.h - text_h) / 2)
    bg = None
    if region.text_color is not None:
        bg = median_rgb(clean_rgb[rect.y : rect.y + rect.h, rect.x : rect.x + rect.w])
    fill, stroke = style_for(region, size, bg)
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
        valign="middle",
        fill=fill,
        stroke=stroke,
        text=nfc(text),
        lines=lines,
    )
