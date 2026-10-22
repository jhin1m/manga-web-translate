---
phase: 6
title: "Docs + hồi quy toàn luồng"
status: done
priority: P2
effort: "0.5d"
dependencies: [1, 2, 3, 4, 5]
---

# Phase 6: Docs + hồi quy toàn luồng

## Overview
Chạy toàn bộ gate + kiểm tay trên trình duyệt với chương mẫu; cập nhật docs.

## Requirements
- Functional: kiểm tay (dev, `pnpm dev` + worker thật hoặc fake):
  1. Thả chương mẫu 96 ảnh → rail 96 ảnh khi đang tải; xem lớn; ←/→.
  2. Xoá ảnh credit cuối → "Luôn bỏ ở series" → Bước 1 → không có trang credit.
  3. Tạo chương kế với cùng credit → "Credit · tự bỏ" trước Bước 1.
  4. Sau Bước 1 ẩn 1 trang → Bước 2 → trang đó không dịch; khôi phục → chương về "Chờ dịch".
  5. Thêm "discord.gg" (hoặc watermark thật của mẫu) → Bước 2 → không box watermark.
  6. Xuất `pages` + `original_slices` có trang ẩn → mở zip kiểm số file/thứ tự.
- Non-functional: không tăng thao tác trong `click-budget`.

## Related Code Files
- Modify: `docs/editor.md` (rail ảnh gốc, xoá/khôi phục, nhãn credit), `docs/export-and-batch-edit.md` (trang ẩn khi
  xuất), `docs/job-queue-worker.md` (skip ở ingest/translate, ExportInputs.skipped, ignore_text), docs series/cài đặt
  nếu có mục tương ứng (đọc trước khi sửa)
- Modify: `plan.md` + phase files (status, số đo ngưỡng hash/thời gian)

## Implementation Steps
1. **Tests Before**: `main` mới nhất, gate chung xanh trước khi kiểm tay.
2. Kiểm tay 6 kịch bản; lỗi → sửa ở branch của phase gây ra, thêm test tái hiện.
3. Docs: đọc từng file trước khi sửa; chỉ ghi hành vi thật đã kiểm; giới hạn đã biết (credit cùng width dính page lớn,
   watermark detector không bắt, AI phân loại chưa có).
4. **Regression Gate**: `pnpm typecheck && pnpm lint && pnpm test` + `pnpm --filter @mtl/web e2e` (toàn bộ) +
   `cd worker && uv run pytest`.

## Success Criteria
- [x] 6 kịch bản kiểm tay đạt; ghi kết quả ngắn vào `plan.md`.
- [x] Toàn bộ test + e2e xanh trên `main`.
- [x] Docs khớp hành vi thật, không nhắc plan/phase.

## Risk Assessment
- E2E dùng DB/cổng chung → chạy tuần tự, không song song với phase khác.

## Ghi chú từ P3 (user chốt 2026-10-22)
- Ẩn/khôi phục trang sau khi đã xuất **không** đánh dấu "cần xuất lại" — để đợt sau; ghi vào docs.
- Reinpaint/OCR vùng ở API không chặn trang ẩn (UI không với tới) — không làm.
- Deploy: worker Mac/Modal phải lên 0.4.2 cùng lúc API (MIN_PIPELINE_VERSION 0.4.2).
