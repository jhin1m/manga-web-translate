"""OCR chạy local (không LLM, không token): MangaOCR (tiếng Nhật) và PaddleOCR (ko/zh/ja/en), đều ONNX.

`ocr_page_local` cho ra đúng `OcrResult`/`OcrItem` như OCR LLM (`ocr.ocr_page`) để phần sau (dịch, editor, OCR lại
vùng tự vẽ) không đổi: cùng `text_regions` + thứ tự id, crop có mực < MIN_INK_RATIO → empty (không đọc), chữ đọc
được với độ tin thấp hoặc crop có mực mà đọc ra rỗng → `low_conf` (người sửa phải thấy). OCR local không nhận SFX
(`is_sfx` luôn false). usage = [] → không vào ledger/ngân sách.
"""

from __future__ import annotations

from typing import Protocol

import numpy as np

from ..ocr import MIN_INK_RATIO, ink_ratio, make_crop, text_regions
from ..schema import OcrItem, OcrResult, Region

# Dưới ngưỡng này (trung bình xác suất token / ký tự) → low_conf.
LOW_CONF = 0.5


class LocalOcrEngine(Protocol):
    name: str

    def read(self, crop_rgb: np.ndarray) -> tuple[str, float]:
        """Crop RGB chữ tối / nền sáng (đã chuẩn hoá cực tính) → (chữ, độ tin 0..1)."""
        ...


def ocr_page_local(engine: LocalOcrEngine, img: np.ndarray, regions: list[Region]) -> OcrResult:
    items: list[OcrItem] = []
    for r in text_regions(regions):
        crop = make_crop(img, r)
        if ink_ratio(crop) < MIN_INK_RATIO:
            items.append(OcrItem(id=r.id, empty=True, confidence=1.0))
            continue
        text, conf = engine.read(crop)
        text = text.strip()
        items.append(
            OcrItem(
                id=r.id, source=text, confidence=round(float(conf), 4), low_conf=not text or conf < LOW_CONF
            )
        )
    return OcrResult(items=items)
