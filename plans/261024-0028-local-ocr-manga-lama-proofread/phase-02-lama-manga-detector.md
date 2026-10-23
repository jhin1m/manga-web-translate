---
phase: 2
title: "LaMa manga + detector CTD + tham số inpaint/mask"
status: pending
priority: P1
effort: "3h"
dependencies: [1]
---

# Phase 2: LaMa manga + detector CTD + tham số

## Overview
Inpainter `lama_manga` (ONNX `mayocream/lama-manga-onnx`, Apache-2.0, = dreMaz AnimeMangaInpainting — model Saber gọi
"lama漫画"), detector CTD, áp threshold/dilation/inpaint_size theo payload.

## Architecture
- `models.lock.json` thêm `lama_manga` (`optional: true`); `models.py` `verify_all` bỏ optional, `ensure_model(name)` tải
  lazy theo URL pin revision + sha256 (khoá luồng).
- `inpaint.py`: `LamaInpainter(model_path, size)` dùng chung cho big/manga (cùng IO 512, output 0..255 — kiểm thực
  nghiệm); `inpaint_size` = cạnh tối đa vùng gom 1 lượt model (mặc định 512 = hiện tại). `CompositeInpainter` giữ.
- `Pipeline.inpainter_for(name, size)` cache theo name; `prepare_image(img, rtl, opts)`.
- CTD detector: `vendor/ctd_blocks.py` port `postprocess_yolo` (manga-image-translator, GPL-3.0) trên output `blk`;
  bubble vẫn lấy từ RT-DETR → chữ trong bóng = `text_bubble`, còn lại `text_free`.
- `build_text_mask(..., dilation=None)`.
- Reinpaint dùng `payload.inpaint`.

## Related Code Files
- Modify: `worker/mtl_pipeline/{inpaint,pipeline,detect,textmask,models}.py`, `worker/mtl_worker/handlers.py`,
  `worker/models.lock.json`, `worker/scripts/fetch_models.py`, `worker/models/README.md`, `worker/modal_app.py`.
- Create: `worker/mtl_pipeline/vendor/ctd_blocks.py`, tests.

## Success Criteria
- [ ] Payload mặc định → output y hệt trước (test so sánh hàm).
- [ ] Smoke test LaMa manga thật trên ảnh mẫu (thời gian, nhận xét).

## Risk Assessment
Model 207MB: không commit, tải lazy; Modal image tải sẵn.
