# Phase 3: Panel khối và thanh phụ công cụ

Wireframe: khung "Mới A · Chọn khối", "Công cụ Tẩy chữ", "Thanh trên + thanh phụ". Đây là phase rủi ro nhất.

## File

`features/chapter/chapter-workspace.tsx` + `.css`, `context-panel.tsx`, `select-panel.tsx`, `tool-panels.tsx`, `tool-rail-model.ts` + test, `block-toolbar.tsx` (xoá), `features/editor/panels/MaskPanel.tsx`, `Properties.tsx`, `features/editor/page-layout.ts`.

## Việc

1. Panel đè lên canvas (`position: absolute` trong vùng canvas). Canvas giữ nguyên bề ngang khi panel đóng mở nên ảnh không nhảy.
2. Panel đóng mặc định. Chọn khối thì mở (nối tiếp logic sẵn có ở `chapter-workspace.tsx:313`), bỏ chọn thì đóng. Khoá `mtl.layout` cũ đang nhớ panel mở: bỏ giá trị cũ để mặc định có hiệu lực.
3. Khối chọn bị panel che: tự cuộn đủ để lộ khối. Thêm hàm thuần trong `page-layout.ts` kèm unit test (cạnh `blockBarPos`).
4. Xung đột khi lưu đang tự mở panel (`:285`): giữ nguyên hành vi, không để panel tự đóng khi còn xung đột.
5. Thanh phụ trên canvas thay panel:
   - Mask: Tô / Tẩy nét, cỡ bút, Bỏ nét, Xoá chữ vùng tô. Tách phần thân `MaskPanel`, giữ nguyên luồng reinpaint.
   - OCR: "Kéo khung quanh chữ" + Xoá chữ gốc; khi chạy "Đang quét…" + Huỷ.
   - Chữ: "Kéo khung trên ảnh". Kéo xong chọn khối và mở panel.
   - Bỏ hướng dẫn 3 bước và ô chỉ đọc. Đổi nhãn hiển thị Mask → Tẩy chữ, OCR → Quét chữ.
6. Panel khối: đầu panel "Khối n/N" + 3 icon (dịch lại, nhân đôi, xoá). Sau đó Gốc, Dịch, cảnh báo ngắn "Tràn 12px" (hướng dẫn vào tooltip), Font + Cỡ, nhóm "Kiểu chữ" thu gọn chứa Loại chữ, Tự khớp, mục nâng cao và "Áp kiểu".
7. Xoá `BlockToolbar`. Giữ Enter và double-click để sửa trên ảnh, Delete để xoá.
8. Bỏ `PageView` khỏi panel. Tạm giữ các nút trang trong menu chuột phải của cột trang để không mất tính năng trước phase 4.
9. Chi tiết lỗi kỹ thuật của trang chuyển sang Hoạt động. `AiUpdatePanel` và `ConflictList` đang nằm trong panel Chọn: khi có nội dung thì panel phải tự mở, không được giấu.

## Kiểm tra

- `tool-rail-model.test.ts`, unit test mới cho tự cuộn; e2e `editor`, `chapter-tools`, `full-flow`, `click-budget`.
- Xem bằng tay: chọn khối sát mép trái, khối gần đáy trang, cuộn trong chia đôi gốc / dịch, panel + zoom 100%, chế độ chỉ xem, trang đang bận.
- Mỗi tool còn đủ chức năng: tô, tẩy nét, xoá vùng tô, quét vùng, thêm khối.

## Rủi ro

- Panel che khối và chia đôi gốc / dịch dễ lệch tính toán khung nhìn: đo lại `chapterStore.box`, không dùng số cứng.
- Phím tắt đang gõ trong textarea không được kích hoạt công cụ.
- `AiUpdatePanel` không được mất khỏi tầm nhìn khi không chọn khối. Đây là điểm dễ thành bug nhất, phải có e2e.
- Hoàn nguyên: revert commit của phase.
