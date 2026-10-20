from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from mtl_pipeline.detect import Detection, Detector, merge_detections, tile_spans, to_regions

from .conftest import model_file, needs_model


def test_tile_spans_cover_page_with_overlap():
    spans = tile_spans(3000, 600)
    assert spans[0][0] == 0 and spans[-1][1] == 3000
    for (a0, a1), (b0, _) in zip(spans, spans[1:], strict=False):
        assert a1 - a0 == 750 and b0 < a1  # chồng nhau
        assert (a1 - b0) >= 0.2 * 750 - 1
    assert tile_spans(500, 600) == [(0, 500)]


def test_merge_union_halves_cut_at_seam():
    top = Detection("bubble", 100, 650, 400, 750, 0.9, at_seam=True)
    bottom = Detection("bubble", 102, 751, 398, 850, 0.8, at_seam=True)
    other = Detection("bubble", 100, 1200, 400, 1300, 0.9)
    merged = merge_detections([top, bottom, other])
    assert len(merged) == 2
    m = next(d for d in merged if d.y1 < 1000)
    assert (m.x1, m.y1, m.x2, m.y2) == (100, 650, 400, 850)


def test_merge_duplicate_from_overlapping_tiles_and_keeps_classes_apart():
    full = Detection("text_bubble", 100, 600, 300, 700, 0.95)
    partial = Detection("text_bubble", 100, 600, 300, 660, 0.7, at_seam=True)
    bubble = Detection("bubble", 90, 590, 310, 710, 0.9)
    merged = merge_detections([full, partial, bubble])
    assert sorted(d.kind for d in merged) == ["bubble", "text_bubble"]


def test_seam_rule_does_not_merge_side_by_side_boxes():
    a = Detection("text_bubble", 0, 700, 100, 750, 0.9, at_seam=True)
    b = Detection("text_bubble", 300, 751, 400, 800, 0.9, at_seam=True)
    assert len(merge_detections([a, b])) == 2


def test_to_regions_reading_order_and_bubble_link():
    dets = [
        Detection("text_bubble", 120, 520, 280, 580, 0.9),
        Detection("bubble", 100, 500, 300, 600, 0.9),
        Detection("bubble", 100, 100, 300, 200, 0.9),
    ]
    regions = to_regions(dets, 400, 800)
    assert [r.id for r in regions] == ["r0", "r1", "r2"]
    assert regions[0].bbox.y == 100
    text = next(r for r in regions if r.kind == "text_bubble")
    assert text.bubble_id == next(r.id for r in regions if r.kind == "bubble" and r.bbox.y == 500)


def _strip_with_bubble_on_seam() -> np.ndarray:
    # W=600 → tile cao 750, bước 600: bóng y 640..860 vắt qua mép dưới tile đầu (750).
    im = Image.new("RGB", (600, 1800), (175, 195, 215))
    d = ImageDraw.Draw(im)
    for y in range(0, 1800, 40):
        d.line((0, y, 600, y + 30), fill=(150, 170, 200), width=6)
    font = ImageFont.load_default(size=34)
    d.ellipse((80, 640, 520, 860), fill="white", outline="black", width=4)
    d.multiline_text((150, 700), "HELLO THERE\nWHAT ARE YOU", font=font, fill="black", spacing=8)
    return np.asarray(im)


@needs_model("rtdetr_v2_comic")
def test_detector_merges_bubble_across_tile_boundary():
    regions = Detector(model_file("rtdetr_v2_comic")).detect(_strip_with_bubble_on_seam())
    bubbles = [r for r in regions if r.kind == "bubble" and r.bbox.y < 1000]
    assert len(bubbles) == 1
    b = bubbles[0].bbox
    assert b.y <= 650 and b.y2 >= 850


def test_to_regions_drops_tiny_text_and_dedupes_text_classes():
    from mtl_pipeline.detect import MIN_TEXT_SIDE

    dets = [
        Detection("text_bubble", 100, 100, 300, 160, 0.9),
        Detection("text_free", 102, 101, 298, 158, 0.6),  # cùng khối chữ, lớp khác, điểm thấp hơn
        Detection("text_bubble", 100, 400, 300, 400 + MIN_TEXT_SIDE - 2, 0.9),  # nhiễu mảnh
        Detection("bubble", 80, 80, 320, 180, 0.9),
    ]
    regions = to_regions(dets, 400, 800)
    kinds = sorted(r.kind for r in regions)
    assert kinds == ["bubble", "text_bubble"]
