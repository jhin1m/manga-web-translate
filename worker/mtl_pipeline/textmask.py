"""Mask chữ mức pixel: comic-text-detector ONNX theo tile ∩ box RT-DETRv2, tinh + giãn 2–6px.

Mask chỉ phủ nét chữ đã giãn (không phải cả lòng bóng) để giữ đuôi bóng/viền. Box không có mask từ model
→ fallback threshold theo cực tính (histogram nền ở viền box).
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .detect import tile_spans
from .schema import BBox, Polarity, Region
from .textcolor import glyph_colors
from .vendor.ctd_blocks import postprocess_yolo
from .vendor.ctd_pre_post import postprocess_mask, preprocess_img
from .vendor.ctd_textmask import REFINEMASK_ANNOTATION, refine_mask

CTD_INPUT = 1024
# Box có ít hơn tỉ lệ này pixel mask model → coi như model bỏ sót, dùng fallback cực tính.
MIN_MODEL_COVERAGE = 0.01
DARK_BG_LUMA = 110


def background_luma(gray: np.ndarray) -> float:
    """Màu nền = mode histogram (bin 8) — trong box chữ, nền chiếm phần lớn diện tích; bền với viền bóng ở mép."""
    hist = np.bincount((gray // 8).ravel(), minlength=32)
    return float(int(np.argmax(hist)) * 8 + 4)


def estimate_polarity(gray: np.ndarray, text_mask: np.ndarray | None = None) -> Polarity:
    """Chữ sáng trên nền tối → light_on_dark. Có mask chữ thì so mực với nền; không có thì nhìn độ sáng nền."""
    bg = background_luma(gray)
    if text_mask is not None and text_mask.any():
        # Mask đã giãn/lấp lỗ nên lẫn nhiều pixel nền: chỉ xét pixel lệch rõ khỏi nền, đếm phía sáng vs tối.
        px = gray[text_mask > 127].astype(np.int16)
        ink = px[np.abs(px - bg) > 40]
        if len(ink):
            return "light_on_dark" if (ink > bg).mean() > 0.5 else "dark_on_light"
    return "light_on_dark" if bg < DARK_BG_LUMA else "dark_on_light"


def polarity_fallback_mask(gray: np.ndarray) -> tuple[np.ndarray, Polarity]:
    """Chỉ lấy pixel lệch về phía mực theo cực tính; Otsu tách mực (tương phản cao nhất) khỏi art/screentone;
    bỏ thành phần chạm mép cửa sổ (art tràn ra ngoài) hoặc dáng viền (dài gần hết cửa sổ mà rất thưa — nét viền bóng).

    Gọi trên cửa sổ đã nới vài px quanh box: box detector ôm sát chữ nên nét chữ không chạm mép cửa sổ."""
    bg = background_luma(gray)
    polarity: Polarity = "light_on_dark" if bg < DARK_BG_LUMA else "dark_on_light"
    g = gray.astype(np.int16)
    dev = np.clip((g - int(bg)) if polarity == "light_on_dark" else (int(bg) - g), 0, 255).astype(np.uint8)
    candidates = dev[dev > 10]
    if candidates.size == 0 or int(dev.max()) < 25:
        return np.zeros_like(gray), polarity
    otsu, _ = cv2.threshold(candidates.reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    th = ((dev > max(25.0, otsu)) * 255).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(th, connectivity=8)
    h, w = gray.shape
    out = np.zeros_like(gray)
    for i in range(1, n):
        x, y, cw, ch, area = stats[i]
        touches = x == 0 or y == 0 or x + cw >= w or y + ch >= h
        outline_like = max(cw / w, ch / h) >= 0.8 and area / max(1, cw * ch) < 0.2
        if touches or outline_like or area < 3:
            continue
        out[labels == i] = 255
    return out, polarity


def normalize_polarity(crop_rgb: np.ndarray, polarity: Polarity) -> np.ndarray:
    """Đảo màu crop chữ sáng/nền tối → chữ tối/nền sáng trước khi gửi OCR."""
    return 255 - crop_rgb if polarity == "light_on_dark" else crop_rgb


def dilation_px(bbox: BBox) -> int:
    return int(np.clip(round(min(bbox.w, bbox.h) * 0.04), 2, 6))


class CtdMasker:
    """Chạy comic-text-detector theo cùng tile với detect → bản đồ xác suất mask chữ cả page (uint8)."""

    def __init__(self, model_path: Path, threads: int = 0):
        import onnxruntime as ort

        from .models import ort_providers

        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        self.session = ort.InferenceSession(str(model_path), so, providers=ort_providers())

    def predict(self, img_rgb: np.ndarray) -> np.ndarray:
        return self.predict_with_blocks(img_rgb, None)[0]

    def predict_with_blocks(
        self, img_rgb: np.ndarray, block_thresh: float | None
    ) -> tuple[np.ndarray, list[tuple[float, float, float, float, float, bool]]]:
        """Mask cả page + (block_thresh khác None) khối chữ CTD theo toạ độ page:
        [(x1, y1, x2, y2, score, at_seam)] — at_seam: chạm mép cắt tile (để ghép với nửa ở tile kề)."""
        page_h, page_w = img_rgb.shape[:2]
        acc = np.zeros((page_h, page_w), dtype=np.float32)
        blocks: list[tuple[float, float, float, float, float, bool]] = []
        for y0, y1 in tile_spans(page_h, page_w):
            tile = img_rgb[y0:y1]
            th, tw = tile.shape[:2]
            # Giống manga-image-translator: truyền ảnh RGB, preprocess_img (cvtColor + đảo kênh) trả lại RGB.
            blob, _, dw, dh = preprocess_img(tile, input_size=(CTD_INPUT, CTD_INPUT))
            outs = dict(
                zip(
                    [o.name for o in self.session.get_outputs()],
                    self.session.run(None, {"images": blob}),
                    strict=True,
                )
            )
            seg = outs["seg"][0, 0]
            seg = seg[: seg.shape[0] - dh, : seg.shape[1] - dw]
            seg = cv2.resize(seg, (tw, th), interpolation=cv2.INTER_LINEAR)
            acc[y0:y1] = np.maximum(acc[y0:y1], seg)
            if block_thresh is not None:
                ratio = (tw / (CTD_INPUT - dw), th / (CTD_INPUT - dh))
                boxes, scores = postprocess_yolo(outs["blk"], block_thresh, resize_ratio=ratio)
                for (bx1, by1, bx2, by2), sc in zip(boxes, scores, strict=True):
                    top_cut = y0 > 0 and by1 <= 2
                    bottom_cut = y1 < page_h and by2 >= th - 2
                    blocks.append(
                        (
                            max(0.0, bx1),
                            by1 + y0,
                            min(float(page_w), bx2),
                            by2 + y0,
                            float(sc),
                            top_cut or bottom_cut,
                        )
                    )
        return postprocess_mask(acc), blocks


def _window(b: BBox, margin: int, page_w: int, page_h: int) -> tuple[int, int, int, int]:
    return max(0, b.x - margin), max(0, b.y - margin), min(page_w, b.x2 + margin), min(page_h, b.y2 + margin)


def build_text_mask(
    img_rgb: np.ndarray, pred_mask: np.ndarray, regions: list[Region], dilation: int | None = None
) -> np.ndarray:
    """Mask chữ cuối cùng (uint8 0/255) cho mọi vùng chữ; cập nhật polarity/mask_source và màu thô của chữ ở region tại chỗ.
    dilation: số px nới mask (cài đặt "Mask dilation"); None = tự động 2–6px theo cạnh ngắn của box.

    SFX chưa biết ở bước này (OCR gắn sau) — pipeline khôi phục vùng SFX sau OCR (pipeline.restore_sfx)."""
    page_h, page_w = img_rgb.shape[:2]
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    final = np.zeros((page_h, page_w), dtype=np.uint8)
    for r in regions:
        if r.kind == "bubble" or r.is_sfx:
            continue
        b = r.bbox
        d = dilation_px(b) if dilation is None else dilation
        box_pred = pred_mask[b.y : b.y2, b.x : b.x2]
        coverage = float((box_pred > 127).mean()) if box_pred.size else 0.0
        if coverage >= MIN_MODEL_COVERAGE:
            # refine_mask cần ngữ cảnh quanh box: chỉ đưa vào ROI (không cấp phát cả page mỗi vùng), lấy phần trong box.
            m = max(b.w, b.h)
            wx0, wy0, wx1, wy1 = _window(b, m, page_w, page_h)
            local_box = BBox(x=b.x - wx0, y=b.y - wy0, w=b.w, h=b.h)
            # ANNOTATION: không giãn 5×5 bên trong vendor — giãn đúng 2–6px ở dưới.
            refined = refine_mask(
                np.ascontiguousarray(img_rgb[wy0:wy1, wx0:wx1, ::-1]),
                np.ascontiguousarray(pred_mask[wy0:wy1, wx0:wx1]),
                [local_box],
                refine_mode=REFINEMASK_ANNOTATION,
            )
            local = refined[local_box.y : local_box.y2, local_box.x : local_box.x2]
            r.mask_source = "model"
            r.polarity = estimate_polarity(gray[b.y : b.y2, b.x : b.x2], local)
        else:
            # Cửa sổ nới thêm vài px: box RT-DETR ôm sát chữ, nét chữ chạm mép box không bị coi là viền bóng.
            wx0, wy0, wx1, wy1 = _window(b, d + 2, page_w, page_h)
            win_mask, r.polarity = polarity_fallback_mask(gray[wy0:wy1, wx0:wx1])
            local = win_mask[b.y - wy0 : b.y2 - wy0, b.x - wx0 : b.x2 - wx0]
            r.mask_source = "polarity_fallback" if local.any() else "none"
        if not local.any():
            continue
        r._glyph_rgb = glyph_colors(img_rgb[b.y : b.y2, b.x : b.x2], local)
        kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * d + 1, 2 * d + 1))
        # Giãn trong khung box + d để nét sát mép box vẫn phủ kín.
        x0, y0, x1, y1 = _window(b, d, page_w, page_h)
        canvas = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
        canvas[b.y - y0 : b.y - y0 + local.shape[0], b.x - x0 : b.x - x0 + local.shape[1]] = local
        final[y0:y1, x0:x1] = np.maximum(final[y0:y1, x0:x1], cv2.dilate(canvas, kern))
    return final
