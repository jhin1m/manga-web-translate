---
phase: 1
title: "API + DB: bỏ qua ảnh gốc trước Bước 1"
status: completed
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: API + DB — bỏ qua ảnh gốc trước Bước 1

## Overview
Thêm `source_files.skip` + endpoint đánh dấu/khôi phục; commit (Bước 1) và input `chapter.ingest` bỏ ảnh skip.

## Requirements
- Functional:
  - `skip`: `null | "user" | "credit"` (credit dùng ở P4; P1 chỉ nhận `"user"`/`null` từ API).
  - `PATCH /w/:ws/chapters/:chapterId/source-files/:fileId` body `{ skip: "user" | null }` → 200 view file.
    Chỉ khi chương **chưa có page** (`draft`, hoặc `partial_failed` không page — cùng điều kiện commit dùng);
    ngược lại 409 `chapter_not_draft`. Người khác giữ khoá → 423 `chapter_locked` (như commit). File khác chương → 404.
  - Commit: lọc `skip IS NULL` trước HEAD/kiểm magic bytes; mọi file bị skip → 400 `no_valid_files`
    (thông điệp "Đã bỏ hết ảnh"). Ảnh skip **không** bị xoá hàng (giữ để hoàn tác + resume).
  - Claim `chapter.ingest` (`claim-inputs.ts:122`) chỉ lấy `skip IS NULL`.
  - `GET /chapters/:id` (`source_files[]`) và `GET …/source-files` trả thêm `skip`.
- Non-functional: tenant isolation như các route chapter khác (đi qua `sdb` scoped).

## Architecture
`skip` là cột text nullable + check `skip IN ('user','credit')`. Không đổi `ord` (ingest sort theo ord, lỗ hổng OK).
Resume upload không bị ảnh hưởng vì hàng vẫn còn → số lượng/bytes vẫn khớp `source_files`.

## Related Code Files
- Modify: `packages/db/src/schema/app.ts` (sourceFiles.skip), migration mới `packages/db/migrations/0007_source_file_skip.sql`
- Modify: `apps/api/src/routes/chapters.ts` (commit lọc skip, detail trả skip, route PATCH mới — hoặc đặt cạnh
  `source-files` GET trong `apps/api/src/routes/pages.ts`; chọn `pages.ts` để gom route source-files)
- Modify: `apps/api/src/jobs/claim-inputs.ts` (ingest lọc skip)
- Modify: `apps/web/src/features/chapter/api.ts` types (`skip` trên source file) — chỉ type, UI ở P2
- Tests: `apps/api/test/chapters.test.ts`, `apps/api/test/tenant-isolation.test.ts`, `apps/api/test/queue.test.ts`

## Implementation Steps
1. **Tests Before**: chạy `chapters.test.ts` + `queue.test.ts` xanh; thêm test khoá hành vi hiện tại: commit nhận đủ
   file theo ord, ingest input chứa mọi source theo ord (nếu chưa có).
2. Schema + migration; `pnpm db:generate`, đổi tên file, `pnpm db:migrate`.
3. Route PATCH (zod body `{ skip: z.enum(["user"]).nullable() }`), kiểm trạng thái + khoá giống commit.
4. Commit lọc skip; ingest claim lọc skip; detail/source-files trả `skip`.
5. **Tests After**:
   - PATCH skip/khôi phục; 409 khi chương đã có page; 423 khi người khác giữ khoá; 404 file chương khác / workspace khác
     (thêm vào tenant-isolation).
   - Commit với 1 file skip → `accepted` không đếm file đó, hàng vẫn còn với `skip='user'`; skip hết → 400.
   - Ingest inputs không chứa file skip.
6. **Regression Gate**: `pnpm typecheck && pnpm lint && pnpm --filter @mtl/api test`.

## Success Criteria
- [x] Bước 1 với ảnh skip → ingest không nhận ảnh đó (test claim).
- [x] Hoàn tác (`skip: null`) trước Bước 1 → ảnh quay lại input ingest.
- [x] Test cũ không phải nới assert.

## Lệch so với plan khi làm (sau code review)
- Route PATCH đặt ở `apps/api/src/routes/chapters.ts` (không phải `pages.ts`) để dùng chung guard
  `assertSourcesEditable` với commit.
- PATCH chạy trong transaction, khoá dòng chương (`lockChapter`, export từ `jobs/enqueue.ts`) → không đổi bộ ảnh xen
  giữa lúc Bước 1 enqueue. Commit đọc lại ảnh không skip sau khi khoá; khác bộ đã kiểm → 409 `sources_changed`
  (không ghép ảnh chưa kiểm magic bytes). `fileId` không phải uuid → 404.
- `enqueueIngest` lọc skip khi tính khoá idempotency (plan bỏ sót; thực tế khoá đã có `ingest_rev` nên chỉ để đúng
  ngữ nghĩa).
- Thêm `packages/db/migrations-down/0007_source_file_skip.down.sql`.
- Để P4 quyết: `PATCH {skip:"user"|null}` ghi đè lý do `credit` do server gán (khôi phục ảnh credit = `null`).
- Kết quả: API 165/165, web/shared/db xanh, typecheck + lint sạch. E2E `upload-chapter`/`full-flow` đỏ **sẵn trên
  main**: fake worker e2e khai `0.4.0` < `MIN_PIPELINE_VERSION` 0.4.1 (commit `b2c5915`) → claim 426.

## Risk Assessment
- Commit chạy lại khi `partial_failed` (ingest lỗi): vẫn lọc skip → đúng. Rủi ro thấp.
- File skip chưa upload xong vẫn không làm commit reject (đã lọc trước HEAD) → mong muốn.
