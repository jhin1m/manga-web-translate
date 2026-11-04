---
phase: 7
title: "Font hệ thống"
status: completed
priority: P2
effort: "1d"
dependencies: [1]
---

# Phase 7: Font hệ thống

## Overview

Admin upload/xoá font TTF/OTF dùng chung cho mọi user (D7, T16). Tái dùng luồng `user_fonts` (presigned POST → API kiểm
magic bytes/kích thước/fontkit → copy sang key cuối) và `job_fonts.py` phía worker. <!-- red-team --> Id dùng lại dạng
`custom-<8hex>` (`font_id` đã unique toàn bảng, `app.ts:191`) → `JobFonts` regex, json-schema, `isCustomFontId`,
`resolveCustomFonts` filter **không đổi**, không phụ thuộc hợp đồng 0.10.0. Storage `system/fonts/`. Migration **0025
`system_fonts`**.

## Requirements

- Functional:
  - Mục **Hệ thống › Font hệ thống**: list (tên, dung lượng, đủ chữ Việt / thiếu chữ), upload, xoá icon.
    <!-- red-team --> Trần: tối đa **20 font hoặc tổng 100MB** (cái nào chạm trước) → 409 `limit`.
  - `GET /api/admin/fonts`, `POST /api/admin/fonts/upload-url`, `POST /api/admin/fonts` (commit), `DELETE
    /api/admin/fonts/:fontId` — cùng mã lỗi `too_large`/`not_font`/`corrupt_font`/`not_uploaded`/`limit` như
    `routes/fonts.ts`. Trùng sha256 → trả font có sẵn. Xoá font đang là mặc định của series bất kỳ → 409 `in_use` (số
    series, không lộ tên series của user khác).
  - `GET /api/fonts` (mọi user) trả thêm font hệ thống, mỗi item có `system: boolean`; trang "Font của tôi" chỉ hiện font
    riêng; <!-- red-team --> giới hạn 20 font riêng (`MAX_USER_FONTS`) **không đếm** font hệ thống ở mọi chỗ (API
    `routes/fonts.ts:96`, web `font-settings.tsx`, `series-settings-form.tsx:119`, `fontUploadError` `fonts/api.ts:54`).
  - Picker font series + <!-- red-team --> ô chọn font editor (`Properties.tsx`) có 2 nhóm: "Font hệ thống" và "Font của bạn".
  - Series chọn được font hệ thống làm mặc định; editor vẽ đúng; job translate/export đính `inputs.fonts` gồm font hệ
    thống → worker render đúng.
- Non-functional: không đổi hợp đồng worker; DRY — tách phần kiểm font dùng chung, không chép route.

## Architecture

- DB `packages/db/src/schema/app.ts`: `systemFonts` = cột của `userFonts` (`app.ts:186-207`) trừ `user_id`; `font_id`
  unique, `sha256` unique, `created_by` (id admin). Migration `pnpm --filter @mtl/db generate --name system_fonts` + down
  `DROP TABLE system_fonts;`.
- <!-- red-team --> Id: `newCustomFontId()` (`lib/fonts.ts:21`) + kiểm không trùng ở **cả** `user_fonts` và `system_fonts` khi
  sinh (thử lại tối đa 3 lần; xác suất trùng ~2^-32). Ngược lại `routes/fonts.ts` sinh id riêng cũng kiểm `system_fonts`.
- `packages/shared/src/storage-keys.ts`: `systemFontUpload: (uploadId) => \`system/fonts/uploads/${uploadId}\``,
  `systemFont: (fontId) => \`system/fonts/${fontId}\``. Prefix `system/` không thuộc user nào → `keyBelongsToUser` luôn
  false cho key này (đúng); route admin kiểm `key.startsWith("system/fonts/uploads/")`.
- `apps/api/src/lib/font-upload.ts` (tách từ `routes/fonts.ts:76-139`): `inspectUploadedFont(key)` → `{ bytes, sha256,
  info }` hoặc ném `fail(...)` + dọn object; `fontView(row, system)` dùng chung. `routes/fonts.ts` gọi lại (hành vi không
  đổi — Tests Before).
- `apps/api/src/lib/fonts.ts`: `unknownFonts` (`:27`) loại thêm id có trong `system_fonts`; `resolveCustomFonts` (`:44`)
  lọc `isCustomFontId` như cũ rồi tra cả `user_fonts` (scoped) và `system_fonts` → `claim-inputs.ts:145` `fontInputs` tự
  có, không sửa.
- `apps/api/src/routes/admin-fonts.ts` (mount trong `adminApi()`); `routes/fonts.ts:61` GET gộp system (đứng trước);
  `:96` đếm giới hạn chỉ `user_fonts` (đã vậy — giữ, có test).
- Web:
  - `apps/web/src/features/fonts/api.ts`: `UserFont.system`; `fontUploadError(file, count)` caller truyền số font **riêng**.
  - `font-settings.tsx` lọc `!system` (list + đếm); `apps/web/src/features/series/series-settings-form.tsx:119` đếm
    `custom.data.filter(f => !f.system).length`; picker series nhóm "Font hệ thống".
  - <!-- red-team --> `apps/web/src/features/editor/fonts.ts:190` `FontKit.custom` giữ `system`;
    `apps/web/src/features/editor/panels/Properties.tsx:168-175` 2 `optgroup` ("Font hệ thống" / "Font của bạn");
    `apps/web/src/features/chapter/select-panel.tsx:168` truyền `kit.custom` như cũ (kiểm lại type).
  - `apps/web/src/features/admin/system-fonts-section.tsx`, `admin-sections.ts` mục `fonts`.
- Worker: không sửa (id `custom-*` như cũ); thêm test.

**Data flow**: admin upload → presigned POST `system/fonts/uploads/<uuid>` → commit: kiểm + trần → copy
`system/fonts/custom-xxxx` → `system_fonts` → user bất kỳ: `GET /api/fonts` → picker/editor (FontFace từ presigned GET) →
series default/text box `font_family = custom-xxxx` → claim translate/export: `resolveCustomFonts` → `inputs.fonts[{id, url,
sha256}]` → worker `job_fonts` tải, kiểm sha256, render.

## Related Code Files

- Create:
  - `packages/db/migrations/0025_system_fonts.sql` (+ snapshot/journal), `packages/db/migrations-down/0025_system_fonts.down.sql`
  - `apps/api/src/lib/font-upload.ts`, `apps/api/src/routes/admin-fonts.ts`, `apps/api/test/admin-fonts.test.ts`
  - `apps/web/src/features/admin/system-fonts-section.tsx`
- Modify:
  - `packages/db/src/schema/app.ts`, `packages/shared/src/storage-keys.ts`
  - `apps/api/src/lib/fonts.ts`, `apps/api/src/routes/fonts.ts`, `apps/api/src/routes/admin.ts`
  - `apps/api/test/fonts.test.ts`, `apps/api/test/fonts-upload.test.ts`, `apps/api/test/claim-fonts.test.ts`,
    `apps/api/test/isolate-queue.ts` (xoá `system_fonts`)
  - `apps/web/src/features/fonts/api.ts`, `font-settings.tsx`, `apps/web/src/features/series/series-settings-form.tsx`,
    `apps/web/src/features/series/series-sidebar.tsx:17`, `apps/web/src/features/editor/fonts.ts`,
    `apps/web/src/features/editor/panels/Properties.tsx`, `apps/web/src/features/chapter/select-panel.tsx`,
    `apps/web/src/features/admin/admin-sections.ts`
  - `apps/web/src/features/editor/__tests__/fonts.test.ts`, `apps/web/e2e/fonts.spec.ts`
  - `worker/tests/test_job_fonts.py`
  - `docs/job-queue-worker.md` mục "Font tuỳ chỉnh" (`:237`), `docs/design-guidelines.md`
- Delete: không.

## Implementation Steps

### Tests Before
1. `apps/api/test/fonts-upload.test.ts` (upload/commit/trùng/giới hạn/xoá in_use) + `fonts.test.ts:24` +
   `claim-fonts.test.ts:121-191` xanh — khoá luồng `user_fonts` trước khi tách `font-upload.ts`.
2. `worker/tests/test_job_fonts.py` xanh.
3. `apps/web/src/features/editor/__tests__/fonts.test.ts:42-53` xanh; thêm ca `fontUploadError` hiện tại (đếm = 20 → lỗi).

### Refactor / Implement
4. Tách `inspectUploadedFont` + `fontView` → chạy lại Tests Before (xanh không sửa test).
5. Schema + migration 0025 + down; storage keys.
6. `lib/fonts.ts` (unknown/resolve gộp system), sinh id kiểm 2 bảng, `admin-fonts.ts` (trần 20/100MB), `GET /api/fonts` gộp.
7. Web: mục Font hệ thống, lọc/đếm font riêng, nhóm picker + `Properties.tsx`; docs.

### Tests After
8. `admin-fonts.test.ts`: admin upload font hợp lệ → id `custom-[0-9a-f]{8}`; WOFF → `not_font`; trùng sha → cùng id;
   font thứ 21 → `limit`; tổng > 100MB (seed `bytes` lớn) → `limit`; key ngoài `system/fonts/uploads/` → 400; xoá khi series
   (của user khác) dùng → 409 không kèm tên series; user thường → 403.
9. `fonts.test.ts`: `isKnownFont(sdbA, <id hệ thống>)` true khi tồn tại, false khi đã xoá; `resolveCustomFonts` gộp system
   + riêng, không lẫn font riêng của user khác.
10. `claim-fonts.test.ts`: translate/export của user B dùng font hệ thống → `inputs.fonts` có `{id, url, sha256}`.
11. `fonts-upload.test.ts`: có 20 font hệ thống, user vẫn upload được font riêng đầu tiên (đếm riêng).
12. Web: `fontUploadError` với danh sách 20 font hệ thống + 0 riêng → không lỗi; `fonts.test.ts` editor: `FontKit.custom`
    giữ `system`. `worker/tests/test_job_fonts.py`: font tải từ key `system/fonts/…` đăng ký đúng id.
13. e2e `fonts.spec.ts`: admin upload font hệ thống → user khác chọn làm font thoại series → ô chọn font editor hiện tên
    trong nhóm "Font hệ thống".

### Regression Gate
```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @mtl/db generate   # No schema changes
cd worker && uv run pytest tests/test_job_fonts.py tests/test_contract_schema.py && cd ..
pnpm --filter @mtl/web e2e        # full suite — phase cuối
```

## Success Criteria

- [x] Font hệ thống hiện trong editor/picker của mọi user (nhóm riêng), render đúng ở worker.
- [x] Luồng font riêng không đổi hành vi; giới hạn 20 font riêng không đếm font hệ thống.
- [x] Trần 20 font / 100MB; xoá font hệ thống đang dùng → 409; không lộ dữ liệu user khác.
- [x] e2e đầy đủ xanh lúc xong phase (55/55); gate chung cuối xem `from-tester-261104-1544-final-regression-gate-report.md` (đang chạy riêng — chưa xác nhận ở thời điểm sync).

**Kết quả (2026-11-04)**: xong, review 8.5/10 (0 Critical/High); fix M1 (kiểu `selectShared`), M2 (xác nhận xoá inline), M3 (copy 409 + runbook SQL), L1, L5–L7 đã áp.
Lệch: `Scoped.selectShared` thêm mới; `allocateCustomFontId` kiểm toàn bộ `user_fonts` + `system_fonts`; advisory lock quanh kiểm trần;
409 trả `series_count`; không có force-delete. Chưa: runbook SQL (gỡ `default_fonts` trỏ font hệ thống) chưa chạy thử trên DB.
Báo cáo: `plans/reports/from-fullstack-developer-261104-1523-phase-07-system-fonts-report.md`,
`plans/reports/from-code-reviewer-261104-1534-phase-07-review-report.md`.

## Risk Assessment

| Rủi ro | Khả năng × Tác động | Giảm thiểu |
|---|---|---|
| Trùng id giữa `user_fonts` và `system_fonts` | Rất thấp × TB | Kiểm cả 2 bảng khi sinh + thử lại |
| Tách `font-upload.ts` làm đổi hành vi upload riêng | TB × TB | Tests Before khoá; tách thuần, không đổi mã lỗi |
| Editor tải mọi font hệ thống mỗi phiên | TB × Thấp | Trần 100MB; tải lười để sau nếu đo thấy chậm |
| Font hệ thống bị xoá khi text box còn dùng | TB × Thấp | Fallback font mặc định như font riêng đã xoá; chỉ chặn khi là mặc định series |
| Prefix `system/` lọt qua kiểm key người dùng | Thấp × Cao | `keyBelongsToUser` chỉ nhận `u/<user>/`; test 400 cho key ngoài prefix |
| Backup/lifecycle MinIO bỏ sót prefix mới | Thấp × TB | Kiểm `infra/backup.sh` + `infra/minio-setup.sh` (lifecycle chỉ áp tag export) lúc implement |

Rollback: revert code; bảng 0025 + object `system/fonts/` giữ lại vô hại. Series trỏ font hệ thống trên bản cũ → fallback
font mặc định (`unknownFonts` cũ từ chối khi lưu lại series — ghi docs).
