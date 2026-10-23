"""Smoke test model thật trên ảnh mẫu: giai đoạn 1 (detect + mask + inpaint) theo từng tổ hợp cài đặt pipeline,
tuỳ chọn OCR local. Không gọi LLM. Ghi ảnh sạch + JSON thời gian/chữ OCR vào --out.

    uv run python scripts/smoke_local_models.py --out /tmp/smoke img1.png [img2.png …] \
        [--detector rtdetr_v2_comic,comic_text_detector] [--inpainter big_lama,lama_manga] \
        [--ocr manga_ocr --lang ja] [--labels labels.json]

labels.json (tuỳ chọn) = {"<tên ảnh>": {"<region id>": "chữ đúng"}} → in CER của OCR local.
"""

from __future__ import annotations

import argparse
import json
import time
import unicodedata
from pathlib import Path

from mtl_pipeline.images import open_rgb, save_png
from mtl_pipeline.options import PrepareOptions
from mtl_pipeline.pipeline import Pipeline


def cer(ref: str, hyp: str) -> float:
    """Character error rate = khoảng cách Levenshtein / độ dài nhãn (NFKC: ！/!, …/... coi như nhau; bỏ khoảng trắng)."""
    a = "".join(unicodedata.normalize("NFKC", ref).split())
    b = "".join(unicodedata.normalize("NFKC", hyp).split())
    if not a:
        return 0.0 if not b else 1.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] / len(a)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--detector", default="rtdetr_v2_comic")
    ap.add_argument("--inpainter", default="big_lama")
    ap.add_argument("--ocr", default="", help="manga_ocr | paddle_ocr (trống = bỏ qua OCR)")
    ap.add_argument("--lang", default="ja")
    ap.add_argument("--rtl", action="store_true")
    ap.add_argument("--labels", type=Path)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    labels = json.loads(args.labels.read_text()) if args.labels else {}
    pipe = Pipeline()
    report = []
    for det in args.detector.split(","):
        for inp in args.inpainter.split(","):
            opts = PrepareOptions(detector=det, inpainter=inp)
            for src in args.images:
                img = open_rgb(src)
                pipe.prepare_image(img[:64, :64], args.rtl, opts)  # nạp lười model trước khi bấm giờ
                t0 = time.perf_counter()
                regions, _mask, clean, timing = pipe.prepare_image(img, args.rtl, opts)
                total = time.perf_counter() - t0
                save_png(clean, args.out / f"{src.stem}.{det}.{inp}.clean.png")
                row = {
                    "image": src.name,
                    "size": [img.shape[1], img.shape[0]],
                    "detector": det,
                    "inpainter": inp,
                    "regions": sum(r.kind != "bubble" for r in regions),
                    "bubbles": sum(r.kind == "bubble" for r in regions),
                    "detect_s": round(timing.detect, 2),
                    "mask_s": round(timing.mask, 2),
                    "inpaint_s": round(timing.inpaint, 2),
                    "stage1_s": round(total, 2),
                }
                if args.ocr:
                    from mtl_pipeline.local_ocr import ocr_page_local

                    t1 = time.perf_counter()
                    res = ocr_page_local(pipe.local_ocr(args.ocr, args.lang, args.rtl), img, regions)
                    row["ocr_s"] = round(time.perf_counter() - t1, 2)
                    row["ocr"] = {it.id: it.source for it in res.items if not it.empty}
                    truth = labels.get(src.name, {})
                    if truth:
                        scores = [cer(t, row["ocr"].get(rid, "")) for rid, t in truth.items()]
                        row["cer"] = round(sum(scores) / len(scores), 4)
                report.append(row)
                print(json.dumps(row, ensure_ascii=False))
    (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
