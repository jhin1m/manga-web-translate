"""Kiểm font đủ dấu tiếng Việt, xuất worker/fonts/manifest.json (unitsPerEm, ascent, descent) cho editor dùng chung.

Chạy: uv run python scripts/font_glyph_check.py [--render out.png]
"""

from __future__ import annotations

import argparse
import json
import sys

from PIL import Image, ImageDraw, ImageFont

from mtl_pipeline.fonts import (
    FONTS_DIR,
    MANIFEST,
    font_langs,
    missing_glyphs,
    read_metrics,
    target_lang_chars,
    vietnamese_chars,
)
from mtl_pipeline.render import require_raqm

SAMPLE = "ếệỗửữẫ ẤẬỖỬỮẪ Đường đời"
# Thứ tự ưu tiên khi chọn font mặc định (thoại, lời dẫn, nhấn mạnh) — chỉ nhận font vẽ đủ mọi ngôn ngữ đích
# (font mặc định là font dự phòng của mọi series).
PREFERRED_DEFAULTS = ["Bangers-Regular", "BeVietnamPro-Regular", "Anton-Regular"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", help="ghi ảnh mẫu SAMPLE cho mọi font để soi mắt")
    args = ap.parse_args()
    require_raqm()

    vi = vietnamese_chars()
    fonts: dict[str, dict] = {}
    for p in sorted(FONTS_DIR.glob("*.[ot]tf")):
        m = read_metrics(p)
        miss = missing_glyphs(p, vi)
        fonts[p.stem] = {
            "file": p.name,
            "unitsPerEm": m.units_per_em,
            "ascent": m.ascent,
            "descent": m.descent,
            "metricsSource": m.source,
            "viComplete": not miss,
            "missing": miss,
            "langs": font_langs(p),
        }
        print(
            f"{'OK  ' if not miss else 'MISS'} {p.stem:24} upm={m.units_per_em} asc={m.ascent} "
            f"desc={m.descent} ({m.source}) langs={','.join(fonts[p.stem]['langs'])} missing={''.join(miss)}"
        )

    all_langs = list(target_lang_chars())
    defaults = [f for f in PREFERRED_DEFAULTS if fonts.get(f, {}).get("langs") == all_langs]
    MANIFEST.write_text(
        json.dumps({"version": 1, "defaults": defaults, "fonts": fonts}, ensure_ascii=False, indent=2) + "\n"
    )
    print(f"defaults={defaults} → {MANIFEST}")

    if args.render:
        size, line_h = 40, 64
        im = Image.new("RGB", (1100, line_h * len(fonts) + 20), "white")
        d = ImageDraw.Draw(im)
        for i, (fid, meta) in enumerate(fonts.items()):
            f = ImageFont.truetype(str(FONTS_DIR / meta["file"]), size, layout_engine=ImageFont.Layout.RAQM)
            d.text((10, 10 + i * line_h), f"{SAMPLE}  ({fid})", font=f, fill="black")
        im.save(args.render)
    return 0 if defaults else 1


if __name__ == "__main__":
    sys.exit(main())
