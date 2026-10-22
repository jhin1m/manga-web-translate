# Sửa theo code review: màn chương "rail công cụ + 1 panel"

Ngày 23/10/2026 · nhánh `feat/chapter-workspace-tool-rail` (chưa push) · nguồn:
[code-review-chapter-workspace-tool-rail-report.md](./code-review-chapter-workspace-tool-rail-report.md) · commit sửa
`7ef240b`.

## Finding đã sửa

| # | Kiểm chứng | Sửa |
|---|---|---|
| M1 kéo khối khi panel thu → khối lệch | **Có thật, tái hiện bằng e2e**: kéo sang phải 30px → khối nhảy về x = −54 (lệch ~114px trang sang trái). Nguyên nhân đúng như report: chọn ở `onMouseDown` → panel tự mở → canvas vừa lại giữa lúc Konva kéo. | `chapter-workspace.tsx`: theo dõi chuột đang nhấn; chọn khối lúc đang nhấn thì panel chỉ mở ở `pointerup`. E2E mới "dragging a block while the panel is collapsed moves it only by the drag distance" (đỏ trước, xanh sau). |
| M2 "Thu panel" bằng bàn phím → focus về body | Có thật (nút nằm trong `<aside hidden>`). | Trước khi thu, focus nút rail đang `aria-pressed`. E2E: focus nút Thu panel → Enter → nút "Chọn (V)" có focus. |
| L1 Tab trong menu nổi → focus về body | Có thật (`onClose` + `preventDefault`). | Tab: đóng menu, trả focus về phần tử mở, không chặn mặc định → Tab đi tiếp từ đó. E2E: chuột phải thumbnail → Tab → menu đóng, body không giữ focus. |
| L2 T/B/E/R vẫn đổi công cụ khi Chỉ xem | Có thật, lệch rail + docs. | `case "tool"`: chặn khi `sourceMode` hoặc `readOnly` (trừ Chọn). Docs ghi rõ. |
| L3 Bảng Bản dịch mất cột "Loại" | Có thật (chỉ còn `title`). | Thêm lại cột "Loại" 52px (`28 32 1fr 1.2fr 52 84`), class riêng `cw-kind` (không đổi locator `.cw-src` của e2e). Docs cập nhật. |
| L4 Vùng bấm `.btn-link` < 32px | Có thật. | `.btn-link { min-height: 32px }`. |
| L5 Xung đột bị giấu khi người dùng thu panel | Có thật. | Băng cảnh báo hiện "n thay đổi chưa áp được do xung đột khi lưu — đổi trang sẽ mất danh sách." + nút "Xem" (mở panel) khi panel thu mà còn xung đột (`LockBand` prop `hiddenConflicts`). |
| L6 Thanh nổi ra ngoài khung khi khối cao hơn khung nhìn | Có thật (không kẹp dọc). | `blockBarPos` kẹp `top` trong khung; unit test mới. |
| L8 CSS chết `.ed-tool*` | Có thật. | Xoá; sửa comment `editor.css` (nền ấm). |
| L8 Lý do nút rail tắt không đọc được | Có thật (`aria-label` đè `title`). | `aria-describedby` trỏ `span.sr-only` chứa lý do. |
| L8 Mô tả "Chạy lại trang lỗi trong ⋯ khi đang chạy" sai | Đúng (thực tế ở trạng thái Chờ dịch có trang lỗi). | Sửa plan mục 20. |

## Finding bỏ qua (lý do)

- **L7 màu nhấn cam gần màu cảnh báo** (`--c-info` = accent, 1.10:1 với `--c-warn`): bảng token trong brief owner đã
  duyệt đặt `--c-focus`, `--c-info` theo `--c-accent`; mọi trạng thái đều kèm nhãn chữ nên không vi phạm "chỉ dùng
  màu". Không tự đổi quyết định của owner → Câu hỏi mở 1.
- **L8 tên dài ở đầu trang series xuống dòng thay vì "…"**: giữ — tiêu đề trang hiện đủ tên, không đè cột nào, không
  tràn ngang (e2e kiểm `scrollWidth`); cắt "…" ở `h1` sẽ giấu tên ở đúng nơi cần đọc đủ → Câu hỏi mở 2.

## Kết quả kiểm tra (chạy chuỗi sau commit `7ef240b`)

| Lệnh | Kết quả |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (Biome 275 file, không lỗi/cảnh báo) |
| `pnpm test` | exit 0 — shared 17, web 180, db 3, api 176 |
| `pnpm --filter @mtl/web e2e` | exit 0 — 30 passed (thêm 1 test kéo khối; thêm bước Thu panel/Tab-menu vào test có sẵn) |

Ghi chú: lượt e2e đầu sau khi thêm cột Loại đỏ 3 test do tôi dùng lại class `.cw-src` cho ô Loại (locator trùng 2 phần
tử) — đổi sang class `cw-kind`, không sửa test; chạy lại xanh.

## Câu hỏi mở

1. L7: tách `--c-info` (VD xanh trung tính) khỏi màu nhấn để "Đang xử lý" / outline trang đang mở khác viền "Cần xem"?
   Brief hiện đặt `--c-info` = nhấn.
2. Tên series dài ở đầu trang series: giữ xuống dòng (hiện đủ) hay cắt "…" + `title` như dòng nghiệm thu plan?
3. Panel tự mở khi chọn khối (plan mục 7): nay mở sau khi nhả chuột — owner thử tay xem có muốn bỏ hẳn tự mở không.
4. Màn chương chưa có bề rộng tối thiểu / `@media` (report câu 5): ~1280px còn ~544px cho canvas khi panel 560px mở;
   chưa xử lý, chờ owner chốt màn nhỏ nhất cần hỗ trợ.
5. Các câu hỏi 1–23 trong [plan.md](../plan.md) vẫn chờ owner.
