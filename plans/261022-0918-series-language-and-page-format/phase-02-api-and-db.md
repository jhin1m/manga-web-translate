---
phase: 2
title: "API series, commit, enqueue"
status: pending
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 2: API series, commit, enqueue

## Overview
Mở validate ngôn ngữ, thêm `page_format` vào API series, commit dùng `page_format`, enqueue phát payload có
ngôn ngữ / thứ tự đọc, câu chỉ dẫn kính ngữ theo cặp nguồn→đích.

## Requirements
- Bỏ `ENABLED_SOURCE_LANGS` + refine "MVP chỉ hỗ trợ tiếng Hàn"; dùng hằng số từ `@mtl/shared`.
- `POST /series`: không gửi `page_format` → `defaultPageFormat(source_lang ?? "ko")`.
- `PATCH /series`: `page_format` sửa được; đổi `page_format` **tăng `settings_rev`** (nó là đầu vào thứ tự đọc của prepare). Đổi `source_lang` **không** tự đổi `page_format` (user chủ động).
- `seriesView` trả `page_format`.
- Commit: `CommitBody.mode` thành optional (không default); `mode = body.mode ?? series.pageFormat`. Giữ override để test/tool cũ không gãy.
- `enqueuePrepare`: payload `{ source_lang, reading_order: readingOrder(s.sourceLang, s.pageFormat) }`.
- `page.ocr_region` enqueue: thêm `source_lang` của series.
- `translateSettings`: thêm `source_lang`, `target_lang`; `honorific_policy` = `honorificText(policy, src, tgt)`.

## Architecture
`honorificText` (thay `HONORIFIC_TEXT` ở `apps/api/src/jobs/enqueue.ts:36`):
```ts
const HONORIFIC_EXAMPLES: Record<SourceLang, string> = {
  ko: "-nim, -ssi, hyung, unnie, oppa, sunbae",
  ja: "-san, -kun, -chan, -sama, senpai, sensei",
  zh: "哥, 姐, 师兄, 前辈, 大人",
  en: "Mr./Ms., Sir, Boss",
};
export function honorificText(policy: string, src: SourceLang, tgt: TargetLang): string {
  const ex = HONORIFIC_EXAMPLES[src];
  return policy === "keep"
    ? `giữ nguyên kính ngữ (${ex}) ở dạng phiên âm Latin`
    : `chuyển kính ngữ (${ex}) sang cách xưng hô/gọi nhau tự nhiên của ngôn ngữ đích (${LANG_NAME[tgt]})`;
}
```
Với ko→vi chuỗi mới khác chuỗi cũ — chấp nhận (prompt worker cũng đổi ở Phase 3, version đã bump).

## Related Code Files
- Modify: `apps/api/src/routes/series.ts` (Settings Zod, `SeriesCreate` default page_format, `toColumns`, `translationChanged`, `seriesView`)
- Modify: `apps/api/src/routes/chapters.ts:74,268` (CommitBody, truyền mode từ series)
- Modify: `apps/api/src/jobs/enqueue.ts` (`enqueueIngest` nhận mode bắt buộc từ caller, `enqueuePrepare`, `translateSettings`, `honorificText`) 
- Modify: `apps/api/src/routes/page-state.ts:246` (payload `page.ocr_region` thêm `source_lang` của series; `pageOpKey` băm cả payload nên key tự đổi theo)
- Create: `apps/api/test/series.test.ts` (chưa có test riêng cho series)
- Modify: `apps/api/test/chapters.test.ts`, `apps/api/test/worker-protocol.test.ts`, `apps/api/test/worker-helpers.ts` (payload mới)

## Implementation Steps
1. Series route: import hằng từ shared; `source_lang: z.enum(SOURCE_LANGS)`, `target_lang: z.enum(TARGET_LANGS)`, `page_format: z.enum(PAGE_FORMATS)`.
2. Create handler: `pageFormat = body.page_format ?? defaultPageFormat(body.source_lang ?? "ko")`.
3. `translationChanged` thêm cặp `pageFormat`.
4. Commit: tra series của chương (đã có `seriesOf` trong enqueue) → mode.
5. Enqueue prepare/ocr_region/translate theo payload Phase 1; xoá default `"strip"` của `enqueueIngest` để mọi caller phải truyền rõ.
6. Test:
   - series: tạo với `{source_lang:"ja"}` → `page_format:"pages"`; `{source_lang:"zh"}` → strip; tạo với page_format tường minh thắng default; PATCH mọi đích hợp lệ; đích `"de"` → 400; PATCH page_format → settings_rev +1; PATCH lại cùng giá trị → không tăng.
   - chapters: commit series pages → payload ingest `mode:"pages"`; commit body `{mode:"strip"}` vẫn override.
   - enqueue: prepare payload `reading_order:"rtl"` cho ja+pages, `"ltr"` cho ja+strip và ko; translate settings có `source_lang/target_lang`; honorific text chứa ví dụ đúng nguồn.
7. `pnpm --filter @mtl/api test`.

## Success Criteria
- [x] Toàn bộ test API xanh, test mới phủ các ca trên.
- [x] Không còn chuỗi "MVP chỉ hỗ trợ tiếng Hàn" / `ENABLED_SOURCE_LANGS` trong repo.

## Risk Assessment
- Tenant isolation: tra series khi commit phải qua scoped db như hiện tại (`seriesOf(tx, ch)`), không truy vấn thô.
- Job prepare đã xếp hàng trước khi deploy (payload cũ) → worker Phase 3 default `ltr`/`ko`; MIN version chặn worker cũ.
