# Code review: wheel page flip (1cac803)

## Scope
- Files: `apps/web/src/features/editor/wheel-page-flip.ts` (new), `editor/__tests__/wheel-page-flip.test.ts` (new), `editor/canvas/ChapterCanvas.tsx`, `chapter/chapter-workspace.tsx`, `e2e/editor.spec.ts`, `docs/editor.md`. About 310 added LOC.
- Checks: the unit test (11/11), `tsc --noEmit` and biome on the changed files all pass. E2e was not run, as instructed.
- Context checked: `ChapterSession.activate`/`doActivate` (they never reject, and the last request wins), `chapterStore.setActive` (calls `pageStartView`), `editorStore.load` (keeps the view), `clampView`/`pageStartView`, Konva 10.9 `Node.remove`→`stopDrag` and the wheel listener (`passive:false`), how `TextLayer` keys boxes, and how the worker builds box ids.

## Findings

### 1. MEDIUM: a wheel flip during a text-box drag moves the same-id box on the new page
- `ChapterCanvas.tsx:202`: the guard is `!gesture.current && !editing`. `gesture` only tracks the canvas pan, rect and paint gestures. A Konva node drag (`TextBoxNode` draggable) or a Transformer resize does not set it.
- Box ids repeat across pages. They are `tb-${region.id}` (`worker/mtl_pipeline/typeset.py:255`), and `region.id` is `r{i}` (`detect.py:167`). So `tb-r0`, `tb-r1`, ... exist on every page. `TextLayer.tsx:91` keys nodes by `b.id`, so after a page switch React keeps the same Konva node while it is still being dragged.
- Failure scenario: a sheet page is fitted to the frame, so it only scrolls about 48px. The user holds the mouse on box `tb-r0`, drags it, and scrolls 2 notches. The page flips. On release, `onDragEnd` runs `moveBox("tb-r0", x, y)` against the new page's doc. A box on the wrong page moves silently and is autosaved. If the new page has no box with that id, `Node.remove()`→`stopDrag()` fires `dragend` and nothing happens, but the drag is lost.
- Fix: skip flip detection while any pointer interaction is in progress, e.g. `if (!gesture.current && e.evt.buttons === 0 && !Konva.isDragging() && !Konva.isTransforming() && !editing)`. The `buttons === 0` check alone covers drag, transform and the canvas gestures.

### 2. MEDIUM: trackpad inertia keeps scrolling the new page, so "down lands at top / up lands at bottom" fails on tall pages
- `ChapterCanvas.tsx:219-220` and `wheel-page-flip.ts:58-61`: while locked, `stepFlip` returns `flip: 0` and `onWheel` goes on to `setView({... y: view.y - deltaY})`. The rest of a macOS fling (often hundreds of px over about 1s) is therefore applied to the page that just loaded.
- Failure scenario: on a tall webtoon page the user flicks down at the bottom edge. Page 2 opens at the top and inertia immediately scrolls it down by hundreds of px, so the top of page 2 is skipped. Flicking up works the same way: the user lands at the bottom and is pushed up.
- This goes against the user decision as the cook report and `docs/editor.md` describe it. Neither e2e nor unit tests check where the user lands (the cook report lists this as open).
- Fix: have `stepFlip` return `locked: boolean`. When a flip lock is active, call `preventDefault` and return without `setView`, so wheel events are dropped until the 300ms pause. Trade-off: a real new gesture that starts less than 300ms after inertia is dropped until the pause. This needs a product decision if inertia carry-over is wanted for continuous reading.

### 3. LOW: edge detection reads `view` from the render closure
- `ChapterCanvas.tsx:203-213`: `atTop`/`atBottom`/`ph` use the `view` captured when the component rendered. If two wheel events arrive before React re-renders (wheel is continuous priority), the second one sees a view before the scroll. The accumulator resets wrongly, so flipping just becomes stiffer. It cannot cause an extra flip.
- The existing pan code `view.y - deltaY` has the same staleness, so this is not a regression. Fix: `const v = editorStore.getState().view` at the top of `onWheel`, and use it for both the edge check and the pan.

### 4. LOW: the e2e test proves less than its comment claims
- `e2e/editor.spec.ts:978-983`, "inertia does not flip on to page 3": there is one 100px wheel after the flip, and 100 < `FLIP_THRESHOLD` (160). It cannot flip whether or not the lock exists, so it does not test the lock. The unit test `wheel-page-flip.test.ts:56-71` is what actually covers inertia.
- The whole e2e runs after Ctrl+wheel has zoomed out (the page fits, so it is at both edges). The real case, a page taller than the frame with the start view at `FIT_EDGE`=16 vs the edge test at `EDGE`=40, is never tested. Landing at the bottom and the reduced-motion animation skip are not asserted either.
- Fix: in e2e, flip from a page taller than the frame (keep the fit scale) and send two 100px wheels without waiting after the flip. Add a unit or e2e check of the view y after flipping up. Add a test for finding 1's guard.

### 5. LOW: discoverability
- `apps/web/src/features/editor/shortcuts.ts:59`: the help table lists "Ctrl/Cmd+scroll" but not "scroll past the edge = next/previous page". Optional: add a row.

## Verified non-issues
- `preventDefault` / passive: Konva 10.9 binds wheel with `{passive:false}` (`Stage.js:395`), and `preventDefault` was already the first line before this change. Native page scroll and browser zoom stay blocked as before.
- Zoom and pinch: Ctrl/Cmd (pinch sets `ctrlKey`) and Shift go through `modified` and leave the state untouched. The zoom path is unchanged.
- Panels, dropdowns, textarea overlay: these are DOM siblings of the Stage, so their wheel events never reach `onWheel`. `editing` also blocks the flip while the textarea is open.
- Matching `clampView`: the `fits` formula and the ±0.5 bounds match `clampView` exactly (every view setter goes through `clampView`), so fractional values are fine. Split mode uses `content.h` = `page.h`.
- deltaMode: lines are 16px and pages use the frame height. `deltaY` is read before `deltaMode`, so Firefox reports pixels anyway.
- Errors and races: `ChapterSession.activate` catches and routes to `onError`, so it never rejects. `flipping` resets in `finally`. A failed save (`UnsavedPageError`) leaves `activePageId` unchanged and `flipTo` returns. Leaving the chapter during the await resets `activePageId`, so it returns too. `wrapRef.current?.animate` is null-safe. Cooldown (≥600ms) is longer than the animation (200ms). `load` keeps the view, and the canvas fit/resize effects do not run on a page change (`lastFit`/`lastSize`), so the bottom landing is not overwritten. A missed `refreshAi` reload also keeps the view.
- Re-registration: `onWheel` is recreated on each render (as it was before). The flip state lives in refs, so it survives. `activateAwait` is a stable `useCallback`, so the `memo` canvas is not broken.
- Read-only / `page_busy`: navigation is allowed, the same as the pager.

## Recommended actions
1. Add the `e.evt.buttons === 0` (or `Konva.isDragging()/isTransforming()`) guard, with a test (finding 1).
2. Decide whether post-flip inertia should be dropped. If yes, add a `locked` result and drop the pan (finding 2).
3. Optional: read the view live in `onWheel`, tighten the e2e, add the help row.

## Unresolved questions
- Should inertia after a flip carry into the new page (continuous reading), or should landing at the top/bottom be strict as the user decision says?

## Re-review b090677

Scope: `git show b090677` only (the working tree is being edited concurrently). The unit test passes (13/13). E2e was not run. Konva 10.9 sources checked: `Stage._pointerleave`/`_pointerup`/`_pointercancel` and `DragAndDrop._listenToWindow`.

### Fix status
- Finding 1 (flip during drag): mostly fixed, but the fix adds a stuck-state regression (R1 below).
- Finding 2 (inertia on the new page): fixed. `locked` is true for the flip event and every continuous event after it. Zoom and horizontal events are not swallowed.
- Finding 3 (stale view): fixed for the edge check, the pan and the zoom anchor.
- Finding 4 (weak e2e): fixed. The test now covers a tall page, a wheel with a button held, two wheels right after the flip, and the landing y for both directions.
- Finding 5 (help row): fixed.
- Top edge 40 to 16: correct. `pageStartView` = `clampView(y = FIT_EDGE)`, so a newly landed page always has y in [16, 40] or counts as `fits`. This holds at every scale, including a kept zoom, and in split mode (`content.h = page.h`). Bottom landing uses the exact `clampView` limit, which matches `atBottom` (±0.5). No code path lands at the bottom with a FIT_EDGE margin, so the asymmetry has no effect.

### R1. MEDIUM: `held` gets stuck true after a box drag or resize is released outside the Stage, and wheel flips stop working
- `ChapterCanvas.tsx:241` sets `held` and only `onUp` clears it (`:294`, wired to Stage `onPointerUp`/`onPointerLeave` at `:335-336`). `busy: held.current || …` (`:223`).
- Konva `Stage._pointerleave` does not fire `pointerleave` while a node is being dragged or a Transformer is transforming (`_pointerEventsEnabled()` returns false). Konva ends the drag on a window `mouseup` (`DragAndDrop.js:32,38`). The native `pointerup` goes to whatever element is under the cursor, not the stage content.
- Scenario: the user drags a box (or a resize handle) past the canvas frame and releases over the panel or the page column. `held` stays true. When they come back, scrolling past the edge never turns the page. It recovers only after the next press and release on the canvas. Right-click or Ctrl+click opening the native context menu (which can eat the mouseup) is a likely second trigger. That one is unverified.
- Fix: drop the ref and derive busy from sources that reset themselves: `busy: e.evt.buttons !== 0 || Konva.isDragging() || Konva.isTransforming()`. This needs a value `import Konva from "konva"`. `gesture.current` already skips the pan, rect and paint gestures. Alternatively, clear `held` in a `useEffect` with window `pointerup`/`pointercancel`/`blur` listeners.

### R2. LOW: the lock swallows deliberate scrolling, including a reversal, with no upper bound
- `wheel-page-flip.ts:64-70`: any vertical event with a gap under 300ms extends the lock and is swallowed, whatever its direction.
- Scenario: a mouse-wheel user scrolling continuously through the chapter (notches about 100ms apart) flips and then sees a frozen page until they pause for 300ms. A user who overshoots and immediately scrolls back up is also swallowed, and the lock keeps extending. Inertia never reverses direction.
- This is the strict-landing trade-off that was accepted. Optional refinement: store the flip direction. While locked, if `dir` differs from the lock direction, return `locked: false` (pan, but no flip, while `lockUntil` holds). Optionally also cap the lock at about 1.5s after the flip.

### R3. LOW: the e2e lock assertion depends on API latency
- `e2e/editor.spec.ts:1043-1048`: the lock is timed from the flip event (600ms), but `expect(foot)…"Trang 2"` waits for save plus load first. If that takes more than about 500ms, the next two wheels arrive after the lock has ended, scroll page 2, and `toBe(top.y)` fails. Fix: send the two wheels before awaiting the pager text, or assert `y` with `expect.poll` on the landing value.

### Verified non-issues
- E2e `import("/src/features/editor/store.ts")`: `playwright.config.ts` always starts `vite` dev (`reuseExistingServer: false`). On a fresh load the app imports the same URL, so it is the same module instance. This would break against `vite preview` or a built bundle. CI only runs `typeset-parity`, and `tsconfig` does not include `e2e/`, so neither typecheck nor CI is affected.
- The pan gesture leaving the Stage: no Konva drag is in progress, so `pointerleave` fires and clears both `held` and `gesture`.
- A slow page switch (save plus load) during inertia: the lock stays on while events keep coming and the old page is not scrolled. A second flip is blocked by `flipping`.
- Stale `content`/`size`/`activeId` in the closure next to a fresh `view`: only for the few ms before React commits. Locked events never reach `setView`.
