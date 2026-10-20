---
phase: 4
title: "Bảng văn bản toàn chương + inspector + đồng bộ"
status: pending
priority: P1
effort: 3d
dependencies: [3]
---

# Phase 4: Bảng văn bản toàn chương + inspector + đồng bộ

## Overview
Lấp khu dưới bằng bảng văn bản cả chương (màn sửa chính, song song canvas) với tab Bản dịch / Tìm-Thay / Glossary; dựng inspector block thay cụm panel tạm; thêm cờ "tràn box". Bỏ `RegionTable` per-page và 2 dialog Tìm-Thay / Áp glossary (chuyển thành panel).

## Requirements
- Bảng: 1 dòng / region (+ 1 dòng / text box không gắn region). Cột: `#` · `Tr` (ord) · `Gốc` · `Dịch` (sửa tại chỗ) · `Loại` · `TT` (cờ: tràn box, cần soát `low_conf`, trống, SFX, AI có bản mới). Lọc: Tất cả / Cần xem / Trang hiện tại. Virtualize (1.000+ dòng mượt).
- Đồng bộ 2 chiều: focus/click dòng → `activate(page)` + chọn box + canvas cuộn tới block nếu ngoài khung; chọn box trên canvas → bảng cuộn tới dòng + tô sáng.
- Sửa ô Dịch → `setRegionTranslation` (`editor/actions.ts:79`) trên `editorStore` → canvas vẽ lại ngay, autosave như cũ; gõ liên tục = 1 bước undo (key `region:<id>`). Box không region → `editText` (`actions.ts:48`).
- Phím trong ô Dịch: Enter → ô Dịch dòng sau (kể cả sang trang sau), Shift+Enter → dòng trước, Alt+Enter → xuống dòng trong ô, Esc → bỏ focus về canvas.
- Tràn box: `measure.ts` thêm `boxOverflows(box, metrics, measure)` — chiều cao `lines.length × lineStep + 2·pad` > `h` hoặc dòng rộng hơn `w − 2·pad`. Cờ hiện ở bảng, inspector, rail.
- Inspector (box đang chọn): "Trang n · Block m", Gốc (read-only), Dịch (cùng nguồn với bảng), nút "Dịch lại trang này" (`runAi(retranslate(ws,ch,[pageId]))`, `chapter/api.ts` `retranslate` nhận `pageIds`), rồi `Properties`, `MaskPanel` (khi brush/eraser), `AiUpdatePanel`, `ConflictList`. Không chọn gì → thông tin trang (trạng thái, cờ, lỗi job).
- Tab Tìm/Thay và Glossary dùng lại luồng P6 (`useBatchFlow`, `FlowPanel`, `MatchList` trong `FindReplace.tsx:36,111,187`); dùng khoá của phiên (không tự `useChapterLock` — xem Risk); `await saver.flush()` trước Xem trước và trước Áp dụng; sau Áp dụng/Hoàn tác: refetch states + nạp lại page active nếu không có sửa chưa lưu. Bấm 1 kết quả → nhảy tới dòng/block.

## Architecture
```
rows.ts (thuần)  buildRows(pagesMeta, cache, active:{pageId, doc}, overflowOf) → Row[]
                 Row = {key: pageId:regionId|boxId, pageId, ord, regionId?, boxId?, source, translation, kind, flags[]}
                 nguồn: page active → editorStore.doc (bản đang sửa), page khác → chapterStore.cache
TextTable ── useVirtualizer(@tanstack/react-virtual) ── RowView(TextField)
   focus → session.activate(pageId) → editorStore.select(boxId) → canvas.scrollToBox
editorStore.selection đổi → rowKeyOf(selection) → virtualizer.scrollToIndex
BottomPanel tabs: [Bản dịch] [Tìm/Thay → FindReplacePanel] [Glossary → ApplyGlossaryPanel + link tab glossary series]
```
Hiệu năng: selector memo theo `cache` + `editorStore.doc`; chỉ dòng của page active tính lại khi gõ.

## Related Code Files
Create:
- `apps/web/src/features/chapter/text-table/rows.ts` (+ `rows.test.ts`)
- `apps/web/src/features/chapter/text-table/text-table.tsx`
- `apps/web/src/features/chapter/bottom-panel.tsx` (tab + thu gọn/kéo cao — chuyển phần placeholder P3)
- `apps/web/src/features/chapter/inspector.tsx` (thay khối `<aside>` tạm P3)

Modify:
- `apps/web/package.json` (+ `@tanstack/react-virtual`)
- `apps/web/src/features/editor/measure.ts` (`boxOverflows`) + `__tests__/measure.test.ts` (case tràn/không tràn)
- `apps/web/src/features/chapter/FindReplace.tsx` (tách `FindReplacePanel` không Modal, nhận `lock` + `onJump` + `beforeWrite` (flush) + `afterWrite`; bỏ `FindReplaceDialog`, bỏ `Link` dòng 232)
- `apps/web/src/features/glossary/ApplyGlossary.tsx` (tách `ApplyGlossaryPanel`, như trên; bỏ `ApplyGlossaryDialog`)
- `apps/web/src/features/chapter/Modal.tsx` (`LockBanner` có thể giữ cho panel; `Modal` còn dùng bởi `ExportDialog` tới P5)
- `apps/web/src/features/chapter/chapter-workspace.tsx`, `chapter-topbar.tsx` (bỏ nút mở dialog Tìm/Thay, Áp glossary tạm P3)
- `apps/web/src/features/chapter/page-rail.tsx`, `page-status.ts` (cờ tràn box theo page)
- `apps/web/src/features/editor/use-chapter-session.ts` (`scrollToBox`, `withFlush(fn)`)
- `apps/web/e2e/editor.spec.ts` (nhãn ô: `Bản dịch trang 1 vùng 1`), `apps/web/e2e/chapter-tools.spec.ts` (Tìm/Thay, Áp glossary qua tab thay dialog)

Delete:
- `apps/web/src/features/editor/panels/RegionTable.tsx` (→ `text-table`)

## Implementation Steps
1. `boxOverflows` + test; `rows.ts` + test.
2. `text-table.tsx` virtualize, TextField tái dùng (`editor/panels/TextField.tsx`), phím Enter/Shift+Enter/Alt+Enter/Esc; aria-label `Bản dịch trang {ord} vùng {i}`.
3. Đồng bộ chọn 2 chiều (session `scrollToBox`, virtualizer `scrollToIndex`).
4. `inspector.tsx`; xoá `RegionTable`.
5. Tách panel Tìm/Thay + Glossary, nối `withFlush`, refetch sau ghi; `bottom-panel.tsx`.
6. Cập nhật e2e.

## Success Criteria
- Vitest `rows.test.ts`: 2 page (page 1 active có sửa chưa lưu) → dòng page 1 lấy từ `doc`, page 2 từ cache; box không region có dòng riêng; cờ `overflow`/`low_conf`/`empty`/`ai_update` đúng; thứ tự theo `ord` rồi thứ tự region.
- Vitest `measure.test.ts`: box 3 dòng cao vừa đủ → không tràn; giảm `h` 1px dưới ngưỡng → tràn.
- E2E (`editor.spec.ts` mở rộng, chương 2 page worker giả):
  - Click dòng page 2 trong bảng → rail đánh dấu page 2 active, inspector "Trang 2".
  - Sửa ô Dịch dòng 1 → trạng thái "Đã lưu" ≤ 10s → `GET /api/w/:ws/pages/:id` có bản dịch mới.
  - Enter ở dòng cuối page 1 → focus ô Dịch dòng đầu page 2; gõ → lưu vào page 2; page 1 không bị ghi lại (không PUT thừa).
  - Box chữ dài trong box nhỏ (set qua API) → dòng có cờ "tràn", lọc "Cần xem" chỉ còn dòng đó.
- E2E `chapter-tools.spec.ts`: Tìm/Thay xem trước–áp dụng–hoàn tác và Áp glossary chạy qua tab dưới, không có dialog; sau Áp dụng bảng hiện chữ mới không cần reload; không PUT 423 nào.
- `rg -n "RegionTable|FindReplaceDialog|ApplyGlossaryDialog" apps/web/src` = 0; `pnpm typecheck && pnpm lint && pnpm test` + e2e xanh.

## Risk Assessment
| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| Panel tự gọi `useChapterLock` → unmount nhả khoá của phiên (`use-chapter-lock.ts:82` cleanup `unlockChapter`) | H×M | Panel nhận `lock` từ session, không tự giữ (đã áp cho dialog tạm ở P3 — xem ghi chú dưới) |
| Batch ghi server lệch version page active → apply 409/rebase | M×M | `flush` trước preview/apply; sau ghi refetch + reload page active nếu sạch, còn lại Saver rebase (`save.ts:127`) |
| Gõ nhanh xuyên trang chờ PUT | M×M | `activate` chỉ PUT khi dirty; ô đích disabled tới khi active xong; đo p95 |
| Virtualize + textarea mất focus khi dòng bị unmount | M×M | Dòng đang focus luôn render (`rangeExtractor` giữ index focus) |
| 1.000 dòng tính `boxOverflows` mỗi render | L×M | Memo theo (page, version); page active tính lại theo doc |
Ghi chú cho P3 (đã sửa trong P3 khi gắn dialog tạm): truyền `lock` của phiên vào `FindReplaceDialog`/`ApplyGlossaryDialog` thay vì gọi `useChapterLock` riêng (`FindReplace.tsx:248`, `ApplyGlossary.tsx:22`).
Rollback: revert PR (khôi phục RegionTable/dialog).
