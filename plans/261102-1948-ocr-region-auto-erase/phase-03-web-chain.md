# Phase 3 — Web: xoá sau xác nhận OCR

## Files
- `apps/web/src/features/editor/api.ts` — `startReinpaint` nhận body có `auto_text_bbox`
- `apps/web/src/features/editor/canvas/OcrSelect.tsx` — `useOcrRegion`: sau khi gửi OCR (khung mới, không phải
  "Dịch lại khối") → đưa bbox vào hàng xoá
- File mới `apps/web/src/features/editor/erase-queue.ts` (thuần, có test): hàng đợi tuần tự, mỗi lần lấy
  `clean_rev` hiện tại của page, gọi reinpaint, chờ job, báo `onDone` để tải lại ảnh; 409 `clean_rev_changed` → lấy
  rev mới, thử lại 1 lần
- `apps/web/src/features/chapter/chapter-workspace.tsx` — truyền `cleanRev` + `data.refresh` vào hook
- `apps/web/src/features/chapter/tool-panels.tsx` — checkbox "Xoá chữ gốc trong khung" (localStorage, try/catch),
  trạng thái "Đang xoá chữ gốc… (n)", lỗi riêng
- `apps/web/e2e/fake-worker.ts` — xử lý reinpaint nhánh bbox

## Bước
1. API client + kiểu.
2. `erase-queue.ts` + test (tuần tự, retry 409 một lần, huỷ khi đổi trang).
3. Nối vào `useOcrRegion.start` (chỉ khi không có `regionId` và checkbox bật); OCR và xoá chạy song song.
4. Panel: checkbox + trạng thái; cập nhật hướng dẫn 3 bước ("…và chữ gốc được xoá").
5. Đổi trang/huỷ OCR: huỷ hàng xoá của page đó (job đang chạy → `cancelJob`).

## Test
- Unit `erase-queue`: 3 bbox → 3 lần gọi tuần tự với rev tăng dần; 409 → refetch + retry; abort → dừng.
- Trình duyệt: kéo 1 khung SFX → khối chữ + ảnh sạch đổi; tắt checkbox → ảnh không đổi.
