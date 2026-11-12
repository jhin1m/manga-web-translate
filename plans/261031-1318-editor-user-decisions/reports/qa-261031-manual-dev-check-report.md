# QA manual dev check — editor user decisions (bulk Cmd+Z, căn dọc Trên/Giữa, wheel page flip)

Date: 2026-10-31 14:50–15:10 (Asia/Saigon) · Branch `feat/editor-user-decisions` · Dev app http://localhost:5180 (real worker 0.7.1)
Data: series "QA đêm" / chapter 1 (`01a18df3-d21d-7100-9a4d-d0ddd106b526`), 4 pages. Real chapter not opened.
Tooling: agent-browser (Chromium, 1440×900) + a tiny CDP script for precise wheel events (`Input.dispatchMouseEvent mouseWheel`, with Ctrl/Meta modifiers). State checked via `GET /api/chapters/:id/states` after each step.
Screenshots: `/private/tmp/claude-501/-Users-jhin1m-Desktop-ducanh-project-manga-web-translate/22875911-5e40-42bf-9dd1-b0e292234ad6/scratchpad/` (file names below are relative to it).

## Summary

| # | Check | Result |
|---|---|---|
| 1a | Cmd+Z after "Áp kiểu này cho khối thoại trong chương" restores all pages, same toast as Hoàn tác | PASS |
| 1b | Second Cmd+Z undoes the pre-batch font-size edit | PASS |
| 1c | Tìm/Thay apply → Cmd+Z restores | PASS |
| 1d | Cmd+Z inside the Tìm field doesn't undo the page/batch | PASS (with a caveat: native field undo can't be seen through CDP) |
| 2a | Căn dọc Giữa centres short text in the editor | PASS |
| 2b | Export (real worker) centres it the same way as the editor | PASS |
| 2c | Untouched old block (no valign) is still top-aligned in the editor and the export | PASS |
| 3a | Wheel down past the bottom → next page, ~200ms animation, lands at the top | PASS |
| 3b | One small notch at the edge doesn't flip | PASS |
| 3c | Ctrl+wheel / Cmd+wheel zooms and never flips | PASS |
| 3d | Wheel up past the top → previous page, lands at the bottom | PASS |
| 3e | One stream of inertia → only one page flips; zoom is kept across the flip | PASS |
| — | Fitted ("Vừa khung") page: wheel-down edge detection | BUG (see B1) |

## 1. Bulk undo via keyboard

Before: page 1 `tb-r5` "Đi dạo cùng không?" BeVietnamPro 24.
- Changed Cỡ chữ 24 → 28 (`03-fontsize-28.png`; API P0 v19 tb-r5 = 28).
- Kiểu chữ nâng cao → "Áp kiểu này cho khối thoại trong chương". Toast: "Đã áp kiểu cho 11 khối thoại trên 4 trang. Hoàn tác · Đóng" (`05-apply-style.png`). API: every dialogue block on all 4 pages = BeVietnamPro 28, auto_fit false.
- **Cmd+Z** (focus on body): toast "Đã hoàn tác áp kiểu trên 4 trang." (`06-cmdz-1.png`). API: all pages back to their pre-batch state (P0 tb-r3 Bangers 37, P1 tb-r3 Bangers 39 auto, P3 tb-r3 Bangers 31 auto…). Only the pre-batch edit stays (P0 tb-r5 = 28).
- **Cmd+Z again**: P0 tb-r5 back to 24, Hoàn tác disabled, Làm lại enabled (`07-cmdz-2.png`).
- Page 2 in the editor after the undo: "RÚT KIẾM RA!" is back in Bangers, the other blocks are back to 24 (`08-page2-after-undo.png`).
- Compared with the toast button: re-applied, then clicked the toast's "Hoàn tác". The message is identical: "Đã hoàn tác áp kiểu trên 4 trang." (`11-toast-undo-button.png`). Afterwards the editor Hoàn tác button is disabled, so the history marker is consumed and there is no double undo.
- **Tìm/Thay**: "nhé" → "nha QA", Xem trước (2 hits, page 4), Áp dụng → P3 v9 has "nha QA" (`14-fr-applied.png`). Then I put the focus in the Tìm field, typed "xyz" and pressed Cmd+Z. The page is not undone (API unchanged, Hoàn tác still enabled). A capture listener shows the keydown reached the INPUT with `defaultPrevented=false`, so the app leaves it to the browser's native field undo. The field text itself did not revert, because synthetic CDP Meta+Z does not run Chromium's native editing command on macOS. That part needs a real-keyboard spot check. Blurred the field, pressed Cmd+Z: toast "Đã hoàn tác thay thế trên 1 trang.", P3 back to "nhé", and the panel's own Hoàn tác button disappears (`16-cmdz-fr-undo.png`).

## 2. Vertical centring (Căn dọc)

- Old block `tb-r5` (no `valign`): the toggle shows **Trên** pressed (aria-pressed true). I shortened the text to "Đi dạo nhé?": one line that sticks to the top of the box (`18-short-text-top.png`).
- Clicked **Giữa**: API `valign: "middle"` and the text is centred in the box (`19-valign-middle.png`; side-by-side in `cmp-valign-editor.png`).
- Export → "Tải chương (.zip)" → real worker render. "Đã xong" appears and the zip downloads (`21-export-progress.png`, unzipped to `export1/001..004.png`, 800×1200).
- Ink bounding boxes, in page px:

| Block | Editor (from the 68% screenshot) | Export 001.png | Box |
|---|---|---|---|
| tb-r5 (Giữa) | y 850.0–873.5, x≈132 | y 850–875, x 131 | 815.3–905.7 |
| tb-r1 "Xin chào!" (no valign) | y 177.9–197 | y 178–197 | 169.4–231.6, top-aligned |

  The editor and the export match within about 1–2px. Annotated crops: `export-crop-r5.png` (text sits on the box midline) and `export-crop-r1.png` (top-aligned, empty space below).

## 3. Wheel page flip

Precise wheel events came from CDP (`tools/wheel.mjs`). Note: `agent-browser mouse wheel` events did not seem to reach the Konva canvas, so I only count the CDP results.
- Page 2 zoomed to 144%, scrolled to the bottom with about 7 isolated notches (100px each, more than 300ms apart): no flip. Then a 12-event stream (50ms apart) → page 3, flipped only once despite the inertia, landed at the top, zoom kept at 144% (`38-p2-zoomed-bottom.png`, `39-stream-down-p3-top.png`). The animation hook logged one `.ed-canvas.animate({duration:200, easing:'ease-out'})` per flip.
- At the top of page 2 (144%): 8 isolated up notches → no flip (`35-p2-top.png`). Then 2 quick notches → page 1, landed at the bottom (bubble "Đi dạo nhé?" and the page's bottom edge visible) with zoom kept (`36-flip-up-p1-bottom.png`).
- Ctrl+wheel ×5 and Cmd(Meta)+wheel ×10 on a fitted page that is at both edges: zoom changed (68% → … → 144%), the page stayed "Trang 2 / 4", no flip (`34-cmd-zoomed-in.png`).

## Bugs / observations

### B1 (Low–Medium, UX): a fitted page isn't treated as "at both edges"; the first notch shifts the page and wheel-down needs 3 notches
`ChapterCanvas.onWheel` computes `fits = ph + 2*EDGE <= size.h` with `EDGE = 40`, but "Vừa khung" fits the page with `FIT_EDGE = 16`. So a page that is fully visible after fit (816px page in an 848px frame) is not "fits":
- `atBottom` is false at the fitted view (y=16 > −7.5). The first notch down is used up scrolling the page up 24px (page top goes 8px above the frame), and the accumulator restarts. Two quick notches do **not** flip; three do.
- Going up from a fitted view, `atTop` is true via the `FIT_EDGE` clause. The first notch still scrolls the page down 24px (bottom 8px cut off), but 2 notches flip. Up and down are asymmetric.

Repro (reproduced 2 out of 2 for each count; screenshots `40-fit-before-*.png` / `40-fit-after-*.png`, `41-fit-up-after-*.png`):
1. Open the editor with a sheet page (800×1200) at "Vừa khung" (68% in a 1440×900 window).
2. Wheel down 1 notch: the page jumps up 24px (top row 16 → 0 in the frame), no flip.
3. From a fresh page activation, wheel down 2 quick notches: no flip. 3 quick notches: flip.

The doc says "page nằm trọn khung = ở cả hai mép" and "2 nấc chuột". Possible fix: use FIT_EDGE (or the clamp range) in the `fits` / `atBottom` test, or make clampView keep a fitted page fixed.

### O1 (info): the page reloaded mid-test because of a concurrent source edit
Around 15:00:37, `apps/web/src/features/chapter/activity-drawer.tsx` was modified (not by me; it shows as `M` in git). Vite reloaded the page (`performance.now` reset, injected globals gone), and the custom zoom was lost (68% after a flip). After re-zooming, a flip keeps the zoom, so this is not a flip bug.

### O2 (minor a11y)
- The "Kiểu chữ nâng cao" disclosure is not exposed as an interactive element in the accessibility snapshot. agent-browser `find text` resolved it under the header, so I had to click it by coordinates. Check that the summary is keyboard- and AT-reachable.
- The spinbutton a11y values show raw floats ("Giãn dòng" 1.149999976158142, "Viền ngoài" 3.299999952316284), while the visible text is fine (1,15 / 3,3).

## Data left behind
- Page 1 `tb-r5` is restored to "Đi dạo cùng không?", 24px, now with explicit `valign: "top"` (renders the same as the original undefined). Batch and Find/Replace edits were undone. 2 export runs exist in history (one created by this check).
- Page versions bumped (P0 v27, P1 v11, P2 v21, P3 v10). Nothing deleted. The browser session is closed.

## Unresolved
- The native Cmd+Z text undo inside the Tìm field needs a real-keyboard spot check (CDP can't trigger it). The app side has been checked: it does not intercept the key.
