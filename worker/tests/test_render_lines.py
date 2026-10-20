"""Render PageState → ảnh (golden có dung sai) và ensure_lines khớp layoutBox của editor (measure.ts)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from mtl_pipeline.render import ensure_lines, line_advance, render_page_state, text_box_from_shared
from mtl_pipeline.schema import TextBox
from mtl_pipeline.typeset import MAX_SIZE, MIN_SIZE, block_height, fit_text

FONT = "PatrickHand-Regular"
GOLDEN = (
    Path(__file__).parent / "reference" / "render_lines.png"
)  # không đặt tên golden/: .gitignore gốc loại thư mục đó
# Dung sai: lệch ≤ 2 mức xám trên ≤ 0.5% pixel (khác biệt nhỏ giữa bản FreeType/raqm).
MAX_LEVEL_DIFF, MAX_BAD_FRACTION = 2, 0.005


def shared_box(**kw) -> dict:
    base: dict[str, Any] = {
        "id": "b",
        "region_id": None,
        "x": 10.0,
        "y": 10.0,
        "w": 160.0,
        "h": 60.0,
        "rotation": 0,
        "text": "",
        "lines": [],
        "font_family": FONT,
        "font_size": 20.0,
        "line_height": 1.15,
        "pad": 4.0,
        "letter_spacing": 0,
        "align": "center",
        "fill": "#000000",
        "stroke": None,
        "auto_fit": False,
        "hidden": False,
    }
    return {**base, **kw}


def golden_state() -> dict:
    boxes = [
        shared_box(id="multi", lines=["Hai dòng chữ", "xuống dòng nữa"], align="left"),
        shared_box(
            id="accents",
            y=80.0,
            lines=["Ếệỗửữẫ Ốồổỗộ", "Ưỡờởợ Ằẳẵặ"],
            align="right",
            fill="#202020",
        ),
        shared_box(
            id="stroke",
            x=190.0,
            lines=["Viền trắng"],
            fill="#cc0000",
            stroke={"color": "#ffffff", "width": 3},
            font_size=26.0,
        ),
        shared_box(id="rot", x=190.0, y=90.0, w=150.0, h=50.0, lines=["Xoay 20°"], rotation=20),
        # Thiếu lines → ensure_lines ngắt dòng khi vẽ.
        shared_box(
            id="nolines",
            y=160.0,
            w=200.0,
            h=80.0,
            text="Tớ đợi cậu mãi đấy, sao giờ này mới tới?",
            auto_fit=True,
        ),
        shared_box(id="hid", x=230.0, y=170.0, lines=["ẨN"], hidden=True),
    ]
    return {
        "schema_version": 1,
        "size": {"w": 360, "h": 260},
        "view": {"show_original": False},
        "regions": [],
        "text_boxes": boxes,
        "meta": None,
    }


def render_golden_page() -> np.ndarray:
    base = np.full((260, 360, 3), 235, np.uint8)
    return render_page_state(base, golden_state())


def test_render_matches_golden_within_tolerance():
    out = render_golden_page()
    if os.environ.get("UPDATE_GOLDEN"):  # UPDATE_GOLDEN=1 để sinh lại ảnh tham chiếu
        GOLDEN.parent.mkdir(exist_ok=True)
        Image.fromarray(out).save(GOLDEN)
    ref = np.asarray(Image.open(GOLDEN).convert("RGB"))
    assert ref.shape == out.shape
    diff = np.abs(ref.astype(int) - out.astype(int)).max(axis=2)
    assert (diff > MAX_LEVEL_DIFF).mean() <= MAX_BAD_FRACTION
    # Có chữ thật được vẽ (không phải ảnh nền trơn).
    assert (out != 235).any()


def test_hidden_box_not_drawn():
    base = np.full((60, 200, 3), 255, np.uint8)
    state = {"text_boxes": [shared_box(lines=["ẨN"], hidden=True)]}
    assert (render_page_state(base, state) == 255).all()
    assert (render_page_state(base, None) == 255).all()


def tb(**kw) -> TextBox:
    return (
        text_box_from_shared(shared_box(**kw))
        if "lines" in kw
        else TextBox(
            **{
                **{
                    "id": "b",
                    "region_id": "",
                    "x": 0,
                    "y": 0,
                    "w": 200,
                    "h": 100,
                    "font_family": FONT,
                    "font_size": 20,
                },
                **kw,
            }
        )
    )


def test_region_id_null_becomes_empty():
    assert text_box_from_shared(shared_box(lines=["a"])).region_id == ""


def test_ensure_lines_keeps_existing_and_blank():
    assert ensure_lines(tb(text="abc", lines=["x"])).lines == ["x"]
    assert ensure_lines(tb(text="  \n ")).lines == []


def test_ensure_lines_paragraph_newline():
    box = ensure_lines(tb(text="một\nhai\n\nba"), auto_fit=False)
    # `\n` = đoạn mới; đoạn rỗng không sinh dòng (như wrapParagraph của measure.ts).
    assert box.lines == ["một", "hai", "ba"]
    assert box.font_size == 20


def test_ensure_lines_auto_fit_matches_fit_text_and_is_maximal():
    text = "Tớ đợi cậu mãi đấy, sao giờ này mới tới? Mau lên!"
    box = ensure_lines(tb(text=text, w=220, h=140), auto_fit=True)
    size, lines = fit_text(text, FONT, 220, 140)
    assert (box.font_size, box.lines) == (size, lines)
    inner_h = 140 - 8
    assert block_height(FONT, box.font_size, len(box.lines)) <= inner_h
    assert MIN_SIZE <= box.font_size <= MAX_SIZE


def test_ensure_lines_auto_fit_with_paragraphs_fits_box():
    box = ensure_lines(tb(text="Xin chào các bạn\nTạm biệt nhé", w=300, h=120), auto_fit=True)
    assert len(box.lines) >= 2
    assert all(line_advance(FONT, box.font_size, ln) <= 300 - 8 for ln in box.lines)
    assert block_height(FONT, box.font_size, len(box.lines)) <= 120 - 8


def test_ensure_lines_no_auto_fit_wraps_by_width_keeping_size():
    box = ensure_lines(tb(text="alpha beta gamma delta epsilon zeta", w=120, h=20), auto_fit=False)
    assert box.font_size == 20
    assert len(box.lines) > 1
    assert all(line_advance(FONT, 20, ln) <= 120 - 8 for ln in box.lines)
    assert " ".join(box.lines) == "alpha beta gamma delta epsilon zeta"


def test_ensure_lines_hard_wrap_for_overlong_word():
    word = "Pneumonoultramicroscopicsilicovolcanoconiosis"
    box = ensure_lines(tb(text=word, w=90, h=300), auto_fit=False)
    assert len(box.lines) > 1
    assert "".join(box.lines) == word
    assert all(line_advance(FONT, 20, ln) <= 90 - 8 for ln in box.lines)
    # auto_fit: không cỡ nào vừa → MIN_SIZE + cắt cứng.
    fit = ensure_lines(tb(text=word, w=40, h=40), auto_fit=True)
    assert fit.font_size == MIN_SIZE
    assert "".join(fit.lines) == word
