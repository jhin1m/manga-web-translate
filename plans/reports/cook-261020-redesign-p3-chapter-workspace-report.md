# Cook report — Redesign P3: màn chương gộp (layout, rail, canvas cuộn liên tục)

Branch `feat/redesign-p3-chapter-workspace` · 20/10/2026 · plan: `plans/261020-1944-web-uiux-redesign-chapter-workspace/phase-03-chapter-workspace-continuous-canvas.md` (status → completed; plan.md không sửa theo yêu cầu owner).

## Đã làm
**API (chỉ thêm, không migration)**
- `GET /api/w/:ws/chapters/:id/states` (`routes/page-state.ts`): state mọi page theo `ord`, 2 truy vấn, không trả `ai_state`.
- `GET /chapters/:id/pages`: thêm `images: {original, clean}`, giữ `image`.
- Test: `page-state.test.ts` (states theo ord, không ai_state), `tenant-isolation.test.ts` (+1 case), `chapters.test.ts` (images).

**Web**
- Route `/w/:ws/s/:s/c/:c?page=` → `ChapterWorkspace` (lazy chunk, toàn màn hình, ngoài app shell, `key=chapterId`); route editor cũ `.../edit/:p` → redirect `?page=`.
- Bố cục theo design owner duyệt (`Chapter.dc.html`): header 52px (← series, Chương n, trạng thái + "AI xong x/y · k cần xem", Gốc/Dịch/Chia đôi[P5, disabled], Dịch lại ▾, Hoạt động[P5, disabled], nút chính), băng khoá 30px (khoá + trạng thái lưu), rail 196px (thumb lazy, 4 mức, lọc Tất cả/Cần xem), canvas nền xám + toolbar nổi + "Trang n/N · zoom", inspector 320px (panel cũ: AI mới, xung đột, mask, thuộc tính, vùng chữ), bảng dưới placeholder (Tìm & thay / Áp glossary mở dialog cũ; kéo cao, thu gọn, nhớ `mtl.layout`; < 1600px mặc định thu gọn).
- Module thuần + test: `strip-layout.ts` (offset, `visiblePages` trần 4, `pageAt`, `clampView`, `stripToPage`), `page-status.ts`, `primary-action.ts`, `chapter-store.ts`.
- `use-chapter-session.ts`: `ChapterSession` (activate tuần tự + chỉ lấy yêu cầu cuối, stash undo theo page/version, `runAi` flush→pause→unlock→API, `syncActive`, khôi phục nhiều page) + hook (Saver/pagehide/finalSave-trước-unlock chuyển nguyên từ EditorPage).
- Chính sách khoá: chỉ giữ khoá khi chương `review|partial_failed|done` và có page; còn lại read-only `"processing"`.
- Canvas: `ChapterCanvas` (1 Stage = khung nhìn, toạ độ strip), `PageSlot` (TileLayer theo viewport cục bộ), `StaticTextLayer` (page không active); TextLayer/MaskLayer/OcrOverlay nhận `offset`. Bấm page khác = chỉ kích hoạt.
- FindReplace/ApplyGlossary nhận `lock` của phiên (không tự `useChapterLock`); link "Mở trang" → `?page=` (đóng dialog).
- Xoá: `EditorPage.tsx`, `canvas/Stage.tsx`, `panels/Toolbar.tsx`, `panels/PageStrip.tsx`, `chapter/chapter-page.tsx`. `rg "EditorPage|PageStrip|ChapterPage\b|canvas/Stage" apps/web/src` = 0 (đổi tên `EditorPage` type → `PageDetail`, `fetchEditorPage` → `fetchPageDetail`).
- E2E: `fake-worker.ts` (+`pagesPerSource`, `capabilities`); `editor.spec.ts` viết lại trên URL mới + 3 case mới (redirect editor cũ, strip 3 trang cuộn → `?page=` + rail → inspector + lưu trước khi đổi trang, khoá khi đang dịch); `chapter-tools.spec.ts`, `upload-chapter.spec.ts` cập nhật theo màn mới.

## Kiểm chứng
- `pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm test` ✓ (api 143, web 91, db 3, shared 8) — với `DEV_AUTO_LOGIN_*` đặt trong `.env`.
- Worker `uv run --frozen pytest -q`: 132 passed, 2 skipped.
- Playwright (cổng 5181/8797): 12/12 xanh (chapter-tools 3, editor 4, routes-redirect 1, typeset-parity 1, upload-chapter 3).
- Đo (spec tạm, đã xoá; strip 20 trang 720×1000, ảnh 1px): đổi page active có sửa p95 **83ms** (max 110ms, mục tiêu < 300ms); cuộn hết strip không lỗi console. Chưa đo được strip 800×6000 ảnh thật (worker giả dùng ảnh 1px) — nên đo tay trên Safari khi có chương thật.

## Code review (code-reviewer, 7/10 → đã xử lý)
Báo cáo: `plans/reports/code-reviewer-261020-2130-redesign-p3-chapter-workspace-review-report.md`.
- H1 mất sửa khi đổi page lúc không lưu được → **sửa**: ở lại page hiện tại, báo "Chưa lưu được trang n…" (`UnsavedPageError`), sửa vẫn trong editor + IndexedDB; test mới.
- M1 thông báo khôi phục không chặn sửa nếu khoá về trước → **sửa**: giữ read-only "loading" tới khi quét IndexedDB xong (quét ngay khi có danh sách page).
- M2 không chặn input lúc đang kích hoạt → **sửa**: tải page đích trước, kiểm "đã lưu" và `load` đồng bộ (không await xen giữa).
- L1 state khoá cũ "held" khi bật lại → **sửa** (coi như acquiring tới khi hook khoá chạy lại). L2 restore đọc page active mỗi bản ghi → **sửa**. L3 Xuất flush trước → **sửa**. L4 "Mở trang" đóng dialog → **sửa**.
- L5 (`partial_failed` 0 page hiện "Chạy lại trang lỗi" vô tác dụng) — hành vi có sẵn từ màn cũ, để lại. L6 (back/forward giữa 2 chương reset store trước finalSave của chương cũ) — pattern có sẵn, để lại.

## Lệch so với plan
- Kích thước theo design owner duyệt (rail 196, inspector 320, header 52) thay vì 168/340/44.
- Route màn chương chuyển ra ngoài `workspaceRoute` (toàn màn hình như editor cũ), tự `setCurrentWs`.
- Tìm & thay / Áp glossary đặt ở header bảng dưới (đúng tab trong design) thay vì topbar.
- "Về bản AI" chuyển vào toolbar nổi canvas; `ai_state` của page active tải nền sau khi kích hoạt (giữ tính năng).
- Khôi phục page không active: PUT thẳng sau rebase; có xung đột → hoãn tới khi mở page đó.

## Còn lại / ghi chú
- Docs (`docs/development-setup.md` mục Web, `docs/editor.md`) còn mô tả route editor per-page — không sửa vì ngoài phạm vi file P3; để P6.
- Cảnh báo console Vite "Several Konva instances detected" xuất hiện trong spec typeset-parity (spec import trực tiếp `TextBoxNode`) — không do P3 đổi, không làm fail.

## Câu hỏi mở
- Không.
