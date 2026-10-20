---
phase: 2
title: "Home + series + upload inline"
status: pending
priority: P1
effort: 2.5d
dependencies: [1]
---

# Phase 2: Home + series + upload inline

## Overview
Thay 3 màn (series list, series detail, upload) bằng Home và Series có tab. Upload thành hành vi "thả file" ở Home / ô "Chương mới" / hàng chương nháp; upload chạy nền qua `upload-manager` (sống qua điều hướng) để thả xong mở thẳng màn chương. Xoá trang upload riêng, redirect route.

## Requirements
- Home `/`: thẻ "Tiếp tục: <series> · Ch.<n> · <trạng thái> [Mở]" (chương cập nhật gần nhất của workspace); lưới series (tiêu đề, số chương, hoạt động gần nhất) + "Series mới" (inline input); vùng thả ZIP/ảnh (+ nút chọn file). Thả file bất kỳ đâu trên trang = cùng hành vi.
- Thả file → popover nhỏ "Series [select] · Chương [số gợi ý] · [Tạo] (Enter)" → tạo chương → điều hướng `/w/:ws/s/:s/c/:c` ngay khi `POST /chapters` trả về; upload tiếp tục nền. Series mặc định = series của "Tiếp tục", không có thì series đầu.
- Series `/w/:ws/s/:s?tab=`: tab Chương (bảng dày: số, tên, trạng thái chương, thanh tiến độ ready/total, lỗi, người giữ khoá, [Mở]); ô "Chương mới — thả file vào đây"; tab Glossary (`GlossaryEditor` P6); tab Cài đặt (form series cũ).
- Chương nháp chưa upload đủ (tab đã đóng giữa chừng): thả lại file → khớp theo thứ tự natural sort + `bytes` với `source_files` → `presignAgain` + upload phần thiếu.
- Nút commit của màn chương cũ đổi nhãn "Dịch chương" (chuẩn bị chuỗi nút P3).
- Rời tab khi đang upload → `beforeunload` cảnh báo.
- Bỏ sắp xếp tay thứ tự file (chỉ natural sort, file rác `__MACOSX` bị loại — logic `files.ts` sẵn có).

## Architecture
API (chỉ thêm, không schema):
- `GET /api/w/:ws/recent-chapters?limit=5` → `[{...chapterSummary, series_title, page_counts}]` sắp `chapters.updated_at desc` (cột tự bump qua `$onUpdate`, `packages/db/src/schema/columns.ts:13-16`, gồm cả heartbeat khoá = "đang làm"). Path riêng, **không** `/chapters/recent` vì sẽ trùng `GET /w/:ws/chapters/:chapterId` (`apps/api/src/routes/chapters.ts:199`).
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
- `apps/web/src/features/home/new-chapter-popover.tsx`
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
3. `drop-zone.tsx` + `new-chapter-popover.tsx` (focus ô số chương, Enter tạo, Esc huỷ; validate series có).
4. `home-page.tsx`, `series-page.tsx` (+ form tách), router.
5. `chapter-page.tsx`: nhúng status + đổi nhãn; disable "Dịch chương" khi upload chưa xong (`phase !== "uploaded"` và còn file thiếu).
6. Xoá 3 file cũ; `pnpm typecheck` sạch; e2e.

## Success Criteria
- `upload-manager.test.ts` (vitest, fetch giả): (a) thứ tự file gửi `createChapter` = natural sort (`10.png` sau `9.png`), bỏ `__MACOSX`; (b) `startNewChapter` resolve `chapterId` trước khi upload xong; (c) file lỗi 2 lần rồi ok → `presignAgain` được gọi, phase `uploaded`; (d) `resumeChapter` chỉ upload file thiếu, từ chối khi bytes lệch.
- `apps/api/test/chapters.test.ts`: recent-chapters sắp theo updated_at, `limit` tôn trọng, có `series_title`; series detail có `page_counts` đúng sau ingest giả.
- `tenant-isolation.test.ts` case mới xanh.
- E2E `upload-chapter.spec.ts` (mới): login → `/` → `setInputFiles` vào drop-zone (ZIP 10 slice) → popover "Tạo" → URL khớp `/w/.+/s/.+/c/[0-9a-f-]{36}` **trước** khi upload xong → upload xong → bấm "Dịch chương" → worker giả → 10 trang "Sẵn sàng". Case redirect: `/w/<ws>/series/<s>/upload` → `/w/<ws>/s/<s>`.
- `rg -n "UploadPage|SeriesListPage|SeriesDetailPage|SeriesSettingsPage" apps/web/src` = 0.
- `pnpm typecheck && pnpm lint && pnpm test` + e2e xanh.

## Risk Assessment
| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| Đóng tab giữa upload → chương nháp thiếu file | M×M | `resumeChapter` + cảnh báo `beforeunload`; commit chặn khi thiếu (server trả `rejected`) |
| Unzip ZIP lớn chặn UI | L×M | Đã chạy trong Web Worker (`unzip-worker.ts`) |
| `updated_at` bump bởi heartbeat làm "Tiếp tục" nhảy chương của người khác | L×L | 1 người/chương (owner); câu hỏi mở #2 |
| Hai lần thả liên tiếp tạo 2 chương trùng số | L×L | Popover gợi ý `nextChapterNumber` mới nhất; số trùng không bị server chặn — chấp nhận |
Rollback: revert PR (khôi phục upload page + route).
