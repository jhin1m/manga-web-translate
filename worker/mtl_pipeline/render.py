"""Vẽ TextBox.lines[] theo hợp đồng layout (docs/typeset-layout-contract.md). Dùng chung cho auto-typeset và export.

Hợp đồng (phải khớp editor Konva):
- text chuẩn hoá NFC trước khi đo/vẽ;
- baseline dòng i = box.y + pad + dy + ascent + i·(ascent+descent)·line_height, ascent/descent từ hhea/OS/2 của file font;
  dy = valign "middle" ? max(0, (h − 2·pad − block_height)/2) : 0 (thiếu valign = "top");
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
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, features

from .fonts import font_path, metrics_for
from .schema import Stroke, TextBox

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
def _load(path: Path, size: float) -> ImageFont.FreeTypeFont:
    require_raqm()
    return ImageFont.truetype(str(path), size, layout_engine=ImageFont.Layout.RAQM)


def load_font(font_id: str, size: float) -> ImageFont.FreeTypeFont:
    # Cache theo file (không theo id): id → file đổi giữa các job (font tuỳ chỉnh đăng ký / fallback).
    return _load(font_path(font_id), size)


@dataclass(frozen=True)
class LinePlacement:
    text: str
    x: float  # mép trái pen (origin) của dòng
    baseline: float
    advance: float


def line_advance(font_id: str, size: float, text: str) -> float:
    return float(load_font(font_id, size).getlength(nfc(text)))


def vertical_offset(box: TextBox) -> float:
    """Dịch khối chữ xuống để căn giữa dọc (valign "middle"); không âm → chữ tràn vẫn bám mép trên như "top"."""
    if box.valign != "middle":
        return 0.0
    from .typeset import block_height  # nạp lười: typeset import ngược render

    block = block_height(box.font_family, box.font_size, len(box.lines), box.line_height)
    return max(0.0, (box.h - 2 * box.pad - block) / 2)


def layout_lines(box: TextBox) -> list[LinePlacement]:
    """Toạ độ pen + baseline từng dòng trong hệ toạ độ chưa xoay (gốc = page)."""
    m = metrics_for(box.font_family)
    asc, desc = m.ascent_px(box.font_size), m.descent_px(box.font_size)
    step = (asc + desc) * box.line_height
    inner_w = box.w - 2 * box.pad
    top = box.y + box.pad + vertical_offset(box)
    out = []
    for i, raw in enumerate(box.lines):
        text = nfc(raw)
        adv = line_advance(box.font_family, box.font_size, text)
        x = box.x + box.pad
        if box.align == "center":
            x += (inner_w - adv) / 2
        elif box.align == "right":
            x += inner_w - adv
        out.append(LinePlacement(text=text, x=x, baseline=top + asc + i * step, advance=adv))
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


# ---- Export: dựng lines[] còn thiếu, vẽ PageState, ghép slice gốc theo cửa sổ trượt ----


def _wrap_paragraphs(text: str, font_id: str, size: float, max_w: float) -> list[str] | None:
    """Wrap greedy theo từ, mỗi đoạn (`\\n`) riêng; null khi có từ không vừa — như wrapWords của measure.ts."""
    from .typeset import wrap_words  # nạp lười: typeset import ngược render

    out: list[str] = []
    for para in nfc(text).split("\n"):
        lines = wrap_words(para, font_id, size, max_w)
        if lines is None:
            return None
        out.extend(lines)
    return out


def _hard_wrap_paragraphs(text: str, font_id: str, size: float, max_w: float) -> list[str]:
    from .typeset import hard_wrap

    return [ln for para in nfc(text).split("\n") for ln in hard_wrap(para, font_id, size, max_w)]


def ensure_lines(box: TextBox, auto_fit: bool = True) -> TextBox:
    """Box đã có lines (hoặc text rỗng) → giữ nguyên. Thiếu lines mà có text → ngắt dòng GIỐNG HỆT layoutBox của
    apps/web/src/features/editor/measure.ts: `\\n` = đoạn mới; auto_fit → binary search cỡ nguyên MIN..MAX như
    fit_text; không auto_fit → giữ cỡ, wrap theo bề rộng, từ quá dài → cắt cứng theo ký tự."""
    from .typeset import MAX_SIZE, MIN_SIZE, block_height

    text = nfc(box.text)
    if box.lines or not text.strip():
        return box
    inner_w, inner_h = box.w - 2 * box.pad, box.h - 2 * box.pad
    if not auto_fit:
        lines = _wrap_paragraphs(text, box.font_family, box.font_size, inner_w)
        if lines is None:
            lines = _hard_wrap_paragraphs(text, box.font_family, box.font_size, inner_w)
        return box.model_copy(update={"lines": lines})
    lo, hi, best = MIN_SIZE, MAX_SIZE, None
    while lo <= hi:
        mid = (lo + hi) // 2
        lines = _wrap_paragraphs(text, box.font_family, mid, inner_w)
        if lines is not None and block_height(box.font_family, mid, len(lines), box.line_height) <= inner_h:
            best = (float(mid), lines)
            lo = mid + 1
        else:
            hi = mid - 1
    if best is None:
        best = (float(MIN_SIZE), _hard_wrap_paragraphs(text, box.font_family, MIN_SIZE, inner_w))
    return box.model_copy(update={"font_size": best[0], "lines": best[1]})


def text_box_from_shared(d: Mapping[str, Any]) -> TextBox:
    """TextBox dùng chung (packages/shared page-state) → TextBox pipeline, lines đã chốt. letter_spacing bỏ qua."""
    stroke = d.get("stroke")
    box = TextBox(
        id=d["id"],
        region_id=d.get("region_id") or "",
        x=d["x"],
        y=d["y"],
        w=d["w"],
        h=d["h"],
        rotation=d.get("rotation", 0.0),
        font_family=d["font_family"],
        font_size=d["font_size"],
        line_height=d["line_height"],
        pad=d["pad"],
        align=d["align"],
        valign=d.get("valign") or "top",
        fill=d["fill"],
        stroke=Stroke(color=stroke["color"], width=stroke["width"]) if stroke else None,
        text=d.get("text", ""),
        lines=list(d.get("lines") or []),
    )
    return ensure_lines(box, bool(d.get("auto_fit", True)))


def render_page_state(base: np.ndarray, state: Mapping[str, Any] | None) -> np.ndarray:
    """Nền (RGB) + text_boxes không hidden của PageState → ảnh page cuối. state null → ảnh nền nguyên."""
    boxes = [text_box_from_shared(b) for b in (state or {}).get("text_boxes", []) if not b.get("hidden")]
    return render_page(base, boxes) if boxes else base


class SliceMapError(ValueError):
    """source_map không khớp page (ngoài biên, lệch bề rộng...)."""


class SliceAssembler:
    """Ghép lại slice gốc từ các page đã render theo source_map, kiểu cửa sổ trượt: buffer của slice chỉ sống từ
    đoạn đầu tới đoạn cuối của nó → RAM ~ vài slice chứ không cả strip. `pages`: dict có width, translated,
    source_map [{source_file_id, src_y, page_y, h}], skipped (tuỳ chọn).

    Page ẩn (`skipped`): slice nằm trọn trong page ẩn bị bỏ; slice vắt qua giữ đoạn đó (page ẩn render ảnh gốc) và
    không tính là "chưa dịch" — người dùng chủ động bỏ trang, không phải trang còn thiếu bản dịch."""

    def __init__(self, pages: Sequence[Mapping[str, Any]], include_untranslated: bool):
        width: dict[str, int] = {}
        height: dict[str, int] = {}
        left: dict[str, int] = {}
        untranslated: set[str] = set()
        visible: set[str] = set()
        for pg in pages:
            skipped = bool(pg.get("skipped"))
            for seg in pg["source_map"]:
                sid = seg["source_file_id"]
                if width.setdefault(sid, pg["width"]) != pg["width"]:
                    raise SliceMapError(f"slice {sid} nằm trên các page khác bề rộng")
                height[sid] = max(height.get(sid, 0), seg["src_y"] + seg["h"])
                left[sid] = left.get(sid, 0) + 1
                if not skipped:
                    visible.add(sid)
                    if not pg["translated"]:
                        untranslated.add(sid)
        # Slice có đoạn thuộc page chưa dịch → bỏ cả slice khi không xuất bản chưa dịch; slice chỉ thuộc page ẩn → bỏ.
        self.kept: list[str] = [
            s for s in width if s in visible and (include_untranslated or s not in untranslated)
        ]
        self._w, self._h = width, height
        self._left = {s: left[s] for s in self.kept}
        self._bufs: dict[str, np.ndarray] = {}

    def needs_page(self, page: Mapping[str, Any]) -> bool:
        return any(seg["source_file_id"] in self._left for seg in page["source_map"])

    def add_page(self, page: Mapping[str, Any], image: np.ndarray) -> Iterator[tuple[str, np.ndarray]]:
        """Dán các đoạn của page vào buffer; slice đủ đoạn → trả (source_file_id, ảnh) và giải phóng buffer."""
        for seg in page["source_map"]:
            sid, h, py = seg["source_file_id"], seg["h"], seg["page_y"]
            if sid not in self._left:
                continue
            if py + h > image.shape[0] or image.shape[1] != self._w[sid]:
                raise SliceMapError(f"đoạn source_map vượt ảnh page {page.get('ord')}")
            buf = self._bufs.get(sid)
            if buf is None:
                buf = self._bufs[sid] = np.zeros((self._h[sid], self._w[sid], 3), np.uint8)
            buf[seg["src_y"] : seg["src_y"] + h] = image[py : py + h]
            self._left[sid] -= 1
            if self._left[sid] == 0:
                yield sid, self._bufs.pop(sid)
