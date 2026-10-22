"""Thứ tự đọc vùng chữ: strip/manhwa giữ trên→dưới, trái→phải; manga Nhật dạng trang đi phải→trái trong từng hàng."""

from __future__ import annotations

from mtl_pipeline.detect import Detection, to_regions


def _det(x1: float, y1: float, x2: float, y2: float, kind: str = "text_free") -> Detection:
    return Detection(kind, x1, y1, x2, y2, 0.9)


def _order(dets: list[Detection], rtl: bool) -> list[tuple[int, int]]:
    return [(r.bbox.x, r.bbox.y) for r in to_regions(dets, 1000, 1500, rtl)]


def test_ltr_keeps_top_then_left_order():
    dets = [_det(600, 110, 700, 300), _det(100, 100, 200, 300), _det(300, 600, 400, 800)]
    assert _order(dets, rtl=False) == [(100, 100), (600, 110), (300, 600)]


def test_rtl_reads_each_row_right_to_left():
    # Hàng 1: ô phải hơi thấp hơn ô trái (lệch 10px) vẫn cùng hàng → phải đọc trước.
    dets = [
        _det(100, 100, 200, 300),
        _det(600, 110, 700, 300),
        _det(300, 600, 400, 800),
        _det(800, 620, 900, 780),
    ]
    assert _order(dets, rtl=True) == [(600, 110), (100, 100), (800, 620), (300, 600)]


def test_rtl_ids_follow_reading_order():
    regions = to_regions([_det(100, 100, 200, 300), _det(600, 100, 700, 300)], 1000, 1500, rtl=True)
    assert [(r.id, r.bbox.x) for r in regions] == [("r0", 600), ("r1", 100)]


def test_rtl_separate_rows_when_overlap_small():
    # Chồng lấn dọc 20px < 50% chiều cao box (200px) → 2 hàng, box trên trước dù nằm bên trái.
    dets = [_det(100, 100, 200, 300), _det(600, 280, 700, 480)]
    assert _order(dets, rtl=True) == [(100, 100), (600, 280)]


def test_rtl_tall_box_does_not_merge_panel_rows():
    # SFX cao vắt qua 2 hàng khung: không được kéo hàng dưới (y≈600) lên trước hàng trên.
    dets = [
        _det(700, 100, 900, 300),
        _det(100, 120, 300, 300),
        _det(450, 120, 550, 900),
        _det(750, 600, 900, 800),
        _det(100, 620, 300, 800),
    ]
    order = _order(dets, rtl=True)
    assert order.index((700, 100)) < order.index((750, 600))
    assert order[-2:] == [(750, 600), (100, 620)]
