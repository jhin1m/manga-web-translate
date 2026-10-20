"""Mở ảnh an toàn: đọc header trước khi giải mã, chặn bom giải nén và định dạng lạ."""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

MAX_SIDE = 16384
MAX_PIXELS = 60_000_000
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}

# Trần toàn cục của Pillow: vượt ngưỡng → DecompressionBombError thay vì cảnh báo.
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class ImageRejected(ValueError):
    """Ảnh không hợp lệ hoặc vượt trần kích thước."""


def _read(src: str | Path | bytes) -> bytes:
    # Đọc 1 lần: kiểm header và giải mã trên CÙNG bytes (file không thể bị thay giữa 2 bước).
    return src if isinstance(src, bytes) else Path(src).read_bytes()


def check_header(src: str | Path | bytes) -> tuple[str, int, int]:
    """Đọc header (không giải mã pixel) → (format, w, h); ném ImageRejected nếu vượt trần."""
    data = _read(src)
    try:
        with Image.open(io.BytesIO(data)) as im:
            fmt, (w, h) = im.format or "", im.size
    except Image.DecompressionBombError as e:
        raise ImageRejected(f"vượt trần pixel: {e}") from e
    except Exception as e:  # Pillow ném nhiều loại lỗi khi file hỏng
        raise ImageRejected(f"không đọc được header ảnh: {e}") from e
    if fmt not in ALLOWED_FORMATS:
        raise ImageRejected(f"định dạng không cho phép: {fmt or 'unknown'}")
    if w <= 0 or h <= 0 or w > MAX_SIDE or h > MAX_SIDE:
        raise ImageRejected(f"cạnh vượt trần {MAX_SIDE}px: {w}x{h}")
    if w * h > MAX_PIXELS:
        raise ImageRejected(f"vượt trần {MAX_PIXELS} pixel: {w}x{h}")
    return fmt, w, h


def open_rgb(src: str | Path | bytes) -> np.ndarray:
    """Kiểm header rồi mới giải mã; trả mảng HxWx3 uint8 RGB, đã xoay theo EXIF orientation."""
    data = _read(src)
    check_header(data)
    with Image.open(io.BytesIO(data), formats=sorted(ALLOWED_FORMATS)) as im:
        return np.asarray(ImageOps.exif_transpose(im).convert("RGB")).copy()


def save_png(arr: np.ndarray, path: str | Path) -> None:
    Image.fromarray(arr).save(path, format="PNG")


def encode_png(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return buf.getvalue()
