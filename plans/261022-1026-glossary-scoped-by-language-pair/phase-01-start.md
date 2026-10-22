---
phase: 1
title: "Phase 1: Schema + migration"
status: done
priority: P1
effort: "2h"
dependencies: []
---

# Phase 1: Schema + migration

## Overview
Thêm `source_lang`, `target_lang` (nullable) vào `glossary_entries`, đổi unique sang theo cặp, backfill entry chung cũ
= ko→vi, tăng `glossary_rev` cho series mà glossary hiệu lực thu hẹp. Migration **chỉ thêm** (đúng giả định rollback
app ở `docs/deployment-guide.md:74`).

## Requirements
- Entry workspace (`series_id IS NULL`) mang cặp; entry series để NULL/NULL. Bất biến này do **API** đảm bảo (zod +
  đường ghi duy nhất), **không** dùng CHECK ở DB (red team #2, #8): CHECK làm API cũ (cửa sổ deploy / smoke rollback)
  insert entry chung không cặp → 23514 → 500; CHECK danh sách ngôn ngữ lệch khi `@mtl/shared` thêm ngôn ngữ
  (`series.source_lang/target_lang` cũng không có CHECK).
- Unique một term mỗi phạm vi: `(workspace_id, series_id, source_lang, target_lang, source_term)` NULLS NOT DISTINCT.
  **Giữ tên** `glossary_entries_scope_term_uq` — `isTermConflict` (`apps/api/src/routes/glossary.ts:61`) bắt theo tên.
- Migration bằng drizzle-kit, kèm file down như các migration trước.

## Architecture
`packages/db/src/schema/app.ts` → `glossaryEntries`:
```ts
/** Chỉ entry chung (series_id null) mang cặp nguồn→đích; entry series theo cặp của series (API đảm bảo). */
sourceLang: text("source_lang"),
targetLang: text("target_lang"),
...
unique("glossary_entries_scope_term_uq")
  .on(t.workspaceId, t.seriesId, t.sourceLang, t.targetLang, t.sourceTerm).nullsNotDistinct(),
```
Entry chung NULL cặp (nếu API cũ ghi trong cửa sổ rollback) không khớp cặp nào → bị bỏ qua khi dịch, không lỗi.

## Related Code Files
- Modify: `packages/db/src/schema/app.ts`
- Create: `packages/db/migrations/0006_glossary_lang_pair.sql` (+ `meta/` snapshot/journal do drizzle-kit sinh)
- Create: `packages/db/migrations-down/0006_glossary_lang_pair.down.sql`

## Implementation Steps
1. Sửa schema như trên.
2. `pnpm --filter @mtl/db generate --name glossary_lang_pair` (**không** có `--`: pnpm chuyển nguyên `--` cho
   drizzle-kit và nó báo `Unrecognized options` — red team #3).
3. Sửa tay thứ tự SQL sinh ra: `ADD COLUMN` → backfill → `DROP CONSTRAINT` unique cũ → `ADD CONSTRAINT` unique mới →
   tăng rev. Thêm:
   ```sql
   -- Trước 0.4.0 API chỉ cho ko→vi → mọi entry chung hiện có viết cho ko→vi.
   UPDATE "glossary_entries" SET "source_lang" = 'ko', "target_lang" = 'vi' WHERE "series_id" IS NULL;
   -- Series khác ko→vi mất entry chung ko→vi → glossary hiệu lực đổi; tăng rev để "Dịch lại" không trùng key job cũ.
   UPDATE "series" SET "glossary_rev" = "glossary_rev" + 1
   WHERE ("source_lang", "target_lang") IS DISTINCT FROM ('ko', 'vi')
     AND EXISTS (SELECT 1 FROM "glossary_entries" g WHERE g."workspace_id" = "series"."workspace_id" AND g."series_id" IS NULL);
   ```
4. Down (theo mẫu `migrations-down/0005_series_page_format.down.sql`): `BEGIN;` drop unique mới → xoá trùng term giữa
   các cặp trong cùng phạm vi (giữ bản `updated_at` mới nhất như 0002) → tạo lại unique cũ
   `(workspace_id, series_id, source_term)` NULLS NOT DISTINCT → drop 2 cột →
   `DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);` → `COMMIT;`
   (red team #4). Rev đã tăng không hoàn lại (vô hại).
5. Trên DB dev: `pnpm --filter @mtl/db migrate` → chạy file down → `migrate` lại → `\d glossary_entries` phải có lại 2
   cột và unique mới (chứng minh down thật sự gỡ journal).

## Success Criteria
- [x] Migrate sạch trên DB có dữ liệu cũ; entry chung cũ có `ko/vi`, entry series NULL/NULL.
- [x] Series khác ko→vi trong workspace có entry chung: `glossary_rev` +1; series ko→vi giữ nguyên.
- [x] Down + up lại chạy thật (bước 5).
- [x] `pnpm --filter @mtl/db test` xanh (typecheck api đỏ tới hết Phase 2 — chấp nhận giữa phase).

## Risk Assessment
- Entry chung tạo **sau** khi deploy 0.4.0 (hôm nay) mà người dùng định cho cặp khác vẫn bị gán ko→vi. Rủi ro thấp
  (tính năng mới vài giờ, chưa thương mại). Ghi vào docs; sửa bằng xoá + thêm lại ở cặp đúng.
- Rollback app (không down DB): code cũ gộp mọi entry chung như trước (quay lại hành vi M3, không lỗi); entry chung
  nó tạo có cặp NULL → bản sau bỏ qua, sửa tay bằng SQL nếu cần (ghi docs).
- Rollback DB bằng file down: có thể mất bản trùng term giữa các cặp (đã ghi trong file down).
