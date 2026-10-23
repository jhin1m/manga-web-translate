"""Metric font theo hợp đồng layout: ascent/descent đọc từ bảng hhea/OS/2 của file font (không dùng metric trình duyệt)."""

from __future__ import annotations

import json
import logging
import unicodedata
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from fontTools.ttLib import TTFont

log = logging.getLogger(__name__)

FONTS_DIR = Path(__file__).resolve().parent.parent / "fonts"
MANIFEST = FONTS_DIR / "manifest.json"
USE_TYPO_METRICS = 1 << 7
# Font thoại mặc định khi series chưa chọn (khớp manifest.defaults[0] và DEFAULT_DIALOGUE_FONT bên API).
DEFAULT_FONT = "Bangers-Regular"


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


# Font tuỳ chỉnh của job đang chạy (id → file, không đuôi — Pillow/fontTools đọc theo nội dung). Worker chạy tuần tự
# từng job nên một registry toàn cục là đủ; `use_fonts` luôn trả về trạng thái cũ.
_registered: dict[str, Path] = {}
_warned: set[str] = set()


@contextmanager
def use_fonts(paths: Mapping[str, Path]) -> Iterator[None]:
    """Đăng ký id → file cho đến hết khối; id đã đăng ký tra trước FONTS_DIR."""
    global _registered
    prev = _registered
    _registered = {**prev, **paths}
    try:
        yield
    finally:
        _registered = prev


@lru_cache(maxsize=64)
def _bundled_path(font_id: str) -> Path | None:
    # font_id đến từ dữ liệu người dùng (TextBox.font_family): chỉ nhận tên phẳng, không thoát khỏi FONTS_DIR.
    if not font_id or font_id != Path(font_id).name or font_id in (".", ".."):
        return None
    for ext in (".ttf", ".otf"):
        p = FONTS_DIR / f"{font_id}{ext}"
        if p.is_file():
            return p
    return None


def font_path(font_id: str) -> Path:
    """font_id = font tuỳ chỉnh đã đăng ký cho job, hoặc tên file không đuôi trong FONTS_DIR (vd. BeVietnamPro-Regular,
    khớp manifest.json; id có dấu phân cách đường dẫn bị từ chối). Id không biết (vd. font tuỳ chỉnh đã bị xoá) → font thoại mặc định, không làm hỏng job."""
    p = _registered.get(font_id) or _bundled_path(font_id)
    if p is not None:
        return p
    if font_id not in _warned:
        _warned.add(font_id)
        log.warning("không có font %s → dùng %s", font_id, DEFAULT_FONT)
    fallback = _bundled_path(DEFAULT_FONT)
    if fallback is None:
        raise FileNotFoundError(f"không có font {DEFAULT_FONT} trong {FONTS_DIR}")
    return fallback


@lru_cache(maxsize=64)
def _metrics_of(path: Path) -> FontMetrics:
    return read_metrics(path)


def metrics_for(font_id: str) -> FontMetrics:
    return _metrics_of(font_path(font_id))


def load_manifest() -> dict:
    return json.loads(MANIFEST.read_text())
