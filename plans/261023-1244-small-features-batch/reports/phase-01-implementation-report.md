# Báo cáo Phase 1: ẩn/khôi phục trang → cần xuất lại

## File thay đổi
- `packages/db/src/schema/app.ts`: cột `pages.skip_changed_at timestamptz null`.
- `packages/db/migrations/0011_pages_skip_changed_at.sql` (+ `meta/_journal.json`, `meta/0011_snapshot.json`); đã đổi tên từ tên drizzle sinh ra theo quy ước 0007-0010.
- `packages/db/migrations-down/0011_pages_skip_changed_at.down.sql`.
- `apps/api/src/routes/pages.ts`: PATCH chỉ UPDATE khi `skipped` khác giá trị mới, set `skip_changed_at = now()` (giờ DB). PATCH cùng giá trị là no-op.
- `apps/api/src/routes/series.ts`: `exportStatus` thêm `maxBy(pages.skipChangedAt)` trong `Promise.all`, đưa vào `bump`; cập nhật doc comment.
- `apps/api/test/chapters.test.ts`: thêm 1 test (export → ẩn → reexport; khôi phục → vẫn reexport; xuất lại → hết; PATCH lặp → không bật).
- `docs/export-and-batch-edit.md`: 1 dòng về trigger mới.
- Phase file: `status: completed`, tick tiêu chí đã kiểm.

## Kiểm tra
- `pnpm db:migrate`: áp dụng thành công.
- `pnpm --filter @mtl/api test`: 21 file / 177 test xanh (test mới fail khi bỏ thay đổi series.ts, xác nhận có hiệu lực).
- `pnpm --filter @mtl/api typecheck`, `pnpm lint`: sạch.

## Ghi chú
- Web không đổi: `pageSkip.onSettled = data.refresh` đã invalidate `seriesKeys.list(ws)` (khoá `["series", ws]`) nên next-action cập nhật.
- Chưa kiểm tay UI "Xuất lại" (tiêu chí thứ 2 của phase để mở).
- File down chưa chạy thử trên DB.
