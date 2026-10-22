"""Mọi font trong manifest phải có glyph cho các ngôn ngữ đích Latin (TARGET_LANGS ở @mtl/shared)."""

from __future__ import annotations

import json

import pytest

from mtl_pipeline.fonts import FONTS_DIR, font_path, missing_glyphs, vietnamese_chars

# id (Indonesia) chỉ dùng chữ Latin cơ bản; en tương tự.
TARGET_CHARS = {
    "vi": vietnamese_chars(),
    "es": "ñÑáéíóúüÁÉÍÓÚÜ¿¡",
    "pt": "ãõâêôàçÃÕÂÊÔÀÇáéíóú",
    "fr": "àâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ«»",
    "latin": "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?…'\"-",
}

FONT_IDS = sorted(json.loads((FONTS_DIR / "manifest.json").read_text(encoding="utf-8"))["fonts"])


@pytest.mark.parametrize("font_id", FONT_IDS)
def test_font_covers_every_target_language(font_id: str):
    missing = {
        lang: "".join(missing_glyphs(font_path(font_id), chars)) for lang, chars in TARGET_CHARS.items()
    }
    assert {k: v for k, v in missing.items() if v} == {}
