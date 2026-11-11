"""Gợi ý glossary/xưng hô LLM trả kèm bản dịch: parse lỏng, gom qua các lô, cắt/lọc trong result."""

from __future__ import annotations

import json
import unicodedata

import pytest

from mtl_pipeline.providers.base import (
    TRANSLATE_SCHEMA,
    OutputTokensExceeded,
    ProviderError,
    load_prompt,
    parse_translate,
)
from mtl_pipeline.providers.openai import strict_schema
from mtl_pipeline.schema import (
    NewTerm,
    PronounPair,
    TokenUsage,
    TranslateItem,
    TranslateResult,
    validate_contract,
)
from mtl_pipeline.translate import SeriesSettings, translate_chapter
from mtl_worker.handlers import handle_translate
from mtl_worker.runner import JobContext
from tests.test_llm_contract import ScriptedProvider, _pages
from tests.test_translate_carry import _Deps, _job, _tr
from tests.test_worker_runner import FakeClient

USAGE = TokenUsage(provider="f", model="m", input_tokens=1)


def _over():
    """Lô vượt guard token: lỗi schema không thử lại trong job, lô bị tách từng trang."""
    return OutputTokensExceeded("schema", "over guard", usage=[USAGE])


def _parse(**extra):
    return parse_translate(json.dumps({"items": [], "context_notes": "", **extra}), USAGE)


def _run(terms=(), pairs=()):
    """Provider dịch echo, trả kèm các gợi ý cho trước."""

    def run(req):
        items = [
            TranslateItem(id=r.id, translation=f"vi:{r.source}", speaker="A")
            for p in req.pages
            for r in p.regions
        ]
        return TranslateResult(
            items=items,
            new_terms=[NewTerm(**t) if isinstance(t, dict) else t for t in terms],
            pronoun_pairs=[PronounPair(**p) for p in pairs],
            usage=[USAGE],
        )

    return run


def _term(source, target="T", kind="term"):
    return {"source": source, "target": target, "kind": kind}


def _pair(speaker="A", listener="B", address="anh/em"):
    return {"speaker": speaker, "listener": listener, "address": address}


def _handle(terms=(), pairs=()):
    return handle_translate(
        JobContext(FakeClient(), _job(None)), _Deps(ScriptedProvider(tr=[_run(terms, pairs)]))
    )


# ---------- parse_translate ----------


def test_parse_without_learned_arrays_gives_empty_lists():
    res = parse_translate(json.dumps({"items": [], "context_notes": "n"}), USAGE)
    assert res.new_terms == [] and res.pronoun_pairs == []


@pytest.mark.parametrize("bad", [None, "chuỗi", 5, {"a": 1}])
def test_parse_non_list_learned_arrays_are_ignored(bad):
    res = _parse(new_terms=bad, pronoun_pairs=bad)
    assert res.new_terms == [] and res.pronoun_pairs == []


def test_parse_drops_broken_entries_and_keeps_good_ones():
    res = _parse(
        new_terms=[_term("Seoul", "Seoul", "place"), "rác", None, {"source": "x"}, {"target": "y"}, 3],
        pronoun_pairs=[_pair(), {"speaker": "A"}, "rác", {"speaker": "A", "listener": None, "address": "x"}],
    )
    assert [t.source for t in res.new_terms] == ["Seoul"]
    assert [p.speaker for p in res.pronoun_pairs] == ["A"]


@pytest.mark.parametrize("kind", ["weapon", None, 7])
def test_parse_unknown_kind_becomes_term(kind):
    res = _parse(new_terms=[{"source": "a", "target": "b", "kind": kind}])
    assert res.new_terms[0].kind == "term"


def test_parse_missing_kind_becomes_term():
    assert _parse(new_terms=[{"source": "a", "target": "b"}]).new_terms[0].kind == "term"


def test_parse_still_rejects_broken_items():
    with pytest.raises(ProviderError):
        parse_translate(json.dumps({"context_notes": ""}), USAGE)


# ---------- translate_chapter ----------


def test_translate_chapter_aggregates_across_batches_first_wins():
    nfd = unicodedata.normalize("NFD", "Éloïse")
    nfc = unicodedata.normalize("NFC", "Éloïse")
    b1 = _run([_term("Minjun", "Mân Chuân", "person"), _term(nfd, "first")], [_pair("A", "B", "anh/em")])
    b2 = _run(
        [_term("  MINJUN ", "khác"), _term(nfc, "second"), _term("Seoul", "Seoul", "place")],
        [_pair("a", " b", "tôi/cậu"), _pair("B", "A", "em/anh")],
    )
    out = translate_chapter(ScriptedProvider(tr=[b1, b2]), _pages(5, 1), SeriesSettings(), "rolling")
    assert [(t.source, t.target) for t in out.new_terms] == [
        ("Minjun", "Mân Chuân"),
        (nfd, "first"),
        ("Seoul", "Seoul"),
    ]
    assert [(p.speaker, p.listener, p.address) for p in out.pronoun_pairs] == [
        ("A", "B", "anh/em"),
        ("B", "A", "em/anh"),
    ]


def test_translate_chapter_collects_from_split_pages_after_schema_failure():
    prov = ScriptedProvider(
        tr=[
            _over(),
            _run([_term("P0")]),
            _run([_term("P1")], [_pair()]),
        ]
    )
    out = translate_chapter(prov, _pages(2, 1), SeriesSettings(), "rolling")
    assert [t.source for t in out.new_terms] == ["P0", "P1"]
    assert len(out.pronoun_pairs) == 1


def test_translate_chapter_hard_failed_page_contributes_nothing():
    bad = lambda: ProviderError("schema", "bad", usage=[USAGE])  # noqa: E731
    # Lô [0,1] vượt guard → tách; trang 0 ok; trang 1 hỏng 2 lần.
    prov = ScriptedProvider(tr=[_over(), _run([_term("P0")]), bad(), bad()])
    out = translate_chapter(prov, _pages(2, 1), SeriesSettings(), "rolling")
    assert out.failed == [1]
    assert [t.source for t in out.new_terms] == ["P0"]


def test_translate_chapter_uses_first_result_hints_when_retry_fails():
    # Lô lệch id → thử lại; lần 2 hỏng JSON → dùng kết quả lần 1, gồm cả gợi ý của nó.
    def short(req):
        res = _run([_term("Kept")])(req)
        res.items = res.items[:-1]
        return res

    prov = ScriptedProvider(tr=[short, ProviderError("schema", "bad", usage=[USAGE])])
    out = translate_chapter(prov, _pages(1, 2), SeriesSettings(), "rolling")
    assert [t.source for t in out.new_terms] == ["Kept"]


# ---------- handle_translate ----------


def test_handler_without_hints_has_no_learned_keys():
    result = handle_translate(JobContext(FakeClient(), _job(None)), _Deps(ScriptedProvider(tr=[_tr("n")])))
    assert "new_terms" not in result and "pronoun_pairs" not in result
    assert set(result) == {"type", "pages", "carry"}
    validate_contract("job-result", result)


def test_handler_keeps_only_non_empty_learned_key():
    result = _handle(terms=[_term("Seoul", "Seoul", "place")])
    assert result["new_terms"] == [{"source": "Seoul", "target": "Seoul", "kind": "place"}]
    assert "pronoun_pairs" not in result
    validate_contract("job-result", result)


def _units(s):
    return len(s.encode("utf-16-le")) // 2


def test_handler_cuts_and_filters_junk_hints_within_contract():
    emoji_edge = "a" * 199 + "😀"  # emoji nằm đúng mốc 200: không cắt đôi cặp surrogate
    terms = [
        _term("x" * 300, "y" * 300),
        _term(emoji_edge, "ok"),
        _term("", "empty source"),
        _term("empty target", "   "),
        _term("  Dup  ", "first"),
        _term("dup", "second"),
        *[_term(f"term{i}") for i in range(60)],
    ]
    pairs = [
        _pair("?", "B"),
        _pair("A", "?"),
        _pair("？", "B"),
        _pair("A", "？"),
        _pair("Same", " same "),
        _pair("A", "B", ""),
        _pair("A" * 100, "B" * 100, "z" * 200),
        _pair("Minjun", "Sora", "anh/em"),
        _pair("minjun", "SORA", "dup"),
        *[_pair(f"S{i}", f"L{i}") for i in range(40)],
    ]
    result = _handle(terms, pairs)
    validate_contract("job-result", result)
    out_terms, out_pairs = result["new_terms"], result["pronoun_pairs"]
    assert len(out_terms) == 50 and len(out_pairs) == 30
    for t in out_terms:
        assert t["source"] and t["target"]
        assert _units(t["source"]) <= 200 and _units(t["target"]) <= 200
    assert out_terms[0]["source"] == "x" * 200 and out_terms[0]["target"] == "y" * 200
    assert out_terms[1]["source"] == "a" * 199  # emoji không vừa nửa nên bị bỏ cả
    dup = [t for t in out_terms if t["source"].casefold() == "dup"]
    assert dup == [{"source": "Dup", "target": "first", "kind": "term"}]
    for p in out_pairs:
        assert p["speaker"] and p["listener"] and p["address"]
        assert not ({p["speaker"], p["listener"]} & {"?", "？"})
        assert _units(p["speaker"]) <= 80 and _units(p["listener"]) <= 80 and _units(p["address"]) <= 120
        assert p["speaker"].casefold() != p["listener"].casefold()
    assert out_pairs[0] == {"speaker": "A" * 80, "listener": "B" * 80, "address": "z" * 120}
    assert [p for p in out_pairs if p["speaker"].casefold() == "minjun"] == [
        {"speaker": "Minjun", "listener": "Sora", "address": "anh/em"}
    ]


def test_handler_dedups_again_after_cutting():
    terms = [_term("k" * 200 + "1", "first"), _term("k" * 200 + "2", "second")]
    result = _handle(terms)
    assert result["new_terms"] == [{"source": "k" * 200, "target": "first", "kind": "term"}]


def test_handler_drops_trailing_space_left_by_cut_and_lone_surrogates():
    lone = json.loads('"ab\\ud83d"')
    result = _handle([_term("a" * 199 + " b", "t"), _term(lone, "t2")])
    assert [t["source"] for t in result["new_terms"]] == ["a" * 199, "ab"]
    validate_contract("job-result", result)


# ---------- schema / prompt ----------


def test_strict_schema_has_four_required_top_level_properties():
    out = strict_schema(TRANSLATE_SCHEMA)
    assert out["required"] == ["items", "context_notes", "new_terms", "pronoun_pairs"]
    for key in ("new_terms", "pronoun_pairs"):
        node = out["properties"][key]["items"]
        assert node["required"] == list(node["properties"]) and node["additionalProperties"] is False


def test_prompt_mentions_learned_fields():
    prompt = load_prompt("translate_batch")
    assert "new_terms" in prompt and "pronoun_pairs" in prompt
