# Nguồn: https://github.com/zyddnys/manga-image-translator/blob/d6de6ab62a7be6afc0d07a3184149cdefbcd32f2/manga_translator/inpainting/inpainting_lama_mpe.py
# Chép phần pre/post-process của LamaMPEInpainter._infer (nhị phân hoá mask, xoá vùng mask trước khi đưa model,
# đổi về uint8, ghép lại chỉ trong mask). Bỏ torch: dùng numpy, input [0,1] cho bản big-lama ONNX (Carve/LaMa-ONNX).
import numpy as np


def prepare(image, mask):
    """image HxWx3 uint8 RGB, mask HxW uint8 → (img NCHW float32 [0,1] đã xoá vùng mask, mask N1HW {0,1})."""
    img = image.astype(np.float32).transpose(2, 0, 1)[None] / 255.0
    m = mask.astype(np.float32)[None, None] / 255.0
    m[m < 0.5] = 0
    m[m >= 0.5] = 1
    img *= (1 - m)
    return img, m


def finalize(out, image_original, mask_original):
    """out N3HW thang 0..255 (Carve/LaMa-ONNX lama_fp32 đã nhân 255 trong graph) → HxWx3 uint8, giữ pixel ngoài mask."""
    o = out[0].transpose(1, 2, 0)
    o = np.clip(o, 0, 255).astype(np.uint8)
    m = (mask_original >= 127).astype(np.uint8)[:, :, None]
    return o * m + image_original * (1 - m)
