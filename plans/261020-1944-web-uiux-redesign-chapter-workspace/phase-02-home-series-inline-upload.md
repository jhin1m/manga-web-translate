---
phase: 2
title: "Home + series + upload inline"
status: completed
priority: P1
effort: 3.5d
dependencies: [1]
---

# Phase 2: Home + series + upload inline

## Overview
Thay 3 màn (series list, series detail, upload) bằng Home và Series có tab. Upload thành hành vi "thả file" ở Home / ô "Chương mới" / hàng chương nháp; upload chạy nền qua `upload-manager` (sống qua điều hướng) để thả xong mở thẳng màn chương. Xoá trang upload riêng, redirect route.

## Requirements
Owner đã duyệt design (artifact "Manga Translate — Redesign", khung 1 Trang chủ và 2 Series, 20/10/2026). Nguyên tắc: vào trang nào cũng thấy ngay bước tiếp theo, mỗi hàng đúng 1 nút hành động chính.
- Home `/` từ trên xuống:
  1. **Vùng thả lớn ở đầu trang** ("Thả strip hoặc ZIP của chương mới vào đây" + nút chính "Chọn file…"). Thả file bất kỳ đâu trên trang = cùng hành vi.
  2. **Dòng xác nhận inline ngay dưới vùng thả** (không phải popover/modal): tên file + kích thước ảnh, `Series [select, đoán từ tên file, có "+ Series mới…"]`, `Chương số [input, đoán từ tên file, mặc định nextChapterNumber]`, [Bỏ] [Tạo và mở chương] (Enter = tạo, Esc = bỏ).
  3. **"Việc cần làm"**: mọi chương chưa xong của workspace (không phải chỉ 1 thẻ "Tiếp tục"), mỗi dòng = chấm trạng thái, `Chương n` + series, mô tả bằng lời, **1 nút bước tiếp theo** suy từ trạng thái: chờ sửa → "Tiếp tục sửa" (nút primary cho dòng đầu), lỗi trang → "Chạy lại trang lỗi", đã tải chưa dịch → "Dịch chương", đang dịch → "Xem tiến độ", upload dở → "Tải tiếp ảnh". Sắp: chương bạn đang giữ khoá trước, rồi `updated_at desc`.
  4. **Series dạng danh sách hàng gọn** (không lưới thẻ): bìa nhỏ, tên, "n chương · m đã xuất", chấm + trạng thái chương mới nhất, nút "+ Ch.{next}" (mở file picker, tạo chương số đó), "Mở series". Ô tìm series + "+ Series mới" (inline).
- Đoán từ tên file (thuần client, `parse-chapter-filename.ts`): số chương = số cuối tên sau tiền tố `ch|chap|chapter|chương|c|화|ep` (không có thì số cuối cùng); series = so khớp tên/slug series đã có (chuẩn hoá bỏ dấu, lowercase, bỏ ký tự không chữ-số; chọn series có chuỗi con dài nhất) — không khớp thì series dùng gần nhất. Luôn cho sửa trước khi tạo.
- Series `/w/:ws/s/:s`: bố cục 2 cột (≥24": nội dung chính + cột phải ~360px; hẹp thì cột phải xuống dưới).
  - Đầu trang: bìa, tên, "Hàn → Việt · n chương · m đã xuất".
  - **Vùng thả "Thả strip của Chương {next} vào đây"** (số tự tăng). Thả nhiều file: mỗi ZIP = 1 chương; nhiều ảnh lẻ → dòng xác nhận hỏi "1 chương gồm N ảnh" (mặc định) hoặc "N chương, mỗi ảnh 1 chương" (đánh số liên tiếp từ next).
  - Bộ lọc chip: **Cần làm** (mặc định) · Đã xuất · Tất cả (lọc client).
  - Danh sách chương dạng hàng: số chương, chấm + trạng thái bằng lời + thời gian, thanh tiến độ + mô tả ("Đã xem 38/54 trang", "GĐ2 · 24/52 trang"), **1 nút hành động chính** (cùng bảng suy luận như Home), link "Mở". Chương nháp chưa có ảnh: hàng có vùng thả inline.
  - Cột phải: thẻ **Cài đặt dịch** (tóm tắt font thoại, font SFX, xưng hô, giọng văn; "Sửa" mở tab/section form cài đặt cũ) và thẻ **Glossary · n từ** (thêm nhanh 2 ô KO/VI + "Thêm" dùng API glossary P4/P6 sẵn có, 4–5 từ mới nhất, "Xem tất cả" mở `GlossaryEditor` P6 qua `?tab=glossary`).
  - `?tab=glossary` / `?tab=settings` vẫn có để vào màn đầy đủ.
- Chương nháp chưa upload đủ (tab đã đóng giữa chừng): thả lại file → khớp theo thứ tự natural sort + `bytes` với `source_files` → `presignAgain` + upload phần thiếu.
- Nút commit của màn chương cũ đổi nhãn "Dịch chương" (chuẩn bị chuỗi nút P3).
- Rời tab khi đang upload → `beforeunload` cảnh báo.
- Bỏ sắp xếp tay thứ tự file (chỉ natural sort, file rác `__MACOSX` bị loại — logic `files.ts` sẵn có).

## Architecture
API (chỉ thêm, không schema):
- `GET /api/w/:ws/recent-chapters?limit=20&open=1` (dùng cho "Việc cần làm"; `open=1` = bỏ chương đã xuất/xong, gồm cả nháp upload dở; mỗi item kèm `lock_holder_is_me`) → `[{...chapterSummary, series_title, page_counts}]` sắp `chapters.updated_at desc` (cột tự bump qua `$onUpdate`, `packages/db/src/schema/columns.ts:13-16`, gồm cả heartbeat khoá = "đang làm"). Path riêng, **không** `/chapters/recent` vì sẽ trùng `GET /w/:ws/chapters/:chapterId` (`apps/api/src/routes/chapters.ts:199`).
- `GET /api/w/:ws/series/:id` (`apps/api/src/routes/series.ts:144`): mỗi chapter thêm `page_counts: {total, ready, failed, busy}` — 1 truy vấn `pages` group theo `chapter_id` (không N+1). Trường mới, client cũ bỏ qua.

Web:
```
upload-manager (zustand vanilla, module-level)
  startNewChapter({ws, seriesId, number, files}) ─ collectPages (unzip worker) → naturalSortBy → listProblems
     → createChapter (POST /chapters) ── resolve chapterId ──> caller navigate
     → runUploadQueue(concurrency 4, attempts 3, presignAgain khi thử lại) → phase: uploading|uploaded|failed
  resumeChapter({ws, chapter, files}) ─ khớp ord+bytes → presignAgain → runUploadQueue
  useChapterUpload(chapterId) → {phase, done, total, bytes, errors}
```
`ChapterUploadStatus` hiển thị tiến độ; P3 nhúng vào màn chương.

## Related Code Files
Create:
- `apps/web/src/features/home/home-page.tsx`
- `apps/web/src/features/home/new-chapter-confirm-row.tsx` (dòng xác nhận inline, dùng chung Home + Series)
- `apps/web/src/features/home/todo-list.tsx` + `apps/web/src/features/chapter/next-action.ts` (hàm thuần trạng thái → {nhãn, nút, tone}; + `next-action.test.ts`)
- `apps/web/src/features/upload/parse-chapter-filename.ts` (+ `parse-chapter-filename.test.ts`)
- `apps/web/src/features/series/series-sidebar.tsx` (thẻ Cài đặt dịch + Glossary thêm nhanh)
- `apps/web/src/features/series/series-page.tsx` (tab qua search `tab`)
- `apps/web/src/features/series/series-settings-form.tsx` (chuyển `SettingsForm` từ `series-settings-page.tsx:72`)
- `apps/web/src/features/upload/upload-manager.ts` (+ `upload-manager.test.ts`)
- `apps/web/src/features/upload/drop-zone.tsx` (kéo-thả + input file, `accept="image/png,image/jpeg,image/webp,.zip"`)
- `apps/web/src/features/upload/chapter-upload-status.tsx`
- `apps/web/src/features/chapter/recent-api.ts` (hoặc thêm vào `features/series/api.ts`: `fetchRecentChapters`, kiểu `page_counts`)

Modify:
- `apps/api/src/routes/chapters.ts` (route `recent-chapters`; dùng lại `chapterSummary` từ `routes/series.ts:76`)
- `apps/api/src/routes/series.ts:144-151` (`page_counts`)
- `apps/api/test/chapters.test.ts` (describe "recent chapters"), `apps/api/test/tenant-isolation.test.ts` (append: recent-chapters của A không chứa chương B)
- `apps/web/src/features/series/api.ts` (`ChapterSummary.page_counts?`, fetch recent)
- `apps/web/src/app/router.tsx` (home → `HomePage`; `s/$seriesId` → `SeriesPage`; `series/$s/upload` → redirect `s/$s`)
- `apps/web/src/features/chapter/chapter-page.tsx` (nhúng `ChapterUploadStatus`, nhãn "Dịch chương", bỏ link `/upload` dòng 194)
- `apps/web/e2e/upload-chapter.spec.ts` (viết lại theo luồng thả ở home)

Delete:
- `apps/web/src/features/upload/upload-page.tsx` (logic chuyển vào upload-manager)
- `apps/web/src/features/series/series-list-page.tsx` (`SeriesListPage`, `SeriesDetailPage`)
- `apps/web/src/features/series/series-settings-page.tsx` (sau khi tách form)

Giữ: `upload/{files,natural-sort,unzip-worker,upload-queue,api}.ts` (tái dùng nguyên).

## Implementation Steps
1. API: `recent-chapters` + `page_counts`; test.
2. `upload-manager.ts`: chuyển các bước trong `upload-page.tsx:47-140` (addFiles, uploadAll, start, commit-less) sang hàm thuần + store; lỗi file từng phần giữ trong store; `beforeunload` khi có chương `uploading`.
3. `drop-zone.tsx` + `new-chapter-confirm-row.tsx` + `parse-chapter-filename.ts` (focus ô số chương, Enter tạo, Esc huỷ; validate series có).
4. `home-page.tsx`, `series-page.tsx` (+ form tách), router.
5. `chapter-page.tsx`: nhúng status + đổi nhãn; disable "Dịch chương" khi upload chưa xong (`phase !== "uploaded"` và còn file thiếu).
6. Xoá 3 file cũ; `pnpm typecheck` sạch; e2e.

## Success Criteria
- `parse-chapter-filename.test.ts`: `seriesA_ch13.png` → (Series A, 13); `[Tên] Chapter 7.zip` → 7; `화 105.zip` → 105; tên bỏ dấu khớp series có dấu; không khớp → null series.
- `next-action.test.ts`: mỗi trạng thái chương (nháp upload dở, đã tải chưa dịch, đang dịch, lỗi trang, chờ sửa, đã xuất) → đúng 1 nhãn nút.
- Home không còn thẻ "Tiếp tục" riêng; "Việc cần làm" liệt kê mọi chương mở, chương đang giữ khoá đứng đầu; series hiển thị dạng hàng có "+ Ch.{next}".
- Series: chip "Cần làm" mặc định ẩn chương đã xuất; thả 3 ảnh lẻ chọn "3 chương" tạo 3 chương số liên tiếp; thêm từ glossary ở cột phải xuất hiện ngay trong danh sách.
- `upload-manager.test.ts` (vitest, fetch giả): (a) thứ tự file gửi `createChapter` = natural sort (`10.png` sau `9.png`), bỏ `__MACOSX`; (b) `startNewChapter` resolve `chapterId` trước khi upload xong; (c) file lỗi 2 lần rồi ok → `presignAgain` được gọi, phase `uploaded`; (d) `resumeChapter` chỉ upload file thiếu, từ chối khi bytes lệch.
- `apps/api/test/chapters.test.ts`: recent-chapters sắp theo updated_at, `limit` tôn trọng, có `series_title`; series detail có `page_counts` đúng sau ingest giả.
- `tenant-isolation.test.ts` case mới xanh.
- E2E `upload-chapter.spec.ts` (mới): login → `/` → `setInputFiles` vào drop-zone (ZIP 10 slice) → dòng xác nhận "Tạo và mở chương" → URL khớp `/w/.+/s/.+/c/[0-9a-f-]{36}` **trước** khi upload xong → upload xong → bấm "Dịch chương" → worker giả → 10 trang "Sẵn sàng". Case redirect: `/w/<ws>/series/<s>/upload` → `/w/<ws>/s/<s>`.
- `rg -n "UploadPage|SeriesListPage|SeriesDetailPage|SeriesSettingsPage" apps/web/src` = 0.
- `pnpm typecheck && pnpm lint && pnpm test` + e2e xanh.

## Risk Assessment
| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| Đóng tab giữa upload → chương nháp thiếu file | M×M | `resumeChapter` + cảnh báo `beforeunload`; commit chặn khi thiếu (server trả `rejected`) |
| Unzip ZIP lớn chặn UI | L×M | Đã chạy trong Web Worker (`unzip-worker.ts`) |
| `updated_at` bump bởi heartbeat làm thứ tự "Việc cần làm" nhảy của người khác | L×L | 1 người/chương (owner); câu hỏi mở #2 |
| Hai lần thả liên tiếp tạo 2 chương trùng số | L×L | Popover gợi ý `nextChapterNumber` mới nhất; số trùng không bị server chặn — chấp nhận |
Rollback: revert PR (khôi phục upload page + route).
