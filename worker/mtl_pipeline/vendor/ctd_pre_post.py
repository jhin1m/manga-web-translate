# Nguồn: https://github.com/zyddnys/manga-image-translator/blob/d6de6ab62a7be6afc0d07a3184149cdefbcd32f2/manga_translator/detection/ctd.py
# Chép: preprocess_img (bản numpy, to_tensor=False → tự chuyển CHW float32) và postprocess_mask.
import numpy as np
import cv2

from .ctd_imgproc import letterbox


def preprocess_img(img, input_size=(1024, 1024), bgr2rgb=True):
    if bgr2rgb:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img_in, ratio, (dw, dh) = letterbox(img, new_shape=input_size, auto=False, stride=64)
    img_in = img_in.transpose((2, 0, 1))[::-1]  # HWC to CHW, BGR to RGB
    img_in = np.array([np.ascontiguousarray(img_in)]).astype(np.float32) / 255
    return img_in, ratio, int(dw), int(dh)


def postprocess_mask(img, thresh=None):
    img = img.squeeze()
    if thresh is not None:
        img = img > thresh
    img = img * 255
    return img.astype(np.uint8)
