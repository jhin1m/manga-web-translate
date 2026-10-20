from __future__ import annotations

import json

import pytest

from mtl_pipeline.bench import (
    GtBox,
    RetryingProvider,
    cer,
    detection_rows,
    levenshtein,
    load_coco,
    match_image,
    write_blind_html,
)
from mtl_pipeline.providers.base import ProviderError
from mtl_pipeline.schema import BBox, OcrResult, Region


def test_levenshtein_and_cer_ignore_whitespace_nfc():
    assert levenshtein("abc", "abd") == 1
    assert cer([("안 녕", "안녕")]) == 0.0
    assert cer([("안냥", "안녕"), ("", "하세요")]) == pytest.approx(4 / 5)


def _gt(kind, tier, x, y, w=100, h=40, ann=1):
    return GtBox(ann, "a.png", kind, tier, BBox(x=x, y=y, w=w, h=h))


def _r(rid, kind, x, y, w=100, h=40):
    return Region(id=rid, kind=kind, bbox=BBox(x=x, y=y, w=w, h=h), score=1)


def test_match_one_to_one_by_iou():
    preds = [_r("r0", "text_bubble", 0, 0), _r("r1", "text_free", 0, 200)]
    m = match_image([_gt("text_bubble", "white", 10, 5, ann=1)], preds)
    assert m[1].id == "r0"
    assert match_image([_gt("text_bubble", "white", 0, 200, ann=1)], preds) == {}  # khác lớp
    m = match_image([_gt("text_free", "over_art", 0, 0, ann=2)], preds)
    assert m[2].id == "r0"  # text_free khớp được text_bubble
    # Một box to không được "trúng" nhiều GT (1-1).
    big = [_r("r0", "text_bubble", 0, 0, 200, 40)]
    two = [_gt("text_bubble", None, 0, 0, ann=1), _gt("text_bubble", None, 100, 0, ann=2)]
    assert len(match_image(two, big)) <= 1


def test_detection_rows_recall_tiers_and_precision():
    preds = {
        "a.png": [
            _r("r0", "text_bubble", 0, 0),
            _r("r1", "text_bubble", 0, 900),
            _r("r2", "text_free", 0, 300),
        ]
    }
    gts = [
        _gt("text_bubble", "white", 0, 0, ann=1),
        _gt("text_bubble", "inverted", 0, 500, ann=2),
        _gt("sfx", None, 0, 300, ann=3),  # khớp r2 → r2 không bị tính là box thừa
    ]
    rows = {(r["metric"], r["tier"]): r for r in detection_rows(gts, preds)}
    assert (
        rows[("recall_text_bubble", "all")]["value"] == 0.5 and rows[("recall_text_bubble", "all")]["n"] == 2
    )
    assert rows[("recall_text_bubble", "white")]["value"] == 1.0
    assert rows[("recall_text_bubble", "inverted")]["value"] == 0.0
    assert rows[("precision_text", "all")]["value"] == pytest.approx(2 / 3, abs=1e-4)


def test_load_coco_label_studio_names(tmp_path):
    coco = {
        "images": [{"id": 1, "file_name": "images/x/001.png"}],
        "categories": [{"id": 0, "name": "text_bubble:inverted"}, {"id": 1, "name": "empty"}],
        "annotations": [
            {"id": 5, "image_id": 1, "category_id": 0, "bbox": [1.4, 2.6, 10, 20]},
            {"id": 6, "image_id": 1, "category_id": 1, "bbox": [0, 0, 5, 5]},
        ],
    }
    (tmp_path / "labels.json").write_text(json.dumps(coco))
    gts = load_coco(tmp_path / "labels.json")
    assert gts[0] == GtBox(5, "001.png", "text_bubble", "inverted", BBox(x=1, y=3, w=10, h=20))
    assert gts[1].kind == "empty" and gts[1].tier is None


def test_blind_html_hides_variant_names_and_shows_each_variant_source(tmp_path):
    d = tmp_path / "pages" / "001"
    d.mkdir(parents=True)
    for prov in ("gemini", "anthropic"):
        for mode in ("rolling", "none"):
            st = {
                "ocr": [{"id": "r1", "source": f"안녕-{prov}"}],
                "translations": [{"id": "r1", "translation": f"{prov}-{mode}"}],
            }
            (d / f"state.{prov}.{mode}.json").write_text(json.dumps(st))
    write_blind_html(tmp_path / "pages", ["gemini", "anthropic"], tmp_path)
    page = (tmp_path / "blind.html").read_text()
    key = json.loads((tmp_path / "blind_key.json").read_text())
    assert "gemini.rolling" not in page and "안녕-gemini" in page and "안녕-anthropic" in page
    assert sorted(key["001/r1"].values()) == sorted(
        f"{p}.{m}" for p in ("gemini", "anthropic") for m in ("rolling", "none")
    )


class Flaky:
    name, model = "f", "m"

    def __init__(self, errors):
        self.errors = list(errors)

    def ocr_page(self, req):
        if self.errors:
            raise self.errors.pop(0)
        return OcrResult(items=[])

    def translate_batch(self, req):
        raise AssertionError


def test_retrying_provider_waits_on_rate_limit_but_not_on_permanent(monkeypatch):
    slept: list[float] = []
    monkeypatch.setattr("mtl_pipeline.bench.time.sleep", slept.append)
    p = RetryingProvider(
        Flaky([ProviderError("rate_limit", "429", retry_after=3), ProviderError("provider", "503")])
    )
    assert p.ocr_page(None).items == []  # type: ignore[arg-type]
    assert slept == [3, 4.0] and p.waited_s == 7
    p = RetryingProvider(Flaky([ProviderError("provider", "401", retryable=False)]))
    with pytest.raises(ProviderError):
        p.ocr_page(None)  # type: ignore[arg-type]
