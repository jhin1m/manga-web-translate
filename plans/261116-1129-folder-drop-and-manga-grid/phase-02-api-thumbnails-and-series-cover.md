---
phase: 2
title: "Phase 2: API thumbnail + ảnh bìa series"
status: done
priority: P1
effort: "5h"
dependencies: []
---

# Phase 2: API thumbnail + ảnh bìa series

## Overview
API tạo thumbnail WebP nhỏ từ ảnh gốc khi có người xem (`sharp`), lưu cache vào storage, trả 302 tới URL ký. Series
list/detail trả sẵn `cover_src` / `thumb_src` để web chỉ việc `<img src>`. Thêm ảnh bìa tuỳ chỉnh (cột
`series.cover_key`, upload / xoá).

## Requirements
- Functional:
  - `GET /api/thumbs/:fileId` → thumbnail của `source_files.id` (thuộc user, qua `sdb` scoped): áp `trim` (top/bottom)
    rồi cắt phần trên tỉ lệ 3:4, resize rộng 300, WebP q≈75.
  - Chưa có file gốc (upload chưa xong) → 404 (web hiện placeholder).
  - `GET /api/series`: mỗi series thêm `cover_src: string | null` — bìa tuỳ chỉnh (URL ký) nếu có, không thì
    `/api/thumbs/{fileId}` của trang đầu không `skip` (ord nhỏ nhất) thuộc chương số nhỏ nhất **có** trang như vậy;
    không có → null.
  - `GET /api/series/:id`: mỗi chương thêm `thumb_src: string | null` (trang đầu không skip của chương đó).
  - `PUT /api/series/:id/cover` (multipart field `file`, ≤ 10 MB, png/jpeg/webp kiểm bằng `sharp().metadata()`, không
    tin Content-Type) → resize `600×800` `fit: cover, position: top`, WebP → lưu, ghi `cover_key`, xoá object cũ.
  - `DELETE /api/series/:id/cover` → `cover_key = null`, xoá object.
- Non-functional:
  - Giới hạn đồng thời tạo thumbnail trong process API (semaphore 2) + `sharp.concurrency(1)`; `limitInputPixels`
    (vd 100 MP) → ảnh quá khổ trả 422, không sập process.
  - Query `cover_src` cho cả danh sách: **1 câu SQL** (`DISTINCT ON (series_id)`), không N+1.
  - Không đổi hành vi worker.

## Architecture
- Storage keys (`packages/shared/src/storage-keys.ts`):
  - `thumb(user, ch, fileId, top, bottom) = u/{user}/ch/{ch}/thumb/{fileId}-{top}-{bottom}.webp` → đổi trim tạo key
    mới (không cần invalidation); xoá chương đã dọn prefix `u/{user}/ch/{ch}/` (`lib/chapter-removal.ts`).
  - `seriesCover(user, series, id) = u/{user}/series/{series}/cover/{id}.webp` → xoá series đã dọn
    `u/{user}/series/{id}/` (`routes/series.ts`).
- `StorageDriver.putObject(key, bytes, contentType)`: S3 `PutObjectCommand`; disk ghi file tạm + `rename` (atomic).
  Re-export ở `storage.ts`.
- Module mới `apps/api/src/lib/thumbnails.ts`:
  - `renderThumb(buf, trim)`: `sharp(buf, { limitInputPixels })` → metadata → `extract({ top: trim.top, height:
    min(H - top - bottom, round(W * 4 / 3)) })` → `resize(300)` → `webp({ quality: 75 })`.
  - `renderCover(buf)`: `resize(600, 800, { fit: "cover", position: "top" })` → webp.
  - Semaphore đơn giản (hàng đợi promise) bọc phần sharp.
- Route mới `apps/api/src/routes/thumbs.ts`: byId(sourceFiles) → key → `head(thumbKey)`; thiếu → `head(source)`
  (null → 404) → `readObject` (file ≤ 30 MB đã kiểm lúc upload) → `renderThumb` → `putObject`. Trả
  `302 Location: presignGet(thumbKey, MAX_GET_TTL_S)` với `Cache-Control: private, max-age=600` (< TTL ký 15').
  Hai request cùng lúc cùng file → tạo 2 lần, ghi đè cùng nội dung — chấp nhận.
- `seriesView` / series routes: cột `cover_key`; list dùng helper `firstPageFiles(sdb, { seriesIds | chapterIds })`
  trả map → URL. Bìa tuỳ chỉnh: `cover_src = /api/series/{id}/cover?v={uuid trong cover_key}` (ổn định, chỉ đổi khi đổi bìa); `GET /api/series/:id/cover` → 302 `presignGet(coverKey)` + `Cache-Control: private, max-age=600`, chưa có bìa → 404. List không ký URL.
- Migration `packages/db`: `series.cover_key text null` (generate drizzle + down viết tay theo
  `docs/development-setup.md`).
- Dependency: `sharp` vào `apps/api` (prebuilt `@img/sharp-linux-{x64,arm64}` glibc — app image là
  `node:24-bookworm-slim`); thêm `sharp: true` vào `allowBuilds` (`pnpm-workspace.yaml`) nếu pnpm chặn script cài.
- Hợp đồng zod web↔API (`packages/shared` nếu series list/detail có schema ở đó; không thì type ở
  `apps/web/src/features/series/api.ts`) thêm `cover_src`, `cover_custom: boolean`, `thumb_src`.

## Related Code Files
- Create: `apps/api/src/lib/thumbnails.ts`, `apps/api/src/routes/thumbs.ts`, test cho cả hai, migration
  `packages/db/drizzle/NNNN_series_cover_key.sql` (+ down)
- Modify: `packages/db/src/schema/app.ts`, `packages/shared/src/storage-keys.ts`,
  `apps/api/src/storage-drivers/{types,s3-driver,disk-driver}.ts`, `apps/api/src/storage.ts`,
  `apps/api/src/routes/series.ts`, `apps/api/src/app.ts` (mount route), `apps/api/package.json`,
  `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/web/src/features/series/api.ts` (type)
- Delete: —

## Implementation Steps
1. Thêm `sharp`; kiểm `pnpm install` không bị chặn build; `node -e "require('sharp')"` trong container app (amd64).
2. `putObject` cho 2 driver + test disk driver (atomic, ghi đè).
3. `storageKeys.thumb` / `seriesCover`.
4. `lib/thumbnails.ts` + test: strip 800×12000 → 300×400; ảnh ngắn hơn 3:4 (800×600) → giữ tỉ lệ thật; trim
   top 500 → vùng bắt đầu từ 500; ảnh 0 byte / không phải ảnh → lỗi rõ; > limitInputPixels → lỗi 422.
5. `routes/thumbs.ts` + test: file user khác → 404 (scoped); chưa upload → 404; lần 2 không gọi sharp (đã cache);
   302 + `Cache-Control`.
6. Migration `cover_key` + down; `seriesView` trả `cover_custom`.
7. Series list `cover_src` (1 câu `DISTINCT ON`, có test: chương số nhỏ nhất toàn trang skip → lấy chương kế; series
   không chương → null; bìa tuỳ chỉnh thắng) + detail `thumb_src`.
8. `PUT/DELETE /series/:id/cover` + test (sai định dạng → 400, > 10 MB → 413, thay bìa xoá object cũ, xoá series dọn
   bìa).
9. `pnpm --filter @mtl/api test`, typecheck, lint.

## Success Criteria
- [x] Thumbnail đúng vùng (trim + 3:4), ≤ ~40 KB, tạo một lần rồi dùng cache.
- [x] Không lộ ảnh user khác (test scoped).
- [x] `GET /api/series` không thêm query theo số series (1 câu cho bìa).
- [x] Upload / xoá bìa đúng, object cũ được dọn.
- [x] Migration up/down chạy được; test API xanh.

## Risk Assessment
- RAM khi giải mã strip lớn đồng thời: semaphore 2 + `limitInputPixels`; strip 1000×40000 ≈ 160 MB RGBA mỗi lần —
  chấp nhận với 2 slot (self-host app container đang ~0,7 GB tổng app + DB; đo lại ở phase 4).
- `sharp` native trên VPS systemd (Node 24, glibc) và CI build multi-arch: kiểm ở phase 4; fallback build từ source
  cần libvips — tránh bằng cách giữ glibc base.
- Disk driver: `presignGet` trả link `/files/…` ký HMAC → 302 tới same-origin, ổn.
- Lần đầu mở trang chủ với nhiều series: N request tạo thumb xếp hàng ở semaphore → ảnh hiện dần; web dùng
  `loading="lazy"`.
- Rollback: revert commit + migration down (cột nullable, không mất dữ liệu khác); object thumb/bìa thừa nằm dưới prefix
  đã có, dọn theo chương/series.
