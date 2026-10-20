# Phase 3 — Gom trạng thái về 1 chỗ

Status: Pending · Branch: `feat/ux-p3-status` · Context: [plan.md](./plan.md), [docs/design-guidelines.md](../../docs/design-guidelines.md)

## Vấn đề
Trạng thái chương hiện ở 5 nơi cùng lúc: chip cạnh tên chương (`chapter-topbar.tsx`), băng `LockBand` (`chapter-topbar.tsx:144-192`, luôn hiện "Bạn đang giữ khoá chương"/"Chương nháp — …"/"Đang dịch — sửa được khi xong"), banner "Bắt đầu dịch N ảnh. Đóng" (`chapter-workspace.tsx:~235`, còn sau khi dịch xong), nút primary "Đang dịch 0/5", rail trang. Người dùng không biết nhìn đâu.

## Yêu cầu
- 1 nguồn trạng thái chương: chip ở topbar (vd "Đang dịch 3/5", "Chờ duyệt · 2 cần xem", "Xong") + nút primary theo trạng thái (giữ `primary-action.ts`). Rail giữ trạng thái **theo trang**.
- `LockBand`: chỉ hiện khi có điều người dùng phải biết/làm: người khác giữ khoá, mất khoá, lỗi khoá, khôi phục phiên, lưu lỗi. Trạng thái bình thường ("đang giữ khoá", "Đã lưu", "nháp", "đang dịch") không chiếm 1 dải riêng — "Đã lưu/Đang lưu…" thu nhỏ vào topbar.
- Banner kết quả commit ("Bắt đầu dịch N ảnh"): bỏ khi thành công (chip đã nói); chỉ giữ khi có file bị loại (`rejected`) và tự ẩn khi chương ổn định.
- Topbar: giảm số nút ngang hàng — giữ `Gốc/Dịch/Chia đôi`, `Dịch lại ▾`, `Xuất` (primary); gom `Hoạt động` và `?` vào 1 menu "⋯" hoặc icon nhỏ. Không xoá tính năng.
- Giữ a11y: `role="status"` cho chip trạng thái, `aria-live` polite.

## File
- Sửa: `apps/web/src/features/chapter/chapter-topbar.tsx`, `lock-banner.tsx` (nếu dùng), `chapter-workspace.tsx`, `chapter-action-button.tsx`, `chapter-workspace.css`, có thể `status.ts`, `next-action.ts`.
- Test: `primary-action.test.ts`, `next-action.test.ts`; e2e `full-flow`, `upload-chapter`, `chapter-tools`, `editor`, `click-budget` (selector theo text/role sẽ đổi — cập nhật selector, không nới kiểm tra hành vi).

## Kiểm chứng
- `pnpm typecheck && pnpm lint && pnpm test` + toàn bộ e2e web.
- Thủ công: chương nháp / đang dịch / chờ duyệt / mở chương ở tab thứ 2 (khoá bị từ chối → băng cảnh báo hiện).

## Ghi chú thêm (từ phase 1)
- e2e đang có lỗi console setState-in-render ở `LockBand` (có từ trước) — sửa trong phase này vì đụng LockBand.
- Thông báo "Đã xếp dịch lại…" (và mọi banner kết quả hành động) chèn phía trên canvas làm canvas nhảy — chuyển sang dạng không chiếm chỗ (toast nổi tự ẩn hoặc chip topbar).
- Nhãn "Đang dịch…" trên page (PageSlot) chưa có nền riêng — thêm nền nhẹ cho dễ đọc nếu tiện.
