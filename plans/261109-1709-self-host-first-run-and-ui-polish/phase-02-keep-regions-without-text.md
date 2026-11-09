---
title: "Phase 2: Keep regions without text"
status: done
---

# Phase 2: Keep regions without text

## Overview

Vùng OCR không có chữ/số (`...!`, `?!`, `♥`, OCR rỗng) giữ nguyên ảnh gốc và không đi dịch, thay vì bị xoá trắng.

## Requirements

- Quy tắc duy nhất: `not any(ch.isalnum() for ch in source)` → giữ ảnh gốc.
- Áp cho cả OCR LLM lẫn OCR local.
- Không gửi vùng này đi dịch, không đặt text box.
- Vùng chữ cạnh bên trong cùng bóng không bị ảnh hưởng.
- Giữ `low_conf` nếu đã có.

## Architecture

Đánh `is_sfx=True` trên cả `OcrItem` và `Region`. Luồng có sẵn lo phần còn lại: `restore_sfx` ở `handle_prepare` trả pixel; các chỗ lọc ở `handlers.py`, `pipeline.py`, `claim-inputs.ts`, `translate-chain.ts` bỏ qua khi dịch; giao diện coi như SFX nên không báo cần xử lý.

Bẫy phải tránh:

1. `ocr_page` đang đặt `is_sfx=False` cho vùng trong bóng. Helper phải chạy **sau** đoạn đó.
2. `ocr_page` có nhánh `return` sớm khi không còn crop nào. Helper phải áp cho cả nhánh này.
3. `ocr_page` gộp `local_empty` với `items`. Helper phải chạy trên danh sách đã gộp.

## Related Code Files

- Modify: `worker/mtl_pipeline/ocr.py`, `worker/mtl_pipeline/local_ocr/__init__.py`
- Modify (test): `worker/tests/test_local_ocr.py`, `worker/tests/test_pipeline_stage2.py` hoặc file test OCR tương ứng

## Implementation Steps

1. Test trước: `...!` trong bóng; `……！`; `♥`; item `empty`; source rỗng; câu có chữ không đổi; `...1` vẫn đi dịch; trang toàn vùng ít mực (nhánh return sớm); cả LLM và local.
2. Thêm helper trong `ocr.py`, nhận regions và items, trả items đã đánh dấu, đồng thời đặt `Region.is_sfx`.
3. Gọi helper ở cuối `ocr_page` (cả nhánh return sớm) và `ocr_page_local`. Sửa comment "`is_sfx` luôn false" trong `local_ocr/__init__.py`.
4. Test `handle_prepare` với ảnh giả: pixel vùng dấu câu trùng ảnh gốc, mask về 0, vùng chữ cạnh bên vẫn sạch.
5. Xác minh `page.ocr_region` không đổi hành vi: handler lọc theo `empty`/source và bỏ qua `is_sfx`.
6. Xác minh `bench.py` không tính sai khi vùng dấu câu thành `is_sfx`.
7. Xác minh **Quét lại trang** thực sự chạy lại với cùng `prepareInputRev` khi không bump version; nếu job cũ được dedup thì dừng lại và báo.

## Thay đổi khi làm

- Helper gọi sau OCR ở `handle_prepare` và `Pipeline.prepare_page`, không đặt trong `ocr_page` / `ocr_page_local`: `page.ocr_region` dùng chung `run_ocr`, đánh dấu ở đó sẽ thêm cờ `sfx` cho vùng người dùng tự vẽ. 3 bẫy ở trên tự hết.
- Vùng giữ hình (có mực) vẫn chiếm phần lòng bóng khi xếp chữ; `restore_sfx` trả cả box của vùng, kể cả khi sát chữ khác.
- Cờ `empty` không còn hiện trên vùng đã giữ hình.
- Đã xác minh: `bench.py` gọi thẳng `ocr_page` nên không đổi; Quét lại trang chạy lại với cùng input rev (`translate-chain.test.ts`).

## Todo

- [x] Test các ca dấu câu và OCR rỗng
- [x] Helper và điểm gọi ở luồng prepare
- [x] Test pixel ở `handle_prepare`
- [x] Xác minh `page.ocr_region`, `bench.py`, Quét lại trang

## Success Criteria

- [x] Bóng `...!` sau prepare giữ đúng pixel gốc
- [x] Không có box dịch trên vùng đó; request dịch không chứa vùng đó
- [x] Câu có chữ vẫn xoá và dịch như cũ
- [x] Bảng chữ không báo vùng này cần xử lý, xuất không cảnh báo

## Risk Assessment

- OCR đọc nhầm `...!` thành `...1` thì vẫn đi dịch; chấp nhận.
- Detector nhầm vào tranh và OCR rỗng: tranh được giữ lại, đúng ý.
- Trang đã xử lý phải Quét lại trang; ghi vào changelog/docs nếu có.
- Item LLM thiếu id (source rỗng, `low_conf`) cũng giữ ảnh gốc: chữ gốc còn nguyên và vẫn được đánh dấu để soát.
