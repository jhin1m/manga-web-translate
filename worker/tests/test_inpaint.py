from __future__ import annotations

import cv2
import numpy as np

from mtl_pipeline.inpaint import CompositeInpainter, FloodFillInpainter, LamaInpainter

from .conftest import model_file, needs_model


def _page_with_text(bg) -> tuple[np.ndarray, np.ndarray]:
    img = np.full((300, 300, 3), 255, np.uint8)
    img[:] = bg
    cv2.putText(img, "TEXT", (60, 160), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 0), 5)
    mask = np.zeros((300, 300), np.uint8)
    cv2.putText(mask, "TEXT", (60, 160), cv2.FONT_HERSHEY_SIMPLEX, 2, 255, 5)
    return img, cv2.dilate(mask, np.ones((7, 7), np.uint8))


def test_flood_fill_flat_background():
    img, mask = _page_with_text((250, 250, 250))
    out, remaining = FloodFillInpainter().inpaint(img, mask)
    assert not remaining.any()
    assert np.abs(out.astype(int) - 250).max() <= 1


def test_flood_fill_hands_textured_background_to_fallback():
    img, mask = _page_with_text((250, 250, 250))
    img[::2] = 120  # nền sọc: không phẳng
    img2 = img.copy()
    cv2.putText(img2, "TEXT", (60, 160), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 0), 5)
    out, remaining = FloodFillInpainter().inpaint(img2, mask)
    assert remaining.any() and np.array_equal(out, img2)


def test_lama_crop_window_square_padded_inside_image():
    x0, y0, x1, y1 = LamaInpainter.crop_window(10, 10, 50, 40, 1000, 3000)
    assert (x0, y0) == (0, 0) and x1 - x0 == y1 - y0 == 512
    x0, y0, x1, y1 = LamaInpainter.crop_window(100, 2900, 600, 90, 1000, 3000)
    assert y1 <= 3000 and x1 <= 1000 and x1 - x0 == 664


@needs_model("big_lama")
def test_lama_only_changes_masked_area():
    img, mask = _page_with_text((250, 250, 250))
    img[::4] = 200
    lama = LamaInpainter(model_file("big_lama"))
    out, _ = CompositeInpainter(FloodFillInpainter(), lama).inpaint(img, mask)
    far = cv2.dilate(mask, np.ones((15, 15), np.uint8)) == 0
    assert np.array_equal(out[far], img[far])
    assert (out[mask > 0] < 60).mean() < 0.05  # mực đen đã bị xoá


def test_group_boxes_merges_nearby_components_within_limit():
    from mtl_pipeline.inpaint import group_boxes

    boxes = [(10, 10, 40, 30), (50, 10, 80, 30), (400, 400, 420, 420)]
    groups = group_boxes(boxes, max_side=448)
    assert sorted(groups) == [(10, 10, 80, 30), (400, 400, 420, 420)]
    # Hợp vượt max_side thì không gom (tránh thu nhỏ quá mức khi đưa vào LaMa 512).
    assert len(group_boxes([(0, 0, 300, 20), (310, 0, 600, 20)], max_side=448)) == 2


def test_flood_fill_uses_roi_and_handles_many_components():
    img = np.full((2000, 300, 3), 240, np.uint8)
    mask = np.zeros((2000, 300), np.uint8)
    for y in range(20, 1980, 40):
        img[y : y + 10, 50:60] = 0
        mask[y - 2 : y + 12, 48:62] = 255
    out, remaining = FloodFillInpainter().inpaint(img, mask)
    assert not remaining.any() and (out[mask > 0] == 240).all()
