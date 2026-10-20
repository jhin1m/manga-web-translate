"""Chọn hàng cắt khi ingest strip (red team #4): không cắt ngang box, kéo dài tới trần, cut_flag khi bất khả."""

from __future__ import annotations

import random

import numpy as np

from mtl_pipeline.ingest import (
    BOX_MARGIN,
    HARD_CAP,
    TARGET_MAX,
    SourceSlice,
    build_pages,
    choose_cuts,
    group_slices,
)
from mtl_pipeline.schema import BBox, Region


def crosses(y: int, spans: list[tuple[int, int]], margin: int = BOX_MARGIN) -> bool:
    return any(y1 - margin < y < y2 + margin for y1, y2 in spans)


def check_cover(cuts, height):
    assert cuts[0].y0 == 0 and cuts[-1].y1 == height
    for a, b in zip(cuts, cuts[1:], strict=False):
        assert a.y1 == b.y0  # không overlap, không hở


def test_no_boxes_cuts_near_preferred_height():
    cuts = choose_cuts(20000, [])
    check_cover(cuts, 20000)
    assert all(c.y1 - c.y0 <= TARGET_MAX for c in cuts)
    assert not any(c.cut_flag for c in cuts)


def test_short_strip_is_one_page():
    assert [(c.y0, c.y1) for c in choose_cuts(5000, [(100, 4900)])] == [(0, 5000)]


def test_extends_past_target_when_window_is_blocked():
    # Box phủ cả cửa sổ 3000–6000 → page kéo dài tới hàng an toàn sau box.
    spans = [(2900, 7000)]
    cuts = choose_cuts(15000, spans)
    check_cover(cuts, 15000)
    assert cuts[0].y1 >= 7000 + BOX_MARGIN
    assert not crosses(cuts[0].y1, spans)
    assert all(c.y1 - c.y0 <= HARD_CAP for c in cuts)


def test_cut_flag_when_no_safe_row_within_cap():
    # Một box khổng lồ dài hơn trần → buộc cắt ngang, chọn hàng giao ít box nhất.
    spans = [(100, 30000), (5000, 9000)]
    cuts = choose_cuts(31000, spans)
    check_cover(cuts, 31000)
    assert cuts[0].cut_flag
    assert all(c.y1 - c.y0 <= HARD_CAP for c in cuts)
    first = cuts[0].y1
    assert not (5000 - BOX_MARGIN < first < 9000 + BOX_MARGIN)  # tránh hàng giao 2 box


def test_group_slices_by_width_and_mode():
    assert group_slices([720, 720, 800, 800, 720], "strip") == [[0, 1], [2, 3], [4]]
    assert group_slices([720, 720], "pages") == [[0], [1]]


def _strip_case(seed: int, n_slices: int = 40, slice_h: int = 1600, width: int = 720):
    """40 slice; bóng thoại ngẫu nhiên, nhiều bóng vắt qua ranh giới slice."""
    rng = random.Random(seed)
    slices = [SourceSlice(f"s{i}", np.full((slice_h, width, 3), 255, np.uint8)) for i in range(n_slices)]
    total = n_slices * slice_h
    regions, y = [], 200
    while y < total - 400:
        h = rng.randint(120, 700)
        regions.append(
            Region(id=f"r{len(regions)}", kind="bubble", bbox=BBox(x=50, y=y, w=300, h=h), score=0.9)
        )
        y += h + rng.randint(40, 900)
    return slices, regions, total


def test_golden_like_40_slice_strip_never_cuts_through_a_box():
    for seed in range(5):
        slices, regions, total = _strip_case(seed)
        spans = [(r.bbox.y, r.bbox.y2) for r in regions]
        pages = build_pages(slices, "strip", lambda strip, rs=regions: rs)
        assert sum(p.image.shape[0] for p in pages) == total
        y = 0
        for p in pages[:-1]:
            y += p.image.shape[0]
            assert not crosses(y, spans), f"seed={seed} cut at {y}"
            assert not p.cut_flag
        assert all(p.image.shape[0] <= HARD_CAP for p in pages)
        # source_map phủ kín từng page, theo đúng thứ tự slice.
        for p in pages:
            assert sum(m["h"] for m in p.source_map) == p.image.shape[0]
            assert p.source_map[0]["page_y"] == 0


def test_pages_mode_keeps_one_file_one_page():
    slices = [SourceSlice(f"s{i}", np.zeros((1400, 1000, 3), np.uint8)) for i in range(3)]
    pages = build_pages(slices, "pages", lambda strip: [])
    assert [p.source_map[0]["source_file_id"] for p in pages] == ["s0", "s1", "s2"]
