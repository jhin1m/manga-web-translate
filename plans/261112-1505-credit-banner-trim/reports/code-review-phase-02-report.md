# Code review — Phase 2 (web trim UI): `dba228e` + `ed411fc`

Score: **8/10**. Critical 0 · High 0 · Medium 2 · Low 6.

Verified on a detached worktree at `ed411fc` (so the other agent's in-progress changes were not included): `pnpm typecheck` passed, `biome check apps/web/src apps/web/e2e` passed (236 files), `source-rail-model.test.ts` passed 17/17, e2e `trim-source.spec.ts` passed.
`block-panel.spec.ts:317` **fails at `ed411fc`, and it also fails with `apps/web/src` reset to `ac18a76`** (before trim). The fake worker change does nothing for that test: `readyChapter` uploads untrimmed sources, so `h` stays 1000. Only `VERSION` changed, and 0.12.0 is required by the API MIN. The failure is at line 339 (panel still visible after the double-click gap), which is UI timing. It is not caused by this phase.

## Spec checklist (a)
All met: menu items only when `editable` + not skipped (rail menu only opens when editable; no rail after step 1). 2 handles with pointer capture and `touch-action: none`. Keys: Tab, ↑/↓ = 1 px, Shift = 10 px, Enter/Esc. `clampTrim` works in natural px and keeps ≥ `MIN_TRIM_KEEP_PX`. Optimistic PATCH with rollback, errors via `errorMessage` (same path as skip). Undo toast. "Bỏ cắt". Flag ✂ + accessible name "Ảnh n · Đã cắt mép" (rail convention instead of the spec's ", đã cắt mép"; acceptable). "Credit · tự cắt" label. Dim overlay + caption outside trim mode. Scroll to bottom for the last image.
Rounding (c): overlay uses % of a frame that wraps only the `<img>` (`display:block`, figure `fit-content`), so zoom and resize don't break it. Pointer y is converted through the frame rect, and `clampTrim` rounds. `naturalHeight 0` is never stored (`height > 0`). `done()` does nothing while `natural === null`, so there is no garbage PATCH. EXIF: browser and worker (`ImageOps.exif_transpose`) both apply orientation, so they agree.

## Medium

**M1. Global Enter/Esc capture takes over every other control while trim mode is on.** `source-viewer.tsx:64-77`
The window capture listener calls `stopPropagation` + `preventDefault` for any Enter whose target is not a `button`, and for every Esc.
- Chapter meta popover (topbar, reachable in source mode): Enter in the chapter-number `<input>` saves the trim and blocks the form submit. Esc cancels the trim instead of closing the popover.
- Right-click a thumbnail during trim: Esc cancels the trim, but the context menu never sees the key. The menu stays open while `closeTrim` moves focus to the thumbnail.

Fix: ignore events whose target is inside `input, textarea, select, [contenteditable], [role=menu], form, [role=dialog]`. Simplest: only handle the keys when the target is `document.body`, inside `.cw-source-view` / `.cw-canvas-foot`, or `e.defaultPrevented` is false. Then run the listener in the bubble phase so the menu and popover handle Esc first.

**M2. The e2e cleanup is not in `finally`.** `e2e/trim-source.spec.ts:135`
If any assertion fails, the series stays in the e2e DB, and the single-series auto-pick in `upload-chapter` specs then fails too. One failure becomes several. Fix: `test.afterEach`/`try…finally` that deletes `sid` when it exists.

## Low

**L1. Drag can get stuck.** `source-trim-overlay.tsx:66-80`
There is no `onLostPointerCapture`, and `onPointerMove` does not check `e.buttons`. Scenario: start a drag, Cmd+Tab away, release the button outside the window. Capture is lost without `pointerup`, so `dragging` stays true and the line follows the cursor on hover. Fix: `onLostPointerCapture={endDrag}`, or `if (!(e.buttons & 1)) dragging.current = false`.

**L2. The line jumps when a drag starts.** `source-trim-overlay.tsx:76`
`setLine` uses the raw pointer y. Grabbing the 24 px hit area away from the line makes the line jump by up to 24 display px, which is about 48 natural px at a 0.5 display scale. Fix: store `offset = clientY − lineY` on pointerdown and subtract it on move.

**L3. Old trim can flash for one frame after Xong.** `source-viewer.tsx:41` + `use-source-images.ts` `onMutate`
`setTrimId(null)` → the effect clears the draft → the viewer and flag render `item.trim` (old). The optimistic cache write only lands after `await cancelQueries`, and the query notify runs on a `setTimeout(0)` batch, so the browser can paint the old shade in between. Fix: reset the draft only on `item?.id` change (and when entering trim), or apply the optimistic `write` before awaiting.

**L4. Undoing "Bỏ cắt" sends no `height`.** `chapter-workspace.tsx:1501, 843`
`trimSource(it, null)` passes `height` undefined, and the undo reuses it. This works today because the first user trim stores the height. Risk for Phase 4: a credit trim on a row with no stored height → undo returns 400 `no_size`. Undo also turns a `by:"credit"` trim back into `by:"user"`, because `prev` drops `by`. Decide this in P4.

**L5. Silent draft loss and leftover state.** `chapter-workspace.tsx:745-746`
If another tab starts step 1 (or the image is skipped / the chapter stops being editable) during trim, the draft is dropped with no notice, and `trimId` stays set. If the chapter becomes editable again (partial_failed with 0 pages), trim mode reopens on its own. Fix: clear `trimId` when `!sourcesEditable`, and hide or end trim when `it.skip` is set.

**L6. Fake worker `source_map` ignores the top trim.** `e2e/fake-worker.ts:125`
`src_y` stays `c.i*1000`; with a top trim it should start at `trim.top`, and with `pagesPerSource>1` + trim every slice gets the full trimmed height. Only the bottom-trim spec uses it today, so this is harmless, but it is a trap for future specs. Possible fix: `src_y: (s.trim?.top ?? 0) + c.i*…`.

## Regressions (b) — checked, nothing found
Skip flow is unchanged; trim writes only touch the `trim` field (same latest-seq pattern as skip). Rail reorder/drag is unchanged; picking a thumbnail or stepping ←/→ ends trim on purpose. The pager comes back after trim. Focus returns to the thumbnail. The context menu returns focus to its anchor first, then the handle effect focuses the top handle. Commit flow: Enter on a button is excluded. Blob URLs work, because `measured` is keyed by URL. Listener cleanup is correct. Pointer handlers read fresh props on every render. Pointermove re-renders only `SourceViewer`; it could skip `setDraft` when the clamped value is unchanged (optional).

Status: DONE_WITH_CONCERNS
Summary: 8/10; 0 critical, 0 high (2 medium: Enter/Esc capture hijack, e2e cleanup not in finally).
Concerns/Blockers: block-panel.spec.ts:317 fails before this phase too (reproduced with src reset to ac18a76); needs a separate fix.

## Fixes applied (commit b1720d5)
- M1 -> trim Enter/Esc listener moved to `document` bubble phase; skipped when `defaultPrevented` or target is in input/textarea/select/contenteditable/form/menu/menuitem/dialog/listbox/combobox (buttons/links keep only Enter). A window-level listener was not usable: the chapter shortcuts listener runs first and calls `preventDefault` on Esc. Context menu / meta popover stop propagation, so Esc closes them first.
- M2 -> `test.afterEach` deletes the created series in both trim specs.
- L1 -> `onLostPointerCapture` ends the drag.
- L2 -> grab offset kept from pointerdown.
- L3 -> draft kept after Xong until the item's `trim` changes (or reverts on error); Cancel / forced exit still drop it.
- L5 -> `trimId` cleared when the chapter stops being editable or the image is skipped (no auto-reopen).
- L6 -> fake worker: src_y counted from the top of the trimmed image (as the real worker does); with `pagesPerSource>1` + trim the kept height is split across slices; untrimmed output unchanged.
- Phase 3 retry -> "Thử lại" re-reads the current trim from the sources list (`currentBandTrim`, unit-tested); an edge no longer trimmed -> short error, nothing learned.
- Not done (as agreed): L4.
