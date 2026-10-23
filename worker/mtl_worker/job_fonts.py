"""Font tuỳ chỉnh của job: tải về cache theo sha256 (kiểm hash), đăng ký id → file cho `mtl_pipeline.fonts`.

Chỉ tải URL nằm trong inputs của job (API đã kiểm font thuộc workspace). Font hỏng / sai hash bị bỏ qua →
render fallback font thoại mặc định như id không biết. Tải lỗi 4xx (font đã xoá, URL hết hạn) cũng bỏ qua; lỗi kết nối /
5xx thì ném ra để job được thử lại."""

from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx

from mtl_pipeline.fonts import read_metrics, use_fonts

log = logging.getLogger("mtl_worker")


def cache_dir() -> Path:
    return Path(os.environ.get("MTL_FONT_CACHE_DIR") or Path.home() / ".cache" / "mtl-worker" / "fonts")


def _usable(path: Path) -> bool:
    try:
        read_metrics(path)
    except Exception:  # fontTools ném nhiều kiểu lỗi trên file hỏng
        return False
    return True


def fetch_fonts(
    fonts: list[dict[str, Any]], download: Callable[[str], bytes], root: Path | None = None
) -> dict[str, Path]:
    """→ {font_id: file}. File cache tên = sha256 (không đuôi), ghi nguyên tử."""
    root = root or cache_dir()
    out: dict[str, Path] = {}
    for f in fonts:
        sha = f["sha256"]
        path = root / sha
        if not path.is_file():
            try:
                data = download(f["url"])
            except httpx.HTTPStatusError as e:
                if e.response.status_code >= 500:
                    raise
                log.warning("font %s: tải lỗi HTTP %s, bỏ qua", f["id"], e.response.status_code)
                continue
            if hashlib.sha256(data).hexdigest() != sha:
                log.warning("font %s: sha256 không khớp, bỏ qua", f["id"])
                continue
            root.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=root, prefix=".font-")
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp, path)
        if not _usable(path):
            log.warning("font %s: không đọc được, bỏ qua", f["id"])
            path.unlink(missing_ok=True)
            continue
        out[f["id"]] = path
    return out


@contextmanager
def job_fonts(
    fonts: list[dict[str, Any]] | None, download: Callable[[str], bytes], root: Path | None = None
) -> Iterator[None]:
    if not fonts:
        yield
        return
    with use_fonts(fetch_fonts(fonts, download, root)):
        yield
