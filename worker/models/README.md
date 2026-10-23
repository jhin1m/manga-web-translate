# Model weights

Nguồn + license: [`../THIRD_PARTY.md`](../THIRD_PARTY.md).

Weights **không commit** (`.gitignore`). Nguồn, revision và sha256 nằm ở [`../models.lock.json`](../models.lock.json);
`mtl_pipeline/models.py` kiểm sha256 khi khởi động và từ chối mọi file không phải `.onnx`/`.safetensors`.

Tải (chạy từ thư mục `worker/`):

```sh
uv run python scripts/fetch_models.py              # tải mọi model theo lock + kiểm sha256
uv run python scripts/fetch_models.py --required   # chỉ model bắt buộc
```

Model *optional* chỉ cần khi Cài đặt nhóm → Pipeline chọn tới (LaMa manga, OCR local): worker không kiểm lúc
khởi động, lần đầu job cần thì tải đúng URL/revision trong lock (kiểm sha256, sai thì xoá và job lỗi `internal`).
Modal: tải đủ trước khi `modal volume put` để container không tải lại mỗi lần.

| name | file | dùng cho |
|---|---|---|
| `rtdetr_v2_comic` | `rtdetr-v2-comic.onnx` | box bóng / chữ trong bóng / chữ ngoài bóng (ogkalu RT-DETRv2, input 640) |
| `comic_text_detector` | `comictextdetector.pt.onnx` | mask chữ mức pixel (input 1024, release manga-image-translator) |
| `big_lama` | `lama_fp32.onnx` | inpaint LaMa (input cố định 512, output 0..255) |
| `lama_manga` *(optional)* | `lama-manga.onnx` | inpaint LaMa cho manga — `mayocream/lama-manga-onnx` (Apache-2.0, bản ONNX của dreMaz/AnimeMangaInpainting = "lama漫画" của Saber-Translator); input 512, output 0..1 |
| `manga_ocr_encoder` / `manga_ocr_decoder` / `manga_ocr_vocab` *(optional)* | `manga-ocr-*.onnx`, `manga-ocr-vocab.txt` | OCR local tiếng Nhật — `mayocream/manga-ocr-onnx` (Apache-2.0, ONNX của kha-white/manga-ocr-base; ~460MB) |
| `paddle_det` / `paddle_rec` *(optional)* | `ppocrv6-det-small.onnx`, `ppocrv6-rec-small.onnx` | PaddleOCR local: PP-OCRv6 small det + rec đa ngữ (zh/ja/en…), bản ONNX của RapidOCR (Apache-2.0) |
| `paddle_rec_korean` *(optional)* | `ppocrv5-rec-korean.onnx` | PaddleOCR rec tiếng Hàn (PP-OCRv5 mobile) |

Khi chạy bench/production đặt `HF_HUB_OFFLINE=1`; đổi thư mục model bằng `MTL_MODELS_DIR`.
