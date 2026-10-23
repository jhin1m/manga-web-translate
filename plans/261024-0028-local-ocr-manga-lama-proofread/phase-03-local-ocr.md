---
phase: 3
title: "OCR local: manga-ocr + PaddleOCR (ONNX)"
status: pending
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 3: OCR local

## Overview
`manga_ocr` (ja, ONNX `mayocream/manga-ocr-onnx` encoder/decoder, không torch) và `paddle_ocr` (PP-OCRv6 det/rec small
đa ngữ ch/ja/en + PP-OCRv5 korean rec, ONNX của RapidOCR) chạy bằng onnxruntime + cv2 — không thêm dependency.

## Architecture
- `mtl_pipeline/local_ocr/`: `manga_ocr.py` (tiền xử lý ViT 224, greedy decode, hậu xử lý như manga-ocr),
  `paddle_ocr.py` (DB det + unclip hình chữ nhật + CTC greedy, dict trong metadata ONNX), `__init__.py`
  (`ocr_page_local(engine, img, regions)`): giữ `MIN_INK_RATIO` → empty, thứ tự id theo `text_regions`, `low_conf` khi
  confidence < 0.5 hoặc rỗng có mực, usage = [].
- Handler prepare/ocr_region chọn engine theo payload; OCR region local rồi dịch LLM như cũ.
- `is_sfx` luôn false với OCR local (giới hạn ghi docs).

## Related Code Files
- Create: `worker/mtl_pipeline/local_ocr/*.py`, `worker/tests/test_local_ocr.py`, `worker/scripts/smoke_local_models.py`.
- Modify: `worker/mtl_worker/handlers.py`, `worker/mtl_pipeline/pipeline.py`, `worker/models.lock.json`.

## Success Criteria
- [ ] Unit test (fake engine) giữ guard + thứ tự + low_conf; smoke test thật có CER trên ảnh tổng hợp có nhãn.

## Risk Assessment
PaddleOCR dọc tiếng Nhật kém → khuyến nghị manga_ocr cho ja (tooltip).
