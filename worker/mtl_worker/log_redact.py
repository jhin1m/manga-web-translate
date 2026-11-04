"""Redact khoá API khỏi log worker. Chạy ở formatter nên áp cho mọi bản ghi, kể cả traceback của `log.exception`
(exception của SDK thường kèm body/header có key)."""

from __future__ import annotations

import logging
import os
import re
import threading

REDACTED = "[redacted]"

# Có tiền tố + độ dài tối thiểu để không bắt nhầm chuỗi thường. Tiền tố dài hơn (sk-ant-, sk-or-) đứng trước sk-.
REDACT_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_\-]{8,}"),
    re.compile(r"(?<![A-Za-z0-9])sk-or-[A-Za-z0-9_\-]{8,}"),
    re.compile(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"(?<![A-Za-z0-9])AIza[A-Za-z0-9_\-]{20,}"),
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=\-]{8,}"),
]

# SDK/HTTP logger ở mức DEBUG in header request (Authorization), ở INFO in URL mỗi request → ghim WARNING kể cả
# `-v`. SDK anthropic/openai bản hiện dùng `httpx2`/`httpcore2`; giữ cả tên cũ cho SDK chưa chuyển.
QUIET_LOGGERS = ("anthropic", "google_genai", "openai", "httpx", "httpcore", "httpx2", "httpcore2")

# Key provider đọc từ env: đăng ký lúc khởi động để redact cả key không có tiền tố quen thuộc.
ENV_SECRET_VARS = (
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENAI_API_KEY",
    "MTL_OPENAI_COMPAT_API_KEY",
)

_lock = threading.Lock()
_secrets: set[str] = set()
_MIN_SECRET_LEN = 6  # khoá quá ngắn dễ thay nhầm nửa log


def register_secret(secret: str | None) -> None:
    if secret and len(secret) >= _MIN_SECRET_LEN:
        with _lock:
            _secrets.add(secret)


def forget_secrets(secrets: list[str]) -> None:
    """Bỏ key cấp job khi job xong; giữ key env đăng ký lúc khởi động."""
    keep = {os.environ.get(v) for v in ENV_SECRET_VARS}
    with _lock:
        for s in secrets:
            if s not in keep:
                _secrets.discard(s)


def clear_secrets() -> None:
    with _lock:
        _secrets.clear()


def redact(text: str) -> str:
    with _lock:
        known = sorted(_secrets, key=len, reverse=True)
    for s in known:
        text = text.replace(s, REDACTED)
    for pat in REDACT_PATTERNS:
        text = pat.sub(REDACTED, text)
    return text


class RedactingFormatter(logging.Formatter):
    """Redact chuỗi đã format (message + exc_text + stack), không phải từng đối số."""

    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


def configure_logging(verbose: bool) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(RedactingFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    if verbose:
        for name in ("mtl_worker", "mtl_pipeline"):
            logging.getLogger(name).setLevel(logging.DEBUG)
    for name in QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
    for var in ENV_SECRET_VARS:
        register_secret(os.environ.get(var))
