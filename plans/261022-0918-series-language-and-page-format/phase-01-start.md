---
phase: 1
title: "Shared contract + DB migration"
status: pending
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Shared contract + DB migration

## Overview
Thêm cột `page_format` cho `series` (migration drizzle-kit + backfill) và mở rộng contract job ở `@mtl/shared`
để payload mang ngôn ngữ + thứ tự đọc. Bump pipeline version vì contract worker đổi.

## Requirements
- `series.page_format text not null default 'strip'` + CHECK `in ('strip','pages')`; backfill `ja → pages`.
- Hằng số ngôn ngữ dùng chung API + web (một nguồn sự thật).
- Payload mới tương thích ngược ở phía worker (Phase 3 đọc với default) nhưng API chỉ phát payload mới.

## Architecture
`packages/shared/src/series-lang.ts` (mới, hoặc đặt trong file shared sẵn có nếu có chỗ hợp lý):
```ts
export const SOURCE_LANGS = ["ko", "ja", "zh", "en"] as const;
export const TARGET_LANGS = ["vi", "en", "id", "es", "pt", "fr"] as const;
export const PAGE_FORMATS = ["strip", "pages"] as const; // = IngestMode
/** Nguồn đã kiểm định chất lượng; nguồn khác vẫn cho chọn, UI chỉ ghi chú. */
export const TESTED_SOURCE_LANGS: readonly SourceLang[] = ["ko"];
export const defaultPageFormat = (src: SourceLang): PageFormat => (src === "ja" ? "pages" : "strip");
/** Manga Nhật dạng trang: hàng trên→dưới, trong hàng phải→trái. */
export const readingOrder = (src: string, fmt: string): "ltr" | "rtl" => (src === "ja" && fmt === "pages" ? "rtl" : "ltr");
```
`packages/shared/src/job.ts`:
- `TranslateSettings` + `source_lang`, `target_lang` (string min 2).
- `page.prepare` + `reading_order: z.enum(["ltr","rtl"])`.
- `page.ocr_region` + `source_lang`.
- `IngestMode` tái dùng `PAGE_FORMATS`.

## Related Code Files
- Modify: `packages/db/src/schema/app.ts` (cột `pageFormat` + check), `packages/shared/src/job.ts`, `packages/shared/src/index.ts` (export)
- Create: `packages/shared/src/series-lang.ts`, `packages/db/migrations/0005_series_page_format.sql` (drizzle-kit generate), `packages/db/migrations-down/0005_series_page_format.down.sql`
- Modify: `apps/api/src/env.ts` (`PIPELINE_VERSION`/`MIN_PIPELINE_VERSION` → `0.4.0`), `worker/mtl_worker/__init__.py` (`PIPELINE_VERSION = "0.4.0"`) — làm ở đây để contract và version đổi cùng lúc

## Implementation Steps
1. Sửa schema `series`: `pageFormat: text("page_format").notNull().default("strip")` + check constraint theo kiểu `chapters_status_chk`.
2. `pnpm --filter @mtl/db generate`; mở SQL sinh ra, thêm backfill **sau** ADD COLUMN:
   `UPDATE "series" SET "page_format" = 'pages' WHERE "source_lang" = 'ja';` (thêm tay, giữ `--> statement-breakpoint`).
3. Viết down: drop constraint + drop column.
4. Thêm `series-lang.ts`, export; cập nhật `job.ts`.
5. Bump pipeline version API + worker (MIN cũng 0.4.0: worker cũ không hiểu `source_lang` → OCR như tiếng Hàn).
6. `pnpm --filter @mtl/db test` + typecheck shared.

## Success Criteria
- [x] Migration chạy trên DB dev có sẵn series ja/ko → backfill đúng; down chạy được.
- [x] Typecheck các package dùng `@mtl/shared` vẫn qua (lỗi do field mới bắt buộc sẽ được sửa ở Phase 2).

## Risk Assessment
- drizzle-kit có thể sinh snapshot lệch nếu migration 0004 chưa có snapshot đúng → kiểm `meta/_journal.json` trước khi generate.
- Bump MIN version: worker Mac cũ bị 426 tới khi cập nhật — chấp nhận, ghi rõ trong docs.
