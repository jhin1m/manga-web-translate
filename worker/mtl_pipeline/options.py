"""Cài đặt pipeline của người dùng snapshot trong payload job (packages/shared/src/pipeline-settings.ts).

Payload thiếu (job xếp hàng trước 0.6.0) hoặc thiếu field → mặc định = hành vi trước khi có cài đặt."""

from __future__ import annotations

from dataclasses import dataclass, fields
from typing import Any

from .detect import DEFAULT_SCORE_THRESH
from .inpaint import LAMA_SIZE

DETECTORS = ("rtdetr_v2_comic", "comic_text_detector")
OCR_ENGINES = ("llm", "manga_ocr", "paddle_ocr")
LOCAL_OCR_ENGINES = ("manga_ocr", "paddle_ocr")
INPAINTERS = ("big_lama", "lama_manga")


@dataclass(frozen=True)
class PrepareOptions:
    detector: str = "rtdetr_v2_comic"
    detection_threshold: float = DEFAULT_SCORE_THRESH
    ocr_engine: str = "llm"
    inpainter: str = "big_lama"
    #: None = tự động (2–6px theo box).
    mask_dilation: int | None = None
    inpaint_size: int = LAMA_SIZE

    @classmethod
    def from_payload(cls, raw: dict[str, Any] | None) -> PrepareOptions:
        """Payload đã qua JSON Schema (giá trị hợp lệ); chỉ lấy field biết, thiếu → mặc định."""
        if not raw:
            return cls()
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in raw.items() if k in known})


@dataclass(frozen=True)
class InpaintOptions:
    inpainter: str = "big_lama"
    inpaint_size: int = LAMA_SIZE

    @classmethod
    def from_payload(cls, raw: dict[str, Any] | None) -> InpaintOptions:
        if not raw:
            return cls()
        return cls(
            inpainter=raw.get("inpainter", "big_lama"), inpaint_size=raw.get("inpaint_size", LAMA_SIZE)
        )
