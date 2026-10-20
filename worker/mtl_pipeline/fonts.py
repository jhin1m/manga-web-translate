"""Metric font theo hợp đồng layout: ascent/descent đọc từ bảng hhea/OS/2 của file font (không dùng metric trình duyệt)."""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from fontTools.ttLib import TTFont

FONTS_DIR = Path(__file__).resolve().parent.parent / "fonts"
MANIFEST = FONTS_DIR / "manifest.json"
USE_TYPO_METRICS = 1 << 7


@dataclass(frozen=True)
class FontMetrics:
    units_per_em: int
    ascent: int  # font units, dương
    descent: int  # font units, dương (độ sâu dưới baseline)
    source: str  # "OS/2.typo" | "hhea"

    def ascent_px(self, size: float) -> float:
        return self.ascent * size / self.units_per_em

    def descent_px(self, size: float) -> float:
        return self.descent * size / self.units_per_em


def read_metrics(path: Path) -> FontMetrics:
    """OS/2 có cờ USE_TYPO_METRICS → sTypoAscender/Descender; ngược lại hhea ascent/descent."""
    f = TTFont(str(path), lazy=True)
    upm = int(f["head"].unitsPerEm)
    os2 = f.get("OS/2")
    if os2 is not None and os2.fsSelection & USE_TYPO_METRICS:
        return FontMetrics(upm, int(os2.sTypoAscender), -int(os2.sTypoDescender), "OS/2.typo")
    hhea = f["hhea"]
    return FontMetrics(upm, int(hhea.ascent), -int(hhea.descent), "hhea")


def vietnamese_chars() -> str:
    """Mọi chữ cái tiếng Việt (NFC, hoa + thường) kể cả dấu chồng."""
    bases = "aăâeêioôơuưy"
    tones = ["", "̀", "́", "̃", "̉", "̣"]
    chars = {"đ", "Đ"}
    for b in bases:
        for t in tones:
            c = unicodedata.normalize("NFC", b + t)
            chars.add(c)
            chars.add(c.upper())
    return "".join(sorted(chars))


def missing_glyphs(path: Path, text: str) -> list[str]:
    cmap = TTFont(str(path), lazy=True).getBestCmap()
    return [ch for ch in dict.fromkeys(text) if ord(ch) not in cmap]


@lru_cache(maxsize=64)
def font_path(font_id: str) -> Path:
    """font_id = tên file không đuôi (vd. BeVietnamPro-Regular), khớp manifest.json."""
    for ext in (".ttf", ".otf"):
        p = FONTS_DIR / f"{font_id}{ext}"
        if p.is_file():
            return p
    raise FileNotFoundError(f"không có font {font_id} trong {FONTS_DIR}")


@lru_cache(maxsize=64)
def metrics_for(font_id: str) -> FontMetrics:
    return read_metrics(font_path(font_id))


def load_manifest() -> dict:
    return json.loads(MANIFEST.read_text())
