# Phase 5: Rail 5 nút, Văn bản, Xuất

Wireframe: khung "Panel Văn bản", "Không chọn gì, menu Xuất + menu trang".

## File

`features/chapter/tool-rail.tsx`, `tool-rail-model.ts` + test, `chapter-workspace.tsx`, `text-table/text-table.tsx`, `FindReplace.tsx`, `proofread-panel.tsx`, `export-panel.tsx`, `export-drawer.tsx`.

## Việc

1. Rail 5 nút, 48px, chỉ icon + tooltip có tên và phím: Chọn, Chữ, Tẩy, Quét, Văn bản.
2. Panel "Văn bản" 4 tab: Bản dịch, Tìm / Thay, Glossary, Hiệu đính · N. Rút `PanelId` còn `tool` | `doc` + tab đang mở. Ctrl+F mở tab Tìm và focus ô tìm như cũ.
3. Các tab giữ nội dung đã mount khi chuyển tab, giữ kết quả xem trước Tìm/Thay như cách `hidden` hiện tại.
4. Bảng còn 4 cột: Vị trí "3·5", Gốc, Dịch, cờ. Bấm hàng vẫn nhảy tới khối (panel đè nên phải dùng hàm tự cuộn của phase 3).
5. Hiệu đính: bỏ đoạn giải thích; xác nhận còn 1 dòng trang, giá, thời gian + nút Chạy. `PROOFREAD_DATA_NOTICE` chuyển vào ⓘ ngay cạnh nút Chạy, không bỏ.
6. Xuất: drawer thành menu dưới nút Xuất. Thứ tự: 1 dòng "N trang cần xem", nút Tải, tóm tắt tuỳ chọn (bấm để mở), lần xuất trước + Tải lại. Giữ nguyên luồng xuất, poll, tạm dừng hết ngân sách.

## Kiểm tra

- `tool-rail-model.test.ts`, `export-options.test.ts`, `export-warnings.test.ts`, `proofread-model.test.ts`; e2e `proofread`, `chapter-tools`, `full-flow`, `glossary-language-pair`, `click-budget`.
- Xem bằng tay: Ctrl+F khi đang ở tool khác, Tìm/Thay rồi Hoàn tác, xuất lại khi link hết hạn, đóng menu Xuất trong lúc đang xuất rồi mở lại.

## Rủi ro

- Menu Xuất đóng khi bấm ra ngoài: tiến độ xuất phải còn ở chip và Hoạt động.
- Icon-only có thể khó đoán Tẩy và Quét. Nếu dùng thật thấy khó, bật nhãn 11px, rail 64px.

## Sau phase này

Cập nhật `docs/design-guidelines.md` (mục Màn chương, sơ đồ khung, Home, Series) và `docs/editor.md`. Chạy `/ak:code-review` trên toàn branch rồi mới merge.
