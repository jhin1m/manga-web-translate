# Wheel page flip (cook report)

## Findings
- Wheel handled in `ChapterCanvas.onWheel` (Konva Stage): Ctrl/Cmd = zoom (pinch = ctrlKey wheel), Shift = horizontal, else pan within page (`clampView`). Textarea overlay is a DOM sibling of the Stage, so wheel there never reaches `onWheel`.
- Page switch = `ChapterSession.activate` (promise chain: flush old page, stash history, load new, `chapterStore.setActive` sets start view at top). Reused as-is via new `onActivate` prop (workspace `activateAwait`, same as pager's `activate` but returns the promise).

## Design
- `editor/wheel-page-flip.ts`: pure `stepFlip(state, input) -> {state, flip}`.
- Thresholds: 160px accumulated overscroll (1 mouse notch ~100 does not flip, 2 notches or one trackpad flick does; deltaMode line=16px, page=frame height); pause 300ms resets accumulator / ends inertia; cooldown 600ms after a flip, extended while wheel events keep arriving < 300ms apart (trackpad inertia cannot chain flips).
- Ignored (state untouched): Ctrl/Cmd/Shift, |deltaX| > |deltaY|, zero delta. Direction change, leaving edge, no neighbour page -> accumulator reset.
- Canvas: edge = view.y at clamp bound (+-0.5px); page fits frame = both edges. Skipped while a pointer gesture is active or text is being edited. In-flight guard against double activate.
- Landing: down -> top (existing start view); up -> bottom (view y clamped to bottom, done after activate resolves). If activate did not switch (error), nothing happens.
- Transition: Web Animations on `.ed-canvas` wrapper, 200ms ease-out, opacity .2->1 + translateY(+-28px) in scroll direction, played after new page is in; skipped under `prefers-reduced-motion: reduce` (instant).

## Files
- new apps/web/src/features/editor/wheel-page-flip.ts, __tests__/wheel-page-flip.test.ts
- edit editor/canvas/ChapterCanvas.tsx, chapter/chapter-workspace.tsx, e2e/editor.spec.ts, docs/editor.md

## Tests
- Unit: red first (module missing -> "no tests"/import failure), then 11 pass (threshold, accumulate, up, cooldown+inertia, direction reset, edge-leave reset, pause reset, modifier, horizontal, first/last, deltaMode). One test needed fixing (my inertia sequence had a >300ms gap), not the module.
- `pnpm --filter @mtl/web test` 297 pass; typecheck, lint clean.
- e2e new test: small wheel no flip, Ctrl+wheel no flip, up at first page no-op, down -> page 2, inertia no skip to 3, up -> page 1, reduced-motion still flips. Passed. Editor, click-budget, chapter-tools, proofread, typeset-parity e2e: 26 pass.

## Open items
- Landing-at-bottom and the animation are not asserted in e2e (timing/visual); verified by code path only.
- Mouse-wheel users with a tall zoomed page need 2 notches past the edge; tweak `FLIP_THRESHOLD` if too eager/stiff.
- commit 1cac803

## Review fixes
1. Busy guard: `WheelInput.busy` (pointer held on Stage via ref set in onDown/cleared in onUp, or `wheel.buttons != 0`) -> never flips, state untouched. Playwright's wheel reports buttons=0, hence the ref. Unit test + e2e (mouse down + wheel).
2. Strict landing: `stepFlip` returns `locked` (flip itself + inertia while lock active); canvas drops those wheel events (no pan). Zoom/horizontal/busy events are not swallowed. Unit test + e2e (two wheels right after flip: still page 2, view.y unchanged and > 0).
3. Fresh `editorStore.getState().view` in onWheel (also used for zoom anchor).
4. e2e: page 720x1000 is taller than frame at fit (scrolls to bottom first); asserts landing top after down, landing bottom (view.y < 0) after up. Reads view through dev-server module import.
5. Shortcuts help row "Cuộn quá mép trang".
- Found while testing: freshly landed top sits at FIT_EDGE (16) < clampView EDGE (40), so scrolling up could never flip without first panning; atTop now uses FIT_EDGE.

## Review fixes round 2
1. `held` ref removed (could stick when a drag/resize is released off the Stage). `busy` = `e.evt.buttons !== 0 || Konva.isDragging() || Konva.isTransforming()` (all self-resetting). e2e: real mouse.down on a seeded box, drag, wheel past the edge -> still page 1 (verified red with the Konva checks removed); release outside the Stage (top bar), wait for save, wheel -> flips to page 2.
2. Lock: `FlipState` gains `lockDir` + `lockCap`. While locked, an opposite-direction event returns `locked:false, flip:0` (scrolls the page, cannot flip, lock unchanged); lock extension capped at `FLIP_LOCK_MAX_MS` = 1500ms after the flip. Two unit tests.
3. e2e: flip wheel + two follow-up wheels sent back-to-back before awaiting pager text; landing y checked with expect.poll (0 < y <= 40). `--repeat-each=3` passes.
