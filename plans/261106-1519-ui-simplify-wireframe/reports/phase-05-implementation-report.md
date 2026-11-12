# Phase 5 report: Rail 5 nút, Văn bản, Xuất

## Việc theo mục
1. Rail 48px, 5 nút chỉ icon (Chọn V, Chữ T, Tẩy chữ B, Quét chữ R, Văn bản). `aria-label` "Tên (phím)", `aria-pressed`, `aria-current`. Tooltip tên + phím bằng CSS `:hover` và `:focus-visible` (mở được bằng Tab), nút tắt có lý do trong tooltip + `aria-describedby`. Bỏ `overflow` của rail để tooltip tràn ra ngoài. Phím V/T/B/E/R giữ nguyên (e2e).
2. Panel Văn bản 4 tab (`doc-tabs.tsx`, `role=tablist`, ←/→/Home/End). `PanelId` = `tool | doc`, tab = `DocTab`. Ctrl+F: `showDoc("find")` + focus `#fr-find`, kể cả khi đang ở công cụ Chữ. Tab Tìm/Glossary/Hiệu đính tắt kèm lý do khi chương chưa dịch (đang ở tab đó thì về Bản dịch).
3. Mỗi tab mount lần đầu khi mở rồi chỉ `hidden`. Hiệu đính nay cũng giữ mount (trước đây unmount). Kết quả xem trước Tìm/Thay còn nguyên sau khi qua tab khác (e2e), Tìm/Thay rồi Hoàn tác vẫn chạy (chapter-tools).
4. Bảng 4 cột: Vị trí "3·5", Gốc, Dịch, cờ. Cờ "!" / "↻" `role=img` có tên + tooltip. Bỏ cột Loại (loại khối đã ở panel khối, còn trong `title` dòng). Bấm hàng dùng lại `pick` + `revealRect`; panel Văn bản không đè canvas nên không cần cuộn thêm.
5. Hiệu đính: bỏ đoạn giải thích; hộp xác nhận còn 1 dòng "N trang · giá · thời gian" (+ "(giá cao nhất)" khi chưa gán model), nút Chạy + ⓘ (`InfoTip`, `PROOFREAD_DATA_NOTICE`) + Huỷ. Model và cơ sở ước tính nằm trong `title` của dòng. Nhãn tab "Hiệu đính · N" = gợi ý chờ duyệt (`usePendingProofread`, chung cache với panel).
6. Xuất: `export-drawer.tsx` đổi thành `export-menu.tsx` (popover `role=dialog` "Xuất chương", không lớp phủ). Thứ tự: 1 dòng "N chỗ cần xem" (`<details>`, mở ra là các câu hậu quả + "Xem N chỗ này") → Tải chương → Tuỳ chọn (tóm tắt) → "Lần trước · … + Tải lại" (hết hạn thì nói rõ). Luồng xuất, poll, tạm dừng hết ngân sách, tự tải, xuất lại khi link hết hạn giữ nguyên. Đóng: Esc, bấm ngoài, Tab ra ngoài; trả focus về nút mở; bấm lại nút = đóng. Cao tối đa tới đáy cửa sổ, cuộn trong menu. Mục Xuất trong ⋯ (chương có trang lỗi) mở cùng nội dung, căn theo nút ⋯. `?drawer=export` mở sẵn. Drawer xuất xoá hẳn; `ExportRow` ở Hoạt động còn nguyên.

## Quyết định tự chọn
- Dòng cảnh báo xuất là "N chỗ cần xem" chứ không "N trang": số đếm trộn trang chưa dịch và khối (trống / tràn / AI mới). Giữ nguyên các câu hậu quả bên trong.
- Bỏ danh sách "Lượt xuất trước" và nút Huỷ khỏi menu (Hoạt động đã có ExportRow với Huỷ + tải lại); menu chỉ giữ lượt thành công gần nhất. "Lần trước" chỉ hiện khi không có lượt đang theo dõi.
- Chip + Hoạt động vẫn báo tiến độ khi menu đóng (đã có từ phase 2; e2e mới kiểm).
- Mặc định tab "Bản dịch"; nút Văn bản mở lại đúng tab lần trước trong phiên. Không thêm khoá nhớ.
- Sửa thêm 2 chỗ ngoài danh sách file: `ChapterCanvas.tsx` (clamp lúc khung đổi cỡ truyền `cover`) + effect cuộn lộ khối ở workspace (đo lại khi khung đổi). Lý do: chuyển từ panel Văn bản (560px) sang panel khối đè canvas làm canvas rộng ra sau lần đo, khối sát mép trái nằm dưới panel (phát hiện bằng e2e mới).
- Docs ngoài hai file chỉ định: sửa `export-and-batch-edit.md`, `deployment-guide.md`, `development-setup.md` (mỗi nơi 1 cụm "drawer Xuất / panel Tìm" lỗi thời).

## Đo 4 tiêu chí
1. 1280x800 không chọn gì: rail rộng **48px**, canvas **1160 x 748** (e2e `toBe(1280-48-72)` ở block-panel + rail-text-export). Thanh trên ≤ 8 mục bấm được (chapter-topbar e2e: done, running, failed).
2. Thao tác khối và trang một chỗ hiển thị (đã làm ở phase 3-4); chuột phải = nút ⋯ cùng danh sách mục (e2e phase 4 giữ xanh).
3. "Export": grep source + test quét DOM (`expectNoExportWord` ở chapter-topbar, kể cả sau khi mở menu Xuất từ ⋯) không còn. Menu Xuất cũng được quét. Chỉ còn tên biến/type.
4. Docs: đọc lại toàn bộ `design-guidelines.md` + `editor.md`, sửa: thanh trên 52px, sơ đồ khung (rail 48, panel Văn bản), bảng vùng (thanh trên, rail, Văn bản), nút chính (Huỷ khi chạy, "Chạy lại N trang"), chip, chỉ báo lưu chỉ khi cần, menu Xuất, drawer chỉ còn Hoạt động + Phím tắt (+ biến thể modal), Home, Series, Cài đặt dịch, ⓘ, quyết định 06/11; editor.md: bố cục đầu file, nút chính, rail/panel Văn bản, bảng, Hiệu đính, Ctrl+F, menu Xuất, Hoạt động, chỉ báo khoá.

## Click-budget (số cụ thể)
- `click-budget.spec.ts` không đổi, budget giữ nguyên: home→chương 2 click, thả ảnh→Dịch chương 1 click.
- Đường chuột: Xuất = 2 (Xuất → Tải), như trước. Bản dịch = 1 (Văn bản mở tab Bản dịch mặc định; nhớ tab lần trước trong phiên). Tìm/Glossary/Hiệu đính: trước 1 (nút rail), nay 2 (Văn bản + tab) khi tab đang mở không phải tab đó. Ctrl+F vẫn 0 click tới ô tìm. Đây là chi phí plan đã ghi ("Hiệu đính xa hơn 1 bấm"), không nằm trong luồng chính của click-budget.

## Gate
typecheck xanh, lint xanh (0 cảnh báo), unit: web 417, api 435, shared 60, db 8 (+6 web: `estimateSummary`, `pendingCount`, `docTabLabel`; test `railClick` viết lại). e2e: **92/92 pass** (83 + 9 mới `rail-text-export.spec.ts`, 5.0 phút) trên cây cuối. Lượt đầu 91/92: 1 assertion cũ ở block-panel đo canvas theo rail 64 (mong đợi 1144), đã đổi sang 1160 theo mục tiêu.

## Test mới / đổi
- e2e mới: rail (5 nút, aria, 48px, canvas 1160, tooltip bằng Tab/hover, phím tắt), Ctrl+F từ công cụ Chữ + giữ nội dung tab + phím mũi tên, bảng 4 cột + chọn khối + cuộn lộ khỏi panel khối, tab tắt khi chưa dịch, menu Xuất (vị trí dưới nút, Esc/ngoài/bấm lại, trả focus, cửa sổ cao 420px thì cuộn trong menu, đóng lúc đang xuất + chip + Hoạt động, "Tải lại", hết hạn, từ menu ⋯ với 1 dòng cảnh báo).
- e2e đổi theo chỗ mới (giữ ý): helpers (`openPanel` mở Văn bản rồi chọn tab; `docPanel`, `docTab`), proofread (1 dòng ước tính, ⓘ có "ảnh từng trang", nhãn tab đếm 1 → 0 → 1), editor (cờ + vị trí "1·1" thay chữ "Tràn khung"/"Xong" ở bảng; Ctrl+F), block-panel (canvas 1160).

## Đã xem bằng ảnh (Playwright tạm 1280x800, đã xoá; ảnh ở scratchpad/shots/p5-*.png)
Rail + tooltip hover, Ctrl+F khi đang ở công cụ Chữ, Tìm/Thay xem trước → áp → Hoàn tác, 4 tab (Bản dịch, Tìm, Glossary, Hiệu đính xác nhận + ⓘ mở), menu Xuất: bình thường, Tuỳ chọn mở, đang xuất (nút "Đang xuất 0%"), đóng rồi mở lại (chip "· đang xuất", đúng tiến độ), "Lần trước · Tải lại", hết hạn (sau khi sửa xuống dòng), từ ⋯ có 2 trang lỗi + dòng cảnh báo mở.
Chưa xem bằng ảnh: tab Hiệu đính có gợi ý + nhãn "· N" (chỉ e2e), menu Xuất ở khung < 1000px, tooltip bằng bàn phím (chỉ e2e; ảnh chụp là hover), "Tạm dừng — hết ngân sách" (chỉ unit `exportPhase`, không dựng được).

## Rủi ro còn lại
- Icon Tẩy / Quét khó đoán lúc đầu (tooltip đã có, theo plan nếu thấy khó thì bật nhãn 11px + rail 64px).
- Tooltip rail CSS không có Esc để ẩn; ẩn khi rời chuột / blur.
- Menu Xuất không bẫy focus (cố ý, popover không modal); Tab từ phần tử cuối đóng menu.
- Hiệu đính giữ mount khi ẩn: query gợi ý chạy cả khi panel đóng (1 request thêm lúc mở chương dịch xong, poll 2,5s chỉ khi job chạy).
