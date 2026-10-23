"""Xoá chữ: flood-fill cho nền phẳng, LaMa (ONNX, crop 512 quanh mask) cho phần còn lại.

Hai bản LaMa cùng IO (image/mask 1×{3,1}×512×512): `big_lama` (Carve/LaMa-ONNX, ra thang 0..255) và `lama_manga`
(mayocream/lama-manga-onnx = dreMaz/AnimeMangaInpainting, bản Saber-Translator gọi "lama漫画"; ra thang 0..1).
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np

from .vendor import lama_pre_post

LAMA_SIZE = 512
LAMA_PAD = 32
FEATHER_PX = 3


class Inpainter(Protocol):
    def inpaint(self, img: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """(ảnh RGB, mask 0/255) → (ảnh đã xoá, mask phần CHƯA xử lý được)."""
        ...


@dataclass(frozen=True)
class Component:
    """Thành phần liên thông của mask: bbox + mask nhị phân CHỈ trong bbox (không cấp phát cả page)."""

    x: int
    y: int
    w: int
    h: int
    local: np.ndarray  # bool, shape (h, w)


def components(mask: np.ndarray) -> list[Component]:
    n, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 127).astype(np.uint8), connectivity=8)
    out = []
    for i in range(1, n):
        x, y, w, h, _ = (int(v) for v in stats[i])
        out.append(Component(x, y, w, h, labels[y : y + h, x : x + w] == i))
    return out


class FloodFillInpainter:
    """Tô màu nền cho thành phần mask có vành ngoài phẳng (bóng trắng/màu trơn). Chỉ tô trên mask chữ giãn."""

    def __init__(self, ring_px: int = 3, max_std: float = 6.0):
        self.ring_px = ring_px
        self.max_std = max_std

    def inpaint(self, img: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        out = img.copy()
        remaining = np.zeros_like(mask)
        img_h, img_w = mask.shape
        r = self.ring_px
        kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
        for c in components(mask):
            # ROI = bbox thành phần + vành r px.
            x0, y0 = max(0, c.x - r), max(0, c.y - r)
            x1, y1 = min(img_w, c.x + c.w + r), min(img_h, c.y + c.h + r)
            comp = np.zeros((y1 - y0, x1 - x0), np.uint8)
            comp[c.y - y0 : c.y - y0 + c.h, c.x - x0 : c.x - x0 + c.w] = c.local
            comp_b = comp > 0
            ring = (cv2.dilate(comp, kern) > 0) & ~comp_b & (mask[y0:y1, x0:x1] <= 127)
            ring_px = img[y0:y1, x0:x1][ring]
            if len(ring_px) < 8 or float(ring_px.std(axis=0).max()) > self.max_std:
                remaining[y0:y1, x0:x1][comp_b] = 255
                continue
            out[y0:y1, x0:x1][comp_b] = np.median(ring_px, axis=0).astype(np.uint8)
        return out, remaining


def group_boxes(boxes: list[tuple[int, int, int, int]], max_side: int) -> list[tuple[int, int, int, int]]:
    """Gom bbox (x0, y0, x1, y1) gần nhau (khe ≤ 2·pad) thành 1 cửa sổ LaMa, miễn hợp không vượt max_side."""
    groups = [list(b) for b in boxes]
    changed = True
    while changed:
        changed = False
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                a, b = groups[i], groups[j]
                gap_x = max(a[0], b[0]) - min(a[2], b[2])
                gap_y = max(a[1], b[1]) - min(a[3], b[3])
                u = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                if max(gap_x, gap_y) <= 2 * LAMA_PAD and max(u[2] - u[0], u[3] - u[1]) <= max_side:
                    groups[i] = u
                    del groups[j]
                    changed = True
                    break
            if changed:
                break
    return [(g[0], g[1], g[2], g[3]) for g in groups]


class LamaInpainter:
    """output_scale: hệ số đưa output model về 0..255 (big_lama 1, lama_manga 255).
    group_side: cạnh tối đa của cửa sổ gom nhiều thành phần mask vào 1 lượt ("Inpainting size"; mặc định 512 = như
    trước). Model luôn chạy ở 512×512: cửa sổ lớn hơn bị thu nhỏ (thấy nhiều nền hơn, nét mờ hơn)."""

    def __init__(
        self, model_path: Path, threads: int = 0, output_scale: float = 1.0, group_side: int = LAMA_SIZE
    ):
        import onnxruntime as ort

        from .models import ort_providers

        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        self.session = ort.InferenceSession(str(model_path), so, providers=ort_providers())
        self.output_scale = output_scale
        self.group_side = group_side

    def sized(self, group_side: int) -> LamaInpainter:
        """Bản dùng chung session ONNX, khác cạnh cửa sổ gom."""
        if group_side == self.group_side:
            return self
        other = copy.copy(self)
        other.group_side = group_side
        return other

    @staticmethod
    def crop_window(x: int, y: int, w: int, h: int, img_w: int, img_h: int) -> tuple[int, int, int, int]:
        """Cửa sổ vuông bao mask + pad 32, tối thiểu 512 (đỡ phải phóng to), kẹp trong ảnh."""
        side = max(w, h) + 2 * LAMA_PAD
        side = max(side, min(LAMA_SIZE, img_w, img_h))
        cx, cy = x + w / 2, y + h / 2
        x0 = int(np.clip(round(cx - side / 2), 0, max(0, img_w - side)))
        y0 = int(np.clip(round(cy - side / 2), 0, max(0, img_h - side)))
        return x0, y0, min(img_w, x0 + side), min(img_h, y0 + side)

    def _run(self, crop: np.ndarray, crop_mask: np.ndarray) -> np.ndarray:
        ch, cw = crop.shape[:2]
        img_r = cv2.resize(crop, (LAMA_SIZE, LAMA_SIZE), interpolation=cv2.INTER_AREA)
        m_r = cv2.resize(crop_mask, (LAMA_SIZE, LAMA_SIZE), interpolation=cv2.INTER_NEAREST)
        x, m = lama_pre_post.prepare(img_r, m_r)
        y = self.session.run(None, {"image": x, "mask": m})[0]
        if self.output_scale != 1.0:
            y = y * self.output_scale
        res = lama_pre_post.finalize(y, img_r, m_r)
        return cv2.resize(res, (cw, ch), interpolation=cv2.INTER_CUBIC)

    def inpaint(self, img: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        out = img.copy()
        img_h, img_w = img.shape[:2]
        # Thành phần gần nhau (các chữ trong cùng bóng) chạy chung 1 lượt LaMa thay vì mỗi chữ 1 lượt.
        boxes = [(c.x, c.y, c.x + c.w, c.y + c.h) for c in components(mask)]
        for gx0, gy0, gx1, gy1 in group_boxes(boxes, self.group_side - 2 * LAMA_PAD):
            x0, y0, x1, y1 = self.crop_window(gx0, gy0, gx1 - gx0, gy1 - gy0, img_w, img_h)
            # Chỉ inpaint phần mask thuộc nhóm; mask nhóm khác trong cửa sổ để lượt của nhóm đó lo.
            crop_mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
            sub = mask[gy0:gy1, gx0:gx1] > 127
            crop_mask[gy0 - y0 : gy1 - y0, gx0 - x0 : gx1 - x0][sub] = 255
            res = self._run(out[y0:y1, x0:x1], crop_mask)
            # Ghép bằng mask feather để không thấy mép crop.
            alpha = cv2.GaussianBlur(
                cv2.dilate(crop_mask, np.ones((3, 3), np.uint8), iterations=FEATHER_PX).astype(np.float32)
                / 255,
                (2 * FEATHER_PX + 1, 2 * FEATHER_PX + 1),
                0,
            )
            alpha = np.maximum(alpha, crop_mask.astype(np.float32) / 255)[:, :, None]
            region = out[y0:y1, x0:x1].astype(np.float32)
            out[y0:y1, x0:x1] = (
                (res.astype(np.float32) * alpha + region * (1 - alpha)).round().astype(np.uint8)
            )
        return out, np.zeros_like(mask)


class CompositeInpainter:
    """Flood-fill trước (rẻ), phần không phẳng chuyển cho LaMa."""

    def __init__(self, first: Inpainter, fallback: Inpainter):
        self.first = first
        self.fallback = fallback

    def inpaint(self, img: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        out, remaining = self.first.inpaint(img, mask)
        if remaining.any():
            out, remaining = self.fallback.inpaint(out, remaining)
        return out, remaining
