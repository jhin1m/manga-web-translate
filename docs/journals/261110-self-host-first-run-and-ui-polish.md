# Self-host first run và UI polish: review bắt được lỗi critical mà unit test không thấy

**Date**: 2026-11-10
**Severity**: High (một lỗi critical bắt được ở review, đã sửa)
**Component**: worker (OCR/bubble layout), web (provider, chapter/series UI), Playwright e2e
**Status**: Code xong trên `feat/self-host-first-run-and-ui-polish`; chưa chạy Docker trên máy sạch, chưa tag `v0.1.0`

## Mục tiêu

Plan `plans/261109-1709-self-host-first-run-and-ui-polish/`. Commit: `43c98e5`, `6f2a99a`, `5bfe1ba`, `d81594b`, `63e8a95`. Ba việc:

- Docker chạy lần đầu, thêm provider đầu tiên xong là dịch được ngay.
- Bubble chỉ có dấu câu (`...!`) giữ nguyên ảnh gốc.
- UI bớt rối.

## Quyết định

`keep_regions_without_text` chạy sau OCR trên đường prepare, KHÔNG nằm trong `ocr_page`/`ocr_page_local` như plan ghi. Lý do: `page.ocr_region` dùng chung `run_ocr`, đặt trong đó sẽ đánh dấu nhầm vùng user tự vẽ là SFX. Plan sai chỗ này, đọc code mới thấy.

## Sự thật khó chịu

Lỗi critical: đánh dấu region `is_sfx` làm nó bị loại khỏi bubble layout, nên chữ dịch có thể đè lên đúng cái `...!` ta định giữ. Tính năng "giữ ảnh gốc" tự phá chính nó, mà test đơn vị vẫn xanh vì chúng không kiểm tra layout. Sửa: region có mực vẫn giữ phần chia của nó trong bubble.

Lỗi thứ hai: `restore_sfx` làm mất dấu câu nằm trong 12px quanh chữ khác. Sửa: khôi phục toàn bộ box của chính nó, trừ box của chữ khác.

Lỗi thứ ba, đáng bực nhất: Playwright spec đã cũ vì trước đó chỉ chạy gate đơn vị. UI đổi mà e2e không ai chạy. Đã cập nhật, kết quả 99/100.

## Lỗi có sẵn, không phải do đợt này

`apps/web/e2e/block-panel.spec.ts:317` fail y hệt trên base commit `7e0ed9e`. Ghi lại để không ai mất thời gian truy lỗi này vào branch.

## Bài học

- Khi plan chỉ định vị trí hook, kiểm tra ai khác gọi hàm đó (`run_ocr` dùng chung) trước khi làm theo.
- Cờ "bỏ qua" (`is_sfx`) có tác dụng phụ ở các bước sau (layout). Test tính năng ở đầu ra cuối, không chỉ ở bước sinh cờ.
- Đổi UI thì phải chạy Playwright, không dừng ở unit gate.

## Việc còn lại

- Chạy Docker 1 lệnh trên máy sạch rồi mới tag `v0.1.0` (owner: jhin1m).
- Mở: blocklist đã phủ thinking, nhưng `output_config.effort` có thể cũng bị model cũ như `claude-haiku-4-5` từ chối. Chưa kiểm chứng bằng call thật; cần một lần gọi thật trước khi tin.
- Quyết định về `block-panel.spec.ts:317`: sửa hay đánh dấu skip.
