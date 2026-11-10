---
phase: 2
title: "Ưu tiên job người dùng đang chờ"
status: completed
priority: P1
effort: "2h"
dependencies: []
---

# Phase 2: Ưu tiên job người dùng đang chờ

## Overview
Job ngắn mà người dùng đang ngồi chờ thì được claim trước backlog dịch của chương khác. Phần này sửa lỗi "bộ 1 xong không tải ZIP được".

## Requirements
- `chapter.export`, `page.reinpaint` (tẩy lại một trang trong editor), `page.ocr_region` (OCR vùng tự vẽ) có priority **10**. Lô dịch giữ 50, `page.prepare` / `chapter.ingest` / `chapter.proofread` giữ 100.
- Không đổi schema DB: cột `jobs.priority` và thứ tự claim đã có sẵn.
- Job đã nằm trong hàng đợi trước khi deploy giữ priority cũ. Chấp nhận được, không cần migration dữ liệu.

Lý do chọn 3 loại này: đều là thao tác một lần do người dùng bấm, chạy ngắn, và kết quả hiện ngay trên màn hình đang mở. Có cùng kiểu kẹt như export. Không đưa `chapter.proofread` vào vì nó gọi LLM cả chương, chạy lâu, ưu tiên nó sẽ chặn lô dịch. Không ưu tiên hơn nữa vì job đang chạy không bị ngắt; chạy trước ngay khi worker rảnh là đủ.

## Architecture
```ts
// apps/api/src/jobs/enqueue.ts — cạnh CHAIN_PRIORITY (translate-chain.ts:38)
/** Job người dùng bấm và đang chờ trên màn hình (xuất file, tẩy lại trang, OCR vùng): chạy ngắn → claim trước
 *  lô dịch (50) và xoá chữ + OCR (100) của chương khác, không xếp sau backlog cả chương. */
export const INTERACTIVE_PRIORITY = 10;
```
Truyền `priority: INTERACTIVE_PRIORITY` vào `insertJob` trong `enqueueReinpaint` (`:337`), `enqueueOcrRegion` (`:362`), `enqueueExport` (`:420`).

## Related Code Files
- Modify: `apps/api/src/jobs/enqueue.ts`
- Modify: `apps/api/test/queue.test.ts`: thêm ca thứ tự claim
- Modify: `docs/job-queue-worker.md`: thêm bảng priority vào đoạn "Job dịch có `priority = 50`…"

## Implementation Steps
1. Thêm hằng `INTERACTIVE_PRIORITY` và truyền vào 3 chỗ `insertJob` nói trên.
2. Thêm test vào `queue.test.ts`, dựa theo test tái hiện đã chạy lúc debug:
   - Chương S2 có 5 job priority 100 tạo **trước** export, và 1 job priority 50 tạo **sau** export.
   - Chương S1 tạo export qua **`enqueueExport` thật**, không dùng `insertJob` tay, để test bắt được nếu ai đó bỏ priority sau này. Cần seed page và `page_states` đủ để `exportKey` chạy.
   - Claim từng job (`max: 1`) → job đầu tiên là export S1, tiếp theo là job 50, sau đó là các job 100.
   - Lưu ý: format hợp lệ là `png_zip` hoặc `cbz` (`EXPORT_FILE`, `packages/shared/src/job.ts:94`), không phải `zip`.
3. Kiểm `enqueueReinpaint` / `enqueueOcrRegion` cũng có priority 10: assert `job.priority` trong test của từng route nếu đã có test, không thì thêm assert đơn giản.
4. Sửa doc.

## Success Criteria
- [x] Test mới pass, các test cũ của `queue`, `export`, `worker-protocol` vẫn xanh.
- [x] Doc ghi đúng 3 mức priority và lý do.

## Risk Assessment
- Người dùng bấm xuất liên tục: idempotency key của export chặn tạo job trùng khi nội dung không đổi, nên không làm đói lô dịch.
- Dispatcher Modal tính tuổi job theo `run_after` (`dispatcher.ts:78`), không theo priority, nên phần này không ảnh hưởng dispatcher.
