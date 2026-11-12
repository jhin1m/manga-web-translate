# Code review: commit 4b1b645 (trim panel in left rail + zoom for draft source viewer)

Date: 2026-11-13. Read-only review. Gates and e2e were run in a scratch detached worktree of `4b1b645`, which has since been removed.

**Score: 8/10.** 0 Critical, 0 High, 2 Medium, 5 Low.

## Gates
- `pnpm typecheck`: clean. `npx biome check apps/web`: clean (254 files).
- `pnpm --filter @mtl/web test`: 59 files, 532 tests, all passing.
- e2e `trim-source`, `trim-learn-band`, `trim-auto-drop` (3 tests): 5/5 green.
- The e2e changes are legitimate. Assertions moved from the old "Trên x px · Dưới y px" text to the panel inputs and the slider `aria-valuenow`. New tests cover typing plus clamping, auto-save when switching images, Enter in an input, zoom (button and Ctrl+wheel) followed by a drag that checks natural px, and the right-click menu no longer offering trim. Nothing was weakened.
- Scratch Playwright probes (throwaway, not committed) confirmed M1, L1, L2 and the auto-save failure path. They also showed:
  - A 720×15000 image works at 400% (2880×60000). The bottom handle sits exactly at H−500 for Dưới=500.
  - 40 Ctrl+wheel events give no browser page zoom (`devicePixelRatio` stays 1).

## Plan decisions
| # | Verdict |
|---|---------|
| 1 Rail icon only on a draft with sources; panel shows Ảnh n/N, Trên/Dưới, Lưu/Huỷ, Bỏ cắt, credit label, skipped-image message | OK. `showTrim={sourceMode}`. The button is disabled with a reason when `!sourcesEditable`. Clamping goes through `clampTrim` in natural px. |
| 2 Auto-save on image switch only when dirty; close/Esc/Huỷ discards | OK. `commit()` only writes when `dirty`; e2e shows a clean draft writes nothing. If the save fails, the switch still happens, the optimistic value rolls back per id, and a danger toast appears (probe: "Internal Server Error"). The drag work is lost (see L3). |
| 3 Context-menu items removed | OK (`source-rail.tsx`). |
| 4 Toast "Hoàn tác · Luôn cắt ở series này" | OK. `trimSource` is unchanged; `trim-learn-band` is green. |
| 5 Zoom | Mostly OK. Exceptions: L1 (zoom is not reset when returning to an image) and L4 (Safari pinch). |
| 6 Icon hidden once pages exist | OK. An effect also closes the panel when `!(sourceMode && sourcesEditable)`. |

Keyboard (b):
- Enter or Esc in the panel is handled by the React `onKeyDown`, which calls `stopPropagation`. The event therefore never reaches the document listener (viewer) or the window listener (shortcuts), so nothing fires twice.
- `useShortcuts` ignores ←/→ when focus is in an input.
- Typing never sends a PATCH; it only updates the draft.

Regressions (d):
- Editor `CanvasPager` is a pure extraction into `ZoomPercentButton`. `.cw-zoom-btn { border-right: 0 }` has no effect because the button already has `border: 0`.
- `railClick` behaves the same for `doc`, and the existing rail tests pass. Editor zoom is untouched.

## Medium

**M1. `type="number"` input: typing "e", "-" or "." resets the edge to 0, so Enter can save "no trim".**
- Where: `apps/web/src/features/chapter/trim-panel.tsx:21-33` and `source-trim-model.ts:25-30`.
- The browser sanitizes an invalid number to `value === ""`. `parseTrimInput("")` returns 0, so the draft edge becomes 0 and the handle jumps.
- The input still visibly shows "120e", because React sees "" equal to the DOM value and skips the write.
- Probe: after typing "120" `aria-valuenow` was 120; after typing "120e" it was 0.
- Failure scenario: the user types "53e" (typo) and presses Enter. The draft is {0, 0}, `trimPayload` returns null, and the existing trim is cleared on the server.
- The code comment claiming that "-", decimals and "e" are ignored is false in practice.
- Fix (either):
  - Ignore the event when `e.target.validity.badInput` is true.
  - Use `type="text" inputMode="numeric" pattern="\d*"`, so the raw text reaches `parseTrimInput`. This is the option that matches the comment's intent.

**M2. An unsaved draft is silently dropped when the user starts "Dịch chương" / prepare.**
- Where: `chapter-workspace.tsx:752-757` and the run path around line 547 (`commitChapter`).
- With the panel open and a dirty draft, clicking Dịch chương starts ingest. `sourcesEditable` turns false, the panel closes, and the draft is discarded. Pages are cut with the banner still in place, and the sources can no longer be edited.
- This already happened on main, but this commit makes the panel persistent and explicitly promises "không mất công kéo". That makes forgetting to press Lưu more likely.
- A related race also predates this commit: pressing Lưu or auto-saving and then immediately clicking Dịch chương sends the trim PATCH and `commitChapter` concurrently.
- Fix: before running, if `trimState.dirty`, `await sourceTrim.mutateAsync(...)` (or await a pending trim mutation), then commit. Alternatively, disable the run button with the reason "Lưu cắt mép trước" while the draft is dirty.

## Low

**L1. Zoom comes back when you return to an image.**
- Where: `source-viewer.tsx:58-59`. `zoomState` keeps the id of the last zoomed image.
- Probe: zoom image 2 to 156%, switch to image 1 (100%), switch back to image 2: it shows 156% again, scrolled to the top.
- This contradicts the plan ("về Vừa khung khi đổi ảnh"). The e2e only checks A→B.
- Fix: clear it during render, e.g. `if (zoomState && zoomState.id !== item?.id) setZoomState(null)`, or call `setZoomState(null)` in an effect on `[item?.id]`.

**L2. The old trim flashes for one frame after Lưu, a regression of a fix made in b1720d5.**
- Where: `use-source-trim.ts:40-44` calls `setDraft(null)` right away. The optimistic write in `use-source-images.ts:117-125` only lands after `await cancelQueries`, and TanStack notifies observers via `setTimeout(0)`.
- Probe (rAF samples after Lưu, no prior trim): frame 0 had no shade, frames 1-19 showed `17.67%`.
- The ghost-draft fix from review L3 was removed on the assumption that the optimistic save covers it. It does not.
- Fix (either):
  - In `onMutate`, call `write(...)` before awaiting `cancelQueries`.
  - Keep `{id, edges}` until `item.trim` matches or the mutation errors.

**L3. A failed auto-save gives a generic toast and loses the draft.**
- Where: `chapter-workspace.tsx:964-967` and `use-source-trim.ts:43`.
- The toast reads "Internal Server Error" with no image number and no retry, and the user is already on another image.
- Fix: in the `trimSource` error toast, say "Chưa lưu cắt mép ảnh n" and add a "Thử lại" action that reuses `{it, trim, height}`.

**L4. Safari trackpad pinch is not intercepted.**
- Where: `source-viewer.tsx:131-137`. Safari pinch fires `gesturestart`/`gesturechange`, not `wheel` with `ctrlKey`, so the whole page zooms.
- The user and the Windows testers use Chrome or Edge, so this is low priority.
- Fix: `preventDefault` on `gesturestart`/`gesturechange` on the scroller, mapped to `zoomTo`.

**L5. Focus jumps to the canvas on every image switch while the panel is open.**
- Where: `source-trim-overlay.tsx:60-62`. The handles remount because the scroller is keyed by `item.id`, and the top handle auto-focuses.
- A keyboard user who presses Enter on a thumbnail, or clicks the pager ‹/›, loses their place in the rail.
- Before this commit, trim mode ended on image switch, so this could not happen.
- Fix: auto-focus only when trim mode starts (pass a flag from the viewer), not when the image changes.

## Recommended order
M1, then M2, then L1 and L2 (both one-line fixes), then L3, L5 and L4.

## Unresolved questions
- For M2, which does the product want: auto-save before running, or block the run with a reason? Either is reversible; auto-save matches decision 2.

## Fixes applied
- M1: trim inputs are `type="text" inputMode="numeric"`; `parseTrimInput` accepts only 1-9 digits (empty/"-"/"."/"e" give null). Rejected text keeps the previous text, an empty box neither moves the handle nor saves, blur/Lưu falls back to the last valid value. Unit-tested; e2e types "-", "120e", ".5".
- M2 (auto-save): "Dịch chương" / prepare first commits a dirty draft and awaits every in-flight trim save, then runs. A failed save returns the error toast and the run is not started. e2e covers failure (no pages created, "Thử lại" re-sends) and success (pages cut with the unsaved value).
- L1: zoom state is dropped as soon as the viewed image changes, so 2 -> 1 -> 2 starts at fit.
- L2: the draft stays displayed (`saving`) until the save settles; it is dropped on success or failure, never earlier.
- L3: save failures toast "Không lưu được cắt mép ảnh n." with "Thử lại" that re-sends the same values (`trim_too_large` keeps its own message without retry). The hook no longer takes an `onError` callback; callers report.
- L5: the top handle takes focus only when trim mode opens (a ref set by the viewer), not on image switch.
- L4: done (about 12 lines): `gesturestart`/`gesturechange` on the viewer with `preventDefault`, `scale` mapped to zoom. Not verified in Safari (no Safari available here).
