"""Font gói sẵn: mọi font vẽ đủ vi/en/id; `langs` trong manifest đúng với glyph thật (editor lọc font theo ngôn ngữ
đích của series bằng `langs`); font mặc định — font dự phòng của mọi series — vẽ đủ mọi ngôn ngữ đích."""

from __future__ import annotations

import json

import pytest

from mtl_pipeline.fonts import FONTS_DIR, font_langs, font_path, target_lang_chars, vietnamese_chars

MANIFEST = json.loads((FONTS_DIR / "manifest.json").read_text(encoding="utf-8"))
FONT_IDS = sorted(MANIFEST["fonts"])
ALL_LANGS = list(target_lang_chars())
# Mọi font gói sẵn phải dùng được cho tiếng Việt và các ngôn ngữ chỉ cần Latin cơ bản.
REQUIRED_LANGS = ["vi", "en", "id"]


def test_target_langs_match_shared():
    """Cùng danh sách và thứ tự với TARGET_LANGS ở packages/shared/src/series-lang.ts."""
    src = (FONTS_DIR.parent.parent / "packages/shared/src/series-lang.ts").read_text(encoding="utf-8")
    line = next(ln for ln in src.splitlines() if ln.startswith("export const TARGET_LANGS"))
    assert line.split("[", 1)[1].split("]", 1)[0].replace('"', "").replace(" ", "").split(",") == ALL_LANGS


@pytest.mark.parametrize("font_id", FONT_IDS)
def test_font_langs_match_glyphs(font_id: str):
    langs = font_langs(font_path(font_id))
    assert MANIFEST["fonts"][font_id]["langs"] == langs
    assert set(REQUIRED_LANGS) <= set(langs)


def test_default_fonts_cover_every_target_language():
    assert MANIFEST["defaults"]
    for font_id in MANIFEST["defaults"]:
        assert MANIFEST["fonts"][font_id]["langs"] == ALL_LANGS


def test_vietnamese_chars_match_shared_golden_list():
    """Danh sách chữ Việt dùng chung với API (packages/shared vietnameseChars) — cùng file vàng."""
    golden = (FONTS_DIR / "vietnamese-chars.txt").read_text(encoding="utf-8").strip()
    assert vietnamese_chars() == golden
