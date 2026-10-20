"""Kiểu dữ liệu dùng chung của pipeline (nguồn cho JSON schema chia sẻ với app TS ở Phase 2)."""

from __future__ import annotations

import json
import os
from functools import cache
from pathlib import Path
from typing import Any, Literal

from jsonschema import Draft202012Validator
from pydantic import BaseModel, Field

# JSON Schema sinh từ zod ở packages/shared (`pnpm schema:emit`) — nguồn duy nhất cho hợp đồng worker ↔ API.
# Triển khai tách khỏi monorepo (Modal) thì copy thư mục và trỏ MTL_SCHEMA_DIR.
DEFAULT_SCHEMA_DIR = Path(__file__).resolve().parents[2] / "packages" / "shared" / "json-schema"


class ContractError(ValueError):
    """Dữ liệu không khớp JSON Schema dùng chung (payload, inputs, result)."""


def schema_dir() -> Path:
    return Path(os.environ.get("MTL_SCHEMA_DIR", DEFAULT_SCHEMA_DIR))


@cache
def _validator(name: str) -> Draft202012Validator:
    path = schema_dir() / f"{name}.schema.json"
    if not path.is_file():
        raise ContractError(f"thiếu JSON Schema {path} (chạy pnpm schema:emit hoặc đặt MTL_SCHEMA_DIR)")
    schema = json.loads(path.read_text())
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def validate_contract(name: str, data: Any) -> None:
    """Validate `data` theo `<name>.schema.json`; sai → ContractError liệt kê tối đa 5 lỗi."""
    errors = sorted(_validator(name).iter_errors(data), key=lambda e: list(e.absolute_path))
    if errors:
        detail = "; ".join(
            f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}" for e in errors[:5]
        )
        raise ContractError(f"{name}: {detail}")


RegionKind = Literal["bubble", "text_bubble", "text_free"]
Polarity = Literal["dark_on_light", "light_on_dark"]
MaskSource = Literal["model", "polarity_fallback", "none"]
ContextMode = Literal["rolling", "neighbors", "none"]
ErrorClass = Literal["provider", "rate_limit", "schema"]


class BBox(BaseModel):
    """Hộp trục song song, toạ độ pixel nguyên trên page."""

    x: int
    y: int
    w: int
    h: int

    @property
    def x2(self) -> int:
        return self.x + self.w

    @property
    def y2(self) -> int:
        return self.y + self.h

    @property
    def xyxy(self) -> list[int]:
        # Tên thuộc tính khớp với code vendor (blk.xyxy) để truyền thẳng vào refine_mask.
        return [self.x, self.y, self.x2, self.y2]

    def area(self) -> int:
        return max(self.w, 0) * max(self.h, 0)

    def normalized(self, page_w: int, page_h: int) -> list[float]:
        return [
            round(self.x / page_w, 4),
            round(self.y / page_h, 4),
            round(self.w / page_w, 4),
            round(self.h / page_h, 4),
        ]


class Region(BaseModel):
    id: str
    kind: RegionKind
    bbox: BBox
    score: float
    # Bóng thoại chứa vùng chữ này (chỉ cho text_bubble), dùng làm vùng typeset.
    bubble_id: str | None = None
    polarity: Polarity = "dark_on_light"
    mask_source: MaskSource = "none"
    is_sfx: bool = False


class TokenUsage(BaseModel):
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0


# ---- Giai đoạn 1: OCR (chỉ chép chữ) ----


class OcrCrop(BaseModel):
    id: str
    png: bytes  # crop đã chuẩn hoá cực tính (chữ tối trên nền sáng)


class OcrRequest(BaseModel):
    page_ord: int
    crops: list[OcrCrop]


class OcrItem(BaseModel):
    id: str
    source: str = ""
    is_sfx: bool = False
    empty: bool = False
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    low_conf: bool = False


class OcrResult(BaseModel):
    items: list[OcrItem]
    usage: list[TokenUsage] = Field(default_factory=list)


# ---- Giai đoạn 2: dịch theo lô trang ----


class RegionText(BaseModel):
    id: str
    kind: RegionKind
    bbox_norm: list[float]
    source: str


class PageText(BaseModel):
    ord: int
    regions: list[RegionText]


class ContextLine(BaseModel):
    source: str
    translation: str


class RollingContext(BaseModel):
    lines: list[ContextLine] = Field(default_factory=list)
    characters: list[str] = Field(default_factory=list)
    notes: str = ""


class TranslateRequest(BaseModel):
    pages: list[PageText]
    glossary: dict[str, str] = Field(default_factory=dict)
    pronoun_rules: str = ""
    honorific_policy: str = "chuyển -nim/-ssi sang cách xưng hô tiếng Việt tự nhiên"
    context: RollingContext | None = None


class TranslateItem(BaseModel):
    id: str
    translation: str = ""
    speaker: str = "?"
    low_conf: bool = False


class TranslateResult(BaseModel):
    items: list[TranslateItem]
    context_notes: str = ""
    usage: list[TokenUsage] = Field(default_factory=list)


# ---- Typeset (hợp đồng layout, xem docs/typeset-layout-contract.md) ----


class Stroke(BaseModel):
    color: str = "#ffffff"
    width: float = 0.0  # bề rộng RA NGOÀI glyph (px)


class TextBox(BaseModel):
    id: str
    region_id: str
    x: float
    y: float
    w: float
    h: float
    rotation: float = 0.0
    font_family: str
    font_size: float
    line_height: float = 1.15
    pad: float = 4.0
    align: Literal["left", "center", "right"] = "center"
    fill: str = "#000000"
    stroke: Stroke | None = None
    text: str = ""
    lines: list[str] = Field(default_factory=list)


class PageAiState(BaseModel):
    schema_version: int = 1
    page_ord: int
    width: int
    height: int
    regions: list[Region]
    ocr: list[OcrItem] = Field(default_factory=list)
    translations: list[TranslateItem] = Field(default_factory=list)
    boxes: list[TextBox] = Field(default_factory=list)
    meta: dict[str, str] = Field(default_factory=dict)
