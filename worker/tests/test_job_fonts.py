"""Font tuỳ chỉnh theo job: tải + kiểm sha256, registry id → file, fallback font mặc định, render qua file không đuôi."""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

import httpx
import numpy as np
import pytest

from mtl_pipeline.fonts import DEFAULT_FONT, FONTS_DIR, font_path, metrics_for, use_fonts
from mtl_pipeline.render import render_page_state
from mtl_worker.job_fonts import fetch_fonts, job_fonts

from .test_render_lines import shared_box

SRC = FONTS_DIR / "PatrickHand-Regular.ttf"
DATA = SRC.read_bytes()
SHA = hashlib.sha256(DATA).hexdigest()
CUSTOM = "custom-0a1b2c3d"


def entry(**kw) -> dict:
    return {"id": CUSTOM, "url": "https://files/font", "sha256": SHA, **kw}


def render(font_family: str) -> np.ndarray:
    base = np.full((90, 190, 3), 255, np.uint8)
    box = shared_box(font_family=font_family, text="Xin chào", lines=["Xin chào"])
    return render_page_state(base, {"text_boxes": [box]})


def test_registry_resolves_before_bundled_dir_and_restores(tmp_path: Path):
    f = tmp_path / "noext"  # file không đuôi
    shutil.copy(SRC, f)
    with use_fonts({CUSTOM: f}):
        assert font_path(CUSTOM) == f
        assert metrics_for(CUSTOM) == metrics_for("PatrickHand-Regular")
    assert font_path(CUSTOM) == font_path(DEFAULT_FONT)


def test_unknown_font_falls_back_to_default_dialogue_font(caplog: pytest.LogCaptureFixture):
    with caplog.at_level("WARNING"):
        assert font_path("custom-deadbeef") == font_path(DEFAULT_FONT)
    assert "custom-deadbeef" in caplog.text
    assert np.array_equal(render("custom-deadbeef"), render(DEFAULT_FONT))


def test_render_with_registered_font_matches_bundled_original(tmp_path: Path):
    f = tmp_path / SHA
    f.write_bytes(DATA)
    with use_fonts({CUSTOM: f}):
        custom = render(CUSTOM)
    assert np.array_equal(custom, render("PatrickHand-Regular"))
    assert not np.array_equal(custom, render(DEFAULT_FONT))
    # Sau job: id không còn đăng ký → fallback, không dùng lại bản cache của render trước.
    assert np.array_equal(render(CUSTOM), render(DEFAULT_FONT))


def test_fetch_downloads_once_per_sha_and_caches(tmp_path: Path):
    calls: list[str] = []

    def download(url: str) -> bytes:
        calls.append(url)
        return DATA

    first = fetch_fonts([entry()], download, tmp_path)
    second = fetch_fonts([entry(id="custom-11111111")], download, tmp_path)
    assert first == {CUSTOM: tmp_path / SHA}
    assert second == {"custom-11111111": tmp_path / SHA}
    assert calls == ["https://files/font"]
    assert (tmp_path / SHA).read_bytes() == DATA


def test_fetch_rejects_sha_mismatch_and_corrupt_font(tmp_path: Path):
    assert fetch_fonts([entry()], lambda _: DATA + b"x", tmp_path) == {}
    assert list(tmp_path.iterdir()) == []
    junk = b"not a font at all"
    bad = entry(id="custom-22222222", sha256=hashlib.sha256(junk).hexdigest())
    assert fetch_fonts([bad], lambda _: junk, tmp_path) == {}
    assert list(tmp_path.iterdir()) == []


def test_network_error_propagates_so_job_retries(tmp_path: Path):
    def boom(_: str) -> bytes:
        raise ConnectionError("down")

    with pytest.raises(ConnectionError), job_fonts([entry()], boom, tmp_path):
        pass


def http_error(status: int):
    def fail(url: str) -> bytes:
        req = httpx.Request("GET", url)
        raise httpx.HTTPStatusError("err", request=req, response=httpx.Response(status, request=req))

    return fail


@pytest.mark.parametrize("status", [403, 404])
def test_client_error_skips_font_and_falls_back(
    tmp_path: Path, status: int, caplog: pytest.LogCaptureFixture
):
    with caplog.at_level("WARNING"):
        assert fetch_fonts([entry()], http_error(status), tmp_path) == {}
    assert str(status) in caplog.text
    with job_fonts([entry()], http_error(status), tmp_path):
        assert font_path(CUSTOM) == font_path(DEFAULT_FONT)


def test_server_error_propagates_so_job_retries(tmp_path: Path):
    with pytest.raises(httpx.HTTPStatusError), job_fonts([entry()], http_error(503), tmp_path):
        pass


def test_path_like_font_family_never_resolves_outside_fonts_dir(tmp_path: Path):
    outside = tmp_path / "Outside.ttf"
    shutil.copy(SRC, outside)
    for bad in (
        str(outside.with_suffix("")),
        f"../{tmp_path.name}/Outside",
        "sub/../PatrickHand-Regular",
        "..",
        "",
    ):
        assert font_path(bad) == font_path(DEFAULT_FONT), bad
    assert font_path("PatrickHand-Regular") == FONTS_DIR / "PatrickHand-Regular.ttf"


def test_job_fonts_registers_for_duration(tmp_path: Path):
    with job_fonts([entry()], lambda _: DATA, tmp_path):
        assert font_path(CUSTOM) == tmp_path / SHA
    assert font_path(CUSTOM) == font_path(DEFAULT_FONT)
    with job_fonts(None, lambda _: DATA, tmp_path):
        pass


def test_inputs_contract_accepts_optional_fonts():
    from mtl_pipeline.schema import ContractError, validate_contract

    base = {"chapter": {"series_title": "s", "number": "1", "title": "t"}, "pages": [], "sources": []}
    validate_contract("inputs-chapter-export", base)
    validate_contract("inputs-chapter-export", {**base, "fonts": [entry()]})
    with pytest.raises(ContractError):
        validate_contract("inputs-chapter-export", {**base, "fonts": [entry(sha256="xyz")]})
