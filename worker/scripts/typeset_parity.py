"""bbox mực từng dòng do render.py vẽ — số đo "đúng" của gate parity Konva ↔ Pillow.

Vào: JSON {"pages": [{"id": str, "boxes": [TextBox...]}]} từ đường dẫn (argv[1]) hoặc stdin.
Ra (stdout): JSON {"pages": [{"id", "boxes": [{"id", "lines": [{"x","baseline","advance"}], "ink": [[x0,y0,x1,y1]|null]}]}]}.
Chạy từ gốc repo: uv run --project worker python worker/scripts/typeset_parity.py [input.json]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from mtl_pipeline.render import ensure_lines, layout_lines, line_ink_bboxes, require_raqm
from mtl_pipeline.schema import TextBox


def measure(boxes: list[dict]) -> list[dict]:
    out = []
    for raw in boxes:
        # Trường thừa của page_state web (hidden, auto_fit…) bị bỏ qua.
        box = TextBox.model_validate({**raw, "region_id": raw.get("region_id") or raw["id"]})
        wrap = not box.lines and box.text.strip() != ""
        # Box thiếu lines: ngắt như export (ensure_lines ≡ layoutBox của editor) rồi mới đo.
        box = ensure_lines(box, auto_fit=bool(raw.get("auto_fit", True)))
        out.append(
            {
                "id": box.id,
                **({"wrapped": {"lines": box.lines, "font_size": box.font_size}} if wrap else {}),
                "lines": [
                    {"x": lp.x, "baseline": lp.baseline, "advance": lp.advance} for lp in layout_lines(box)
                ],
                "ink": [list(b) if b else None for b in line_ink_bboxes(box)],
            }
        )
    return out


def main() -> None:
    require_raqm()
    src = Path(sys.argv[1]).read_text() if len(sys.argv) > 1 else sys.stdin.read()
    data = json.loads(src)
    result = {"pages": [{"id": p["id"], "boxes": measure(p["boxes"])} for p in data["pages"]]}
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
