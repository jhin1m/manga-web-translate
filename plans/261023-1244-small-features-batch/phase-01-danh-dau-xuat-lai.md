---
phase: 1
title: "Ẩn/khôi phục trang sau khi xuất → cần xuất lại"
status: completed
priority: P1
effort: "2h"
dependencies: []
---

# Phase 1: Ẩn/khôi phục trang sau khi xuất → cần xuất lại

## Overview
Ẩn hoặc khôi phục trang sau lần xuất thành công cuối phải bật cờ `reexport` ("Sửa sau lần xuất" / "Xuất lại"), như sửa
tay hay dịch lại.

## Hiện trạng
- `apps/api/src/routes/series.ts:114-174` `exportStatus()`: `reexport` = có export succeeded và (job `chapter.translate`
  hoặc `page_states.updated_at`) mới hơn `created_at` của export cuối.
- Ẩn/khôi phục = `PATCH /w/:ws/pages/:pageId` (`apps/api/src/routes/pages.ts:86-107`) chỉ đổi `pages.skipped`, không
  chạm `page_states` → không bật `reexport`. Bảng `pages` không có `updated_at`.
- Key idempotency export đã đổi theo skip (`idempotency.ts:43-55`) → xuất lại tạo job mới đúng; chỉ thiếu cờ.

## Requirements
- Functional: đổi `skipped` (true↔false) sau export cuối → chương vào `reexport`. Đổi trước export → không ảnh hưởng.
  Gọi PATCH với giá trị không đổi → không bump.
- Non-functional: 1 cột + 1 truy vấn `max` thêm trong `exportStatus`; không đổi hợp đồng API.

## Architecture
- Cột `pages.skip_changed_at timestamptz null`. PATCH set `now()` khi giá trị thật sự đổi.
- `exportStatus`: thêm `sdb.maxBy(pages, { chapterId }, pages.skipChangedAt, inArray(pages.chapterId, ids))` → `bump`.
  `max` bỏ qua null nên chương chưa từng ẩn không bị ảnh hưởng.

## Related Code Files
- Create: `packages/db/migrations/0011_pages_skip_changed_at.sql` (qua `pnpm db:generate`),
  `packages/db/migrations-down/0011_pages_skip_changed_at.down.sql`
- Modify: `packages/db/src/schema/app.ts` (pages), `apps/api/src/routes/pages.ts`, `apps/api/src/routes/series.ts`
- Modify (nếu cần): `apps/web/src/features/chapter/chapter-workspace.tsx` / `page-rail.tsx`: sau `setPageSkip`
  invalidate query danh sách chương của series để next-action cập nhật.
- Test: `apps/api/test/chapters.test.ts` (gần block reexport `:671-730`)

## Implementation Steps
1. Thêm cột vào schema → `pnpm db:generate` → viết file down (`ALTER TABLE pages DROP COLUMN skip_changed_at`).
2. PATCH page skip: trong tx hiện có, `UPDATE ... SET skipped = $v, skip_changed_at = now() WHERE skipped <> $v`.
3. `exportStatus`: thêm truy vấn max skip_changed_at chạy song song trong `Promise.all`; có thể gộp với `countBy` pages
   đang dùng để lấy `chapterOf` nếu helper `scoped` cho phép, không thì để 2 truy vấn.
4. Sửa doc comment `exportStatus` (thêm "ẩn/khôi phục trang").
5. Web: kiểm tra mutation `setPageSkip` đã invalidate dữ liệu series/next-action chưa; thiếu thì thêm.

## Tests
- export succeeded → ẩn trang → `reexport` có chương; khôi phục → vẫn `reexport`.
- ẩn trang → export → không `reexport`.
- PATCH cùng giá trị sau export → không `reexport`.

## Success Criteria
- [x] 3 test trên xanh, test reexport cũ không đổi.
- [ ] Màn series/chương hiện "Xuất lại" sau khi ẩn trang ở chương đã xuất (kiểm tay hoặc e2e có sẵn).
- [x] `docs/export-and-batch-edit.md` ghi thêm trigger mới (1 dòng).

## Risk Assessment
- Thấp. Rollback = migration down + revert. Đồng hồ: dùng `now()` của DB (cùng nguồn với `jobs.created_at`) để không
  lệch giờ API/DB.
