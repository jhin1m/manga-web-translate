"""OCR local: giữ hợp đồng OcrResult như OCR LLM (guard mực, thứ tự id, low_conf, usage rỗng); tiền/hậu xử lý
MangaOCR / PaddleOCR; model thật (nếu đã tải + có font CJK của hệ thống) đọc đúng chữ in."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

from mtl_pipeline.local_ocr import ocr_page_local
from mtl_pipeline.local_ocr.manga_ocr import MangaOcr, h2z_ascii, post_process
from mtl_pipeline.local_ocr.paddle_ocr import PaddleOcr, db_boxes, split_columns
from mtl_pipeline.schema import BBox, Region

from .conftest import model_file


class FakeEngine:
    name = "fake"

    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = 0

    def read(self, crop):
        self.calls += 1
        return self.answers.pop(0)


def _region(rid: str, x: int, kind="text_bubble") -> Region:
    return Region(id=rid, kind=kind, bbox=BBox(x=x, y=10, w=40, h=40), score=0.9)


def test_local_ocr_keeps_guards_order_and_flags():
    img = np.full((80, 300, 3), 255, np.uint8)
    img[20:40, 70:110] = 0  # r1 có mực
    img[20:40, 130:170] = 0  # r2 có mực
    img[20:40, 190:230] = 0  # r3 có mực
    regions = [
        _region("r0", 10),  # trống → empty, không gọi engine
        Region(id="b", kind="bubble", bbox=BBox(x=0, y=0, w=300, h=80), score=0.9),
        _region("r1", 70),
        _region("r2", 130, "text_free"),
        _region("r3", 190),
    ]
    eng = FakeEngine([("こんにちは", 0.9), ("", 0.0), ("ぼや", 0.2)])
    res = ocr_page_local(eng, img, regions)
    assert [it.id for it in res.items] == ["r0", "r1", "r2", "r3"]
    assert res.usage == [] and eng.calls == 3
    r0, r1, r2, r3 = res.items
    assert r0.empty and not r0.low_conf
    assert r1.source == "こんにちは" and not r1.low_conf and not r1.is_sfx
    # Có mực mà đọc ra rỗng, hoặc độ tin thấp → low_conf (người sửa phải soát), không empty.
    assert r2.source == "" and r2.low_conf and not r2.empty
    assert r3.low_conf


def test_manga_ocr_post_process_like_upstream():
    assert post_process("今日 は …") == "今日は．．．"
    assert post_process("あ・・・") == "あ．．．"
    assert h2z_ascii("A1!") == "Ａ１！"


def test_manga_ocr_decode_skips_special_tokens(tmp_path):
    ocr = MangaOcr.__new__(MangaOcr)
    ocr.vocab = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]", "<unused0>", "今", "##日"]
    assert ocr.decode([2, 6, 1, 7, 5, 3]) == "今日"


def test_split_columns_reads_vertical_blocks_and_drops_furigana():
    gray = np.full((200, 160), 255, np.uint8)
    gray[20:180, 20:40] = 0  # cột 1
    gray[20:120, 70:90] = 0  # cột 2
    gray[30:60, 96:100] = 0  # furigana hẹp sát cột 2 (khe lớn) → bỏ
    gray[20:150, 120:140] = 0  # cột 3
    cols = split_columns(gray)
    assert [(c[0], c[2]) for c in cols] == [(20, 40), (70, 90), (120, 140)]
    assert cols[1][1:4:2] == (20, 120)


def test_db_boxes_from_probability_map():
    pred = np.zeros((96, 160), np.float32)
    pred[30:50, 20:140] = 0.9
    boxes = db_boxes(pred, 1.0, 1.0, (96, 160))
    assert len(boxes) == 1
    b = boxes[0]
    # Unclip nới mỗi cạnh vài px quanh vùng xác suất cao.
    assert b[:, 0].min() < 20 and b[:, 0].max() > 139 and b[:, 1].min() < 30 and b[:, 1].max() > 49


def test_paddle_ctc_decode_merges_repeats_and_blank():
    class Sess:
        def get_inputs(self):
            return [type("I", (), {"name": "x"})()]

        def run(self, _out, feed):
            n = feed["x"].shape[0]
            t = np.zeros((n, 6, 4), np.float32)
            for k, ch in enumerate([1, 1, 0, 2, 2, 3]):  # a a _ b b <space>
                t[:, k, ch] = 0.9
            return [t]

    ocr = PaddleOcr.__new__(PaddleOcr)
    ocr.rec, ocr.chars = Sess(), ["", "a", "b", " "]
    [(text, conf)] = ocr.recognize([np.zeros((48, 100, 3), np.uint8)])
    assert text == "ab " and conf == pytest.approx(0.9)


# ---- model thật ----

JP_FONT = Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf")
KO_FONT = Path("/System/Library/Fonts/AppleSDGothicNeo.ttc")


def _render(text: str, font: Path, size=48, vertical=False) -> np.ndarray:
    f = ImageFont.truetype(str(font), size)
    if vertical:
        img = Image.new("RGB", (size + 40, size * len(text) + 40), "white")
        d = ImageDraw.Draw(img)
        for i, ch in enumerate(text):
            d.text((20, 20 + i * size), ch, font=f, fill="black")
    else:
        w = int(f.getlength(text)) + 40
        img = Image.new("RGB", (w, size + 40), "white")
        ImageDraw.Draw(img).text((20, 15), text, font=f, fill="black")
    return np.array(img)


def _needs(*names: str, font: Path = JP_FONT):
    missing = [n for n in names if not model_file(n).is_file()]
    return pytest.mark.skipif(bool(missing) or not font.is_file(), reason=f"thiếu model {missing} hoặc font")


@_needs("manga_ocr_encoder", "manga_ocr_decoder", "manga_ocr_vocab")
def test_manga_ocr_real_model_reads_vertical_japanese():
    ocr = MangaOcr(
        model_file("manga_ocr_encoder"), model_file("manga_ocr_decoder"), model_file("manga_ocr_vocab")
    )
    text, conf = ocr.read(_render("今日は晴れ", JP_FONT, vertical=True))
    assert text == "今日は晴れ" and conf > 0.5


@_needs("paddle_det", "paddle_rec")
def test_paddle_real_model_reads_english_line():
    ocr = PaddleOcr(model_file("paddle_det"), model_file("paddle_rec"), join=" ")
    text, conf = ocr.read(_render("HELLO WORLD", JP_FONT))
    assert text.replace(" ", "").upper() == "HELLOWORLD" and conf > 0.5


@_needs("paddle_det", "paddle_rec_korean", font=KO_FONT)
def test_paddle_real_model_reads_korean_line():
    ocr = PaddleOcr(model_file("paddle_det"), model_file("paddle_rec_korean"), join=" ")
    text, _ = ocr.read(_render("안녕하세요 친구", KO_FONT))
    assert text.replace(" ", "") == "안녕하세요친구"
