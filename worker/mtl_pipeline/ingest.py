"""Ingest chương: ghép slice liên tiếp cùng width thành strip ảo, chạy detector trên strip, cắt page ở hàng không
giao box nào (red team #4). Không overlap; không có hàng an toàn → kéo dài page tới trần cứng; vượt trần vẫn không
có → cắt ở hàng giao ít box nhất + cut_flag. Manga (mode="pages"): 1 file = 1 page."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import numpy as np

from .schema import Region

TARGET_MIN = 3000
TARGET_MAX = 6000
# Chiều cao ưu tiên khi có nhiều hàng an toàn trong cửa sổ [TARGET_MIN, TARGET_MAX].
TARGET_PREFERRED = 4500
HARD_CAP = 12000
BOX_MARGIN = 16


@dataclass(frozen=True)
class Cut:
    """Page logic = hàng [y0, y1) của strip; cut_flag = đường cắt dưới buộc phải giao box."""

    y0: int
    y1: int
    cut_flag: bool = False


@dataclass
class SourceSlice:
    source_file_id: str
    image: np.ndarray  # HxWx3 RGB


@dataclass
class IngestPage:
    image: np.ndarray
    source_map: list[dict] = field(default_factory=list)  # {source_file_id, src_y, page_y, h}
    cut_flag: bool = False


def group_slices(widths: Sequence[int], mode: str) -> list[list[int]]:
    """Chỉ số slice theo nhóm: strip = các slice liên tiếp cùng width; pages = mỗi file một nhóm."""
    if mode == "pages":
        return [[i] for i in range(len(widths))]
    groups: list[list[int]] = []
    for i, w in enumerate(widths):
        if groups and widths[groups[-1][-1]] == w:
            groups[-1].append(i)
        else:
            groups.append([i])
    return groups


def coverage(height: int, spans: Sequence[tuple[int, int]], margin: int) -> np.ndarray:
    """Số box (nới margin) phủ đường cắt tại hàng y — cắt tại y = ranh giới giữa hàng y−1 và y.
    Đường cắt y giao box [y1, y2) khi y1 − margin < y < y2 + margin."""
    diff = np.zeros(height + 2, np.int32)
    for y1, y2 in spans:
        lo = max(0, y1 - margin + 1)
        hi = min(height, y2 + margin - 1)
        if lo <= hi:
            diff[lo] += 1
            diff[hi + 1] -= 1
    return np.cumsum(diff)[: height + 1]


def choose_cuts(
    height: int,
    spans: Sequence[tuple[int, int]],
    target_min: int = TARGET_MIN,
    target_max: int = TARGET_MAX,
    preferred: int = TARGET_PREFERRED,
    hard_cap: int = HARD_CAP,
    margin: int = BOX_MARGIN,
) -> list[Cut]:
    """Chia strip cao `height` thành page theo khoảng dọc của box (y1, y2)."""
    cov = coverage(height, spans, margin)
    cuts: list[Cut] = []
    s = 0
    while height - s > target_max:
        lo, hi = s + target_min, s + target_max
        safe = np.flatnonzero(cov[lo : hi + 1] == 0) + lo
        if safe.size:
            y = int(safe[np.argmin(np.abs(safe - (s + preferred)))])
            cuts.append(Cut(s, y))
            s = y
            continue
        # Kéo dài page: hàng an toàn đầu tiên sau target_max, không quá trần.
        cap = min(s + hard_cap, height)
        ext = np.flatnonzero(cov[hi + 1 : cap] == 0) + hi + 1
        if ext.size:
            y = int(ext[0])
            cuts.append(Cut(s, y))
            s = y
            continue
        if height - s <= hard_cap:
            break  # phần còn lại vừa trần → một page tới hết strip, không cần cắt
        # Vượt trần mà không có hàng an toàn: cắt ở hàng giao ít box nhất (gần trần nhất khi hoà).
        window = cov[lo : s + hard_cap + 1]
        best = np.flatnonzero(window == window.min()) + lo
        y = int(best[-1])
        cuts.append(Cut(s, y, cut_flag=True))
        s = y
    cuts.append(Cut(s, height))
    return cuts


def box_spans(regions: Sequence[Region]) -> list[tuple[int, int]]:
    return [(r.bbox.y, r.bbox.y2) for r in regions]


def build_pages(
    slices: Sequence[SourceSlice],
    mode: str,
    detect: Callable[[np.ndarray], list[Region]],
    on_group: Callable[[int, int], None] | None = None,
) -> list[IngestPage]:
    """Ghép, detect, cắt → page theo thứ tự; source_map ghi slice gốc nào phủ đoạn y nào của page."""
    pages: list[IngestPage] = []
    groups = group_slices([s.image.shape[1] for s in slices], mode)
    for gi, group in enumerate(groups):
        if on_group:
            on_group(gi, len(groups))
        imgs = [slices[i].image for i in group]
        if len(group) == 1 and mode == "pages":
            img = imgs[0]
            pages.append(IngestPage(img, [_map(slices[group[0]], 0, 0, img.shape[0])]))
            continue
        strip = imgs[0] if len(imgs) == 1 else np.concatenate(imgs, axis=0)
        offsets = np.cumsum([0] + [im.shape[0] for im in imgs])
        for cut in choose_cuts(strip.shape[0], box_spans(detect(strip))):
            page = IngestPage(np.ascontiguousarray(strip[cut.y0 : cut.y1]), cut_flag=cut.cut_flag)
            for k, i in enumerate(group):
                a, b = max(cut.y0, int(offsets[k])), min(cut.y1, int(offsets[k + 1]))
                if a < b:
                    page.source_map.append(_map(slices[i], a - int(offsets[k]), a - cut.y0, b - a))
            pages.append(page)
    return pages


def _map(s: SourceSlice, src_y: int, page_y: int, h: int) -> dict:
    return {"source_file_id": s.source_file_id, "src_y": src_y, "page_y": page_y, "h": h}
