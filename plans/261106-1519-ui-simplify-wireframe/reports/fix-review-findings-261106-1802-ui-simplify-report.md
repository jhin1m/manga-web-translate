# Sửa phát hiện review feat/ui-simplify

Commit: de85e6a (fix + test đi kèm), 7d01924 (dọn dẹp). Docs sửa trong de85e6a.
Gate: typecheck, lint xanh; unit web 419, api 435, shared 60, db 8; e2e 99/99 ở lượt đầy đủ, rồi sửa 1 spec (editor.spec "block panel is closed by default") chạy riêng xanh, không chạy lại đủ 100.
Đỏ trước/xanh sau: W1, W5, W3, S1 chạy đỏ trên code cũ (stash src); W2 đỏ khi thay guard bằng undo trần.

## Phải sửa
- **W1 đúng.** Nguyên nhân: tự mở chỉ khi nội dung false→true và panel null; thu Văn bản không kiểm lại. Sửa: thu Văn bản (nút rail hoặc ×) khi còn AI mới/xung đột thì về panel khối (`railClick` nhận `content`, × kiểm `hasToolContent`); thêm băng "AI có bản mới cho trang này · Xem" khi panel không phải panel khối (thu tay hoặc đang ở Văn bản). Test: 2 e2e block-panel + unit tool-rail-model.
- **W2 đúng.** Toast nhớ đúng bước (so tham chiếu `history.past.at(-1)` + `pageId`): khác trang / đã sửa tiếp thì không undo; bấm là đóng toast. Không đụng mốc batch vì chỉ undo khi bước cuối chính là bước reset. Test e2e "Hoàn tác of Bỏ chỉnh sửa tay" (bấm 2 lần; đổi trang có sửa dở).
- **W3 đúng.** Canvas căn lại trang khi khung đổi cỡ mà không biết panel, chạy sau subscriber cũ. Sửa: `revealSelection()` (chapter-store) gọi sau effect đặt khung nhìn của canvas (đổi cỡ, chia đôi) và trong `fitView` (nút %); bỏ subscriber box trong workspace. Test e2e fit-to-frame ở 1280x1250 (đỏ: 276 < 320).
- **W4 KHÔNG phải lỗi (ở fixture này).** E2e nhấp đúp khối x=8 ở 100% khi panel đóng (khối nằm dưới vùng panel) xanh trên code cũ. Giữ làm test hồi quy. Phát hiện kèm: hai lần bấm sát nhau (<400ms, kể cả có bấm nút thu panel ở giữa) trên cùng khối là nhấp đúp của Konva và vào sửa chữ; spec của tôi chờ 450ms.
- **W5 đúng.** `select(id)` cùng giá trị không đổi `selection`. Sửa: store thêm `reselects` (tăng khi chọn lại đúng khối); workspace mở panel khi `reselects` tăng. Thêm: về công cụ Chọn (V) khi còn khối chọn cũng mở panel (cho đường B→V). Test e2e.
- **W6.** Đổi: shortcuts.ts ("Chọn · Chữ · Tẩy chữ · Tẩy nét · Quét chữ"), lang-pair ("công cụ Quét chữ"), "Đang OCR…"/"Huỷ OCR"/"vùng OCR" trong panel khối thành "quét chữ", Hoạt động "OCR vùng" → "Quét chữ vùng"; e2e theo nhãn mới. Giữ "OCR": "Xoá chữ + OCR" (tên bước pipeline ở chip, nút Dịch, Hoạt động), "Đọc chữ (OCR)", cài đặt pipeline/admin (tên engine kỹ thuật).
- **Quyết định rail Chọn (+S5).** `railClick` nhận `{content, selection}`; không có gì thì không mở. "Có khối" tính cả dòng bảng chọn không có khung chữ (panel vẫn hiện "Khối i/N"). Chương chưa cắt trang không còn mở panel vô ích. Test unit + e2e + sửa spec cũ "Bấm Chọn mở panel" (editor.spec) theo quyết định (không có khối thì không mở; mở bằng cách chọn khối).

## Sửa nhanh
- S1 đúng: lọc phần tử trong `<details>` đóng khỏi danh sách Tab; test e2e (đỏ trước).
- S2 đúng: `usePendingProofread` chỉ bật khi `seenTabs.size > 0`. Không có test riêng.
- S3 đúng: `ProofreadPanel` nhận `active`, rời tab thì đóng hộp xác nhận (vẫn mount). Không có test riêng.
- S4: `setCover(0)` kẹp lại khung nhìn ngay. Không có test riêng (đã xem qua e2e hiện có, không hồi quy).
- S6: xoá CSS chết `.cw-flags .cw-page-line .cw-panel-sub .cw-seg .ed-mask .ed-steps .drawer-warn` (grep chỉ còn trong css), wrapper `setPanel`, alias `view`.
- S7: `export-panel` dùng `lib/format.timeAgo` (mốc xa nay "12/10" thay "N ngày trước"); `lang-pair-popover.tsx` → `lang-pair-fields.tsx`.
- S8: sửa comment lỗi thời (workspace, export-options, ChapterCanvas) + comment đầu panel.
- Xung đột khi lưu: dựng được 409 thật bằng `page.route` (chặn PUT đầu, bump bản dịch trên server bằng chính request qua `route.fetch`, rồi cho PUT cũ đi tiếp → server trả 409, editor rebase). Spec block-panel không còn đặt vào store; ý kiểm giữ nguyên (panel tự mở, ở lại, băng, Bỏ).

## Xem bằng ảnh (1280x800; W3 ở 1280x1250 vì cần trang không bị co)
Đã xem: rail Chọn không khối (không mở); W1 (Văn bản mở + băng AI, thu Văn bản → panel khối về, thu panel khối → băng); W3 sau khi chuyển Văn bản → Chọn (khối lộ ở x=344 > panel 320); W5 (thu panel rồi bấm lại khối → mở). Ảnh ở scratchpad/shots (w1-*, w3-*, w5-*, rail-select-empty). Spec tạm đã xoá.

## Rủi ro còn lại
- Rail Chọn từ Văn bản khi không có khối: giữ Văn bản mở (như phím V không đụng panel).
- Hành vi thêm ngoài yêu cầu: phím V khi còn khối chọn mở lại panel đang thu.
- S2, S3, S4 chưa có test tự động.
