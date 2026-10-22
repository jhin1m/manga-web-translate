# Code review: chapter workspace tool rail + warm theme (`0fc7abb..HEAD`, apps/web + docs)

Read-only review. Scope: 61 files, +2814/-1411. Old inspector / bottom-panel / CanvasToolbar / view-mode-switch /
page-rail at `0fc7abb` compared with the new files. CI was reported green and was not re-run here.

## High

### H1. Save conflicts and "AI có bản mới" only appear in the Chọn panel, so they are invisible elsewhere and get dropped on page change
- `select-panel.tsx:81-82`: `AiUpdatePanel` and `ConflictList` render only inside `SelectPanel`.
  `chapter-workspace.tsx:721-723` mounts `SelectPanel` only when `view === "tool" && (tool === "select" || sourceMode)`.
- Before this change, the inspector was always on screen next to the bottom table, except on the Mask tab
  (`inspector.tsx@0fc7abb:103-114`). Nothing else shows conflicts: `ConflictList` is the only reader of `s.conflicts`,
  and `store.load()` clears them on every page activation (`store.ts:105`, via `...initial()`).
- Repro: open the Bản dịch panel (it is remembered in `mtl.layout`, so it reopens after a reload). Accept "Khôi phục"
  on the recovery band, or hit a 409 rebase on a field the server also changed. The conflicts go to the store, but the
  panel showing is the table, so nothing appears. Press Enter in the table to move to a row on the next page:
  `load()` runs and the conflicts are gone. The user's edit is lost without any warning. The same happens with the
  panel collapsed, or with the T / B / E / R tools active.
- Fix: render `ConflictList` (plus a one-line "AI có bản mới" notice) above every panel body in `ContextPanel`, or in
  the LockBand. When `conflicts.length` goes from 0 to more than 0, also open the Chọn panel: `setTool("select")` and
  `setPanel("tool")`.

### H2. The Tìm panel unmounts when the chapter stops being settled, which loses the Find/Replace and Glossary "Hoàn tác" (batch undo)
- `chapter-workspace.tsx:783`: `{seen.has("find") && canTools && (…)}`. `canTools = settled && pages.length > 0`
  (line 592). The `applied.batch_id` that the undo needs lives in component state (`FindReplace.tsx:49-50, 110`).
- The old `bottom-panel.tsx@0fc7abb:137-139` kept seen tabs mounted even while they were disabled, so undo came back
  once the chapter settled again.
- Repro: Tìm / Thay → Xem trước → Áp dụng. Then use "Dịch lại trang này" (panel Chọn), "Dịch lại cả chương" or
  "Chạy lại trang lỗi" (menu ⋯). `enqueue.ts:310` sets the chapter to `processing`, so the panel unmounts. When the
  chapter settles again, the panel comes back empty and the bulk replace can no longer be undone from the UI.
- This contradicts `docs/editor.md:139`, which says the two sections keep their state.
- Fix: mount on `seen.has("find")` only, and hide the panel with `hidden={view !== "find"}`. `view` already falls
  back to "tool" when `!canTools`.

## Medium

### M1. After a page change, opening or closing the panel no longer re-fits the canvas, but "Vừa khung" still shows as pressed
- `ChapterCanvas.tsx:98-106` refits on resize only while `view === lastFit.current`. Once `setActive` (page change)
  or `fitView()` sets the view, it no longer equals `lastFit`, so every later panel width change (open/collapse,
  288↔560, or the auto-open on select at `chapter-workspace.tsx:261`) only changes the Stage width. The view is not
  refit or clamped again.
- `canvas-controls.tsx:49` keeps `aria-pressed={!zoomed}` on "Vừa khung" anyway.
- Repro: go to page 2 and collapse the panel. The page stays at the old scale, off-centre. Now click a block: the
  panel auto-opens, the canvas shrinks from the left, the image jumps 288px right and the right edge is cut off,
  while "Vừa khung" still shows as pressed. Switching Chọn → Bản dịch moves things another 272px.
- In the new layout, panel width changes are a normal action, not a rare one.
- Fix: in the resize effect, when `!chapterStore.zoomed`, call `pageStartView` again (re-fit). Otherwise run
  `clampView` with the new size. Alternatively, have `fitView()` and `setActive` record their view as `lastFit`.

### M2. A context menu whose items are all disabled cannot be closed from the keyboard
- `context-menu.tsx:60-62` only focuses `button:not(:disabled)`. The Esc / Tab handling is the menu's own
  `onKeyDown` (lines 106-116), so it only works when focus is inside the menu.
- `page-rail.tsx:48-69` returns a single disabled item whenever `!editable` (no lock, chapter running) or only one
  page is visible.
- Repro: while the chapter is translating, focus a thumbnail and press Shift+F10 (or click a hidden page). The menu
  opens, but focus stays on the thumbnail. Esc runs the global "escape" (deselect) and the menu stays open. Tab moves
  focus on and the menu still stays open. Only a pointer click closes it.
- The docs say "Esc trả focus về nút mở" (`docs/design-guidelines.md:89`).
- Fix: when there is no enabled item, focus the menu container (`tabIndex={-1}`), or attach the Esc / Tab handler to
  `document` while the menu is open.

### M3. Screen readers can no longer tell which tool is active
- `tool-rail.tsx:44`: `aria-pressed={open}` is true only when that tool's panel is open. When the panel is collapsed,
  or Bản dịch / Tìm is open, every tool button reads "not pressed". The active tool is shown only by `data-current`,
  which is a colour change.
- The old `CanvasToolbar.tsx@0fc7abb:27` exposed `aria-pressed={tool === t.id}`.
- Fix: for tool buttons, use `aria-pressed={tool === it.id}`, and announce whether the panel is open with
  `aria-expanded` / `aria-controls` on the button. Alternatively, add "· đang chọn" to the accessible name.

## Low

- **L1. Clicking ⋯ while its menu is open closes it and immediately reopens it** (`more-menu.tsx:64-68` together with
  `context-menu.tsx:66-73`). The capture-phase `pointerdown` closes the menu and React flushes that update before
  `click` fires, so the click handler sees `at === null` and opens the menu again. Fix: in `outside`, ignore targets
  inside `anchor`, or toggle the menu on `pointerdown`.
- **L2. Keys the menu does not handle still reach the global shortcuts** (`context-menu.tsx:106-116`). ←/→ change the
  page, V/T/B/E/R change the tool, and Delete/Backspace delete the selected box while focus is on a menu item. Fix:
  call `e.stopPropagation()` for every keydown inside the menu, not only for the keys it handles.
- **L3. Before Bước 1, the tool keys bypass the disabled rail** (`chapter-workspace.tsx:620-621`; the reset effect at
  453-455 only runs when `sourceMode` changes). Pressing T / B / E / R in source mode sets the tool, so the rail marks
  a disabled button as current and the panel title reads "Thêm chữ" over the source panel. The tool also carries over
  once pages exist. Fix: ignore `tool` actions other than select while `sourceMode`.
- **L4. The chapter-wide block count was dropped.** The old tab label was `Bản dịch · ${allRows.length} khối`
  (`chapter-workspace.tsx@0fc7abb:767`). The rail label (`tool-rail.tsx:21`) and `TextTable` (it uses `total` only for
  the empty state) no longer show it anywhere. Fix: show "N khối" in `.cw-panel-tools` or in the panel title.
- **L5. On the active thumbnail, focus cannot be told apart from "current page".**
  `.cw-thumb[aria-current="page"]` (`chapter-workspace.css:337-340`) uses the same colour as `:focus-visible`
  (`tokens.css:95-97`) and has higher specificity, so focus on the active thumbnail has no visible change (WCAG 2.4.7).
  Fix: give focus a different treatment, for example an inner `box-shadow` or a larger offset.
- **L6. Hidden-page numbers are below contrast** (`chapter-workspace.css:347-350`). `opacity: .45` on the whole
  `.cw-thumb` also fades the white-on-dark number badge, to roughly 2.4:1. The "Đã ẩn" label is fine. Fix: fade only
  the `img`.
- **L7. Docs: `docs/editor.md:124` says selecting a block while the panel is collapsed opens "panel Chọn".** The code
  (`chapter-workspace.tsx:261`) opens the current tool's panel. After an OCR-region result is selected with tool =
  ocr, the OCR panel opens instead. Fix the text or call `setTool("select")`.

## Checked, no issue found
- **Contrast of the new tokens.** Computed values: fg-muted 5.63 on bg / 4.72 on surface-2; fg-subtle 4.52 on bg and
  only used as text on bg (`figcaption`, `kbd`); accent-hover 4.86 on accent-weak; white on accent 4.71; warn on
  warn-weak 4.62; danger on danger-weak 5.53; focus/outline `#c2501b` at 4.11–4.48 (UI ≥ 3). All pass.
- **Icon-only buttons all have `aria-label`:** rail, Thu panel, pager, block toolbar, ⋯, undo/redo.
- **Ctrl+F focus:** opens the panel, switches to the find section, and the deferred focus works even on first mount.
- **`duplicateBox`:** structured clone, 1 undo step, ignores a duplicate id, `region_id = null`. The block toolbar
  hides correctly in read-only, original view and while AI is running.
- **`fitView`:** no-op without an active page or box; 100% keeps its scale across page changes via `zoomed`.
- **Hidden pages:** shown in place, restore through the menu, excluded from review counts and the pager. The hide
  button is guarded against hiding the last page.
- **Rail "Find" button:** disabled until the chapter is settled. A remembered "find" panel falls back to "tool".
- **E2E:** test counts are equal or higher in every spec. The old assertions (tab selection, rail filters, inspector
  text) map to equal-strength checks: aria-pressed, accessible names, panel text. Nothing was dropped without a
  replacement. Gaps that existed before and still exist: no e2e for Ctrl+F focus, the context menu Esc path or the
  Vừa khung / 100% buttons.
- **Shortcuts in `docs/editor.md`:** all still resolve in `shortcuts.ts` with unchanged handlers.

## Unresolved questions
1. H1: should conflicts force the Chọn panel open (interrupting table work), or only show a band/toast with a link to
   it? This is a product call.
2. M1: when the user collapses the panel for more room, should "Vừa khung" re-fit automatically, or only re-clamp?
   The brief says the canvas is "vừa khung" by default, but does not say how it should react to panel width changes.
3. Open question 7 in the plan (auto-open the panel when a block is selected): combined with M1, this makes the image
   jump on every first click after collapsing the panel. Does the owner still want it?
