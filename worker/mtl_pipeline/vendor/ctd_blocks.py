# Nguồn: https://github.com/zyddnys/manga-image-translator/blob/d6de6ab62a7be6afc0d07a3184149cdefbcd32f2/manga_translator/detection/ctd_utils/utils/yolov5_utils.py
# (GPL-3.0) — `non_max_suppression` + `postprocess_yolo` cho output `blk` của comic-text-detector. Bỏ torch:
# numpy + cv2.dnn.NMSBoxes (NMS theo từng lớp như yolov5 `agnostic=False`); giữ ngưỡng mặc định của ctd.py.
import cv2
import numpy as np

CONF_THRESH = 0.4
NMS_THRESH = 0.35


def xywh2xyxy(x):
    y = np.empty_like(x)
    y[:, 0] = x[:, 0] - x[:, 2] / 2
    y[:, 1] = x[:, 1] - x[:, 3] / 2
    y[:, 2] = x[:, 0] + x[:, 2] / 2
    y[:, 3] = x[:, 1] + x[:, 3] / 2
    return y


def postprocess_yolo(blk, conf_thresh=CONF_THRESH, nms_thresh=NMS_THRESH, resize_ratio=(1.0, 1.0)):
    """blk (1, N, 5 + nc) [cx, cy, w, h, obj, cls...] → (boxes xyxy float (M, 4) theo ảnh gốc, scores (M,))."""
    x = blk[0].astype(np.float32)
    x = x[x[:, 4] > conf_thresh]
    if not len(x):
        return np.zeros((0, 4), np.float32), np.zeros((0,), np.float32)
    x[:, 5:] *= x[:, 4:5]  # conf = obj_conf * cls_conf
    boxes = xywh2xyxy(x[:, :4])
    cls = x[:, 5:].argmax(1)
    conf = x[np.arange(len(x)), 5 + cls]
    keep = conf > conf_thresh
    boxes, conf, cls = boxes[keep], conf[keep], cls[keep]
    if not len(boxes):
        return np.zeros((0, 4), np.float32), np.zeros((0,), np.float32)
    # NMS theo lớp: lệch toạ độ mỗi lớp một khoảng lớn để box khác lớp không loại nhau (cách của yolov5).
    off = boxes + (cls[:, None] * 4096.0)
    xywh = np.stack([off[:, 0], off[:, 1], off[:, 2] - off[:, 0], off[:, 3] - off[:, 1]], 1)
    idx = cv2.dnn.NMSBoxes(xywh.tolist(), conf.tolist(), conf_thresh, nms_thresh)
    idx = np.array(idx).reshape(-1).astype(int)
    boxes, conf = boxes[idx], conf[idx]
    boxes[:, [0, 2]] *= resize_ratio[0]
    boxes[:, [1, 3]] *= resize_ratio[1]
    return boxes, conf
