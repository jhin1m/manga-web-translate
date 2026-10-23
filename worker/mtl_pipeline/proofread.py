"""AI hiệu đính: mỗi trang 1 call LLM (bản dịch hiện tại + glossary + quy tắc xưng hô + ảnh trang gốc) → gợi ý sửa
theo khối. Chỉ gợi ý — không ghi đè bản dịch. Chặn gợi ý id lạ / trùng id / rỗng / trùng bản hiện tại."""

from __future__ import annotations

import unicodedata

import cv2
import numpy as np

from .providers.base import ProofreadProvider, ProviderError
from .schema import ProofreadItem, ProofreadRegion, ProofreadRequest, ProofreadResult, TokenUsage

IMAGE_WIDTH = 640
CHUNK_HEIGHT = 1280
MAX_CHUNKS = 6
JPEG_QUALITY = 80


def page_images(img_rgb: np.ndarray) -> list[bytes]:
    """Ảnh trang gốc thu về rộng 640 rồi cắt khúc cao ≤ 1280 (strip dài không bị nén thành dải mảnh), tối đa 6 khúc
    (dài hơn thì khúc to hơn), JPEG 80 để đỡ token."""
    h, w = img_rgb.shape[:2]
    scale = min(1.0, IMAGE_WIDTH / w)
    small = cv2.resize(
        img_rgb, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA
    )
    sh = small.shape[0]
    n = min(MAX_CHUNKS, max(1, -(-sh // CHUNK_HEIGHT)))
    step = -(-sh // n)
    out = []
    for y in range(0, sh, step):
        ok, buf = cv2.imencode(
            ".jpg",
            cv2.cvtColor(small[y : y + step], cv2.COLOR_RGB2BGR),
            [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY],
        )
        if ok:
            out.append(buf.tobytes())
    return out


# Trần theo hợp đồng kết quả (packages/shared ProofreadSuggestionOut; zod đếm UTF-16 → cắt lý do dư an toàn).
MAX_TEXT = 4000
MAX_REASON = 240


def norm_text(s: str) -> str:
    """So sánh bản dịch: NFC, gộp khoảng trắng trong dòng, bỏ trắng đầu/cuối mỗi dòng — GIỮ xuống dòng tay (`\n`
    là ngắt dòng cứng của typeset), khớp `sameText` ở API và proofread-model.ts ở web."""
    lines = unicodedata.normalize("NFC", s).replace("\r\n", "\n").split("\n")
    return "\n".join(" ".join(ln.split()) for ln in lines).strip()


def validate_suggestions(regions: list[ProofreadRegion], items: list[ProofreadItem]) -> list[ProofreadItem]:
    """Giữ gợi ý đúng id (lần đầu), có nội dung và khác bản dịch hiện tại (bỏ qua khác biệt khoảng trắng/Unicode,
    không bỏ qua xuống dòng). Bản dịch / gợi ý quá trần hợp đồng → bỏ (không để cả kết quả bị từ chối)."""
    current = {r.id: r.translation for r in regions}
    seen: set[str] = set()
    out = []
    for it in items:
        if it.id not in current or it.id in seen:
            continue
        seen.add(it.id)
        sug = norm_text(it.suggestion)
        if not sug or sug == norm_text(current[it.id]):
            continue
        if len(sug) > MAX_TEXT or len(current[it.id]) > MAX_TEXT:
            continue
        out.append(ProofreadItem(id=it.id, suggestion=sug, reason=" ".join(it.reason.split())[:MAX_REASON]))
    return out


def proofread_page(provider: ProofreadProvider, req: ProofreadRequest) -> ProofreadResult:
    """1 call; JSON sai → thử lại 1 lần trong job (như OCR/dịch), lỗi khác để hàng đợi xử lý. Token của lần hỏng
    vẫn vào usage."""
    usage: list[TokenUsage] = []
    for attempt in range(2):
        try:
            res = provider.proofread_page(req)
        except ProviderError as e:
            usage.extend(e.usage)
            if e.error_class == "schema" and attempt == 0 and e.retry_in_job:
                continue
            e.usage = usage
            raise
        usage.extend(res.usage)
        return ProofreadResult(items=validate_suggestions(req.regions, res.items), usage=usage)
    raise AssertionError("unreachable")  # pragma: no cover
