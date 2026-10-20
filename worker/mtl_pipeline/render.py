"""Vẽ TextBox.lines[] theo hợp đồng layout (docs/typeset-layout-contract.md). Dùng chung cho auto-typeset và export.

Hợp đồng (phải khớp editor Konva):
- text chuẩn hoá NFC trước khi đo/vẽ;
- baseline dòng i = box.y + pad + ascent + i·(ascent+descent)·line_height, ascent/descent từ hhea/OS/2 của file font;
- x dòng = box.x + pad (+ căn giữa/phải theo advance của dòng trong vùng w − 2·pad);
- stroke.width = bề rộng RA NGOÀI glyph, join tròn (Minkowski với đĩa bán kính w), vẽ trước, fill đè lên.
  Không dùng stroke_width của Pillow: offset bị làm tròn, viền trên dày hơn canvas 1–2px (spike parity);
  dựng bằng dilate trên mask siêu lấy mẫu STROKE_SS× — khớp canvas lineWidth=2w + lineJoin=round;
- glyph cũng vẽ ở STROKE_SS× rồi thu nhỏ (triệt tiêu lệch do hinting FreeType ở 1×);
- Pillow bắt buộc raqm; không có → từ chối chạy.
"""

from __future__ import annotations

import math
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, features

from .fonts import font_path, metrics_for
from .schema import TextBox

# Hệ số siêu lấy mẫu khi dựng mask dòng (glyph + viền).
STROKE_SS = 4


class RaqmMissing(RuntimeError):
    pass


def require_raqm() -> None:
    if not features.check("raqm"):
        raise RaqmMissing(
            "Pillow thiếu libraqm (brew install libraqm / manylinux wheel có raqm); không fallback"
        )


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


@lru_cache(maxsize=256)
def load_font(font_id: str, size: float) -> ImageFont.FreeTypeFont:
    require_raqm()
    return ImageFont.truetype(str(font_path(font_id)), size, layout_engine=ImageFont.Layout.RAQM)


@dataclass(frozen=True)
class LinePlacement:
    text: str
    x: float  # mép trái pen (origin) của dòng
    baseline: float
    advance: float


def line_advance(font_id: str, size: float, text: str) -> float:
    return float(load_font(font_id, size).getlength(nfc(text)))


def layout_lines(box: TextBox) -> list[LinePlacement]:
    """Toạ độ pen + baseline từng dòng trong hệ toạ độ chưa xoay (gốc = page)."""
    m = metrics_for(box.font_family)
    asc, desc = m.ascent_px(box.font_size), m.descent_px(box.font_size)
    step = (asc + desc) * box.line_height
    inner_w = box.w - 2 * box.pad
    out = []
    for i, raw in enumerate(box.lines):
        text = nfc(raw)
        adv = line_advance(box.font_family, box.font_size, text)
        x = box.x + box.pad
        if box.align == "center":
            x += (inner_w - adv) / 2
        elif box.align == "right":
            x += inner_w - adv
        out.append(LinePlacement(text=text, x=x, baseline=box.y + box.pad + asc + i * step, advance=adv))
    return out


def _line_alpha(
    box: TextBox, lp: LinePlacement, w: float, ox: float, oy: float
) -> tuple[Image.Image, int, int]:
    """Alpha của dòng (w = 0: chỉ glyph; w > 0: glyph giãn ra ngoài w, join tròn) → (mask L, x0, y0).

    Vẽ ở STROKE_SS× rồi thu nhỏ: hinting FreeType ở 1× xê dịch dấu chồng 1–2px so với canvas (không hinting);
    ở 4× sai lệch đó còn ≤ 1/4 px."""
    left, top, right, bottom = load_font(box.font_family, box.font_size).getbbox(lp.text, anchor="ls")
    x0 = math.floor(lp.x - ox + left - w) - 2
    y0 = math.floor(lp.baseline - oy + top - w) - 2
    x1 = math.ceil(lp.x - ox + right + w) + 2
    y1 = math.ceil(lp.baseline - oy + bottom + w) + 2
    s = STROKE_SS
    big = Image.new("L", ((x1 - x0) * s, (y1 - y0) * s), 0)
    ImageDraw.Draw(big).text(
        ((lp.x - ox - x0) * s, (lp.baseline - oy - y0) * s),
        lp.text,
        font=load_font(box.font_family, box.font_size * s),
        fill=255,
        anchor="ls",
    )
    if w > 0:
        rad = max(1, round(w * s))
        kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * rad + 1, 2 * rad + 1))
        big = Image.fromarray(cv2.dilate(np.asarray(big), kern))
    return big.reduce(s), x0, y0


def _draw_line(page: Image.Image, box: TextBox, lp: LinePlacement, ox: float = 0, oy: float = 0) -> None:
    """Vẽ 1 dòng lên page; (ox, oy) = toạ độ góc trái-trên của page trong hệ toạ độ box (vẽ lên lớp con)."""
    layers = [(box.stroke.width, box.stroke.color)] if box.stroke and box.stroke.width > 0 else []
    layers.append((0.0, box.fill))  # fill vẽ sau, đè lên viền
    for w, color in layers:
        alpha, x0, y0 = _line_alpha(box, lp, w, ox, oy)
        page.paste(Image.new(page.mode, alpha.size, color), (x0, y0), alpha)


def render_box(page: Image.Image, box: TextBox) -> None:
    """Vẽ box lên page (RGB/RGBA) tại chỗ. rotation (độ, chiều kim đồng hồ) quay quanh tâm box."""
    lines = layout_lines(box)
    if not box.rotation:
        for lp in lines:
            _draw_line(page, box, lp)
        return
    # Vẽ lên lớp trong suốt cỡ box (+ lề cho stroke/dấu tràn), quay rồi dán tâm trùng tâm box.
    margin = int(box.font_size + (box.stroke.width if box.stroke else 0)) + 2
    lw, lh = int(np.ceil(box.w)) + 2 * margin, int(np.ceil(box.h)) + 2 * margin
    layer = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    for lp in lines:
        _draw_line(layer, box, lp, ox=box.x - margin, oy=box.y - margin)
    rotated = layer.rotate(-box.rotation, resample=Image.Resampling.BICUBIC, expand=True)
    cx, cy = box.x + box.w / 2, box.y + box.h / 2
    pos = (round(cx - rotated.width / 2), round(cy - rotated.height / 2))
    if page.mode == "RGBA":
        page.alpha_composite(rotated, pos)
    else:
        page.paste(rotated, pos, rotated)


def render_page(base: np.ndarray, boxes: list[TextBox]) -> np.ndarray:
    page = Image.fromarray(base).convert("RGB")
    for b in boxes:
        render_box(page, b)
    return np.asarray(page)


def line_ink_bboxes(box: TextBox, alpha_thresh: int = 128) -> list[tuple[int, int, int, int] | None]:
    """bbox mực (x0, y0, x1, y1, toạ độ page) của từng dòng vẽ riêng — số đo cho gate parity với Konva."""
    out: list[tuple[int, int, int, int] | None] = []
    margin = int(box.font_size * 2 + (box.stroke.width if box.stroke else 0)) + 4
    ox, oy = int(box.x) - margin, int(box.y) - margin
    w, h = int(np.ceil(box.w)) + 2 * margin, int(np.ceil(box.h)) + 2 * margin
    for lp in layout_lines(box):
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        _draw_line(layer, box, lp, ox=ox, oy=oy)
        a = np.asarray(layer)[:, :, 3]
        ys, xs = np.nonzero(a >= alpha_thresh)
        out.append(
            None
            if len(xs) == 0
            else (int(xs.min()) + ox, int(ys.min()) + oy, int(xs.max()) + 1 + ox, int(ys.max()) + 1 + oy)
        )
    return out
