"""Giai đoạn 1 — OCR theo trang qua LLM vision (chỉ chép chữ). Gọi cuối cùng, sau khi đã lưu artifact."""

from __future__ import annotations

import cv2
import numpy as np

from .images import encode_png
from .providers.base import LLMProvider, ProviderError
from .schema import OcrCrop, OcrItem, OcrRequest, OcrResult, Region, TokenUsage
from .textmask import normalize_polarity

# Crop có ít hơn tỉ lệ pixel "mực" này → không gửi LLM, đánh empty luôn (chống bịa).
MIN_INK_RATIO = 0.004
CROP_PAD = 4
MAX_CROP_SIDE = 768


def ink_ratio(crop_rgb: np.ndarray) -> float:
    """Tỉ lệ pixel lệch rõ khỏi màu nền (trung vị) — xấp xỉ mật độ nét chữ."""
    gray = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2GRAY)
    bg = float(np.median(gray))
    return float((np.abs(gray.astype(np.int16) - bg) > 60).mean())


def text_regions(regions: list[Region]) -> list[Region]:
    return [r for r in regions if r.kind in ("text_bubble", "text_free")]


def make_crop(img: np.ndarray, r: Region) -> np.ndarray:
    h, w = img.shape[:2]
    b = r.bbox
    x0, y0 = max(0, b.x - CROP_PAD), max(0, b.y - CROP_PAD)
    x1, y1 = min(w, b.x2 + CROP_PAD), min(h, b.y2 + CROP_PAD)
    crop = normalize_polarity(img[y0:y1, x0:x1], r.polarity)
    side = max(crop.shape[:2])
    if side > MAX_CROP_SIDE:
        s = MAX_CROP_SIDE / side
        crop = cv2.resize(
            crop,
            (max(1, round(crop.shape[1] * s)), max(1, round(crop.shape[0] * s))),
            interpolation=cv2.INTER_AREA,
        )
    return crop


def validate_ids(expected: list[str], items: list[OcrItem]) -> tuple[list[OcrItem], bool]:
    """Giữ item đúng id (lần đầu), id thiếu → source rỗng + low_conf (KHÔNG empty: crop có mực, chữ sẽ bị xoá,
    người sửa phải thấy); trả (items theo thứ tự expected, đủ_id)."""
    by_id: dict[str, OcrItem] = {}
    for it in items:
        if it.id in expected and it.id not in by_id:
            by_id[it.id] = it
    ok = len(by_id) == len(expected) and len(items) == len(expected)
    out = [by_id.get(i) or OcrItem(id=i, low_conf=True) for i in expected]
    return out, ok


def ocr_page(provider: LLMProvider, img: np.ndarray, regions: list[Region], page_ord: int) -> OcrResult:
    """Chép chữ mọi vùng chữ của trang trong 1 call; thiếu/thừa id → retry 1 lần rồi đánh low_conf."""
    local_empty: list[OcrItem] = []
    crops: list[OcrCrop] = []
    for r in text_regions(regions):
        crop = make_crop(img, r)
        if ink_ratio(crop) < MIN_INK_RATIO:
            local_empty.append(OcrItem(id=r.id, empty=True, confidence=1.0))
            continue
        crops.append(OcrCrop(id=r.id, png=encode_png(crop)))
    if not crops:
        return OcrResult(items=local_empty)

    req = OcrRequest(page_ord=page_ord, crops=crops)
    expected = [c.id for c in crops]
    usage: list[TokenUsage] = []
    items: list[OcrItem] | None = None  # kết quả lệch id gần nhất
    ok = False
    for attempt in range(2):
        try:
            res = provider.ocr_page(req)
        except ProviderError as e:
            usage.extend(e.usage)
            # Lỗi schema thử lại 1 lần trong cùng job; rate_limit/provider để hàng đợi (Phase 3) xử lý.
            if e.error_class == "schema" and attempt == 0:
                continue
            if e.error_class == "schema" and items is not None:
                break  # lần 2 hỏng JSON → dùng kết quả lệch id của lần 1
            e.usage = usage  # token đã trả tiền của các lần trước vẫn phải vào ledger
            raise
        usage.extend(res.usage)
        items, ok = validate_ids(expected, res.items)
        if ok:
            break
    assert items is not None
    if not ok:
        # Hết lượt retry mà id vẫn lệch → cả trang đánh low_conf để người sửa soát lại.
        items = [it.model_copy(update={"low_conf": True}) for it in items]

    by_region = {r.id: r for r in regions}
    for it in items:
        by_region[it.id].is_sfx = it.is_sfx
    merged = {it.id: it for it in local_empty + items}
    order = [r.id for r in text_regions(regions)]
    return OcrResult(items=[merged[i] for i in order if i in merged], usage=usage)
