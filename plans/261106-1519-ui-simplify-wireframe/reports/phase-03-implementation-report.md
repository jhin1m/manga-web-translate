# Phase 3 report: Panel khối và thanh phụ công cụ

## Việc theo mục
1. Panel khối (272px) cùng ô lưới với canvas, `z-index` đè mép trái; canvas không đổi bề ngang. Wide panel (Bản dịch / Tìm / Hiệu đính) vẫn chiếm cột như cũ. Pager dời sang phải khi panel mở.
2. Đóng mặc định. Tự mở: chọn khối ở công cụ Chọn (sau khi nhả chuột), hoặc có nội dung (`hasToolContent` = xung đột HOẶC AI có bản mới của trang mở). Đóng: bỏ chọn / hết nội dung / đổi sang tool có thanh phụ, chỉ khi hết nội dung. `mtl.layout` cũ bị xoá khi vào màn (`clearLegacyLayout`); không đọc/ghi panel nữa. Không còn khoá layout nào khác.
3. `revealBlockView` (page-layout.ts, thuần) + `clampView(…, coverLeft)` nới tầm cuộn ngang đúng bề ngang panel (nếu không, lăn chuột sau đó kẹp khối về dưới panel). Đo theo `chapterStore.box` + `chapterStore.cover` (offsetWidth panel thật). Hoãn tới nhả chuột khi đang nhấn.
4. Xung đột: giữ hành vi mở panel; thêm không tự đóng khi còn xung đột (kể cả bỏ chọn, đổi tool). Thu tay → băng "Xem" như cũ.
5. Thanh phụ `.cw-toolbar` (`CanvasToolBar`): Tẩy chữ (Tô / Tẩy nét, cỡ bút + số, Bỏ nét, Xoá chữ vùng tô; luồng reinpaint nguyên văn, `MaskPanel.tsx` đổi tên `MaskToolBar.tsx`), Quét chữ ("Kéo khung quanh chữ", "Xoá chữ gốc", "Đang quét n vùng…" + Huỷ, "Đang xoá chữ gốc…"), Chữ ("Kéo khung trên ảnh"; kéo xong chọn khối, về Chọn, panel mở, sửa chữ trên ảnh). Bỏ hướng dẫn 3 bước và ô chỉ đọc. Nhãn Tẩy chữ / Quét chữ (rail, tooltip, tên panel).
6. Đầu panel "Khối i/N" + 3 icon; thân Gốc, Dịch, "Tràn 12px" (tooltip hướng dẫn), Font + Cỡ, "Kiểu chữ" (Loại chữ, Tự khớp, nâng cao, "Áp kiểu cho khối <loại>").
7. `BlockToolbar` xoá, grep không còn tham chiếu code; Enter / double-click / Delete giữ (e2e).
8. `PageView` + `SourcePanel` bỏ khỏi panel.
9. Chi tiết kỹ thuật lỗi trang → Hoạt động (`<details>` "Chi tiết kỹ thuật", gom lỗi thô theo nội dung + dải trang).

## Nút cũ → chỗ mới
- Sửa chữ (thanh nổi, focus ô Dịch) → panel tự mở có ô Dịch; Enter / double-click trên ảnh.
- Dịch lại khối / Nhân đôi / Xoá khối (thanh nổi + nút chữ trong panel) → 3 icon đầu panel (tắt khi chỉ xem / bận / khối không có vùng OCR). Đang OCR: dòng "Đang OCR…" + "Huỷ OCR" trong thân panel.
- Dịch trang này / Dịch lại trang này → menu chuột phải thumbnail "Dịch trang n" / "Dịch lại trang n" (nay dùng được cho mọi trang chọn được, không chỉ trang mở).
- Ẩn trang này → "Ẩn trang n" (đã có) + nút góc thumbnail.
- Bỏ chỉnh sửa tay, dùng lại bản AI → "Bỏ chỉnh sửa tay trang n" (chỉ trang mở, khi khác bản AI). Xác nhận inline thay bằng toast "Hoàn tác".
- Trạng thái trang + cờ (AI mới, tràn khung, cắt ở trần, chờ AI) + câu lỗi job → nhãn / viền / title / aria-label thumbnail (có sẵn).
- Chi tiết kỹ thuật → Hoạt động.
- Xoá / Khôi phục ảnh (panel ảnh gốc) → nút góc thumbnail ảnh + menu chuột phải của cột ảnh gốc (có sẵn); đếm "N ảnh · đã bỏ k" đã ở đầu cột.

## Quyết định tự chọn
- Chỉ tự mở panel theo chọn khối khi công cụ là Chọn (OCR xong chọn khối mới nhưng tool Quét chữ vẫn bật → không che canvas).
- Panel Bản dịch / Tìm / Hiệu đính không đè (plan không nói; giữ như cũ để bảng xem song song canvas). Hậu quả: canvas vẫn đổi bề ngang khi chuyển qua/lại các panel rộng này (hành động rõ của người dùng).
- Không nhớ panel nào theo trình duyệt (kể cả Bản dịch): reload → đóng. Test sửa theo (`openTable` sau reload).
- Bỏ SourcePanel (trùng chức năng với SourceRail, tuân "mỗi thao tác một chỗ"). Giữ nguyên nếu cần: nói lại.
- Panel chung `aria-label` "Chọn & sửa" giữ nguyên (không đổi sang "Khối đang chọn" vì cũng chứa AI mới / xung đột khi không chọn khối).
- Nhãn ô cỡ chữ "Cỡ" (title "Cỡ chữ (px)"); `RETRY_HINT` đổi sang "Chuột phải trang → Dịch lại trang".
- File ngoài danh sách phải đụng: `chapter-store.ts` (`cover`), `canvas/ChapterCanvas.tsx` (1 dòng clamp), `page-rail.tsx`, `activity-drawer.tsx`, `job-error.ts`, `page-layout.ts`, `layout-prefs.ts` (+ test), docs `editor.md`, `design-guidelines.md`, `export-and-batch-edit.md` (đúng chỗ phase này là phase cuối đụng tới: panel khối, thanh phụ, menu trang).

## Số đo canvas
Khung 1280x800, không chọn gì: canvas **1104 x 748** (rail 64 + cột trang 112). Chọn khối → panel mở: bounding box canvas **bằng hệt** (e2e so `toEqual`), đóng lại cũng bằng. Mục tiêu cuối 1160px cần rail 48 + cột trang 72 (phase sau): 1280 - 48 - 72 = 1160, cấu trúc hiện tại không cản.

## Gate
typecheck xanh, lint xanh (0 cảnh báo), unit: web 408 (391 + 17), api 435, shared 60, db 8. e2e 82/82 (66 cũ, 1 test cũ thay bằng 2, +15 spec mới `block-panel`); lượt đầu 1 lỗi là test cũ phải `openTable` sau `goto` (panel không nhớ), đã sửa. click-budget không đổi (chỉ đếm home→chương, không phụ thuộc panel).

## Test mới
- Unit: `revealBlockView` (mép trái, đáy, đã lộ, khung không số cứng, zoom, chia đôi, khối rộng hơn vùng lộ, hết trang), `clampView` coverLeft, `railClick`, `clearLegacyLayout`, `failedPageGroups.details`.
- e2e: AI mới tự mở + không đóng + đóng sau "Đã xem"; AI mới cùng khối chọn; xung đột mở/giữ/đóng sau Bỏ (xung đột giả bằng đặt thẳng vào store, luật rebase đã có unit test); canvas không đổi box; reveal 100% mép trái + lăn không kẹp lại; khối gần đáy; chia đôi; Tẩy chữ đủ luồng (Tô, Tẩy nét, cỡ, Bỏ nét, reinpaint đủ); Quét chữ huỷ; Chữ kéo-chọn-mở-sửa; menu trang (Dịch lại, Dịch trang, Bỏ chỉnh sửa tay + Hoàn tác); chi tiết lỗi ở Hoạt động; chỉ xem (tab 2) và trang bận; gõ trong ô Dịch không đổi tool, Enter / double-click / Delete; legacy `mtl.layout`.

## Đã xem bằng ảnh (Playwright tạm 1280x800, đã xoá)
Khối sát mép trái ở 100%, khối gần đáy, chia đôi 100% sau reveal, panel + zoom 100% + pager, "Kiểu chữ" mở, cảnh báo "Tràn 337px", AI mới (có / không chọn khối, mở diff), xung đột + AI, chỉ xem (tab 2), trang bận, thanh phụ Tẩy chữ / Quét chữ / Chữ, menu trang. Sửa sau khi xem: nút "Áp kiểu" tràn panel (rút nhãn + wrap), "Kiểu chữ" thiếu mũi tên (thêm chevron), danh sách xung đột bị bóp trong panel hẹp (wrap nút).
Chưa xem bằng ảnh: thanh Quét chữ lúc "Đang quét…" (chỉ e2e), chia đôi khi chưa chọn khối ở khung hẹp < 1000.

## Rủi ro còn lại
- Sau reveal, đóng panel + lăn chuột: tầm cuộn về lại không-nới (`cover` = 0), khối có thể nhảy ngang 1 lần.
- Panel đè che pager cũ chỉ được dời tạm bằng CSS; phase 4 gom pager.
- Reset-to-AI mất bước xác nhận (có Hoàn tác).
- Phím Alt+↑/↓ chọn khối: cuộn dọc dùng "dịch tối thiểu" của `revealBlockView` khi panel mở thay vì căn đầu của `revealRect`.
