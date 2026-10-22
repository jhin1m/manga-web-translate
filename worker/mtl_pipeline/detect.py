"""Detect bóng thoại / chữ bằng RT-DETRv2 (ogkalu) ONNX, tile theo chiều dọc cho strip manhwa dài."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .schema import BBox, Region, RegionKind

# Thứ tự class theo config.json của ogkalu/comic-text-and-bubble-detector.
CLASSES: tuple[RegionKind, ...] = ("bubble", "text_bubble", "text_free")
INPUT_SIZE = 640
# Vùng chữ có cạnh ngắn hơn ngưỡng này là nhiễu (nét viền bóng, chấm) — không có dòng chữ nào thấp vậy.
MIN_TEXT_SIDE = 10


@dataclass
class Detection:
    kind: RegionKind
    x1: float
    y1: float
    x2: float
    y2: float
    score: float
    # Box chạm mép cắt của tile (không phải mép page) → ứng viên ghép với nửa còn lại ở tile kề.
    at_seam: bool = False

    @property
    def area(self) -> float:
        return max(0.0, self.x2 - self.x1) * max(0.0, self.y2 - self.y1)


def tile_spans(height: int, width: int, h_ratio: float = 1.25, overlap: float = 0.2) -> list[tuple[int, int]]:
    """Chia page cao thành các tile [y0, y1) cao h_ratio*width, chồng nhau overlap; tile cuối dồn về đáy."""
    tile_h = max(1, round(h_ratio * width))
    if height <= tile_h:
        return [(0, height)]
    step = max(1, round(tile_h * (1 - overlap)))
    spans: list[tuple[int, int]] = []
    y = 0
    while True:
        if y + tile_h >= height:
            spans.append((height - tile_h, height))
            break
        spans.append((y, y + tile_h))
        y += step
    return spans


def _intersection(a: Detection, b: Detection) -> float:
    w = min(a.x2, b.x2) - max(a.x1, b.x1)
    h = min(a.y2, b.y2) - max(a.y1, b.y1)
    return max(0.0, w) * max(0.0, h)


def _should_merge(a: Detection, b: Detection, seam_gap: float) -> bool:
    if a.kind != b.kind:
        return False
    inter = _intersection(a, b)
    smaller = min(a.area, b.area)
    # Cùng một vật thể thấy ở 2 tile chồng nhau (bản cắt cụt nằm gọn trong bản đầy đủ, hoặc trùng gần hết).
    if smaller > 0 and inter / smaller >= 0.5:
        return True
    # Hai nửa của vật thể bị cắt đúng ở mép tile: chồng ngang nhiều, khe dọc rất nhỏ.
    if a.at_seam or b.at_seam:
        x_overlap = min(a.x2, b.x2) - max(a.x1, b.x1)
        min_w = min(a.x2 - a.x1, b.x2 - b.x1)
        y_gap = max(a.y1, b.y1) - min(a.y2, b.y2)
        if min_w > 0 and x_overlap >= 0.6 * min_w and y_gap <= seam_gap:
            return True
    return False


def merge_detections(dets: list[Detection], seam_gap: float = 4.0) -> list[Detection]:
    """Ghép box trùng/bị cắt ở mép tile bằng union (lặp tới khi ổn định)."""
    items = sorted(dets, key=lambda d: -d.score)
    changed = True
    while changed:
        changed = False
        out: list[Detection] = []
        for d in items:
            for i, o in enumerate(out):
                if _should_merge(o, d, seam_gap):
                    out[i] = Detection(
                        kind=o.kind,
                        x1=min(o.x1, d.x1),
                        y1=min(o.y1, d.y1),
                        x2=max(o.x2, d.x2),
                        y2=max(o.y2, d.y2),
                        score=max(o.score, d.score),
                        at_seam=o.at_seam and d.at_seam,
                    )
                    changed = True
                    break
            else:
                out.append(d)
        items = out
    return items


def _contains(outer: BBox, inner: BBox, min_ratio: float = 0.6) -> bool:
    w = min(outer.x2, inner.x2) - max(outer.x, inner.x)
    h = min(outer.y2, inner.y2) - max(outer.y, inner.y)
    if w <= 0 or h <= 0 or inner.area() == 0:
        return False
    return (w * h) / inner.area() >= min_ratio


def dedupe_text_classes(dets: list[Detection], min_cover: float = 0.7) -> list[Detection]:
    """Cùng một khối chữ đôi khi ra cả text_bubble lẫn text_free → giữ box điểm cao hơn (tránh OCR/vẽ 2 lần)."""
    texts = sorted((d for d in dets if d.kind != "bubble"), key=lambda d: -d.score)
    kept: list[Detection] = []
    for d in texts:
        dup = any(
            k.kind != d.kind
            and min(k.area, d.area) > 0
            and _intersection(k, d) / min(k.area, d.area) >= min_cover
            for k in kept
        )
        if not dup:
            kept.append(d)
    return [d for d in dets if d.kind == "bubble"] + kept


# Box nhập vào hàng hiện tại khi chồng lấn dọc với box mở hàng ≥ tỉ lệ này của cạnh ngắn hơn.
RTL_ROW_OVERLAP = 0.5


def rtl_order(regions: list[Region]) -> list[Region]:
    """Thứ tự đọc manga phải→trái: gom box thành hàng (trên → dưới), trong mỗi hàng đọc từ mép phải sang trái.
    So với box mở hàng chứ không với dải đã nới — box cao (SFX/lời dẫn vắt qua nhiều khung) không kéo
    hàng dưới nhập vào hàng trên."""
    rows: list[tuple[Region, list[Region]]] = []  # (box mở hàng, thành viên)
    for r in sorted(regions, key=lambda r: (r.bbox.y, -r.bbox.x2)):
        if rows:
            anchor, members = rows[-1]
            overlap = min(anchor.bbox.y2, r.bbox.y2) - max(anchor.bbox.y, r.bbox.y)
            if overlap >= RTL_ROW_OVERLAP * min(r.bbox.h, anchor.bbox.h):
                members.append(r)
                continue
        rows.append((r, [r]))
    return [r for _, members in rows for r in sorted(members, key=lambda r: (-r.bbox.x2, r.bbox.y))]


def to_regions(dets: list[Detection], page_w: int, page_h: int, rtl: bool = False) -> list[Region]:
    """Detection → Region có id theo thứ tự đọc; gắn text_bubble vào bubble chứa nó.
    rtl=True: manga Nhật dạng trang (xem rtl_order)."""
    regions: list[Region] = []
    for d in dedupe_text_classes(dets):
        x1, y1 = max(0, int(round(d.x1))), max(0, int(round(d.y1)))
        x2, y2 = min(page_w, int(round(d.x2))), min(page_h, int(round(d.y2)))
        min_side = MIN_TEXT_SIDE if d.kind != "bubble" else 2
        if x2 - x1 < min_side or y2 - y1 < min_side:
            continue
        regions.append(
            Region(id="", kind=d.kind, bbox=BBox(x=x1, y=y1, w=x2 - x1, h=y2 - y1), score=round(d.score, 4))
        )
    if rtl:
        regions = rtl_order(regions)
    else:
        # Thứ tự đọc của strip dọc: trên → dưới, rồi trái → phải.
        regions.sort(key=lambda r: (r.bbox.y, r.bbox.x))
    for i, r in enumerate(regions):
        r.id = f"r{i}"
    bubbles = [r for r in regions if r.kind == "bubble"]
    for r in regions:
        if r.kind != "text_bubble":
            continue
        hosts = [b for b in bubbles if _contains(b.bbox, r.bbox)]
        if hosts:
            r.bubble_id = min(hosts, key=lambda b: b.bbox.area()).id
    return regions


class Detector:
    def __init__(self, model_path: Path, score_thresh: float = 0.35, threads: int = 0):
        import onnxruntime as ort

        from .models import ort_providers

        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        self.session = ort.InferenceSession(str(model_path), so, providers=ort_providers())
        self.score_thresh = score_thresh

    def _run_tile(self, tile: np.ndarray) -> list[tuple[int, np.ndarray, float]]:
        h, w = tile.shape[:2]
        # Tiền xử lý theo preprocessor_config.json: resize 640x640, /255, không normalize.
        x = cv2.resize(tile, (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_LINEAR)
        x = x.astype(np.float32).transpose(2, 0, 1)[None] / 255.0
        labels, boxes, scores = self.session.run(
            None, {"images": x, "orig_target_sizes": np.array([[w, h]], dtype=np.int64)}
        )
        return [
            (int(lab), box, float(sc))
            for lab, box, sc in zip(labels[0], boxes[0], scores[0], strict=True)
            if sc >= self.score_thresh and 0 <= int(lab) < len(CLASSES)
        ]

    def detect(self, img: np.ndarray, rtl: bool = False) -> list[Region]:
        """img: HxWx3 RGB uint8 → regions theo thứ tự đọc (rtl: phải→trái, xem rtl_order)."""
        page_h, page_w = img.shape[:2]
        spans = tile_spans(page_h, page_w)
        dets: list[Detection] = []
        for y0, y1 in spans:
            for lab, (bx1, by1, bx2, by2), sc in self._run_tile(img[y0:y1]):
                top_cut = y0 > 0 and by1 <= 2
                bottom_cut = y1 < page_h and by2 >= (y1 - y0) - 2
                dets.append(
                    Detection(
                        kind=CLASSES[lab],
                        x1=float(bx1),
                        y1=float(by1) + y0,
                        x2=float(bx2),
                        y2=float(by2) + y0,
                        score=sc,
                        at_seam=top_cut or bottom_cut,
                    )
                )
        return to_regions(merge_detections(dets), page_w, page_h, rtl)
