---
phase: 4
title: "Tự cắt khi thả ảnh"
status: completed
priority: P2
effort: "1d"
dependencies: [3]
---

# Phase 4: Tự cắt khi thả ảnh

## Overview
Thả ảnh chương mới → trình duyệt so mép trên 3 ảnh đầu / mép dưới 3 ảnh cuối với dải đã học → khớp thì tạo chương
với `trim` đặt sẵn, thumbnail "Credit · tự cắt", bỏ được bằng "Bỏ cắt".

## Requirements
- Hàm thuần ở `packages/shared/src/dhash.ts`:
  - `bandWindow(imgW, imgH, band, edge)` → `{sy, sh} | null`: `sh = round(band.height × imgW / band.width)`;
    null khi `sh < 8` hoặc còn lại < `MIN_TRIM_KEEP_PX`.
  - `sameBand(hash, band)` = Hamming ≤ `DHASH_MAX_DISTANCE` (tỉ lệ đã khớp nhờ co theo bề rộng).
- Upload (`upload-manager.ts`): trước `createChapter`, lấy dải đã học của series (`GET /series/:id/skip-images`, lọc
  `edge != null`); không có dải / lỗi mạng → bỏ qua, **không chặn upload**.
- Ứng viên: mép trên của 3 ảnh đầu, mép dưới của 3 ảnh cuối (theo thứ tự sau natural sort), ảnh có dấu
  (`fingerprint` ≠ null). Giải mã mỗi ảnh 1 lần, vẽ từng cửa sổ dải ra 9×8. Mỗi ảnh/mép lấy dải khớp đầu tiên.
- Ảnh đã khớp credit nguyên tấm (server đặt `skip = 'credit'`) → server bỏ `trim` của ảnh đó.
- `POST /chapters`: `UploadFile.trim?: {top, bottom}` → lưu `{…, by: "credit"}`; kiểm biên như PATCH (vượt → bỏ trim
  ảnh đó, không lỗi cả request).
- Web: cờ "Credit · tự cắt"; xem ảnh thấy phủ mờ dải; menu có "Bỏ cắt" (ghi trim null) và "Cắt mép…" (sửa → `by:
  "user"`).
- Hiệu năng: ≤ 6 ảnh × số dải; mục tiêu thêm < 0,3 s cho chương 96 ảnh với 5 dải (đo cùng cách `image-fingerprint`).

## Related Code Files
- Modify: `packages/shared/src/dhash.ts` (+ test `packages/shared/test/dhash.test.ts`)
- Modify: `apps/web/src/features/upload/image-fingerprint.ts` (`bandTrims(blobs, fps, bands)`), `upload-manager.ts`
  (dependency mới như `fingerprints`), `features/upload/api.ts` (gửi `trim`)
- Modify: `apps/api/src/routes/chapters.ts` (`UploadFile.trim`, insert)
- Tests: `apps/api/test/chapters.test.ts`, test upload-manager (dependency giả), e2e: series đã học dải → thả chương
  có banner → thumbnail "Credit · tự cắt" → Dịch chương → page cuối không banner.

## Implementation Steps
1. Test shared `bandWindow`/`sameBand` (co theo bề rộng 720 ↔ 800, dải quá cao → null).
2. API `POST /chapters` nhận/kiểm `trim`, bỏ trim khi `skip = 'credit'`.
3. `bandTrims` + nối vào upload-manager (inject để test).
4. Nhãn/cờ web (đã làm sẵn ở P2) — kiểm lại.
5. e2e + đo thời gian với chương mẫu thật.

## Success Criteria
- [x] Chương N+1 cùng banner → tự cắt đúng mép; chương không banner → không cắt gì (e2e chương sạch: 0 trim; mẫu 96 ảnh × 5 dải: 0 khớp).
- [x] Lấy dải lỗi → upload vẫn chạy như cũ.
- [x] Gate chung xanh.

## Risk Assessment
- Khớp nhầm phần truyện giống dải (nền trắng/đen): đã chặn dải gần trơn lúc học; chỉ xét 3 ảnh mỗi đầu; người dùng thấy
  cờ và "Bỏ cắt" được trước Bước 1.
- Banner lệch chiều cao/vị trí giữa các chương → không khớp (cắt tay lại, học thêm mẫu mới).
- Thứ tự ảnh đổi sau khi tạo chương (kéo-thả) → trim vẫn theo ảnh, không theo vị trí — đúng mong muốn.
