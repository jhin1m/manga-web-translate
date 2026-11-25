"""Giọng văn AI đề xuất (`style_note`) khi series chưa có Giọng văn: cờ gửi LLM, parse lỏng, lô thành công gần nhất
thắng, làm sạch thành một dòng trong trần hợp đồng."""

from __future__ import annotations

import json
from typing import Any

import pytest

from mtl_pipeline.providers.base import ProviderError, parse_translate, translate_user_text
from mtl_pipeline.schema import (
    TokenUsage,
    TranslateItem,
    TranslateRequest,
    TranslateResult,
    validate_contract,
)
from mtl_pipeline.translate import SeriesSettings, translate_chapter
from mtl_worker.handlers import handle_translate
from mtl_worker.runner import JobContext
from tests.test_llm_contract import ScriptedProvider, _pages
from tests.test_translate_carry import _Deps, _job
from tests.test_worker_runner import FakeClient

USAGE = TokenUsage(provider="f", model="m", input_tokens=1)


def _run(style_note: str):
    """Provider dịch echo, trả kèm `style_note` cho trước."""

    def run(req):
        items = [
            TranslateItem(id=r.id, translation=f"vi:{r.source}", speaker="A")
            for p in req.pages
            for r in p.regions
        ]
        return TranslateResult(items=items, style_note=style_note, usage=[USAGE])

    return run


def _handle(style_note: str, style_prompt: str = "") -> tuple[dict[str, Any], ScriptedProvider]:
    job = _job(None)
    job["payload"]["settings"]["style_prompt"] = style_prompt
    prov = ScriptedProvider(tr=[_run(style_note)])
    result = handle_translate(JobContext(FakeClient(), job), _Deps(prov))
    validate_contract("job-result", result)
    return result, prov


def _units(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


# ---------- request / parse ----------


@pytest.mark.parametrize("want", [True, False])
def test_user_text_carries_want_style(want):
    req = TranslateRequest(pages=[], want_style=want)
    assert json.loads(translate_user_text(req))["want_style"] is want


def test_parse_keeps_string_style_note():
    text = json.dumps({"items": [], "context_notes": "", "style_note": "Giọng trẻ trung"})
    assert parse_translate(text, USAGE).style_note == "Giọng trẻ trung"


@pytest.mark.parametrize("bad", [None, 5, 1.5, True, {"a": 1}, ["x"]])
def test_parse_non_string_style_note_becomes_empty(bad):
    text = json.dumps({"items": [], "context_notes": "", "style_note": bad})
    assert parse_translate(text, USAGE).style_note == ""


def test_parse_missing_style_note_becomes_empty():
    assert parse_translate(json.dumps({"items": [], "context_notes": ""}), USAGE).style_note == ""


# ---------- translate_chapter ----------


def test_chapter_ignores_style_note_when_not_wanted():
    prov = ScriptedProvider(tr=[_run("Giọng A")])
    out = translate_chapter(prov, _pages(1, 1), SeriesSettings(want_style=False), "rolling")
    assert prov.tr_reqs[0].want_style is False
    assert out.style_note == ""


def test_chapter_keeps_latest_non_empty_style_note():
    prov = ScriptedProvider(tr=[_run("Giọng A"), _run("Giọng B"), _run("   ")])
    out = translate_chapter(prov, _pages(9, 1), SeriesSettings(want_style=True), "rolling")
    assert len(prov.tr_reqs) == 3 and all(r.want_style for r in prov.tr_reqs)
    assert out.style_note == "Giọng B"


def test_chapter_hard_failed_page_contributes_no_style_note():
    bad = lambda: ProviderError("schema", "bad", usage=[USAGE])  # noqa: E731
    prov = ScriptedProvider(tr=[_run("Giọng A"), bad(), bad()])
    out = translate_chapter(prov, _pages(2, 1), SeriesSettings(want_style=True), "none")
    assert out.failed == [1]
    assert out.style_note == "Giọng A"


# ---------- handle_translate ----------


def test_handler_asks_and_returns_style_note_when_series_has_none():
    result, prov = _handle("Giọng nam chính lạnh lùng, giữ tên Hàn")
    assert prov.tr_reqs[0].want_style is True
    assert result["style_note"] == "Giọng nam chính lạnh lùng, giữ tên Hàn"


def test_handler_with_style_prompt_does_not_ask_and_has_no_key():
    result, prov = _handle("Giọng A", style_prompt="  Trang trọng  ")
    assert prov.tr_reqs[0].want_style is False
    assert "Phong cách: Trang trọng" in prov.tr_reqs[0].pronoun_rules
    assert "style_note" not in result


@pytest.mark.parametrize("junk", ["", "   ", "\n\t\r", "\x00\x07\x1b", " 　 \x7f "])
def test_handler_drops_empty_or_junk_style_note(junk):
    result, _ = _handle(junk)
    assert "style_note" not in result


def test_handler_flattens_multiline_and_strips_control_chars():
    result, _ = _handle("  Giọng\r\n trẻ\t\ttrung\x00,\x1b giữ tên  \n\n riêng \x7f")
    assert result["style_note"] == "Giọng trẻ trung, giữ tên riêng"


def test_handler_cuts_style_note_without_splitting_emoji():
    result, _ = _handle("a" * 149 + "😀" + "tail")
    assert result["style_note"] == "a" * 149
    assert _units(result["style_note"]) <= 150


def test_handler_keeps_emoji_that_fits():
    result, _ = _handle("a" * 148 + "😀" + "tail")
    assert result["style_note"] == "a" * 148 + "😀"
    assert _units(result["style_note"]) == 150


def test_handler_drops_space_left_by_cut():
    result, _ = _handle("a" * 149 + " bcd")
    assert result["style_note"] == "a" * 149
