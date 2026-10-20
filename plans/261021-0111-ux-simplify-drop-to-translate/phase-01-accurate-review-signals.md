# Phase 1 — Tín hiệu "cần xem" đúng

Status: Done (2026-10-21, có vấn đề mở — xem [report](../reports/phase-01-261021-ux-simplify-report.md)) · Branch: `feat/ux-p1-review-signals` · Context: [plan.md](./plan.md)

## Vấn đề
Chương mẫu 5 trang: 145 dòng bảng văn bản, 70 "Trống"; 5/5 trang "tràn khung" → lọc "Cần xem" vô dụng.
1. `pageRows` (`apps/web/src/features/chapter/text-table/rows.ts`) lặp mọi `state.regions`, gồm `kind: "bubble"` = khung bóng thoại do detector trả (`worker/mtl_pipeline/detect.py:14,125`), không chứa chữ, `source_text`/`translation` luôn rỗng. Worker đã bỏ qua bubble khi OCR/dịch/mask (`pipeline.py:131`, `textmask.py:126`).
2. `boxOverflow` (`apps/web/src/features/editor/measure.ts:157`) trả >0 cho mọi lệch > 1e-6. Box `auto_fit` do Pillow (render.py) chọn cỡ, trình duyệt đo chênh ~1px → báo "Tràn khung 1px".

## Yêu cầu
- Bảng văn bản, inspector ("Khối N"), export warnings, đếm "Bản dịch · N khối", lọc "Cần xem", rail "tràn khung" **không** tính region `bubble`. Region bubble vẫn giữ trong state (worker/typeset có thể dùng `bubble_id`), chỉ ẩn khỏi UI văn bản.
- Dung sai tràn khung: bỏ qua tràn nhỏ do sai số đo giữa engine. Đề xuất hằng số tên rõ ràng trong `measure.ts`, ví dụ tràn ≤ `max(2px, 4% cạnh box theo trục tràn)` = không tràn. Hàm báo số px (inspector) vẫn trả số thật nhưng chỉ hiện cảnh báo khi vượt dung sai. Chọn ngưỡng bằng dữ liệu thật: chương mẫu đã có trong DB dev (chapter `01a15a7d-b291-775c-aaa9-998278f47783`, xem `page_states.state`) — các khối "1px" phải hết cờ, khối tiêu đề "CHƯƠNG 59: CÂU CHUYỆN VỀ NỖ LỰC CỦA CÔ GÁI HOẢNG LOẠN" (tràn thật lên tranh) vẫn bị cờ. Nếu tiêu đề tràn do box quá hẹp mà auto-fit không thu nhỏ đủ thì giữ cờ là đúng.
- Kiểm `apps/web/src/features/chapter/page-status.ts` (`needsReview`) và nơi tính `overflow` cho rail/topbar dùng cùng hàm có dung sai (DRY, 1 nguồn).

## File
- Sửa: `apps/web/src/features/chapter/text-table/rows.ts`, `apps/web/src/features/editor/measure.ts`, `apps/web/src/features/chapter/inspector.tsx`, `apps/web/src/features/chapter/export-warnings.ts` (nếu cần), nơi gọi `boxOverflows`.
- Test: `apps/web/src/features/editor/__tests__/measure.test.ts`, test rows (tạo nếu chưa có cạnh `rows.ts`), `export-warnings.test.ts`, `page-status.test.ts`.
- Có thể ảnh hưởng e2e `editor`, `chapter-tools` (đếm khối) — chạy lại.

## Kiểm chứng
- Unit test: region bubble không thành dòng; tràn 1px với box 100px không cờ; tràn 30px có cờ.
- `pnpm typecheck && pnpm lint && pnpm test`; e2e `editor`, `chapter-tools`, `typeset-parity`.
- Mở `http://localhost:5180` (dev đang chạy, auto-login) → chương 5 series "123": "Cần xem" giảm hẳn; bảng không còn dòng "—" của bubble.

## Rủi ro
- Text table virtualize theo index; đổi số dòng ảnh hưởng `index` "vùng i" → cập nhật test đếm.
