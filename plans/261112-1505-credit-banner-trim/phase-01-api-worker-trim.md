---
phase: 1
title: "API + DB + worker: source_files.trim"
status: completed
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: API + DB + worker — `source_files.trim`

## Overview
Lưu số pixel cắt mép trên/dưới cho từng ảnh gốc; Bước 1 cắt ảnh theo đó trước khi ghép/cắt trang. Chưa có UI.

## Requirements
- `source_files.trim` jsonb null: `{top: int ≥ 0, bottom: int ≥ 0, by: "user" | "credit"}` (null = không cắt;
  `top = bottom = 0` lưu thành null). `by` để web hiện nhãn "Credit · tự cắt" (P4).
- `PATCH /chapters/:id/source-files/:fileId` nhận thêm `trim` (`{top, bottom} | null`) và `height?` (cao thật web đo
  được, chỉ dùng khi hàng chưa có `height` — ảnh > 16k px trên Safari không tính được dấu). Body có `skip` và/hoặc
  `trim`, ít nhất một. Cắt tay luôn ghi `by: "user"`.
- Guard y như skip: khoá dòng chương, `assertSourcesEditable` → 423 khoá ở tab khác, 409 `chapter_not_draft`.
- Kiểm biên: `h = row.height ?? body.height`; không có `h` → 400 `no_size`; phải còn ≥ `MIN_TRIM_KEEP_PX = 64` px →
  400 `trim_too_large`. Hằng ở `packages/shared` (web dùng chung).
- `sourceFileView` và `GET /chapters/:id/source-files` trả `trim`.
- `chapter.ingest` inputs: `sources[].trim: {top, bottom} | null` (bỏ `by`). Worker cắt `image[top : H − bottom]`
  trước `build_pages`; kẹp phòng thủ (giữ ≥ 1 px) nếu số liệu vượt ảnh thật.
- `source_map.src_y` theo ảnh **đã cắt** → `SliceAssembler` không đổi, xuất `original_slices` ra slice đã cắt.
- `ingestKey`: id ảnh có trim băm thành `id:top:bottom`; ảnh không cắt giữ `id` như cũ.
- Học credit từ trang (`filesInsidePage`, `series-skip-images.ts:58`) bỏ ảnh có `trim` (nếu không, học nhầm cả ảnh gốc
  gồm trang truyện) → không còn ảnh nào → `no_whole_image` như hiện nay.
- Version: worker `PIPELINE_VERSION = "0.12.0"` (+ dòng ghi chú lý do); API `MIN_PIPELINE_VERSION` mặc định
  `"0.12.0"` (+ dòng ghi chú ở `env.ts`). Không đổi API `PIPELINE_VERSION`.

## Architecture
```
web PATCH {trim} ─▶ source_files.trim ─▶ commit/enqueueIngest ─▶ claim-inputs sources[].trim
  ─▶ worker handle_ingest: open_rgb → crop(top,bottom) → SourceSlice ─▶ build_pages (không đổi)
  ─▶ pages.source_map (src_y theo ảnh đã cắt) ─▶ export SliceAssembler (không đổi)
```

## Related Code Files
- Modify: `packages/db/src/schema/app.ts` (cột `trim` + check `by`), migration mới (tên kiểu `add_source_file_trim`)
- Modify: `packages/shared/src/job.ts` (`SourceTrim` zod, `MIN_TRIM_KEEP_PX`), `packages/shared/src/worker-protocol.ts`
  (`IngestInputs.sources[].trim`), `packages/shared/json-schema/*` (sinh bằng `pnpm schema:emit`)
- Modify: `apps/api/src/routes/chapters.ts` (`SourceSkipBody` → body skip/trim, PATCH, `sourceFileView`)
- Modify: `apps/api/src/routes/pages.ts` (GET source-files nếu view riêng), `apps/api/src/jobs/claim-inputs.ts:150`,
  `apps/api/src/jobs/idempotency.ts:21` + nơi gọi `ingestKey`, `apps/api/src/routes/series-skip-images.ts:58`,
  `apps/api/src/env.ts:79`
- Modify: `worker/mtl_worker/ingest.py`, `worker/mtl_worker/__init__.py`, schema worker nếu có bản sao
- Tests: `apps/api/test/chapters.test.ts`, `apps/api/test/series-skip-images.test.ts`,
  `worker/tests/test_ingest_cuts.py` (hoặc test handler ingest), `worker/tests/test_export_slices.py`,
  `worker/tests/test_contract_schema.py`

## Implementation Steps
1. Tests trước: API PATCH trim (200, 400 `trim_too_large`/`no_size`, 409, 423, `null` xoá trim, `0/0` → null);
   ingestKey đổi khi trim đổi, không đổi với ảnh không cắt; claim inputs có `trim`.
2. Migration + schema drizzle; zod `SourceTrim`; body PATCH.
3. `claim-inputs.ts`: map `trim` (bỏ `by`); `ingestKey` nhận `{id, trim}`.
4. Worker: hàm thuần `apply_trim(img, trim)` trong `mtl_pipeline/ingest.py` + gọi ở `handle_ingest`; test: slice
   1000 px, trim 100/200 → page tổng cao 700, `source_map` của slice `src_y` 0..700; strip 2 slice cùng width.
5. Test export: ingest có trim → `SliceAssembler` xuất slice cao 700 (khoá hành vi "bản xuất không có banner").
6. `filesInsidePage` bỏ ảnh có trim + test.
7. Version bump + `pnpm schema:emit` + contract test.

## Success Criteria
- [x] Unit/API/worker test mới xanh; gate chung xanh.
- [x] Worker 0.11.x claim → 426.
- [x] Ingest chương không có trim cho kết quả y hệt trước (test ingest cũ không sửa).

## Risk Assessment
- Quên bump MIN → worker cũ fail schema mọi ingest có trim. Mitigation: test khoá `MIN_PIPELINE_VERSION ≥ 0.12.0`.
- `height` null + web không gửi height → 400 rõ ràng, UI báo "Chưa đo được ảnh, thử lại".
- Rollback: cột nullable; bỏ code đọc trim là đủ (dữ liệu thừa vô hại).
