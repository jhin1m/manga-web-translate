---
phase: 3
title: "Worker ngôn ngữ + thứ tự đọc"
status: pending
priority: P1
effort: "5h"
dependencies: [1, 2]
---

# Phase 3: Worker ngôn ngữ + thứ tự đọc

## Overview
OCR và dịch nhận ngôn ngữ từ payload thay vì ghi cứng Hàn→Việt; `page.prepare` sắp vùng chữ phải→trái khi
`reading_order = "rtl"`.

## Requirements
- System prompt giữ **tĩnh** (không chèn biến → giữ cache prompt); ngôn ngữ đi trong nội dung request.
- `ocr_page.md`: bỏ "Hàn Quốc/tiếng Hàn"; nói "chép nguyên văn chữ ngôn ngữ nguồn ghi ở dòng `source_lang=`"; nêu chữ Nhật/Trung có thể viết dọc (đọc cột trên→dưới, cột phải→trái), giữ chữ Hán/kana nguyên dạng, không phiên âm.
- `translate_batch.md`: "dịch giả truyện tranh `source_lang` → `target_lang`"; ví dụ xưng hô tiếng Việt chỉ áp khi đích = vi; với đích khác: lời thoại tự nhiên, ngắn, đúng chuẩn chính tả ngôn ngữ đích; `pronoun_rules` = cách hai nhân vật gọi nhau.
- Payload cũ thiếu field → default `source_lang="ko"`, `target_lang="vi"`, `reading_order="ltr"`.
- LTR giữ đúng thuật toán cũ `(bbox.y, bbox.x)` — không đổi id vùng của series hiện có.

## Architecture
- `schema.py`: `OcrRequest.source_lang: str = "ko"`; `TranslateRequest.source_lang/target_lang` (default ko/vi); bỏ default honorific ghi cứng tiếng Việt ở `TranslateRequest`/`SeriesSettings` hoặc để chuỗi trung tính.
- `mtl_pipeline/langs.py` (mới, nhỏ): `LANG_NAMES = {"ko": "tiếng Hàn", "ja": "tiếng Nhật", ...}` dùng để in tên ngôn ngữ vào request.
- Provider (`providers/base.py` builder payload, `gemini.py`, `anthropic.py`): OCR thêm dòng đầu `source_lang=ja (tiếng Nhật)` trước các crop; translate JSON thêm `source_lang`, `target_lang`.
- `detect.py::to_regions(dets, w, h, rtl=False)`: rtl → gom hàng theo chồng lấn dọc ≥ 50% chiều cao box nhỏ hơn (greedy theo y tăng), hàng trên→dưới, trong hàng sắp `-bbox.x2`. `Detector.detect(img, rtl=False)` → `Pipeline.prepare_image(img, rtl=False)` truyền xuống.
- `handlers.py`: `handle_prepare` đọc `payload.get("reading_order","ltr")`, `payload.get("source_lang","ko")` → `prepare_image(img, rtl=...)`, `ocr_page(..., source_lang=...)`; `handle_ocr_region` đọc `source_lang`; `_settings` đọc `source_lang/target_lang`. Nhánh `partial` (dùng lại region đã detect) giữ nguyên thứ tự đã lưu.
- `ocr.py::ocr_page(provider, img, regions, page_ord, source_lang="ko")`.

## Related Code Files
- Modify: `worker/mtl_pipeline/prompts/ocr_page.md`, `worker/mtl_pipeline/prompts/translate_batch.md`
- Modify: `worker/mtl_pipeline/schema.py`, `ocr.py`, `translate.py` (`SeriesSettings` + truyền lang), `detect.py`, `pipeline.py`, `providers/base.py`, `providers/gemini.py`, `providers/anthropic.py`, `cli.py`/`bench.py` (nếu gọi `prepare_image`/`ocr_page` — thêm cờ `--source-lang` cho CLI chỉ khi cần cho test)
- Modify: `worker/mtl_worker/handlers.py`
- Create: `worker/mtl_pipeline/langs.py`, `worker/tests/test_reading_order.py`, `worker/tests/test_font_coverage.py`
- Modify: `worker/tests/test_llm_contract.py`, `test_contract_schema.py`, `test_pipeline_stage2.py` (field mới)

## Implementation Steps
1. Schema + langs; prompts tổng quát.
2. Provider đưa `source_lang`/`target_lang` vào nội dung request.
3. `to_regions` thêm nhánh rtl; truyền cờ qua `detect` → `prepare_image` → handler.
4. Handlers đọc payload với default.
5. Test:
   - reading order: 2 bubble cùng hàng (x=600 và x=100) → rtl cho id `r0` là x=600; ltr giữ thứ tự cũ; 3 hàng xen kẽ chiều cao lệch.
   - font coverage: mọi font trong `manifest.json` có glyph cho bộ ký tự es/pt/fr (ñ ¿ ¡ ã õ ç œ æ « » …) — chặn hồi quy khi thêm font sau này.
   - contract: payload OCR có dòng `source_lang`, payload dịch có `source_lang/target_lang`; payload thiếu field vẫn chạy (default).
6. `cd worker && uv run pytest`; chạy thử 1 chương ja thật bằng CLI nếu có ảnh mẫu (ghi kết quả vào report).

## Success Criteria
- [x] `grep -n "Hàn\|Hàn Quốc\|-nim" worker/mtl_pipeline/prompts` chỉ còn ở phần ví dụ có điều kiện, không còn giả định cứng.
- [x] pytest xanh; test reading order + font coverage mới qua.

## Risk Assessment
- Chất lượng OCR chữ dọc tiếng Nhật qua crop: LLM vision thường đọc được; nếu crop dọc rất hẹp bị resize xấu → theo dõi, không xử lý trong plan này.
- Gom hàng heuristic có thể sai với layout chéo; chỉ ảnh hưởng thứ tự gửi dịch (ngữ cảnh), người sửa vẫn sửa từng vùng.
