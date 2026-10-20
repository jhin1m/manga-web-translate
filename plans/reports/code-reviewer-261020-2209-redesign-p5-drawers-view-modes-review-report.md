# Code Review: Redesign Phase 5 (drawers, view modes, shortcuts)

Scope: uncommitted diff + untracked files on `feat/redesign-p5-drawers-view-modes` (23 modified/renamed, 12 new, about 1.1k LOC).
Gates: `pnpm typecheck` passed · `pnpm lint` (biome, 232 files) found 0 issues · `pnpm --filter @mtl/web test` passed 109/109 (21 files). I did not run e2e (owned by another agent).

**Score: 8/10.** The core logic is sound and I found no critical issues. One latent rendering bug in split view and one avoidable re-render hotspot.

## Major

**M1. Split view: the original column's tile culling uses the wrong x-coordinate.** `apps/web/src/features/editor/canvas/ChapterCanvas.tsx:305` (left-column `PageSlot`, `viewport={local(off)}`)
- `local()` shifts only `y`. The left column sits at strip x = `content.x` (= −(w+gap)), so its page-local viewport x should be `viewport.x - content.x`.
- `visibleTiles` (TileLayer.tsx:22-23) culls tile columns by `viewport.x`. With TILE=2048 it only works by accident for pages narrower than about 2016px, because the ±1 tile margin rescues column 0.
- For pages wider than 2048px (2-tile columns), zooming in on the left column computes `c1 = 0`. Tile column 1 never mounts and the right part of the original column stays blank.
- Fix: `viewport={{ ...local(off), x: viewport.x - content.x }}` for the original column only.

**M2. The whole ChapterWorkspace re-renders on every upload progress tick of any chapter.** `chapter-workspace.tsx:393` → `activity-drawer.tsx` `useUploadCount()` → `useUploads()` selects `s.chapters`.
- `s.chapters` gets a new reference on every byte-progress publish.
- Realistic case: uploading the next chapter while editing this one. The table, rail and topbar re-render tens of times per second.
- Fix: use a scalar selector, e.g. `useStore(uploadManager.store, s => Object.values(s.chapters).filter(c => c.phase === "uploading").length)`.
- `ShellActivity` is isolated, so the app shell is fine.

## Minor / Low

**L1. Ctrl/Cmd+S with a drawer open opens the browser "Save page" dialog.** `use-shortcuts.ts:31-32`: `blocked()` returns before `preventDefault`. The spec says Ctrl+S always saves. At minimum, call `preventDefault` for `save` (or allow `save` through while blocked).

**L2. Ctrl/Cmd+F while `!canTools` (chapter processing) does nothing and still blocks the browser's find.** `chapter-workspace.tsx:371-373` + `use-shortcuts.ts:32`. Either let it fall through or open the tab anyway.

**L3. A hold of `O` can get stuck.** `shortcuts.ts:61` matches keyup by `e.key === "o"`:
- macOS with Alt pressed mid-hold: keyup key is "ø".
- macOS with Cmd pressed during the hold: no keyup is delivered at all.

It recovers on window blur or the next O press. Matching keyup on `code === "KeyO"` covers the Alt case; the plan's `KeyInput` listed `code` but the implementation dropped it.

**L4. "Xem các khối này" skips the export refresh.** `chapter-workspace.tsx:~565` closes via `setDrawer(null)`, so it bypasses the `data.refresh()` that `onClose` performs. The impact is minor.

**L5. Split mount cap is 2 pages per column, but split auto-fit roughly halves the scale.** At low zoom (near MIN_SCALE 0.1), more than 2 pages can be visible, and the extra ones render white. With 3000–6000px slices this is rare at fit scale. It is the same class of issue as the existing cap, but more likely in split.

**L6. Dead state and dead export.**
- `editorStore.showOriginal` now has no reader in `src`; it is only written by the subscription at `chapter-store.ts:149`. The plan asked to keep it, so this is acceptable, but it is dead.
- `withFlush` (`use-chapter-session.ts:472`) has no remaining caller.

**L7. Activity badge counts `paused_budget` as "đang chạy".** `activity-drawer.tsx` `ACTIVE`. Debatable wording.

**L8. The workspace always mounts `useExports`.** That adds one extra `GET /exports` per chapter open and keeps the 1.5s poll running while an export is active, even with the drawer closed. This is intentional for the badge; noting the cost only.

**L9. Split view shows a crosshair cursor over the left column even though it only pans.** UX nit.

## Verified OK (touchpoints)

**Keyboard**
- Esc with the drawer open: capture-phase close runs and the shortcut table is blocked.
- Esc in a table or canvas textarea: `inField` gives null, and the local handlers blur or cancel as before.
- Enter on a button/link/summary is skipped. Auto-repeat is ignored except for page navigation (matches old behavior).
- No stale closures: `keys.current` and `drawerRef` are reassigned every render, and the listener is mounted once.
- The old inline listener was fully removed. The old `dialog` exclusion is now covered by `blocked()`, since no other `<dialog>` remains.

**Coordinates**
- `clampView(x0)` math checks out and is tested.
- Every `clampView` caller passes `contentBox` + `x0`: fit, split toggle, `setView`, `focusPage`.
- `focusPage` and the canvas both key split off `viewMode`, so they stay consistent.
- `revealRect` is vertical-only and unaffected.
- Edit layers stay at x = 0; a left-column pointer means pan (`at.x < 0`).

**Save/lock**
- Untouched. Export now flushes in `beforeStart` before `createExport`, and a flush error surfaces in the panel.
- `LockBanner` was moved verbatim. `rg "Modal\b" apps/web/src` returns 0.

**Contracts**
- Router search adds an optional `drawer: "export"`, which is stripped after open.
- `ChapterActionButton` passes `search={}` in the non-reexport case, the same as before.
- No API changes.

**Tests**
- `shortcuts.test.ts` and `export-warnings.test.ts` cover the plan's success criteria (`{failed:1, overflow:2, empty:1}`; inField, repeat and keyup O cases; `r` gives `ocr`).

## Plan status

Steps 1–6 are implemented, and the unit criteria are met. The e2e criteria are written (chapter-tools Esc/focus, editor segmented/hold O/split save, activity drawer on home and in the chapter) but were not run by me. The scope exclusions (page-range selection, per-page PNG) were accepted by the owner.

## Unresolved questions

1. Should Ctrl/Cmd+S save even while a drawer is open (L1)? The spec table says "cả trong ô" but is silent about drawers.
2. Should `viewMode` persist across chapters? Right now `reset()` returns it to "translated" for every chapter.
