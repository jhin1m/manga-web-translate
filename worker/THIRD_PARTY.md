# Mã và model bên thứ ba (worker)

MVP nội bộ: được dùng lại code/model mở bất kể license (GPL/AGPL…); rà giấy phép trước khi thương mại hoá
(README → "Rà giấy phép"). Weights không commit — nguồn + revision + sha256 ở [`models.lock.json`](./models.lock.json).

## Code

| Ở đâu | Nguồn | License |
|---|---|---|
| `mtl_pipeline/vendor/ctd_*.py` (mask CTD), `vendor/ctd_blocks.py` (hậu xử lý khối chữ YOLO + NMS) | [manga-image-translator](https://github.com/zyddnys/manga-image-translator) @ `d6de6ab` | GPL-3.0 |
| `mtl_pipeline/vendor/lama_pre_post.py` | manga-image-translator `inpainting_lama_mpe.py` | GPL-3.0 |
| `mtl_pipeline/local_ocr/paddle_ocr.py` (tiền/hậu xử lý DB, giải mã CTC, nắn box) | [RapidOCR](https://github.com/RapidAI/RapidOCR) 3.10 `ch_ppocr_det/utils.py`, `ch_ppocr_rec/utils.py` | Apache-2.0 |
| `mtl_pipeline/local_ocr/manga_ocr.py` (tiền/hậu xử lý) | [manga-ocr](https://github.com/kha-white/manga-ocr) | Apache-2.0 |
| Thiết kế tính năng (lama manga, MangaOCR, PaddleOCR ONNX, AI hiệu đính) | tham khảo [Saber-Translator](https://github.com/MashiroSaber03/Saber-Translator) `src/interfaces/` | GPL-3.0 |

## Model

| name (lock) | Nguồn | License |
|---|---|---|
| `rtdetr_v2_comic` | [ogkalu/comic-text-and-bubble-detector](https://huggingface.co/ogkalu/comic-text-and-bubble-detector) | Apache-2.0 |
| `comic_text_detector` | manga-image-translator release beta-0.3 | GPL-3.0 |
| `big_lama` | [Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX) | Apache-2.0 |
| `lama_manga` | [mayocream/lama-manga-onnx](https://huggingface.co/mayocream/lama-manga-onnx) (ONNX của dreMaz/AnimeMangaInpainting) | Apache-2.0 |
| `manga_ocr_*` | [mayocream/manga-ocr-onnx](https://huggingface.co/mayocream/manga-ocr-onnx) (ONNX của kha-white/manga-ocr-base) | Apache-2.0 |
| `paddle_det`, `paddle_rec`, `paddle_rec_korean` | PP-OCRv6 small / PP-OCRv5 korean mobile, bản ONNX của [RapidAI/RapidOCR](https://www.modelscope.cn/models/RapidAI/RapidOCR) | Apache-2.0 |
