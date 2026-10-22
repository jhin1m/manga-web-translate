---
phase: 3
title: "Ẩn trang sau Bước 1/2"
status: completed
priority: P1
effort: "1.5d"
dependencies: [2]
---

# Phase 3: Ẩn trang sau Bước 1/2

## Overview
`pages.skipped` + endpoint; trang ẩn không dịch (Bước 2/dịch lại/thử lại), không tính trạng thái chương, không xuất;
`original_slices` không lỗi. Web: icon Xoá trên rail trang, lọc "Đã xoá (n)" để khôi phục; số trang giữ số gốc.
<!-- Updated: Validation Session 1 - giữ số trang gốc; sửa đường dẫn no_pages/glossary-apply; lọc neighborLines -->


## Requirements
- Functional:
  - `PATCH /w/:ws/pages/:pageId` body `{ skipped: boolean }`; yêu cầu **giữ khoá** (`assertChapterLock`) và chương
    settled (không `ingesting`/`processing`) → 409 `chapter_busy`. Sau đổi → `refreshChapter`.
  - `refreshChapter` (`enqueue.ts:435`), `translatePrepared`, `retranslate` (cả chương), `retryFailedPages` bỏ page
    skipped. Chỉ còn page skipped → `translatePrepared` 409 `page_not_prepared`. `retranslate` với `page_ids` chứa page
    skipped → 409 `page_skipped`.
  - Progress (`routes/progress.ts`): page trả `skipped`; `counts` **không** đếm page skipped.
  - Ngữ cảnh dịch: `neighborLines` (`claim-inputs.ts:100`) bỏ page skipped (không lấy trang đã ẩn làm trang trước/sau).
  - Route `POST /chapters/:id/translate` (`chapters.ts:318-322`): kiểm `no_pages` trên page không skipped.
  - Export inputs (`claim-inputs.ts` `exportInputs`): thêm `skipped` mỗi page (`ExportInputs` trong
    `packages/shared/src/worker-protocol.ts`, optional default false cho job cũ). `enqueueExport`
    (`jobs/enqueue.ts:369`) 409 `no_pages` khi mọi page skipped.
  - Worker `export.py`: layout `pages` bỏ page skipped, **đánh số liên tục** theo page còn lại; `original_slices`:
    slice mà mọi đoạn thuộc page skipped → bỏ; slice có đoạn vắt qua page skipped → đoạn đó dùng ảnh gốc
    (`background = originalKey`, không vẽ chữ) — không lỗi "thiếu đoạn".
  - Find/Replace + Áp glossary (`routes/find-replace.ts`, cả `find-replace/*` lẫn `glossary-apply/*`) bỏ page skipped
    (không ghi vào trang đã xoá).
  - Web rail: icon Xoá trên mục trang (khi có quyền sửa); bộ lọc thêm "Đã xoá n"; mục skipped chỉ hiện trong lọc đó, có
    icon Khôi phục. **Số trang giữ số gốc** (`ord + 1`, vd. 1, 2, 4) ở mọi nơi — rail, bảng, Tìm/Thay, thông báo; chỉ
    bộ đếm "Tất cả n" và chỉ báo "Trang i/n" đếm trên page không skipped. Trang active bị xoá → nhảy trang kế.
    Toast "Đã xoá trang n · Hoàn tác". Bảng văn bản bỏ dòng của page skipped.
- Non-functional: không tốn job nào khi ẩn/khôi phục.

## Architecture
- Cột boolean riêng (không thêm giá trị vào `PAGE_STATUSES`): job writer ghi `status` không đụng `skipped` → không
  bị ghi đè khi job đang bay về.
- Khôi phục trang chưa dịch (status `prepared`) ở chương `review`/`done` → `refreshChapter` đưa chương về `prepared`
  → người dùng bấm Bước 2 để dịch trang đó (đúng luồng 2 bước, không tự chạy).
- Chạy lại ingest (`createIngestedPages`) xoá page cũ → mất cờ skipped: chấp nhận (ingest lại chỉ khi Bước 1 lỗi,
  chưa có page).

## Related Code Files
- Modify: `packages/db/src/schema/app.ts` (pages.skipped), migration `0008_page_skipped.sql`
- Modify: `apps/api/src/routes/pages.ts` (PATCH), `routes/progress.ts`, `routes/chapters.ts` (`/translate` no_pages),
  `routes/find-replace.ts` (find-replace + glossary-apply), `jobs/enqueue.ts` (refresh/translate/retry/retranslate +
  `enqueueExport` no_pages), `jobs/claim-inputs.ts` (exportInputs + neighborLines)
- Modify: `packages/shared/src/worker-protocol.ts` (+ `pnpm schema:emit`), `worker/mtl_worker/export.py`
- Modify web: `features/chapter/page-rail.tsx`, `chapter-workspace.tsx`, `api.ts`, `page-status.ts`, `status.ts`,
  `text-table/text-table.tsx` (lọc page skipped), `export-warnings.ts`
- Tests: `apps/api/test/chapters.test.ts`, `queue.test.ts`, `export.test.ts`, `find-replace.test.ts`,
  `tenant-isolation.test.ts`; `worker/tests/test_export_slices.py`, `test_contract_schema.py`;
  web `status.test.ts`, `page-status.test.ts`, `export-warnings.test.ts`; e2e `chapter-tools.spec.ts`

## Implementation Steps
1. **Tests Before**: chạy và bổ sung test khoá hành vi hiện tại của `refreshChapter` (bảng status), `translatePrepared`
   (rolling vs neighbors), export `original_slices` (slice vắt 2 page) trong `test_export_slices.py`.
2. Schema + migration; shared `ExportInputs.pages[].skipped` (`.default(false)`), emit JSON Schema.
3. API: PATCH, refresh/translate/retry/retranslate/progress/export/find-replace/glossary lọc skipped.
4. Worker export: bộ lọc page skipped + `SliceAssembler` nhận page skipped như page "dùng ảnh gốc"; slice toàn đoạn
   skipped bị loại khỏi `kept`.
5. Web: rail (icon, lọc, đánh số), workspace (nhảy trang, toast), bảng văn bản, chip/status.
6. **Tests After**:
   - API: ẩn 1/3 page `prepared` → Bước 2 job `page_ids` không chứa nó và context vẫn `rolling` (mọi page không
     skipped đều prepared).
   - Ẩn page duy nhất còn `failed` → chương thành `review`.
   - Dịch lại trang 3 (neighbors) khi trang 2 skipped → context không chứa dòng của trang 2.
   - Find/Replace + glossary-apply preview không trả kết quả từ page skipped.
   - PATCH khi không giữ khoá → 423/409 theo `assertChapterLock`; workspace khác → 404.
   - Worker: `pages` layout tên file 001..n liên tục; `original_slices` với page skipped toàn slice → slice bị bỏ;
     slice vắt → ra đủ, phần skipped = pixel gốc.
   - Web vitest: chip/status bỏ page skipped; e2e `chapter-tools`: xoá trang 2 → rail còn n−1 mục, nhãn "Trang 1",
     "Trang 3"…, "Đã xoá 1", khôi phục.
7. **Regression Gate**: `pnpm typecheck && pnpm lint && pnpm test` + `cd worker && uv run pytest` + e2e
   `chapter-tools`, `full-flow`.

## Success Criteria
- [ ] Trang ẩn không xuất hiện trong input `chapter.translate` nào.
- [ ] Xuất cả 2 layout thành công với page ẩn ở đầu/giữa/cuối.
- [ ] Khôi phục trang chưa dịch → chương về "Chờ dịch", Bước 2 dịch đúng trang đó.

## Kết quả (2026-10-22 22:35) — xong, đã merge `b10b99d`
- e2e đỏ: chip lọc "Đã xoá n" tràn khỏi rail hẹp (sau canvas) → `.cw-rail-filter { flex-wrap: wrap }`.
- Review: `pages[].skipped` mới → worker cũ fail schema (`additionalProperties: false`) → worker `PIPELINE_VERSION` +
  `MIN_PIPELINE_VERSION` 0.4.2 (muối input_rev API giữ 0.4.0); docs `job-queue-worker.md`.
- Thêm test: ẩn trang lỗi duy nhất → `review`; glossary-apply bỏ trang ẩn. Ẩn icon Xoá khi còn 1 trang hiện.
- Gate: typecheck, lint, vitest (api 166+, web 157), worker 160, e2e 25/25.
- Còn mở: đánh dấu cần xuất lại khi ẩn/khôi phục sau xuất; chặn reinpaint/OCR vùng ở API cho trang ẩn.

## Bàn giao giữa chừng (2026-10-22 21:54) — branch `feat/skip-p3-hide-pages`, CHƯA commit
Trạng thái: P1 + P2 đã merge vào main (`51405a8`, `8a92ff4`). P3 code gần xong, còn 1 e2e đỏ.

Đã làm (working tree, chưa commit):
- DB: `pages.skipped` (migration `0008_page_skipped.sql` + down), đã `pnpm db:migrate`.
- Shared: `ExportInputs.pages[].skipped` **`.optional()`** (`.default(false)` sinh JSON Schema bắt buộc → job cũ
  fail hợp đồng; đã kiểm), `pnpm schema:emit` xong.
- API: `PATCH /w/:ws/pages/:pageId {skipped}` ở `routes/pages.ts` (assertChapterLock → tx `lockChapter` → 409
  `chapter_busy` / `last_page` → `refreshChapter`); lọc `skipped=false` ở `refreshChapter`, `translatePrepared`,
  `retranslate` (cả chương), `retryFailedPages`, `enqueueExport` (no_pages + khoá), `enqueueTranslate` (409
  `page_skipped`), `neighborLines`, route `/translate` no_pages, progress counts (+ trả `skipped`), Tìm/Thay +
  glossary-apply (`chapterPages`), `chapterStats` ở series.ts; exportInputs trả `skipped`, trang ẩn `translated=false`.
- Worker: `SliceAssembler` (slice chỉ thuộc page ẩn → bỏ; vắt qua → giữ, không tính "chưa dịch"); `handle_export`
  layout pages bỏ page ẩn, tên file theo `rank` liên tục. 3 test mới trong `worker/tests/test_export_slices.py`.
- Web: `ProgressPage.skipped`, `setPageSkip`; `useChapterData` trả `progress` (đã lọc trang ẩn) + `hiddenPages`;
  `PageRail` viết lại (lọc "Đã xoá n", icon Xoá/Khôi phục khi `lockEnabled && lock held`, số trang gốc); workspace
  `pageSkip` mutation + toast "Đã xoá trang n · Hoàn tác" (Notice `key: "skip"`), ẩn trang đang sửa → nhảy trang kế.
  CSS `.cw-source-item` đổi tên `.cw-rail-row` (dùng chung 2 rail). e2e `readyChapter(page, n)` nhận số trang.

Kết quả: API `chapters` + `tenant-isolation` 30/30; worker export + contract 21/21, ruff sạch; web unit 157/157;
typecheck + lint sạch. **E2E `chapter-tools.spec.ts` › "delete a page from the rail…" ĐỎ**: ẩn trang 2 chạy đúng
(rail "Tất cả 2", "Đã xoá 1", Trang 1 + Trang 3) nhưng không thấy toast "Đã xoá trang 2" để bấm "Hoàn tác"
(locator `getByRole("status").filter({hasText:"Đã xoá trang 2"})` hết giờ). Nghi: toast bị xoá ngay sau khi hiện
(`onSettled: data.refresh` / effect `notice` / re-render) hoặc role/text khác — kiểm `test-results/…/error-context.md`.

Việc còn lại P3: sửa e2e trên → chạy `pnpm test`, `cd worker && uv run pytest`, `pnpm --filter @mtl/web e2e` (full)
→ subagent tester + code-reviewer → commit `feat: hide pages after step 1 …` → hỏi user merge → `ak plan check`.
Chưa làm: chụp màn hình rail trang có icon Xoá; docs (để P6).

## Risk Assessment
- `translatePrepared` dùng `prepared.length === rows.length` để chọn rolling → phải loại page skipped khỏi `rows`
  không thì chương có page ẩn luôn rơi về `neighbors` (chất lượng dịch kém hơn). Có test ở bước 6.
- Job export cũ xếp hàng trước deploy: `skipped` default false → hành vi cũ.
- Credit cùng width đã dính vào page lớn: ẩn page mất cả phần truyện — ngoài phạm vi, ghi docs P6.
