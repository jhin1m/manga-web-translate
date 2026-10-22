---
phase: 4
title: "Tự bỏ ảnh credit (hash series + gợi ý kích thước)"
status: done
priority: P2
effort: "1.5d"
dependencies: [3]
---

# Phase 4: Tự bỏ ảnh credit

## Overview
Trình duyệt tính dHash + kích thước lúc thả ảnh, gửi trong `createChapter`; server so với danh sách ảnh đã học của
series → ảnh khớp `skip='credit'` ngay khi tạo chương. Học qua toast "Luôn bỏ ở series này". Gợi ý kích thước chỉ là
nhãn. Cài đặt series có mục "Ảnh tự bỏ".

## Requirements
- Functional:
  - `createChapter` `files[]` thêm optional `dhash` (16 hex), `width`, `height` (int > 0). Lưu `source_files.dhash`,
    `width`, `height` (cột width/height đã có).
  - Bảng `series_skip_images`: `id`, `workspace_id`, `series_id` (FK cascade), `dhash`, `width`, `height`,
    `thumb_key` (object riêng), `learned_from_chapter_id` (nullable, không FK cứng), `created_by`, timestamps.
  - Khớp: `hamming(a,b) ≤ 6` **và** `|a.w/a.h − b.w/b.h| / (b.w/b.h) ≤ 0.05` → `skip='credit'` khi tạo chương.
  - `POST /w/:ws/series/:seriesId/skip-images` body `{ source_file_id }` hoặc `{ page_id }`:
    - source file: cần `dhash` (không có → 409 `no_hash`); copy object gốc → `storageKeys.seriesSkip(ws, series, id)`.
    - page: học mọi source file **nằm trọn** trong page (theo `source_map`) có `dhash`; 0 file → 409 `no_hash`.
    - Trùng (đã có hash khớp) → bỏ qua, không tạo bản sao.
  - `GET …/skip-images` (thumb URL ký), `DELETE …/skip-images/:id` (xoá hàng + object).
  - Xoá series dọn prefix `ws/{ws}/series/{id}/`: trong callback `removeChapters` của route
    `DELETE /series/:seriesId` (`routes/series.ts:307`), sau khi xoá hàng series (FK cascade xoá `series_skip_images`).
  - Web:
    - `files.ts`/`upload-manager.startNewChapter`: tính `{dhash,width,height}` song song 4 trước `createChapter`; lỗi decode
      → bỏ trống (không chặn upload).
    - Toast sau xoá (P2 ảnh, P3 trang) thêm "Luôn bỏ ở series này" → POST; báo "Đã học n ảnh".
    - Rail ảnh gốc: `skip='credit'` → nhãn "Credit · tự bỏ" + Khôi phục; gợi ý kích thước: ảnh trong 3 đầu/3 cuối có
      `width` lệch > 10% so với trung vị width của chương → nhãn "Có thể là credit" (không tự xoá).
    - `series-settings-form.tsx`: mục "Ảnh tự bỏ" — lưới thumbnail + icon Xoá, trống → "Chưa có ảnh nào".
<!-- Updated: Validation Session 1 - hash mọi ảnh, đo rồi mới giảm; dọn prefix ở route xoá series -->
- Non-functional: mặc định hash **mọi ảnh** (bắt cả quảng cáo giữa chương); tính hash 96 ảnh ≤ 1.5s trên máy dev (đo bằng chương mẫu). Vượt → chỉ hash 5 ảnh đầu + 5 cuối
  (credit hầu như chỉ ở đầu/cuối) và ghi lại số đo.

## Architecture
- dHash: `createImageBitmap(blob)` → lấy w/h → vẽ 9×8 `OffscreenCanvas` grayscale → 64 bit (so sánh ngang) → hex.
  Hàm thuần `dhashFromGray(gray: Uint8ClampedArray /*72*/)` + `hamming(hexA, hexB)` đặt `packages/shared/src/dhash.ts`
  (web + api dùng chung, test ở shared).
- Khớp ở API trong transaction tạo chương: đọc toàn bộ `series_skip_images` của series (nhỏ, < vài chục) → so trong JS.
- Thumbnail: copy object S3 (thêm `copyObject` vào `apps/api/src/storage.ts`, `CopyObjectCommand`) để còn ảnh khi
  chương nguồn bị xoá. Key mới `storageKeys.seriesSkip` trong `packages/shared/src/storage-keys.ts`.
- Hash do client gửi: tin được trong workspace (không phải ranh giới bảo mật); sai hash chỉ làm khớp/không khớp sai,
  người dùng khôi phục được.

## Related Code Files
- Create: `packages/shared/src/dhash.ts` (+ test), `apps/web/src/features/upload/image-fingerprint.ts`,
  `apps/web/src/features/series/skip-images-section.tsx`, `apps/api/src/routes/series-skip-images.ts` (hoặc trong
  `series.ts` nếu ngắn — chọn file riêng vì `series.ts` đã dài), migration `0009_series_skip_images.sql`
- Modify: `packages/db/src/schema/app.ts`, `apps/api/src/routes/chapters.ts` (ChapterCreate + khớp),
  `apps/api/src/storage.ts`, `apps/api/src/app.ts` (mount route), xoá series (`routes/series.ts:307`),
  `packages/shared/src/storage-keys.ts`, `apps/web/src/features/upload/upload-manager.ts`, `features/upload/api.ts`,
  `features/chapter/source-rail.tsx`, `source-rail-model.ts`, `chapter-workspace.tsx` (toast), `features/series/*`
- Tests: `apps/api/test/chapters.test.ts`, `series.test.ts`, `tenant-isolation.test.ts`, `storage-presign.test.ts`;
  `packages/shared` test; web `upload-manager.test.ts`, `source-rail-model.test.ts`; e2e `upload-chapter.spec.ts`

## Implementation Steps
1. **Tests Before**: `upload-manager.test.ts` (startNewChapter gửi đúng files theo thứ tự), `chapters.test.ts`
   (create không có trường mới vẫn 201) xanh.
2. `dhash.ts` + test (ảnh gradient biết trước → hash cố định; hamming).
3. Migration + schema; storage `copyObject`; storage key.
4. API: create nhận trường mới + khớp; route skip-images (POST/GET/DELETE); dọn khi xoá series.
5. Web: fingerprint (+ đo thời gian với `/Users/jhin1m/Downloads/demo_manga_eng` và chương mẫu 96 ảnh), toast
   "Luôn bỏ", nhãn rail, gợi ý kích thước, mục cài đặt series.
6. **Tests After**:
   - API: series có 1 hash → tạo chương với file hash lệch 3 bit, cùng tỉ lệ → `skip='credit'`; lệch 10 bit → null;
     cùng hash khác tỉ lệ 20% → null. POST từ page vắt 2 slice chỉ học slice nằm trọn. Workspace khác → 404.
   - Web: model gợi ý kích thước (đầu/cuối, ngưỡng 10%); upload-manager gửi dhash khi fingerprint ok, bỏ trống khi lỗi.
   - E2E: chương 1 xoá ảnh cuối → "Luôn bỏ" → tạo chương 2 cùng ảnh → rail "Credit · tự bỏ"; Khôi phục hoạt động.
7. **Regression Gate**: `pnpm typecheck && pnpm lint && pnpm test` + e2e `upload-chapter`, `series-manage`,
   `click-budget`.

## Success Criteria
- [x] Credit đã học bị tự bỏ trước Bước 1, thấy rõ trên rail, khôi phục 1 chạm.
- [x] Không ảnh truyện nào của chương mẫu bị khớp nhầm với danh sách credit của chính nó (đo bằng cách học ảnh
      cuối rồi tạo lại chương).
- [x] Ngưỡng cuối cùng + số đo thời gian hash ghi vào phase file.

## Kết quả đo (2026-10-22)
- Chương mẫu 96 ảnh (`atsu…Chapter_58`, 20.3 MB, 800×~1500 + ảnh cuối 4036×2185): fingerprint (decode + 9×8) **~0.1 s**
  trên Chromium (3 lần: 109/88/90 ms) → giữ "hash mọi ảnh", không cần rút về 5 đầu + 5 cuối.
- Học ảnh cuối (credit) rồi so 95 ảnh còn lại: **0 khớp nhầm**, Hamming nhỏ nhất 22 (ngưỡng 6); 0/4465 cặp ảnh
  truyện khớp nhau. **Chốt ngưỡng: Hamming ≤ 6, tỉ lệ khung ≤ 5%.**
- Thêm sau review: không học ảnh có hash ≤ 8 hoặc ≥ 56 bit 1 (`isPlainHash`, 409 `plain_image`) — ảnh gần trơn /
  khoảng trắng giữa slice ra hash gần 0, dễ tự bỏ nhầm trang truyện. Học khoá hàng series (bấm 2 lần không trùng);
  `not_uploaded` có nút "Thử lại"; trang không chứa trọn ảnh nào → 409 `no_whole_image`.

## Risk Assessment
- Credit cùng template khác chữ (đổi tên người dịch) có thể khớp nhầm/không khớp → chỉ đánh dấu, khôi phục được.
- `createImageBitmap` ảnh > 16k px cao có thể lỗi trên Safari → bắt lỗi, bỏ hash (không chặn upload).
- Thêm 1–1.5s trước khi mở màn chương: nếu vượt, áp phương án chỉ hash đầu/cuối (đã ghi ở Requirements).
