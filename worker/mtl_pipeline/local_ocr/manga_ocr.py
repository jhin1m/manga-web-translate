"""MangaOCR (kha-white/manga-ocr-base, Apache-2.0) bản ONNX `mayocream/manga-ocr-onnx` (encoder ViT + decoder BERT
2 lớp, xuất bằng optimum) — không cần torch/transformers. Tiền/hậu xử lý theo package manga-ocr; giải mã greedy
(manga-ocr gốc dùng beam 4: kết quả gần như trùng trên crop bóng thoại, nhanh hơn ~4 lần)."""

from __future__ import annotations

import re
from pathlib import Path

import cv2
import numpy as np

INPUT = 224
START, EOS = 2, 3  # [CLS] = decoder_start_token_id, [SEP] = eos (generation_config.json)
MAX_TOKENS = 300


def h2z_ascii(text: str) -> str:
    """jaconv.h2z(ascii=True, digit=True): ký tự ASCII in được → dạng full-width (như manga-ocr)."""
    return "".join(chr(ord(c) + 0xFEE0) if "!" <= c <= "~" else c for c in text)


def post_process(text: str) -> str:
    text = "".join(text.split())
    text = text.replace("…", "...")
    text = re.sub("[・.]{2,}", lambda m: (m.end() - m.start()) * ".", text)
    return h2z_ascii(text)


class MangaOcr:
    name = "manga_ocr"

    def __init__(self, encoder: Path, decoder: Path, vocab: Path, threads: int = 0):
        import onnxruntime as ort

        from ..models import ort_providers

        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        self.encoder = ort.InferenceSession(str(encoder), so, providers=ort_providers())
        self.decoder = ort.InferenceSession(str(decoder), so, providers=ort_providers())
        self.vocab = vocab.read_text(encoding="utf-8").splitlines()

    @staticmethod
    def preprocess(crop_rgb: np.ndarray) -> np.ndarray:
        """Xám → 3 kênh (img.convert('L').convert('RGB')), resize 224 bilinear, chuẩn hoá mean/std 0.5."""
        gray = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2GRAY)
        x = cv2.resize(gray, (INPUT, INPUT), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
        x = (x - 0.5) / 0.5
        return np.repeat(x[None, None], 3, axis=1)

    def decode(self, ids: list[int]) -> str:
        out = []
        for i in ids:
            tok = self.vocab[i] if 0 <= i < len(self.vocab) else ""
            if not tok or (tok.startswith("[") and tok.endswith("]")) or tok.startswith("<unused"):
                continue  # [PAD] [UNK] [CLS] [SEP] [MASK] …
            out.append(tok[2:] if tok.startswith("##") else tok)
        return "".join(out)

    def read(self, crop_rgb: np.ndarray) -> tuple[str, float]:
        hidden = self.encoder.run(None, {"pixel_values": self.preprocess(crop_rgb)})[0]
        ids = [START]
        probs: list[float] = []
        for _ in range(MAX_TOKENS):
            logits = self.decoder.run(
                None, {"input_ids": np.array([ids], np.int64), "encoder_hidden_states": hidden}
            )[0][0, -1]
            e = np.exp(logits - logits.max())
            p = e / e.sum()
            nxt = int(p.argmax())
            if nxt == EOS:
                break
            ids.append(nxt)
            probs.append(float(p[nxt]))
        text = post_process(self.decode(ids[1:]))
        return text, float(np.mean(probs)) if probs else 0.0
