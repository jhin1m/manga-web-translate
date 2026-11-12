# Phase 4: Canvas và cột trang

Wireframe: khung "Không chọn gì, menu Xuất + menu trang".

## File

`features/chapter/page-rail.tsx`, `source-rail.tsx`, `canvas-controls.tsx`, `page-status.ts` + test, `chapter-topbar.tsx` (`LockBand`), `chapter-workspace.css`.

## Việc

1. Một cụm giữa dưới canvas: ‹ 3/12 › · 62%. Nút % bấm đổi Vừa khung ↔ 100%, tooltip nói rõ.
2. Cột trang 72px, thumb 52×72, chỉ ảnh + số. Cờ là icon ở góc (! cần xem, × lỗi) kèm tooltip và `aria-label` đầy đủ, không chỉ dùng màu.
3. Trang đang chạy vẫn giữ thanh % trên thumb. Trang ẩn giữ kiểu mờ + viền đứt.
4. Bỏ đầu cột ("N trang", lọc "Cần xem"). Tổng trang đã có ở pager, nhảy trang cần xem đã có ở chip. Giữ thanh "Dịch N trang · Bỏ chọn" khi chọn nhiều trang.
5. Menu ⋯ luôn hiện trên trang đang mở; chuột phải (và Shift+F10) mở cùng menu. Bỏ nút thùng rác hiện khi rê chuột.
   - Trang đang mở: Dịch trang này / Dịch lại trang, Bỏ sửa tay (chỉ khi khác bản AI), Ẩn trang.
   - Trang khác, chuột phải: chỉ Ẩn trang / Khôi phục như hiện tại.
6. "Bỏ sửa tay" không cần hộp xác nhận vì Ctrl+Z hoàn tác được; hiện thông báo ngắn sau khi làm.
7. `SourceRail` (chương chưa cắt trang) cùng cỡ thumb. Giữ kéo-thả đổi thứ tự, Alt+↑/↓ và menu chuột phải. Nhãn "Đang tải" chuyển vào tooltip + icon.
8. Rút câu ở `LockBand` theo khung wireframe; lý do dài vào tooltip.

## Kiểm tra

- `page-status.test.ts`, `source-rail-model.test.ts`, `page-selection.test.ts`; e2e `editor`, `upload-chapter`, `full-flow`.
- Xem bằng tay: chương 150 trang (cuộn cột), ⌘/Shift chọn nhiều trang, kéo đổi thứ tự ảnh gốc, ẩn rồi khôi phục trang.

## Rủi ro

- Thumb 52×72 khó nhìn với strip dài: nếu test thực tế thấy không ổn, tăng lên 60×84, không quay lại nhãn chữ.
- Mất lọc "Cần xem" với chương nhiều trang lỗi: nhảy lần lượt bằng chip có thể chậm hơn. Theo dõi khi dùng thật.
