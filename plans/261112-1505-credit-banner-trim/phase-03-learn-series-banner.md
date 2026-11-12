---
phase: 3
title: "Học dải banner theo series"
status: completed
priority: P2
effort: "1d"
dependencies: [2]
---

# Phase 3: Học dải banner theo series

## Overview
Sau khi cắt mép, toast có thêm "Luôn cắt ở series này": lưu dấu (dHash) của dải đã cắt để chương sau tự cắt (P4).

## Requirements
- Dùng lại bảng `series_skip_images`, thêm cột `edge text null` check `in ('top','bottom')`: null = cả ảnh (như cũ),
  `top`/`bottom` = dải mép. `dhash/width/height` của dải = dHash vùng dải, bề rộng ảnh, chiều cao dải (px ảnh thật).
  Dùng chung giới hạn 100/series, chung màn quản lý "Ảnh tự bỏ".
- `creditMatcher` (`series-skip-images.ts:41`) chỉ so hàng `edge IS NULL`.
- `POST /series/:id/skip-images` nhận thêm dạng `{source_file_id, edge, dhash}`:
  - ảnh phải thuộc chương của series, có `trim` ở mép đó (`trim.top > 0` / `trim.bottom > 0`), nếu không → 409
    `no_trim`; `height` dải lấy từ `trim` phía server, không tin client.
  - `dhash` sai dạng → 400; gần trơn (`isPlainHash`) → 409 `plain_image`; trùng dải đã học (cùng edge, Hamming ≤ 6,
    tỉ lệ lệch ≤ 5%) → không thêm, trả như đã học.
  - thumbnail: `copyObject` ảnh gốc như hiện nay (API không xử lý ảnh); UI tự hiện đúng dải bằng CSS theo
    `edge` + `height/width`.
- dHash dải tính ở **trình duyệt** lúc bấm "Luôn cắt…": `bandFingerprint(blob, edge, bandPx)` trong
  `image-fingerprint.ts` (`createImageBitmap(blob, sx, sy, sw, sh)` → 9×8 xám → `dhashFromGray`). Nguồn ảnh: Blob
  local của phiên upload nếu còn, không thì `fetch(URL ký)` → blob.
- Toast sau cắt: "Hoàn tác · Luôn cắt ở series này"; cắt cả 2 mép → học cả 2 dải (2 request, báo "Đã học n dải").
  Lỗi tính hash / mạng → toast có "Thử lại".
- Màn "Ảnh tự bỏ" (`series/skip-images-section.tsx`): mục dải hiện nhãn "Dải đầu ảnh" / "Dải cuối ảnh", thumbnail
  chỉ dải đó; xoá như mục cũ.

## Related Code Files
- Modify: `packages/db/src/schema/app.ts` + migration (`add_series_skip_image_edge`)
- Modify: `apps/api/src/routes/series-skip-images.ts` (+ test `apps/api/test/series-skip-images.test.ts`)
- Modify: `apps/web/src/features/upload/image-fingerprint.ts` (+ test), `apps/web/src/features/series/api.ts`,
  `apps/web/src/features/series/skip-images-section.tsx`, `apps/web/src/features/chapter/chapter-workspace.tsx` (toast)

## Implementation Steps
1. Test API: học dải hợp lệ; `no_trim`; `plain_image`; trùng; full 100; series khác → 404; `creditMatcher` bỏ qua dải.
2. Migration + route.
3. `bandFingerprint` + unit test (vùng sx/sy đúng với edge, ảnh thật nhỏ trong test).
4. Toast + màn quản lý.
5. **Kiểm CORS** (bản hosted): `fetch` URL ký ảnh gốc từ web ở dev (MinIO) và prod. Self-host đã cùng origin
   (`/files/…`, `storage-drivers/disk-driver.ts`) — chỉ cần chạy thử một lần. Ghi kết quả vào report của phase.
<!-- Updated: Validation Session 1 - self-host không cần CORS -->

<!-- Updated: Validation Session 1 - user chốt tự cắt luôn khi khớp (P4), giữ nguyên thiết kế học dải -->


## Success Criteria
- [x] Học dải xong, thấy trong "Ảnh tự bỏ" với nhãn + thumbnail đúng dải.
- [x] Học ảnh nguyên tấm cũ không đổi hành vi (test cũ không sửa).
- [x] Gate chung xanh.

## Risk Assessment
- CORS chặn `fetch` URL ký → không tính được hash khi Blob local đã mất (mở lại chương ở tab khác). Mitigation: báo
  "Không đọc được ảnh, thử lại" ; nếu xác nhận bị chặn trên một môi trường thì bật CORS storage tương ứng (không đổi
  thiết kế).
- Thumbnail = bản sao ảnh gốc cả tấm (nặng với ảnh webtoon cao) — giống ảnh credit cũ, chấp nhận.
