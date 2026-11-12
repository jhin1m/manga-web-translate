# Round 2 fixes: ui-simplify

Commits: 0bf84d5 (behaviour + tests), 8ccade0 (wording, comments, docs).

## Việc 1 - nhấp đúp khối dưới panel (đã sửa)
- Spec viết lại (block-panel.spec.ts): khối x=8 w=40, tâm 296 < 320 (dưới panel), `mouse.click(clickCount:2, delay:80)`. Chạy trên code cũ: ĐỎ (không thấy ô "Sửa chữ"). Sau sửa: xanh.
- Sửa: bấm chuột chọn khối có mép trái < bề ngang panel (đọc `--cw-overlay-w`) + margin thì hoãn mở panel `Konva.dblClickWindow`; thành nhấp đúp / đổi chọn / unmount thì huỷ. Hàm `selectionUnderCover` ở chapter-store.ts. Khối xa mép trái mở ngay như cũ.
- Chưa xem bằng ảnh; kiểm bằng e2e trên app thật.

## Việc 2 - Hoàn tác "Bỏ chỉnh sửa tay" sau khi đổi trang (đã sửa)
- Dùng `session.restoreOther` (rebase op diff(after, before) lên bản server, PUT thẳng), không đụng trang đang mở. Conflict/bận: báo "sẽ khôi phục khi mở trang". Lỗi: toast danger. Toast đóng nên không bấm lần 2.
- Spec đổi: assert qua API trang 1 về "Sửa hai", trang 2 đang mở giữ "Trang hai mới", mở lại trang 1 thấy "Sửa hai".
- Lưu ý: spec cũ nằm ở block-panel.spec.ts, không phải editor.spec.ts:817.

## Việc 3 - phím V (đã sửa)
- Ref `collapsedByTool`: chỉ true khi panel thu vì đổi công cụ (phím hoặc rail); × đặt false. V chỉ mở khi true. Bấm lại đúng khối vẫn mở; rail Chọn giữ quy tắc cũ. Sửa comment tool-rail-model.ts.
- Test: B rồi V mở; × rồi V không mở; × rồi B rồi V không mở; bấm lại khối mở.

## Việc 4
- S-A: ocr-wait.ts, OcrSelect.tsx (lỗi + aria-label) đổi sang "quét chữ". Unit không assert các chuỗi này.
- S-B: comment chapter-workspace (hộp xác nhận Hiệu đính đóng khi rời tab), design-guidelines.md, 2 comment editor.spec.ts.
- S-F: unit `setCover(0)` (view vừa không đổi; view lệch bị kẹp về).
- S-C, S-D, S-E: KHÔNG sửa. S-C hiếm (dòng không khung chọn từ bảng, Esc không xoá `current`); S-D, S-E là NG chưa xác nhận.

## Việc 5 - e2e re-OCR rời chương (chưa rõ nguyên nhân, không sửa)
- Đọc code: `useOcrRegion` cleanup theo pageId huỷ job nếu đã có jobId; POST còn bay thì `if (signal.aborted) cancelJob` sau khi POST về. Cả hai đường đều gửi cancel. `POST /jobs/:id/cancel` ở server không cần khoá chương. Không thấy lỗ hổng trong code (xác nhận bằng đọc code, không bằng chạy).
- Trước khi bị dừng đã chạy có tải (18 `yes`, 12 core): nhóm re-OCR x12 = 23 pass, 1 fail. Fail đó KHÔNG phải lỗi cancel: `openPanel` chờ nút rail enabled quá 15s ở bước setup (do tải). Lỗi gốc "job còn queued sau 5s" không tái hiện. Chưa xem network trace để biết có request cancel hay không.
- Kết luận: test chập chờn chưa rõ nguyên nhân; không đổi timeout, không retry. Đã dừng tải CPU theo yêu cầu (không còn tiến trình `yes` từ phía tôi).

## Gate (trên code đã commit)
- typecheck xanh; lint xanh (sau biome --write sort import).
- Unit: web 420, api 435, shared 60, db 8.
- e2e đầy đủ: 100/100 (5.4 phút), chạy sau sửa cuối.

Unresolved: nguyên nhân lượt đỏ re-OCR; không có ảnh chụp tay cho việc 1.
