"""Detector CTD: hậu xử lý khối chữ (YOLO + NMS) và gán text_bubble / text_free theo bóng RT-DETR."""

from __future__ import annotations

import numpy as np

from mtl_pipeline.detect import Detection, ctd_text_detections
from mtl_pipeline.vendor.ctd_blocks import postprocess_yolo


def test_postprocess_yolo_filters_conf_nms_and_rescales():
    blk = np.array(
        [
            [
                [100, 100, 40, 20, 0.9, 0.9, 0.1],  # giữ
                [102, 101, 40, 20, 0.8, 0.9, 0.1],  # trùng → NMS bỏ
                [300, 300, 30, 30, 0.2, 0.9, 0.1],  # obj thấp → bỏ
            ]
        ],
        np.float32,
    )
    boxes, scores = postprocess_yolo(blk, 0.4, 0.35, resize_ratio=(2.0, 3.0))
    assert len(boxes) == 1 and scores[0] > 0.8
    np.testing.assert_allclose(boxes[0], [160, 270, 240, 330])
    empty, _ = postprocess_yolo(np.zeros((1, 3, 7), np.float32))
    assert empty.shape == (0, 4)


def test_ctd_blocks_inside_bubble_are_text_bubble():
    bubble = Detection(kind="bubble", x1=0, y1=0, x2=200, y2=200, score=0.9)
    out = ctd_text_detections([bubble], [(20, 20, 120, 80, 0.8, False), (300, 300, 340, 360, 0.7, True)])
    assert [d.kind for d in out] == ["text_bubble", "text_free"]
    assert out[1].at_seam
