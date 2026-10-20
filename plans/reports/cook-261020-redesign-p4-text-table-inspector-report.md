# Cook report — Redesign P4: bảng văn bản + inspector + đồng bộ

Branch `feat/redesign-p4-text-table-inspector` · 20/10/2026 · plan: `plans/261020-1944-web-uiux-redesign-chapter-workspace/phase-04-text-table-inspector-sync.md` (status → completed; plan.md không sửa theo yêu cầu owner). Chỉ web; API/schema không đổi.

## Đã làm
- **Bảng văn bản cả chương** (`chapter/text-table/`): `rows.ts` thuần (1 dòng/region + 1 dòng/box không region, theo ord; page active đọc `editorStore.doc`, page khác đọc cache; cờ tràn khung/cần soát/trống/SFX/AI có bản mới; memo theo object state; `filterRows` luôn giữ dòng đang chọn/gõ). `text-table.tsx`: virtualize `@tanstack/react-virtual` (dep mới duy nhất), dòng đang focus luôn render; cột #, Tr., Gốc, Dịch (sửa tại chỗ), Loại, Tình trạng; lọc "Chỉ khối cần xem" + "Chỉ trang đang sửa"; Enter dòng sau (xuyên trang) / Shift+Enter dòng trước / Alt+Enter xuống dòng / Esc bỏ focus; bỏ qua Enter khi bộ gõ đang compose (cả Safari keyCode 229). Ô của trang chưa active chỉ đọc tới khi focus kích hoạt xong trang đó.
- **Đồng bộ 2 chiều**: focus/click dòng → `activate(page)` + chọn box + `revealRect` (chỉ cuộn canvas khi khối ngoài khung); chọn box trên canvas → dòng hiện tại + bảng cuộn tới; bỏ chọn → inspector về thông tin trang.
- **Tràn khung**: `measure.ts` `boxOverflow`/`boxOverflows` (cùng công thức chiều cao với `fitText`) + test; cờ ở bảng, inspector ("Tràn khung Npx[ ở cỡ tối thiểu]…"), rail ("tràn khung", lọc Cần xem), tóm tắt "k cần xem" trên thanh trên.
- **Inspector** (`chapter/inspector.tsx`, thay khối `<aside>` tạm P3) theo design: tab Khối chữ / Xoá chữ (đổi tab ↔ công cụ brush), "Trang n" + "Khối m · Loại", Gốc (OCR) + "OCR lại", Bản dịch (cùng nguồn bảng), cảnh báo tràn, Properties (bỏ ô "Chữ" trùng), "Áp kiểu này cho khối cùng loại trong chương" (xác nhận 1 bước), "Dịch lại trang này", AI có bản mới, xung đột. Không chọn khối → trạng thái trang, cờ, lỗi job.
- **Bảng dưới** (`chapter/bottom-panel.tsx`): tab Bản dịch · N khối / Tìm / Thay / Áp glossary; giữ kéo cao, thu gọn, nhớ `mtl.layout`; tab đã mở giữ trạng thái khi đổi tab/thu gọn.
- **Tìm/Thay, Áp glossary** thành panel (`FindReplacePanel`, `ApplyGlossaryPanel`): dùng khoá phiên, `beforeWrite` = `saver.flush()` trước xem trước/áp dụng/hoàn tác, sau ghi refetch states → page active nạp lại nếu sạch (`syncActive` sẵn có); "Tới khối" nhảy tới khối. Xoá `FindReplaceDialog`, `ApplyGlossaryDialog`, `RegionTable`; link "Sửa glossary series".
- Session: `ChapterSession.updateOther` (ghi page không active: PUT If-Match, 409 thử lại 1 lần) + test; hook `withFlush`. Actions: `setStyleMany`, `refreshRegionFromOcr` + test. `useOcrRegion.start(rect, regionId?)` cho OCR lại. `TextField` ghép onFocus/onBlur của caller, đồng bộ giá trị khi hết chỉ đọc.
- Hiệu năng: `PageRail`, `ChapterCanvas` memo; Set page tràn giữ identity; dòng chỉ tính lại cho page có state mới.
- **Việc nhỏ được giao**: chương lỗi ở bước cắt trang (partial_failed, 0 trang) — nút chính đổi từ "Chạy lại trang lỗi" (vô tác dụng) thành **"Chạy lại cắt trang"** = `POST /commit` (API cho commit lại chương ingest lỗi); không còn ảnh nguồn → "Tải ảnh". Canvas trống hiện lỗi ingest + hướng dẫn. Test `primary-action.test.ts`.

## Kiểm chứng (với `DEV_AUTO_LOGIN_*` đặt trong `.env`)
- `pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm test` ✓ (api 143, web 100, db 3, shared 8).
- Worker `uv run --frozen pytest -q`: 132 passed, 2 skipped.
- Playwright (cổng 5181/8797): **14/14** xanh. Mới: `editor.spec` "text table…" (click dòng trang 2 → rail + inspector Trang 2; sửa ô → lưu → GET có bản mới; Enter dòng cuối trang 1 → ô trang 2, gõ lưu vào trang 2, không PUT trang 1; Shift+Enter/Esc), "overflowing box…" (box dài trong khung nhỏ set qua API → cờ Tràn khung ở bảng + rail, lọc chỉ còn dòng đó, inspector cảnh báo). `chapter-tools.spec`: Tìm/Thay + Áp glossary qua tab (không dialog), bảng hiện chữ mới không reload, "Tới khối", không PUT 423.
- `rg "RegionTable|FindReplaceDialog|ApplyGlossaryDialog" apps/web/src` = 0.

## Code review (code-reviewer 7.5/10 → đã xử lý)
Báo cáo: `plans/reports/code-reviewer-261020-2200-redesign-p4-text-table-inspector-review-report.md`.
- H1 dòng đang gõ biến mất khi lọc "Cần xem" (focus rơi ra phím tắt, Backspace xoá box) → **sửa**: `filterRows` giữ dòng hiện tại + test.
- M1 re-render cả màn mỗi phím → **sửa**: memo rail/canvas, Set tràn ổn định, `onOcr` ổn định.
- M2 bỏ chọn trên canvas vẫn hiện khối cũ → **sửa**.
- M3 Safari IME Enter → **sửa** (keyCode 229).
- M4 ô focus trước khi trang kích hoạt giữ chữ cũ → **sửa** (TextField đồng bộ khi hết readOnly).
- M5 Áp kiểu cả chương không xác nhận/không báo lỗi giữa chừng/đụng page vừa active → **sửa**: xác nhận 1 bước, bỏ qua page vừa thành active, lỗi báo trang đã áp; box auto-fit không chép cỡ chữ.
- Low (để lại): cờ "empty" từ server giữ nguyên khi đã có bản dịch; region nhiều box lấy box đầu; dòng cố định 40px (chữ nhiều dòng cuộn trong ô); trạng thái "Đang OCR…" dùng chung.

## Lệch so với plan / design
- "Dịch lại khối" (design) → "Dịch lại trang này" (API dịch chỉ nhận `page_ids`) + "OCR lại" (OCR + dịch lại riêng vùng qua job ocr-region có sẵn).
- `scrollToBox` đặt ở `chapter-store.ts` (`revealRect`, cạnh `focusPage`) thay vì session.
- Lọc dùng 2 checkbox (Chỉ khối cần xem / Chỉ trang đang sửa) thay 3 nút.
- Thêm file ngoài danh sách plan (nhỏ): `editor/actions.ts`, `editor/canvas/OcrSelect.tsx`, `editor/canvas/ChapterCanvas.tsx` (memo), `editor/panels/Properties.tsx`, `editor/panels/TextField.tsx`, `primary-action.ts`.
- Docs (`docs/development-setup.md`, `docs/export-and-batch-edit.md`) còn nhắc hộp thoại Tìm & thay — để P6 (dọn docs).

## Chốt của controller (vòng 2)
- Cờ `empty` của worker = crop không có mực, OCR bỏ qua (`worker/mtl_pipeline/ocr.py` `ink_ratio < MIN_INK_RATIO`). Khối đã có bản dịch không rỗng → bỏ cờ "Trống" (cả cờ server lẫn cờ suy ra), không còn "cần xem" (`rows.ts` + test).
- "Áp kiểu cùng loại" không áp cho khung đang ẩn (`sameKindBoxIds` + test).
- Nút 0 trang: đã xử lý ở commit đầu ("Chạy lại cắt trang").
- Gate lại: typecheck ✓ · lint ✓ · test ✓ (api 143, web 102, db 3, shared 8) · e2e 14/14 (cổng 5181).

## Câu hỏi mở
- Không.
