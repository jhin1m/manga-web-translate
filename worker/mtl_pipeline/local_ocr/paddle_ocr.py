"""PaddleOCR bản ONNX của RapidOCR (Apache-2.0): PP-OCRv6 det small (đa ngữ) + rec small (ch/chinese_cht/en/japan…)
và PP-OCRv5 korean rec. Không kéo paddlepaddle / rapidocr: tiền xử lý, hậu xử lý DB (box chữ nhật xoay) và giải mã
CTC port từ rapidocr 3.10 (`ch_ppocr_det/utils.py`, `ch_ppocr_rec/utils.py`); bảng ký tự nằm trong metadata ONNX.

Crop vùng chữ (bóng thoại) → det tách dòng → rec từng dòng → nối theo thứ tự đọc (dòng ngang trên→dưới; cột dọc
phải→trái như manga Nhật)."""

from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np

DET_LIMIT_SIDE = 736  # limit_type=min: cạnh ngắn phóng tới 736
DET_MAX_SIDE = 2000
DET_THRESH, BOX_THRESH, UNCLIP_RATIO, MIN_SIZE = 0.3, 0.5, 1.6, 3
REC_H, REC_W = 48, 320
BORDER = 8  # viền trắng quanh crop: det cần khoảng nền quanh chữ chạm mép


def _session(path: Path, threads: int):
    import onnxruntime as ort

    from ..models import ort_providers

    so = ort.SessionOptions()
    if threads:
        so.intra_op_num_threads = threads
    return ort.InferenceSession(str(path), so, providers=ort_providers())


def det_resize(img: np.ndarray) -> tuple[np.ndarray, float, float]:
    h, w = img.shape[:2]
    ratio = DET_LIMIT_SIDE / min(h, w) if min(h, w) < DET_LIMIT_SIDE else 1.0
    ratio = min(ratio, DET_MAX_SIDE / max(h, w)) if max(h, w) * ratio > DET_MAX_SIDE else ratio
    rh = max(32, int(round(h * ratio / 32) * 32))
    rw = max(32, int(round(w * ratio / 32) * 32))
    return cv2.resize(img, (rw, rh)), rh / h, rw / w


def box_score(pred: np.ndarray, box: np.ndarray) -> float:
    """score_mode=fast: trung bình xác suất trong đa giác box (trên vùng bao)."""
    h, w = pred.shape
    xmin = int(np.clip(np.floor(box[:, 0].min()), 0, w - 1))
    xmax = int(np.clip(np.ceil(box[:, 0].max()), 0, w - 1))
    ymin = int(np.clip(np.floor(box[:, 1].min()), 0, h - 1))
    ymax = int(np.clip(np.ceil(box[:, 1].max()), 0, h - 1))
    mask = np.zeros((ymax - ymin + 1, xmax - xmin + 1), np.uint8)
    pts = box.copy()
    pts[:, 0] -= xmin
    pts[:, 1] -= ymin
    cv2.fillPoly(mask, [pts.astype(np.int32)], 1)
    return float(cv2.mean(pred[ymin : ymax + 1, xmin : xmax + 1], mask)[0])


def order_points(pts: np.ndarray) -> np.ndarray:
    """4 đỉnh → [trên-trái, trên-phải, dưới-phải, dưới-trái] (như get_mini_boxes)."""
    pts = pts[np.argsort(pts[:, 0])]
    left, right = pts[:2], pts[2:]
    tl, bl = left[np.argsort(left[:, 1])]
    tr, br = right[np.argsort(right[:, 1])]
    return np.array([tl, tr, br, bl], np.float32)


def db_boxes(pred: np.ndarray, sy: float, sx: float, shape: tuple[int, int]) -> list[np.ndarray]:
    """Bản đồ xác suất DB → box 4 đỉnh theo toạ độ ảnh vào. Unclip trên hình chữ nhật xoay: nới đều mỗi cạnh
    d = area·ratio/perimeter (pyclipper cho cùng kết quả với hình chữ nhật, trừ góc bo)."""
    seg = cv2.dilate((pred > DET_THRESH).astype(np.uint8), np.ones((2, 2), np.uint8))
    contours, _ = cv2.findContours(seg, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in contours[:1000]:
        (cx, cy), (rw, rh), ang = cv2.minAreaRect(c)
        if min(rw, rh) < MIN_SIZE:
            continue
        box = order_points(cv2.boxPoints(((cx, cy), (rw, rh), ang)))
        if box_score(pred, box) < BOX_THRESH:
            continue
        d = rw * rh * UNCLIP_RATIO / (2 * (rw + rh))
        rw, rh = rw + 2 * d, rh + 2 * d
        if min(rw, rh) < MIN_SIZE + 2:
            continue
        box = order_points(cv2.boxPoints(((cx, cy), (rw, rh), ang)))
        box[:, 0] = np.clip(box[:, 0] / sx, 0, shape[1] - 1)
        box[:, 1] = np.clip(box[:, 1] / sy, 0, shape[0] - 1)
        out.append(box)
    return out


def split_columns(gray: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Chữ dọc (ja/zh): det PP-OCR gom các chữ cùng hàng của nhiều cột thành 1 dòng ngang (khoảng cách cột ≈
    khoảng cách chữ). Tách cột theo hình chiếu mực lên trục x (Otsu, nét tối): khe trống ngăn cột; mảnh hẹp ở khe
    nhỏ (nét rời của い, ハ…) gộp vào cột kề; cột quá hẹp so với trung vị (furigana) bỏ. → [(x0, y0, x1, y1)] trái→phải."""
    _, ink = cv2.threshold(gray, 0, 1, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    prof = ink.sum(0) > max(1, int(0.01 * gray.shape[0]))
    segs: list[list[int]] = []
    x = 0
    while x < len(prof):
        if prof[x]:
            x0 = x
            while x < len(prof) and prof[x]:
                x += 1
            segs.append([x0, x])
        x += 1
    if not segs:
        return []
    med = float(np.median([b - a for a, b in segs]))
    merged: list[list[int]] = [segs[0]]
    for a, b in segs[1:]:
        last = merged[-1]
        narrow = min(b - a, last[1] - last[0]) < 0.6 * med
        if narrow and a - last[1] <= max(2, 0.25 * med):
            last[1] = b
        else:
            merged.append([a, b])
    widths = [b - a for a, b in merged]
    big = max(widths)
    out = []
    for a, b in merged:
        if b - a < 0.45 * big:
            continue  # furigana / vụn
        rows = np.flatnonzero(ink[:, a:b].sum(1))
        if len(rows):
            out.append((a, int(rows[0]), b, int(rows[-1]) + 1))
    return out


def rotate_crop(img: np.ndarray, box: np.ndarray) -> np.ndarray:
    """get_rotate_crop_image: nắn box về chữ nhật; dòng dọc (cao ≥ 1.5 rộng) xoay 90° cho rec đọc ngang."""
    w = int(max(np.linalg.norm(box[0] - box[1]), np.linalg.norm(box[2] - box[3])))
    h = int(max(np.linalg.norm(box[0] - box[3]), np.linalg.norm(box[1] - box[2])))
    w, h = max(w, 1), max(h, 1)
    dst = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    m = cv2.getPerspectiveTransform(box.astype(np.float32), dst)
    crop = cv2.warpPerspective(img, m, (w, h), borderMode=cv2.BORDER_REPLICATE, flags=cv2.INTER_CUBIC)
    if h / w >= 1.5:
        crop = np.rot90(crop)
    return np.ascontiguousarray(crop)


def rec_norm(crop: np.ndarray, max_ratio: float) -> np.ndarray:
    """resize_norm_img: cao 48, rộng theo tỉ lệ (≤ 48·max_ratio), chuẩn hoá (x/255−0.5)/0.5, pad 0 bên phải."""
    img_w = int(REC_H * max_ratio)
    h, w = crop.shape[:2]
    rw = min(img_w, int(math.ceil(REC_H * w / h)))
    x = cv2.resize(crop, (rw, REC_H)).astype(np.float32).transpose(2, 0, 1) / 255.0
    x = (x - 0.5) / 0.5
    out = np.zeros((3, REC_H, img_w), np.float32)
    out[:, :, :rw] = x
    return out


class PaddleOcr:
    name = "paddle_ocr"

    def __init__(self, det: Path, rec: Path, threads: int = 0, join: str = " ", vertical: bool = False):
        """join: nối các dòng — " " cho ko/en (có dấu cách giữa từ), "" cho ja/zh. vertical: ngôn ngữ có chữ dọc
        (ja/zh) → gom box ký tự thành cột khi det không ra dòng ngang rõ."""
        self.det = _session(det, threads)
        self.rec = _session(rec, threads)
        meta = self.rec.get_modelmeta().custom_metadata_map
        if "character" not in meta:
            raise ValueError(f"{rec.name}: thiếu bảng ký tự trong metadata ONNX")
        # CTC: 0 = blank, cuối = dấu cách (insert_special_char của rapidocr).
        self.chars = ["", *meta["character"].splitlines(), " "]
        self.join = join
        self.vertical = vertical

    def detect(self, img_bgr: np.ndarray) -> list[np.ndarray]:
        x, sy, sx = det_resize(img_bgr)
        x = ((x.astype(np.float32) / 255.0 - 0.5) / 0.5).transpose(2, 0, 1)[None]
        pred = self.det.run(None, {self.det.get_inputs()[0].name: x})[0][0, 0]
        return db_boxes(pred, sy, sx, img_bgr.shape[:2])

    def recognize(self, crops: list[np.ndarray]) -> list[tuple[str, float]]:
        if not crops:
            return []
        max_ratio = max(REC_W / REC_H, *(c.shape[1] / c.shape[0] for c in crops))
        batch = np.stack([rec_norm(c, max_ratio) for c in crops])
        preds = self.rec.run(None, {self.rec.get_inputs()[0].name: batch})[0]
        out = []
        for p in preds:
            idx, prob = p.argmax(1), p.max(1)
            keep = np.ones(len(idx), bool)
            keep[1:] = idx[1:] != idx[:-1]  # gộp lặp
            keep &= idx != 0  # bỏ blank
            text = "".join(self.chars[i] for i in idx[keep] if i < len(self.chars))
            out.append((text, float(prob[keep].mean()) if keep.any() else 0.0))
        return out

    def read(self, crop_rgb: np.ndarray) -> tuple[str, float]:
        bgr = cv2.copyMakeBorder(
            np.ascontiguousarray(crop_rgb[:, :, ::-1]), BORDER, BORDER, BORDER, BORDER, cv2.BORDER_REPLICATE
        )
        h, w = crop_rgb.shape[:2]
        if self.vertical and h >= 1.2 * w:
            return self._read_columns(bgr)
        boxes = self.detect(bgr)
        if not boxes:
            return "", 0.0
        vertical = [np.linalg.norm(b[0] - b[3]) > np.linalg.norm(b[0] - b[1]) for b in boxes]
        if sum(vertical) * 2 > len(boxes):
            boxes.sort(key=lambda b: -float(b[:, 0].mean()))  # cột dọc: phải → trái
        else:
            boxes.sort(key=lambda b: (float(b[:, 1].mean()), float(b[:, 0].mean())))  # dòng: trên → dưới
        lines = [(t, c) for t, c in self.recognize([rotate_crop(bgr, b) for b in boxes]) if t.strip()]
        if not lines:
            return "", 0.0
        return self.join.join(t.strip() for t, _ in lines), float(np.mean([c for _, c in lines]))

    def _read_columns(self, bgr: np.ndarray) -> tuple[str, float]:
        """Khối chữ dọc: tách cột (split_columns), đọc phải → trái, mỗi cột xoay 90° như dòng dọc của PP-OCR."""
        cols = split_columns(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
        pad = 3
        crops = []
        for x0, y0, x1, y1 in reversed(cols):
            c = bgr[max(0, y0 - pad) : y1 + pad, max(0, x0 - pad) : x1 + pad]
            crops.append(np.ascontiguousarray(np.rot90(c)) if c.shape[0] >= 1.5 * c.shape[1] else c)
        lines = [(t, c) for t, c in self.recognize(crops) if t.strip()]
        if not lines:
            return "", 0.0
        return self.join.join(t.strip() for t, _ in lines), float(np.mean([c for _, c in lines]))
