"""Sinh 20 TextBox mẫu (stroke, nhiều dòng, dấu chồng, căn lề) + bbox mực từng dòng do render.py vẽ.

Ghi out/boxes.json cho parity.spec.ts (Konva headless) so lại; out/pillow/*.png để soi mắt.
Chạy từ worker/: uv run python spikes/typeset-parity/render_boxes.py
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from mtl_pipeline.fonts import FONTS_DIR, load_manifest
from mtl_pipeline.render import layout_lines, line_ink_bboxes, render_box, require_raqm
from mtl_pipeline.schema import Stroke, TextBox

OUT = Path(__file__).resolve().parent / "out"

SAMPLES = [
    ["Xin chào!"],
    ["Sao giờ này cậu", "mới tới hả?"],
    ["ếệỗửữẫ", "ẤẬỖỬỮẪ"],
    ["Đường đời", "ngoằn ngoèo"],
    ["KHÔNG ĐƯỢC!!"],
    ["Ừ… để tớ", "nghĩ thêm", "chút đã"],
    ["Quỷ thật, ổn chứ?"],
    ["Rầm!"],
]
FONTS = ["PatrickHand-Regular", "BeVietnamPro-Regular", "Anton-Regular", "Itim-Regular", "Mali-Regular"]


def make_boxes() -> list[TextBox]:
    boxes = []
    for i in range(20):
        lines = SAMPLES[i % len(SAMPLES)]
        size = 18 + (i * 7) % 30 + (0.5 if i % 3 == 0 else 0)  # có cỡ lẻ .5
        stroke = (
            Stroke(color="#ffffff" if i % 2 else "#1a1a1a", width=[0, 1.5, 2, 3.5][i % 4]) if i % 4 else None
        )
        boxes.append(
            TextBox(
                id=f"b{i:02d}",
                region_id=f"r{i}",
                x=20 + (i % 3) * 7.25,
                y=30 + (i % 5) * 3.5,
                w=420,
                h=60 + len(lines) * size * 1.4,
                font_family=FONTS[i % len(FONTS)],
                font_size=size,
                line_height=[1.0, 1.15, 1.3][i % 3],
                pad=4 + i % 3,
                align=["center", "left", "right"][i % 3],
                fill="#111111" if i % 2 == 0 else "#fafafa",
                stroke=stroke,
                lines=lines,
            )
        )
    return boxes


def main() -> None:
    require_raqm()
    OUT.mkdir(exist_ok=True)
    (OUT / "pillow").mkdir(exist_ok=True)
    manifest = load_manifest()
    fonts = {fid: str(FONTS_DIR / manifest["fonts"][fid]["file"]) for fid in FONTS}
    records = []
    for b in make_boxes():
        lps = layout_lines(b)
        records.append(
            {
                "box": b.model_dump(),
                "metrics": {
                    k: manifest["fonts"][b.font_family][k] for k in ("unitsPerEm", "ascent", "descent")
                },
                "pillow": {
                    "lines": [{"x": lp.x, "baseline": lp.baseline, "advance": lp.advance} for lp in lps],
                    "inkBBoxes": line_ink_bboxes(b),
                },
            }
        )
        page = Image.new("RGB", (480, int(b.y + b.h + 40)), "#7f8c8d")
        render_box(page, b)
        page.save(OUT / "pillow" / f"{b.id}.png")
    (OUT / "boxes.json").write_text(
        json.dumps({"fonts": fonts, "records": records}, ensure_ascii=False, indent=2)
    )
    print(f"{len(records)} box → {OUT / 'boxes.json'}")


if __name__ == "__main__":
    main()
