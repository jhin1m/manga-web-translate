---
phase: 3
title: "Màn chương gộp: layout, rail, canvas cuộn liên tục"
status: pending
priority: P1
effort: 4.5d
dependencies: [2]
---

# Phase 3: Màn chương gộp — layout, rail, canvas cuộn liên tục

## Overview
Gộp `chapter-page.tsx` + `EditorPage.tsx` thành `ChapterWorkspace` tại `/w/:ws/s/:s/c/:c?page=`. Canvas vẽ cả chương như 1 strip dọc (virtualize theo page), rail trang bên trái, inspector bên phải (tạm chứa panel cũ, P4 thay), khu bảng dưới (placeholder thu gọn được, P4 lấp). Nút primary theo trạng thái. Route editor per-page → redirect. Sau phase này luồng sửa end-to-end chạy trên màn mới.

## Requirements
- Layout grid (≥ 1600px): topbar 44px | rail 168px · canvas · inspector 340px | bảng dưới (mặc định 280px, kéo cao, thu gọn; nhớ trong localStorage `mtl.layout`). < 1600px: bảng mặc định thu gọn. Canvas nền xám trung tính (token sẵn có).
- Trạng thái page 4 mức (`page-status.ts`): `pending`→chưa; `preparing|prepared|translating`→đang; `ready`→xong; `failed`→lỗi (enum `features/chapter/status.ts:19`). Cờ cần xem: `ai_update_available` (P3), tràn box (P4).
- Nút primary (`primary-action.ts`, thuần):
  | Trạng thái | Primary | Phụ (menu) |
  |---|---|---|
  | draft, chưa đủ file | Tải ảnh (mở chọn file → `resumeChapter`) | — |
  | draft, đủ file | Dịch chương (`commitChapter`) | — |
  | ingesting / processing | (disabled) "Đang dịch x/y" | Huỷ xử lý |
  | partial_failed | Chạy lại trang lỗi | Xuất, Dịch lại cả chương |
  | review / done | Xuất (P3: mở `ExportDialog` cũ; P5: drawer) | Dịch lại cả chương |
- Chương draft không có page: vùng canvas = `ChapterUploadStatus` + drop-zone.
- **Chính sách khoá** (bắt buộc, xem Architecture): giữ khoá chỉ khi chương `review|partial_failed|done` và có page; còn lại editor read-only lý do mới `"processing"` ("Đang dịch — sửa được khi xong").
- Canvas: cuộn = cuộn strip; Ctrl/Cmd+cuộn zoom; Space/chuột giữa kéo; mở chương fit bề ngang (≤ 100%). Page đang sửa (active) đổi khi: click vào page, chọn ở rail, `?page=`. Pointerdown lên page không active chỉ kích hoạt page đó (không bắt đầu công cụ).
- Bộ nhớ: tối đa 4 page có `TileLayer` mount (vùng nhìn ± overscan 1 màn); unmount → bitmap `close()` (đã có trong `TileLayer.tsx`).
- `?page=<pageId>`: mở → cuộn tới + kích hoạt; cuộn → cập nhật `page` (replace, debounce 400ms) theo page ở giữa khung.
- Khôi phục IndexedDB: khi mở chương quét mọi page → 1 thông báo "Có thay đổi chưa lưu ở trang 3, 7 [Khôi phục] [Bỏ]".
- Undo/redo theo page active; đổi page giữ lịch sử từng page (stash) nếu version không đổi.

## Architecture
```
ChapterWorkspace
 ├ useChapterData(ws, ch): detail(15s) · progress(2.5s khi chưa ổn định) · pages+images(12') · states[mới]
 │     progress.pages[].version ≠ cache.version (page không active) → refetch states (debounce 1s)
 ├ chapterStore (zustand vanilla, 1/tab, reset khi đổi chương)
 │     pages(meta) · offsets[] · cache{pageId→{state,version,origin,ai_rev,ai_update_available}} · activePageId · centerPageId
 ├ useChapterSession (tách từ EditorPage.tsx:56-262)
 │     fonts · Saver(editorStore) · lock(enabled = settled && pages>0 && !pausedForAi)
 │     activate(id): if same → return; await saver.flush(); stash{history,version}; cache[prev]=base/baseVersion;
 │                   editorStore.load(cache[id], history?) ; ai_update_available → GET /pages/:id lấy ai_state
 │     runAi(fn): await saver.flush(); pausedForAi=true; await serial(unlockChapter); await fn()
 │                pausedForAi=false khi progress thấy chương rời rồi về trạng thái ổn định
 ├ PageRail (thumb <img loading=lazy> từ /pages image.url · ord · chấm 4 trạng thái · cờ · lọc "chỉ lỗi/cần xem")
 ├ ChapterCanvas (1 KStage = khung nhìn; view trong toạ độ strip)
 │     visiblePages(offsets, viewport) → PageSlot(Group y=offset) ×≤4
 │        PageSlot: TileLayer(clean|original, viewport cục bộ = viewport − offset)
 │                  active ? TextLayer + MaskLayer + OcrOverlay (editorStore) : StaticTextLayer(cache.state)
 │     TextEditOverlay: toạ độ + offset page active
 ├ Inspector (tạm): AiUpdatePanel · ConflictList · MaskPanel · Properties · RegionTable
 └ BottomPanel (placeholder thu gọn; P4)
```
Vì sao khoá theo trạng thái: `writeAiState` chỉ ghi `state` khi `stateOrigin === "ai" && !chapterLocked` (`apps/api/src/jobs/page-state-writer.ts:35`). Màn chương mở = giữ khoá thì lần dịch đầu không bao giờ hiện bản dịch (chỉ cờ "AI có bản mới"). `commit`/`translate`/`retry-failed` không đòi khoá (`grep assertChapterLock` chỉ ở `page-state.ts:112,170`, `find-replace.ts:285,295,312`); `commit` chỉ chặn khi **người khác** giữ (`chapters.ts:151-154`).

API (chỉ thêm):
- `GET /api/w/:ws/chapters/:id/states` → `{ pages: [{page_id, ord, version, state, state_origin, ai_rev, ai_update_available}] }`, 2 truy vấn (pages, page_states `inArray`), không trả `ai_state` (lấy theo page khi cần). Trong `routes/page-state.ts`.
- `GET /api/w/:ws/chapters/:id/pages` (`routes/pages.ts:17`): thêm `images: {original, clean}` (giữ `image` cũ).

## Related Code Files
Create:
- `apps/web/src/features/chapter/chapter-workspace.tsx`, `chapter-workspace.css`
- `apps/web/src/features/chapter/chapter-topbar.tsx` (crumb Series / Ch.n, trạng thái, primary + menu phụ, trạng thái lưu)
- `apps/web/src/features/chapter/page-rail.tsx` (thay `editor/panels/PageStrip.tsx` + `PageCard` trong `chapter-page.tsx:243`)
- `apps/web/src/features/chapter/page-status.ts`, `primary-action.ts` (+ `page-status.test.ts`, `primary-action.test.ts`)
- `apps/web/src/features/chapter/use-chapter-data.ts` (chuyển `useStableImages` từ `chapter-page.tsx:220`)
- `apps/web/src/features/editor/chapter-store.ts` (+ `__tests__/chapter-store.test.ts`)
- `apps/web/src/features/editor/use-chapter-session.ts` (+ `__tests__/chapter-session.test.ts` cho `activate`/`runAi` với store + Saver giả)
- `apps/web/src/features/editor/strip-layout.ts` (+ `__tests__/strip-layout.test.ts`): `pageOffsets`, `visiblePages`, `pageAt`, `clampView` (chuyển từ `canvas/Stage.tsx:27`)
- `apps/web/src/features/editor/canvas/ChapterCanvas.tsx` (từ `Stage.tsx`), `PageSlot.tsx`, `StaticTextLayer.tsx` (dùng `TextBoxNode`, `boxInView` của `TextLayer.tsx:20`)
- `apps/web/src/features/editor/panels/CanvasToolbar.tsx` (công cụ V/T/B/E/OCR, undo/redo, zoom, nút `\` gốc/dịch — phần công cụ của `Toolbar.tsx`)

Modify:
- `apps/api/src/routes/page-state.ts`, `apps/api/src/routes/pages.ts`; test `apps/api/test/page-state.test.ts` (append), `tenant-isolation.test.ts` (append 1 case `/chapters/:id/states` id của B → 404)
- `apps/web/src/features/chapter/api.ts` (`fetchChapterStates`, `PageImage.images`)
- `apps/web/src/features/editor/store.ts` (`ReadOnlyReason` thêm `"processing"`; `load(p & {history?})`)
- `apps/web/src/features/editor/pending-queue.ts` (`getMany(ids)`)
- `apps/web/src/features/editor/canvas/TextLayer.tsx` (nhận `offset`/không đổi logic chọn)
- `apps/web/src/features/editor/canvas/OcrSelect.tsx`, `MaskLayer.tsx` (toạ độ page active trong Group — nếu cần)
- `apps/web/src/features/editor/editor.css` (bỏ grid `.editor` cũ `editor.css:5-15`, giữ class panel/canvas)
- `apps/web/src/features/editor/__tests__/tiles.test.ts` (import `clampView` từ `strip-layout.ts`)
- `apps/web/src/features/chapter/FindReplace.tsx:232` (link → `/w/$ws/s/$s/c/$c` + `search.page`)
- `apps/web/src/features/chapter/FindReplace.tsx:248`, `apps/web/src/features/glossary/ApplyGlossary.tsx:22` (dialog tạm mở từ topbar: nhận `lock` của phiên qua prop, **không** tự `useChapterLock` — cleanup của hook gọi `unlockChapter` (`use-chapter-lock.ts:82`) sẽ nhả khoá phiên khi đóng dialog)
- `apps/web/src/app/router.tsx` (chapter route → `ChapterWorkspace` lazy chunk; `editorRoute` → redirect `?page=`)
- `apps/web/e2e/fake-worker.ts` (tuỳ chọn `pagesPerSource`: ingest cắt 1 slice thành k page cao 1000, `source_map.src_y = i·1000` — server chỉ kiểm `source_file_id` (`apps/api/src/jobs/queue.ts:374`))
- `apps/web/e2e/editor.spec.ts` (URL mới; "← Chương" → crumb series; nhãn `Bản dịch vùng 1` còn trong inspector), `apps/web/e2e/chapter-tools.spec.ts` (URL + heading mới)

Delete:
- `apps/web/src/features/editor/EditorPage.tsx` (logic → `use-chapter-session.ts`)
- `apps/web/src/features/editor/canvas/Stage.tsx` (→ `ChapterCanvas.tsx`)
- `apps/web/src/features/editor/panels/Toolbar.tsx` (→ `chapter-topbar.tsx` + `CanvasToolbar.tsx`)
- `apps/web/src/features/editor/panels/PageStrip.tsx` (→ `page-rail.tsx`)
- `apps/web/src/features/chapter/chapter-page.tsx` (→ `chapter-workspace.tsx`)

Giữ nguyên đường dẫn (e2e typeset-parity import trực tiếp): `features/editor/canvas/TextBoxNode.tsx`, `features/editor/fonts.ts`. Giữ: `store.ts`, `save.ts`, `rebase.ts`, `history.ts`, `actions.ts`, `measure.ts`, `TileLayer.tsx`, `use-chapter-lock.ts`, panel `Properties/AiUpdatePanel/ConflictList/MaskPanel/TextField`.

## Implementation Steps
1. API 2 thay đổi + test.
2. `strip-layout.ts` thuần + test trước (offset, page hiển thị, trần 4, `pageAt`, `clampView` theo strip).
3. `chapter-store.ts`: `setStates` không ghi đè cache page active bằng version cũ hơn; `setPages` tính offset.
4. `use-chapter-session.ts`: chuyển nguyên khối Saver/subscribe/pagehide/beforeunload/`finalSave` + lock effect + recovery từ `EditorPage.tsx`; thêm `activate`, `runAi`, history stash (Map pageId→{version,history}), quét recovery nhiều page.
5. `ChapterCanvas` + `PageSlot` + `StaticTextLayer`; gesture đổi sang toạ độ strip → trừ offset page active; click page khác → `activate`.
6. `page-rail`, `chapter-topbar`, `primary-action`, `page-status`, `ChapterUploadStatus` cho draft.
7. `chapter-workspace.tsx` ghép + CSS grid + thu gọn bảng; router lazy + redirect; xoá 5 file; sửa e2e.
8. Đo: cuộn 20 page giả 800×6000, đổi page active có sửa — ghi p95 vào PR.

## Success Criteria
- Vitest:
  - `strip-layout.test.ts`: 3 page cao 1000/2000/500 → offsets [0,1000,3000]; viewport y=900 h=300 → page 0,1; không bao giờ > 4 page; `pageAt(2999)`=1.
  - `primary-action.test.ts`: đủ 6 hàng bảng trên.
  - `page-status.test.ts`: 6 `PageStatus` → 4 mức.
  - `chapter-store.test.ts`: `setStates` bỏ qua version cũ của page active.
  - `chapter-session.test.ts`: `activate(B)` khi A dirty → PUT A trước `load(B)`; quay lại A cùng version → undo còn; `runAi` gọi flush → unlock → API theo đúng thứ tự.
  - Toàn bộ test editor cũ (`actions/history/measure/pending-queue/rebase/save/tiles`) xanh.
- API: `page-state.test.ts` states trả đủ page theo `ord`, không có `ai_state`; tenant case xanh.
- E2E:
  - `editor.spec.ts` chạy trên `/w/:ws/s/:s/c/:c`: autosave + reload giữ; `\` đổi gốc/dịch không lỗi console; Ctrl+Z; rời màn trước debounce vẫn lưu, không PUT 423; crash → "Khôi phục".
  - `/w/<ws>/series/<s>/chapters/<c>/edit/<p>` → `/w/<ws>/s/<s>/c/<c>?page=<p>`.
  - Case mới: chương 3 page (worker giả) → cuộn canvas xuống cuối → `?page=` đổi sang page 3; click rail page 2 → inspector hiện vùng chữ page 2.
  - Case khoá: mở màn chương lúc `processing` → chương **không** bị khoá (`GET /chapters/:id` `lock=null`) → worker giả dịch xong → bảng/inspector hiện "Xin chào" (state đã áp, không phải cờ AI).
- `rg -n "EditorPage|PageStrip|ChapterPage\b|canvas/Stage" apps/web/src` = 0; `pnpm typecheck && pnpm lint && pnpm test` + e2e xanh.

## Risk Assessment
| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| Khoá giữ lúc AI chạy → bản dịch không áp | H×H | Chính sách khoá theo trạng thái + `runAi` nhả trước; e2e case khoá |
| Đua `activate` khi click nhanh nhiều page | M×M | `activate` tuần tự (promise chain), chỉ lấy yêu cầu cuối; input bị chặn khi `activating` |
| Bộ nhớ bitmap strip lớn | M×H | Trần 4 page; đo Safari với page 12.000px; overscan 1 màn |
| Toạ độ gesture lệch sau thêm offset (mask/OCR/text) | M×M | Hàm `stripToPage` thuần có test; e2e vẽ box chữ ở page 2 |
| Saver bỏ qua kết quả PUT khi `pageId` đổi giữa chừng (`save.ts:122`) → base cũ | M×M | `activate` luôn `await flush()` trước `load`; cache cập nhật từ `editorStore.base` sau flush |
| Thumbnail rail = ảnh full-size | M×L | `loading=lazy` + `decoding=async`; nếu chậm → câu hỏi P6 (thumbnail server) |
Rollback: revert PR (khôi phục EditorPage/route per-page); API thêm route đọc, không migration.
