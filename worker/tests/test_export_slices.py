"""chapter.export: layout original_slices / pages, include_untranslated, CBZ + ComicInfo, upload header, cửa sổ trượt."""

from __future__ import annotations

import io
import xml.etree.ElementTree as ET
import zipfile
from typing import Any

import httpx
import numpy as np
import pytest
from PIL import Image

from mtl_pipeline.images import encode_png
from mtl_pipeline.render import SliceAssembler
from mtl_worker.client import WorkerClient
from mtl_worker.handlers import HANDLERS
from mtl_worker.runner import run_job

JOB = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6c"
CHAPTER = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6d"
SRC = [f"0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5b{i:02d}" for i in range(4)]
PAGE = [f"0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5c{i:02d}" for i in range(4)]
EXPORT_KEY = "exports/ch/job.zip"
ZIP_HEADERS = {"content-type": "application/zip", "x-amz-tagging": "mtl-kind=export"}
FONT = "PatrickHand-Regular"

# Slice gốc: (rộng, cao). 3 slice rộng 200 và 1 slice rộng 100.
SLICES = [(200, 300), (200, 250), (200, 400), (100, 120)]


def slice_image(i: int) -> np.ndarray:
    """Mỗi slice 1 màu nền + gradient theo hàng/cột để lệch vị trí là lộ ngay."""
    w, h = SLICES[i]
    img = np.zeros((h, w, 3), np.uint8)
    img[:, :, 0] = (np.arange(h) % 251)[:, None]
    img[:, :, 1] = (np.arange(w) % 253)[None, :]
    img[:, :, 2] = 40 + 50 * i
    return img


# Page: (ord, width, [(slice, src_y, page_y, h)]) — S1 một page; S2 vắt 2 page; S3 vắt 2 page; S4 khác bề rộng.
PAGES = [
    (0, 200, [(0, 0, 0, 300), (1, 0, 300, 100)]),
    (1, 200, [(1, 100, 0, 150), (2, 0, 150, 300)]),
    (2, 200, [(2, 300, 0, 100)]),
    (3, 100, [(3, 0, 0, 120)]),
]


def page_image(segs: list[tuple[int, int, int, int]], w: int) -> np.ndarray:
    height = max(py + h for _, _, py, h in segs)
    img = np.zeros((height, w, 3), np.uint8)
    for s, sy, py, h in segs:
        img[py : py + h] = slice_image(s)[sy : sy + h]
    return img


class ExportClient:
    def __init__(self, backgrounds: dict[str, bytes], reject_first_put: bool = False):
        self.bg = backgrounds
        self.reject_first_put = reject_first_put
        self.presigns = 0
        self.puts: list[tuple[str, dict[str, str]]] = []
        self.uploaded: bytes | None = None
        self.completed: dict[str, Any] | None = None
        self.failed: tuple[str, str] | None = None

    def heartbeat(self, job, progress, stage, usage):
        return {"lease_expires_at": "x", "stop": None}

    def presign_outputs(self, job, names):
        self.presigns += 1
        assert names == ["export"]
        return {
            "export": {
                "key": EXPORT_KEY,
                "rev": None,
                "put": f"http://files/put-{self.presigns}",
                "expires_at": "x",
                "headers": ZIP_HEADERS,
            }
        }

    def complete(self, job, result, usage):
        self.completed = result
        return {"ok": True}

    def fail(self, job, error_class, message, retry_after_s=None, usage=None, partial=None):
        self.failed = (error_class, message)
        return {"ok": True}

    def download(self, url):
        return self.bg[url]

    def upload_png(self, url, data):  # pragma: no cover - export không dùng
        raise AssertionError("export phải dùng upload_file")

    def upload_file(self, url, path, headers):
        self.puts.append((url, headers))
        if self.reject_first_put and len(self.puts) == 1:
            return False
        with open(path, "rb") as f:
            self.uploaded = f.read()
        return True


def make_job(
    *,
    fmt="png_zip",
    layout="original_slices",
    quality=100,
    include=True,
    untranslated: set[int] = frozenset(),  # type: ignore[assignment]
    states: dict[int, dict] | None = None,
    chapter: dict | None = None,
) -> tuple[dict[str, Any], dict[str, bytes]]:
    bgs: dict[str, bytes] = {}
    pages = []
    for ord_, w, segs in PAGES:
        img = page_image(segs, w)
        url = f"http://files/bg/{ord_}"
        bgs[url] = encode_png(img)
        pages.append(
            {
                "page_id": PAGE[ord_],
                "ord": ord_,
                "width": w,
                "height": img.shape[0],
                "translated": ord_ not in untranslated,
                "background": url,
                "state": (states or {}).get(ord_),
                "source_map": [
                    {"source_file_id": SRC[s], "src_y": sy, "page_y": py, "h": h} for s, sy, py, h in segs
                ],
            }
        )
    job = {
        "id": JOB,
        "type": "chapter.export",
        "attempt": 1,
        "lease_token": "t" * 48,
        "lease_expires_at": "x",
        "payload": {
            "type": "chapter.export",
            "chapter_id": CHAPTER,
            "format": fmt,
            "layout": layout,
            "quality": quality,
            "include_untranslated": include,
        },
        "inputs": {
            "chapter": chapter or {"series_title": "Truyện", "number": "12", "title": "Mở đầu"},
            "pages": pages[::-1],  # đảo thứ tự: worker phải tự sắp theo ord
            "sources": [{"source_file_id": SRC[i], "ord": i} for i in range(4)],
        },
        "outputs": {
            "export": {
                "key": EXPORT_KEY,
                "rev": None,
                "put": "http://files/put-0",
                "expires_at": "x",
                "headers": ZIP_HEADERS,
            }
        },
    }
    return job, bgs


def run(job: dict[str, Any], bgs: dict[str, bytes], **kw) -> ExportClient:
    c = ExportClient(bgs, **kw)
    assert run_job(c, job, HANDLERS, deps=None) == "succeeded", c.failed  # type: ignore[arg-type]
    return c


def open_zip(c: ExportClient) -> zipfile.ZipFile:
    assert c.uploaded is not None
    return zipfile.ZipFile(io.BytesIO(c.uploaded))


def decode(zf: zipfile.ZipFile, name: str) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(zf.read(name))).convert("RGB"))


def text_state(box_y: float) -> dict:
    box: dict[str, Any] = {
        "id": "b1",
        "region_id": None,
        "x": 20.0,
        "y": box_y,
        "w": 150.0,
        "h": 50.0,
        "rotation": 0,
        "text": "Xin chào",
        "lines": [],
        "font_family": FONT,
        "font_size": 20.0,
        "line_height": 1.15,
        "pad": 4.0,
        "letter_spacing": 0,
        "align": "center",
        "fill": "#ffffff",
        "stroke": None,
        "auto_fit": True,
        "hidden": False,
    }
    return {
        "schema_version": 1,
        "size": {"w": 200, "h": 400},
        "view": {"show_original": False},
        "regions": [],
        "text_boxes": [box],
        "meta": None,
    }


def test_original_slices_restore_each_source_exactly():
    job, bgs = make_job()
    c = run(job, bgs)
    zf = open_zip(c)
    assert zf.namelist() == ["001.png", "002.png", "003.png", "004.png"]
    assert all(i.compress_type == zipfile.ZIP_STORED for i in zf.infolist())
    for i in range(4):
        np.testing.assert_array_equal(decode(zf, f"{i + 1:03d}.png"), slice_image(i))
    assert c.completed == {"type": "chapter.export", "key": EXPORT_KEY, "bytes": len(c.uploaded or b"")}


def test_upload_uses_fresh_presign_and_signed_headers():
    job, bgs = make_job()
    c = run(job, bgs)
    assert c.puts == [("http://files/put-1", ZIP_HEADERS)]


def test_upload_retries_once_with_new_presign_on_403():
    job, bgs = make_job()
    c = run(job, bgs, reject_first_put=True)
    assert [u for u, _ in c.puts] == ["http://files/put-1", "http://files/put-2"]
    assert c.completed is not None


def test_text_drawn_only_on_translated_page_with_state():
    # Page 0 dịch + có chữ trắng ở y=20; page 1 chưa dịch có state nhưng KHÔNG vẽ.
    job, bgs = make_job(untranslated={1}, states={0: text_state(20), 1: text_state(20)})
    zf = open_zip(run(job, bgs))
    # S1 (001) nằm trọn page 0 → có chữ trắng; S4 (004) không đổi. S2/S3 dính page 1 chưa dịch nhưng vẫn xuất
    # (include_untranslated=true): phần page 1 giữ nguyên nền.
    s1 = decode(zf, "001.png")
    assert (s1 != slice_image(0)).any()
    assert (s1[0:15] == slice_image(0)[0:15]).all()
    s3 = decode(zf, "003.png")
    np.testing.assert_array_equal(s3[:300], slice_image(2)[:300])


def test_include_untranslated_false_drops_whole_slices():
    # Page 1 chưa dịch → mọi slice có đoạn trên page 1 (S2, S3) bị bỏ; S1, S4 còn, tên giữ theo ord nguồn.
    job, bgs = make_job(untranslated={1}, include=False)
    zf = open_zip(run(job, bgs))
    assert zf.namelist() == ["001.png", "004.png"]
    np.testing.assert_array_equal(decode(zf, "001.png"), slice_image(0))
    np.testing.assert_array_equal(decode(zf, "004.png"), slice_image(3))


def test_pages_layout_names_and_sizes():
    job, bgs = make_job(layout="pages")
    zf = open_zip(run(job, bgs))
    assert zf.namelist() == ["001.png", "002.png", "003.png", "004.png"]
    assert [decode(zf, n).shape[:2] for n in zf.namelist()] == [
        (400, 200),
        (450, 200),
        (100, 200),
        (120, 100),
    ]


def test_pages_layout_skips_untranslated_when_excluded():
    job, bgs = make_job(layout="pages", untranslated={0, 2}, include=False)
    assert open_zip(run(job, bgs)).namelist() == ["002.png", "004.png"]


def test_cbz_jpeg_with_comic_info_first():
    chapter = {"series_title": "A & B <x>", "number": "3", "title": 'Tập "một"'}
    job, bgs = make_job(fmt="cbz", quality=80, chapter=chapter)
    zf = open_zip(run(job, bgs))
    assert zf.namelist() == ["ComicInfo.xml", "001.jpg", "002.jpg", "003.jpg", "004.jpg"]
    assert zf.read("001.jpg")[:3] == b"\xff\xd8\xff"
    root = ET.fromstring(zf.read("ComicInfo.xml"))
    assert root.findtext("Series") == "A & B <x>"
    assert root.findtext("Title") == 'Tập "một"'
    assert root.findtext("Number") == "3"
    assert root.findtext("PageCount") == "4"
    assert root.findtext("LanguageISO") == "vi"


def test_cbz_quality_100_is_png():
    job, bgs = make_job(fmt="cbz", quality=100, layout="pages")
    assert open_zip(run(job, bgs)).namelist()[1:] == ["001.png", "002.png", "003.png", "004.png"]


def test_png_zip_ignores_quality():
    job, bgs = make_job(fmt="png_zip", quality=50, layout="pages")
    assert open_zip(run(job, bgs)).namelist()[0] == "001.png"


def test_nothing_to_export_fails_invalid_input():
    job, bgs = make_job(untranslated={0, 1, 2, 3}, include=False)
    c = ExportClient(bgs)
    assert run_job(c, job, HANDLERS, deps=None) == "failed"  # type: ignore[arg-type]
    assert c.failed is not None and c.failed[0] == "invalid_input"


def test_background_size_mismatch_fails_invalid_input():
    job, bgs = make_job()
    bgs["http://files/bg/2"] = encode_png(np.zeros((50, 50, 3), np.uint8))
    c = ExportClient(bgs)
    assert run_job(c, job, HANDLERS, deps=None) == "failed"  # type: ignore[arg-type]
    assert c.failed is not None and c.failed[0] == "invalid_input"


def test_assembler_window_frees_buffers():
    # 30 page nối tiếp, mỗi slice vắt 2 page liền nhau: tại mọi thời điểm chỉ ≤ 1 buffer sống.
    pages = []
    for i in range(30):
        segs = [{"source_file_id": f"s{i}", "src_y": 0, "page_y": 0, "h": 50}]
        if i:
            segs.insert(0, {"source_file_id": f"s{i - 1}", "src_y": 50, "page_y": 0, "h": 10})
            segs[1]["page_y"] = 10
        pages.append({"ord": i, "width": 20, "translated": True, "source_map": segs})
    asm = SliceAssembler(pages, True)
    done, peak = 0, 0
    for pg in pages:
        img = np.zeros((60 if pg["ord"] else 50, 20, 3), np.uint8)
        done += sum(1 for _ in asm.add_page(pg, img))
        peak = max(peak, len(asm._bufs))
    assert peak <= 2 and done <= 30


def test_upload_file_streams_with_content_length_and_headers(tmp_path):
    seen: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["headers"], seen["body"] = dict(req.headers), req.read()
        return httpx.Response(200)

    f = tmp_path / "x.zip"
    f.write_bytes(b"z" * 3_000_000)
    c = WorkerClient("http://api", "tok", "w")
    c.files = httpx.Client(transport=httpx.MockTransport(handler))
    assert c.upload_file("http://files/put", str(f), ZIP_HEADERS) is True
    assert seen["headers"]["content-type"] == "application/zip"
    assert seen["headers"]["x-amz-tagging"] == "mtl-kind=export"
    assert seen["headers"]["content-length"] == "3000000"
    assert "transfer-encoding" not in seen["headers"]
    assert seen["body"] == f.read_bytes()
    c.files = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(403)))
    assert c.upload_file("http://files/put", str(f), ZIP_HEADERS) is False
    c.files = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    with pytest.raises(httpx.HTTPStatusError):
        c.upload_file("http://files/put", str(f), ZIP_HEADERS)
