---
phase: 6
title: "Font tuỳ chỉnh theo workspace"
status: completed
priority: P3
effort: "2d"
dependencies: []
---

# Phase 6: Font tuỳ chỉnh theo workspace

## Overview
Owner/admin upload font TTF/OTF ở trang cài đặt workspace; font dùng được trong editor, mặc định font của series, auto
typeset và bản xuất.

## Hiện trạng
- Font gói sẵn: `worker/fonts/*.ttf` + `manifest.json` (`{id: {file, unitsPerEm, ascent, descent, metricsSource,
  viComplete, missing}}`), sync sang `apps/web/public/fonts/` bằng `apps/web/scripts/sync-fonts.ts` (`--check` trong
  `pnpm test`).
- Editor: `apps/web/src/features/editor/fonts.ts:58-63` `FontFace(id, url(/fonts/<file>))`, metrics từ manifest.
- Worker: `worker/mtl_pipeline/fonts.py:64-74` `font_path(id)` chỉ tìm trong `FONTS_DIR`; `metrics_for` đọc từ file.
- ID font hard-code: `apps/api/src/routes/series.ts:30-39` `FONT_IDS` (`z.enum` cho `default_fonts`),
  `apps/web/src/features/series/api.ts:5-15` (bản sao), `apps/api/test/fonts.test.ts:14`. `TextBox.font_family` và
  settings job là `z.string()`.
- Storage: `presignPost`/`presignGet` (`apps/api/src/storage.ts`), worker tải input qua presigned GET
  (`claim-inputs.ts`, `INPUT_GET_TTL_S`). Chưa có trang cài đặt workspace (chỉ `members`).

## Requirements
- Functional:
  - Upload: TTF/OTF (kiểm magic bytes), ≤ 10MB, ≤ 20 font/workspace, trùng sha256 trong workspace → trả font có sẵn.
    WOFF/WOFF2 từ chối (Pillow không đọc được).
  - API đọc font: tên hiển thị (name table), unitsPerEm/ascent/descent **theo đúng quy tắc chọn metrics của manifest**
    (`metricsSource`), độ phủ glyph tiếng Việt → cảnh báo "thiếu dấu: …" (vẫn cho dùng).
  - Danh sách font = gói sẵn + font workspace, ở: select mặc định font series, panel thuộc tính editor (nhóm "Font của
    nhóm").
  - Xoá font: 409 nếu đang là mặc định của series nào; box đã dùng font bị xoá → render/editor fallback font thoại mặc
    định (không lỗi job).
  - Thành viên thường xem danh sách, không upload/xoá.
- Non-functional: editor và worker cho cùng layout (cùng metrics); URL font presigned TTL ngắn, editor tải lại khi hết
  hạn; không lộ key storage của workspace khác.

## Architecture
- DB `workspace_fonts`: `id uuid`, `workspace_id`, `font_id text unique` (dạng `custom-<8 hex>`, không trùng id gói
  sẵn), `name`, `file_key`, `sha256`, `bytes`, `units_per_em`, `ascent`, `descent`, `vi_complete`, `missing text[]`,
  `created_by`, `created_at`; unique `(workspace_id, sha256)`. Migration + down. `storageKeys` thêm prefix font.
- API (route mới `apps/api/src/routes/fonts.ts`): `POST /w/:ws/fonts/upload-url` (presignPost, admin),
  `POST /w/:ws/fonts {key}` (tải qua client internal, kiểm, parse bằng `fontkit` — MIT — lưu), `GET /w/:ws/fonts`
  (kèm presigned GET), `DELETE /w/:ws/fonts/:id`.
- Validation font id: hàm `isKnownFont(sdb, id)` = id gói sẵn (đọc từ manifest, bỏ `FONT_IDS` bản sao) hoặc font của
  workspace → dùng cho `default_fonts`. Web lấy danh sách từ manifest + `GET fonts` thay cho `FONT_IDS`.
- Bộ ký tự tiếng Việt: dùng chung 1 nguồn với worker (`fonts.py missing_glyphs`) — đưa danh sách vào
  `packages/shared` nếu chưa có, worker giữ bản Python có test so khớp (hoặc đọc JSON chung).
- Job: input `chapter.translate` và `chapter.export` thêm `fonts: [{id, url, sha256}]` cho font tuỳ chỉnh được dùng
  (translate: mặc định series; export: font trong box + mặc định). zod `job.ts` → `schema:emit`.
- Worker: tải font về cache theo sha256, đăng ký `id → path` cho job; `font_path` tra registry trước `FONTS_DIR`;
  id không biết → fallback + log. `PIPELINE_VERSION` 0.5.x và **tăng `MIN_PIPELINE_VERSION`** khi deploy.
- Web: route `/w/$ws/settings` (tab "Font": upload, danh sách, cảnh báo thiếu dấu, xoá) + link cạnh "Thành viên";
  `fonts.ts` nạp thêm font workspace bằng `FontFace(font_id, url(presigned))`.

## Related Code Files
- Create: `packages/db/migrations/0012_workspace_fonts.sql` + down, `apps/api/src/routes/fonts.ts`,
  `apps/api/test/fonts-upload.test.ts`, `apps/web/src/routes/workspace-settings.tsx` (hoặc theo cấu trúc route hiện
  có), `apps/web/src/features/fonts/` (api + hook), worker test font registry
- Modify: `packages/db/src/schema/app.ts`, `packages/shared/src/storage-keys.ts`, `packages/shared/src/job.ts`,
  `apps/api/src/app.ts` (mount route), `apps/api/src/routes/series.ts`, `apps/api/src/jobs/claim-inputs.ts`,
  `apps/api/test/fonts.test.ts`, `apps/api/test/tenant-isolation.test.ts`, `apps/web/src/features/series/api.ts`,
  `series-settings-form.tsx`, `apps/web/src/features/editor/fonts.ts`, `panels/Properties.tsx`,
  `apps/web/src/app/router.tsx`, `worker/mtl_pipeline/fonts.py`, `worker/mtl_worker/handlers.py` / `runner.py`,
  `apps/api/src/env.ts` (MIN_PIPELINE_VERSION)
- Docs: `docs/editor.md`, `docs/job-queue-worker.md`, `docs/typeset-layout-contract.md` (metrics font tuỳ chỉnh),
  `docs/deployment-guide.md` (thứ tự deploy worker/API), README

## Implementation Steps
1. Đọc `sync-fonts.ts` / script sinh manifest để chốt quy tắc metrics; viết hàm metrics TS + test so với manifest của
   các font gói sẵn (phải khớp số) → đảm bảo parity.
2. Schema + migration + storage key.
3. Route fonts + test (magic bytes, 10MB, giới hạn 20, trùng sha256, member 403, xoá đang dùng 409, tenant isolation).
4. Validation `default_fonts` động; bỏ `FONT_IDS` bản sao web; sửa `fonts.test.ts`.
5. Claim inputs + zod job + worker registry/fallback + test worker.
6. Web: trang cài đặt, danh sách font trong series form + editor; e2e upload 1 font (dùng file trong `worker/fonts`
   làm fixture) → chọn làm mặc định series → editor hiển thị font.
7. Docs + thứ tự deploy.

## Tiến độ
- 6a xong (bước 1, 2, 3, 4, 6): metrics fontkit + test parity manifest, bảng `workspace_fonts` (migration 0012), route
  `/w/:ws/fonts*`, `default_fonts` kiểm động, trang `/w/$ws/settings` (tab Font), select series + editor có nhóm "Font của
  nhóm", e2e `workspace-fonts.spec.ts`, docs/editor.md. Chi tiết: `reports/phase-06a-implementation-report.md`.
- 6b xong (bước 5, 7): `inputs.fonts` cho translate/export (`claim-inputs.ts`, zod `JobFonts`), worker tải font theo sha256
  (`mtl_worker/job_fonts.py`) + registry/fallback trong `mtl_pipeline/fonts.py`, `PIPELINE_VERSION` 0.5.1 và
  `MIN_PIPELINE_VERSION` 0.5.1, docs worker/deploy/layout, README, TODO. Chi tiết: `reports/phase-06b-implementation-report.md`.
- Deploy: worker 0.5.1 trước, API (migration 0012 + `MIN_PIPELINE_VERSION`) sau.

## Success Criteria
- [x] Test api/web/worker/e2e xanh; `sync-fonts --check` vẫn xanh.
- [ ] Font upload hiện trong editor, auto typeset dùng đúng font, bản xuất render đúng font (đã kiểm ở mức test: editor
      e2e, worker render bằng font đăng ký = bản gói sẵn); còn lại soi mắt parity chữ Konva ↔ render.py trên 1 trang dùng
      font tuỳ chỉnh (thủ công).
- [x] Xoá font đang dùng bị chặn; font đã xoá trong box cũ fallback, export không lỗi.

## Risk Assessment
- Lệch metrics editor ↔ worker → bước 1 test parity với manifest; worker đọc metrics từ file → cùng quy tắc.
- Font độc hại/hỏng làm crash parser → parse trong try, giới hạn kích thước; worker chỉ tải font đã qua API.
- Bản quyền font do nhóm tự chịu (MVP không ràng buộc license — xem ghi chú Phase 8).
- Phase lớn nhất: có thể tách 6a (upload + editor + series) / 6b (worker + export) nếu cần ship sớm; 6a một mình thì
  chặn chọn font tuỳ chỉnh làm mặc định series cho tới khi có 6b.
