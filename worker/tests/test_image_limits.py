from __future__ import annotations

import io
import struct
import zlib

import numpy as np
import pytest
from PIL import Image

from mtl_pipeline.images import MAX_PIXELS, ImageRejected, check_header, open_rgb


def _png(w=4, h=4) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, format="PNG")
    return buf.getvalue()


def _forge_png_size(data: bytes, w: int, h: int) -> bytes:
    """Sửa IHDR (+CRC) để header khai kích thước khổng lồ mà file vẫn bé (giả bom giải nén)."""
    ihdr = bytearray(data[8 + 8 : 8 + 8 + 13])
    ihdr[0:8] = struct.pack(">II", w, h)
    crc = struct.pack(">I", zlib.crc32(b"IHDR" + bytes(ihdr)) & 0xFFFFFFFF)
    return data[:16] + bytes(ihdr) + crc + data[16 + 13 + 4 :]


def test_ok_image_decodes_rgb():
    arr = open_rgb(_png(10, 20))
    assert arr.shape == (20, 10, 3) and arr.dtype == np.uint8


def test_side_over_limit_rejected_from_header():
    with pytest.raises(ImageRejected, match="cạnh"):
        check_header(_forge_png_size(_png(), 20000, 100))


def test_pixel_bomb_rejected_before_decode():
    with pytest.raises(ImageRejected):
        open_rgb(_forge_png_size(_png(), 16000, 16000))
    assert MAX_PIXELS < 16000 * 16000


def test_disallowed_format_rejected():
    buf = io.BytesIO()
    Image.new("RGB", (4, 4)).save(buf, format="GIF")
    with pytest.raises(ImageRejected, match="định dạng"):
        check_header(buf.getvalue())


def test_garbage_rejected():
    with pytest.raises(ImageRejected):
        check_header(b"<svg xmlns='http://www.w3.org/2000/svg'/>")


def test_path_input(tmp_path):
    p = tmp_path / "a.png"
    p.write_bytes(_png(8, 8))
    assert check_header(p) == ("PNG", 8, 8)
