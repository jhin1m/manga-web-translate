"""Màu chữ gốc: màu nét chữ + màu viền (nếu có) lấy từ ảnh gốc, để typeset dịch giữ tông chữ gốc.

Thuần numpy/cv2. Prepare gọi `glyph_colors` (cần mask nét chữ chưa giãn) rồi `resolve_colors` sau khi có ảnh sạch;
typeset dùng `contrast_ratio`/`contrast_stroke` để kiểm tra màu có đọc được trên nền sạch không."""

from __future__ import annotations

import cv2
import numpy as np

from .schema import Region

RGB = tuple[int, int, int]

# ΔE (CIE76, Lab) tối thiểu để dải quanh nét chữ coi là viền riêng: khác nền sạch VÀ khác màu chữ.
OUTLINE_DELTA_E = 20.0
# ΔE tới đen/trắng nhỏ hơn ngưỡng này → snap về #000000/#ffffff (tránh #0b0a0c, #f8f8fa lấm tấm).
SNAP_DELTA_E = 12.0
# Tương phản WCAG tối thiểu giữa màu chữ (hoặc viền) và nền sạch.
MIN_CONTRAST = 3.0
# Độ sáng (Rec.601 luma, 0–255) trên ngưỡng → viền đen, ngược lại viền trắng. Editor (contrastStroke) dùng cùng ngưỡng.
STROKE_LUMA_THRESHOLD = 128
# Viền ngoài nét chữ dày tối đa ~3px; mask co 1px để bỏ pixel khử răng cưa.
RING_PX = 3
MIN_CORE_PX = 8
MAX_SAMPLE_PX = 65536


def to_hex(rgb: RGB) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def parse_hex(color: str) -> RGB:
    """`#rrggbb` → (r, g, b); sai định dạng → ValueError."""
    if len(color) != 7 or color[0] != "#":
        raise ValueError(f"màu không hợp lệ: {color!r}")
    return int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)


def _lab(rgb: RGB) -> np.ndarray:
    px = np.array([[rgb]], dtype=np.uint8)
    return cv2.cvtColor(px, cv2.COLOR_RGB2LAB)[0, 0].astype(np.float32)


def delta_e(a: RGB, b: RGB) -> float:
    """CIE76 trên Lab 8-bit của OpenCV (L 0–255 ≈ 2.55× L*): quy lại thang L* 0–100 trước khi so."""
    scale = np.array([100.0 / 255.0, 1.0, 1.0], dtype=np.float32)
    return float(np.linalg.norm((_lab(a) - _lab(b)) * scale))


def _channel(v: int) -> float:
    c = v / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb: RGB) -> float:
    r, g, b = (_channel(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: RGB, b: RGB) -> float:
    """Tỉ số tương phản WCAG (1–21)."""
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def snap_bw(rgb: RGB) -> RGB:
    for target in ((0, 0, 0), (255, 255, 255)):
        if delta_e(rgb, target) < SNAP_DELTA_E:
            return target
    return rgb


def contrast_stroke(fill: RGB) -> str:
    """Viền đen cho chữ sáng, trắng cho chữ tối (khớp contrastStroke của editor)."""
    luma = 0.299 * fill[0] + 0.587 * fill[1] + 0.114 * fill[2]
    return "#000000" if luma > STROKE_LUMA_THRESHOLD else "#ffffff"


def median_rgb(patch: np.ndarray) -> RGB:
    """Median từng kênh của patch (H×W×3); lấy mẫu thưa khi patch lớn để rẻ hơn nhiều so với inpaint."""
    h, w = patch.shape[:2]
    step = max(1, int((h * w / MAX_SAMPLE_PX) ** 0.5))
    px = patch[::step, ::step].reshape(-1, 3)
    return tuple(int(v) for v in np.median(px, axis=0))  # type: ignore[return-value]


def glyph_colors(crop_rgb: np.ndarray, local_mask: np.ndarray) -> tuple[RGB, RGB | None] | None:
    """Màu nét chữ (median dưới mask co 1px) và màu dải ngay ngoài nét (ứng viên viền) trong crop của box.

    `local_mask` = mask nét chữ CHƯA giãn, cùng kích thước crop. Mask rỗng → None."""
    ink = local_mask > 127
    if not ink.any():
        return None
    core = cv2.erode(ink.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    sel = core if int(core.sum()) >= MIN_CORE_PX else ink
    text = tuple(int(v) for v in np.median(crop_rgb[sel], axis=0))
    k = 2 * RING_PX + 1
    grown = cv2.dilate(ink.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))).astype(
        bool
    )
    ring = grown & ~ink
    ring_rgb = (
        tuple(int(v) for v in np.median(crop_rgb[ring], axis=0)) if int(ring.sum()) >= MIN_CORE_PX else None
    )
    return text, ring_rgb  # type: ignore[return-value]


def resolve_colors(text: RGB, ring: RGB | None, bg: RGB) -> tuple[str, str | None]:
    """→ (text_hex, outline_hex | None). Dải ngoài nét là viền thật khi khác cả nền sạch lẫn màu chữ."""
    outline = None
    if ring is not None and delta_e(ring, bg) > OUTLINE_DELTA_E and delta_e(ring, text) > OUTLINE_DELTA_E:
        outline = to_hex(snap_bw(ring))
    return to_hex(snap_bw(text)), outline


def assign_colors(regions: list[Region], clean_rgb: np.ndarray) -> None:
    """Gắn text_color/outline_color cho region đã có màu thô từ build_text_mask; nền = median ảnh sạch trong bbox."""
    for r in regions:
        glyph = r._glyph_rgb
        if glyph is None:
            continue
        b = r.bbox
        patch = clean_rgb[b.y : b.y2, b.x : b.x2]
        if patch.size == 0:
            continue
        r.text_color, r.outline_color = resolve_colors(glyph[0], glyph[1], median_rgb(patch))
