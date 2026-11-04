"""Redact khoá trong log worker: pattern, khoá đăng ký, traceback, và mức log của SDK/HTTP."""

from __future__ import annotations

import io
import logging

import pytest

from mtl_worker.log_redact import (
    QUIET_LOGGERS,
    REDACTED,
    RedactingFormatter,
    clear_secrets,
    configure_logging,
    redact,
    register_secret,
)


@pytest.fixture(autouse=True)
def _reset():
    clear_secrets()
    root = logging.getLogger()
    saved = (root.handlers[:], root.level)
    names = (*QUIET_LOGGERS, "mtl_worker", "mtl_pipeline")
    levels = {n: logging.getLogger(n).level for n in names}
    yield
    clear_secrets()
    root.handlers[:], root.level = saved[0], saved[1]
    for n, lv in levels.items():
        logging.getLogger(n).setLevel(lv)


def _logger(name: str) -> tuple[logging.Logger, io.StringIO]:
    buf = io.StringIO()
    h = logging.StreamHandler(buf)
    h.setFormatter(RedactingFormatter("%(levelname)s %(message)s"))
    lg = logging.getLogger(name)
    lg.handlers[:] = [h]
    lg.propagate = False
    lg.setLevel(logging.INFO)
    return lg, buf


@pytest.mark.parametrize(
    "secret",
    [
        "sk-proj-abcdef1234567890XYZ",
        "sk-ant-api03-abcdef123456",
        "sk-or-v1-abcdef123456",
        "AIzaSyA1234567890abcdefghijk",
        "Bearer abcdef1234567890",
    ],
)
def test_key_like_strings_are_redacted(secret):
    out = redact(f"request failed: {secret} end")
    assert secret not in out and "[redacted]" in out


def test_plain_text_is_untouched():
    assert redact("job sk-short ok, task-manager-2") == "job sk-short ok, task-manager-2"


def test_traceback_of_log_exception_is_redacted():
    lg, buf = _logger("redact.tb")
    try:
        raise RuntimeError("bad key sk-ant-api03-abcdef123456 and AIzaSyA1234567890abcdefghijk")
    except RuntimeError:
        lg.exception("job lỗi")
    text = buf.getvalue()
    assert "Traceback" in text and "RuntimeError" in text
    assert "sk-ant" not in text and "AIza" not in text


def test_registered_secret_is_replaced_until_cleared():
    lg, buf = _logger("redact.reg")
    register_secret("custom-key-no-prefix")
    lg.info("using custom-key-no-prefix now")
    assert "custom-key-no-prefix" not in buf.getvalue()
    clear_secrets()
    lg.info("using custom-key-no-prefix now")
    assert "custom-key-no-prefix" in buf.getvalue()


def test_verbose_keeps_sdk_and_http_loggers_at_warning():
    configure_logging(verbose=True)
    # Danh sách cứng (không lặp lại hằng số) để bắt thiếu tên logger HTTP mà SDK thật dùng.
    for name in ("anthropic", "google_genai", "openai", "httpx", "httpcore", "httpx2", "httpcore2"):
        assert logging.getLogger(name).getEffectiveLevel() == logging.WARNING
    assert logging.getLogger("mtl_worker").getEffectiveLevel() == logging.DEBUG
    assert logging.getLogger("mtl_pipeline.providers").getEffectiveLevel() == logging.DEBUG
    assert logging.getLogger().level == logging.INFO


def test_non_verbose_leaves_worker_loggers_at_info():
    configure_logging(verbose=False)
    logging.getLogger("mtl_worker").setLevel(logging.NOTSET)
    assert logging.getLogger("mtl_worker").getEffectiveLevel() == logging.INFO


def test_prefix_inside_word_is_not_redacted():
    assert redact("mask-0123456789abcdef0123") == "mask-0123456789abcdef0123"
    assert redact("key sk-0123456789abcdef0123") == f"key {REDACTED}"


def test_env_provider_keys_are_registered_on_configure(monkeypatch):
    monkeypatch.setenv("MTL_OPENAI_COMPAT_API_KEY", "xai-plainkey123456")
    try:
        configure_logging(verbose=False)
        assert redact("auth xai-plainkey123456") == f"auth {REDACTED}"
    finally:
        clear_secrets()
