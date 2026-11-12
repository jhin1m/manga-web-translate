# Phase 2 report: Thanh trên màn chương

## Việc theo mục
1. EditState: chỉ hiện pill khi đang lưu / chưa lưu / lỗi lưu / chỉ xem / mất khoá / lấy khoá. Lúc bình thường vùng `role="status"` "Khoá chương" vẫn nằm trong DOM, chỉ còn chữ sr-only "Bạn đang giữ khoá chương · Đã lưu" (đổi theo trạng thái lưu nên trình đọc màn hình vẫn nghe được). Không thêm dấu ✓.
2. Chip thành nút (`role="status"` "Trạng thái chương" giữ nguyên bên ngoài). Có trang cần xem (chương không busy) → `nextReviewPage` rồi `pickPage` (cùng đường với bấm thumbnail: `session.activate` lưu trang đang sửa trước), vòng lại từ đầu, bỏ qua trang đang mở. Còn lại → mở Hoạt động. Mục "Hoạt động" (kèm "N đang chạy") luôn có ở menu ⋯.
3. Bỏ ActivityButton khỏi thanh trên (đã bỏ biến thể icon). `chipWithActivity`: thêm "· đang xuất" và "· chương khác đang tải ảnh" (chương yên chuyển tone busy; warn/danger giữ tone).
4. Đang chạy: nút chính = "Huỷ" (btn-danger, title "Huỷ xử lý chương"), không còn Export khoá. Thanh 2px ở đáy header (`chapterProgress`: tỉ lệ khi đo được, vạch chạy qua lại khi chưa đo được, tắt animation khi reduced-motion).
5. Chip "Hàn → Việt" gộp vào popover tên chương (chọn Dịch từ/Sang + Lưu chung một form; PATCH series rồi PATCH chương nếu cần). "Chương 12" → "Ch.12" (aria-label "Chương 12 · tên"), "Xem gốc" → "Gốc" (aria-label "Xem gốc").
6. "Export" → "Xuất": primary-action, topbar, activity-drawer (nhãn job + mục "Xuất gần đây"), tiêu đề drawer "Xuất chương", comment drawer.tsx/export-panel.tsx. Quét `src` + `index.html`: không còn "Export" hiển thị (tên biến/route/type giữ).
7. partial_failed có trang: nút chính "Chạy lại N trang" (N=0 → "Chạy lại trang lỗi"), "Xuất" + "Dịch lại cả chương" trong menu ⋯.

## Quyết định tự chọn
- Chip busy (đang dịch/cắt trang) bấm = mở Hoạt động dù có trang cần xem (đang chạy thì xem tiến độ hơn nhảy trang).
- Chỉ còn mỗi trang đang mở cần xem → không nhảy, chip dẫn tới Hoạt động; aria-label chip nói rõ hành động ("nhảy tới trang cần xem" / "mở Hoạt động").
- Popover: nút Lưu tắt khi chưa đổi gì; ô ngôn ngữ ẩn khi đang chọn series khác (ngôn ngữ thuộc series hiện tại).
- `lang-pair-popover.tsx` giữ tên file nhưng giờ chỉ xuất `LangPairFields`.
- Wireframe trạng thái chỉ xem có nút "Thử lại" làm nút chính; không có trong phase nên giữ "Thử lại" ở băng cảnh báo như cũ.

## Test
- Unit: primary-action.test (Huỷ, Chạy lại N trang, không còn Export), status.test (progress, chipWithActivity, `nextReviewPage`: kế tiếp, vòng lại, không có trang mở, chỉ trang mở/không có gì → null).
- e2e mới `chapter-topbar.spec.ts` (6 test, 1280): nhảy trang lưu trước chữ sửa dở + vòng lại; chip/menu mở Hoạt động; vùng live luôn có, không pill khi bình thường; trang lỗi (nút "Chạy lại 2 trang", Xuất trong menu, quét aria-label/title/text không có "Export", ≤ 8 mục); đang chạy (một Huỷ, vạch 2px đúng tỉ lệ); done (Xuất, popover gộp ngôn ngữ lưu PATCH series). Trạng thái lỗi/đang chạy giả bằng cách sửa phản hồi /progress (worker giả không tạo trang lỗi).
- e2e sửa theo tên mới (ý kiểm giữ nguyên): "Đã lưu" → vùng "Khoá chương" chứa "Đã lưu" (editor, proofread, full-flow); "Export" → "Xuất"/"Xuất chương" (full-flow, chapter-tools); full-flow: chương đang cắt trang kiểm nút Huỷ bấm được + không có nút Xuất; editor: Hoạt động mở qua menu ⋯ và qua chip.

## Gate
typecheck xanh, lint xanh (0 cảnh báo), unit web 391 (381 + 10) / api 435 / shared 60 / db 8, e2e 66/66 (60 cũ + 6 mới, 3.7 phút; lượt đầu 7 lỗi do selector "Đã lưu" cũ, đã sửa). click-budget không đổi.

## Đã xem bằng ảnh (Playwright tạm 1280x800, đã xoá spec)
Đủ 6 trạng thái: draft, running (có vạch 2px), error (+ menu ⋯ có Xuất/Hoạt động), review (2 cần xem), done, readonly (tab thứ hai); thêm pill "Chưa lưu", popover tên chương có ô ngôn ngữ; tên series rất dài ở 1280/900/720 (cắt "…", chip co lại, Ch.N không bị ép). Phát hiện + sửa lúc xem: chấm chip mất do `display:block`, icon ‹ bị bóp ở 720.
Chưa xem: draft có upload dở (chỉ unit), trạng thái "Đang lấy khoá…", mất khoá (chỉ kiểm bằng code, không dựng được ổn định).

## Rủi ro còn lại
- Mất dấu "Đã lưu" thường trực: dùng được nhờ sr-only; người nhìn mắt chỉ thấy pill khi chưa lưu/lỗi. Nếu thấy lo thì thêm ✓ nhỏ (đã ghi trong plan).
- Chip hẹp (≤ 720) cắt "…" phần đuôi; đủ chữ ở aria-label.
