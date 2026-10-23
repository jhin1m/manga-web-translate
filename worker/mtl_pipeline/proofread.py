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


def _norm(s: str) -> str:
    return " ".join(unicodedata.normalize("NFC", s).split())


def validate_suggestions(regions: list[ProofreadRegion], items: list[ProofreadItem]) -> list[ProofreadItem]:
    """Giữ gợi ý đúng id (lần đầu), có nội dung và khác bản dịch hiện tại (bỏ qua khác biệt khoảng trắng/Unicode)."""
    current = {r.id: r.translation for r in regions}
    seen: set[str] = set()
    out = []
    for it in items:
        if it.id not in current or it.id in seen:
            continue
        seen.add(it.id)
        sug = _norm(it.suggestion)
        if not sug or sug == _norm(current[it.id]):
            continue
        out.append(ProofreadItem(id=it.id, suggestion=sug, reason=_norm(it.reason)[:500]))
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
