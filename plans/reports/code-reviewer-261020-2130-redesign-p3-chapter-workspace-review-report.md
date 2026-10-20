# Code Review: Redesign P3, Chapter Workspace (continuous canvas)

Scope: uncommitted diff + untracked files on `feat/redesign-p3-chapter-workspace` (28 modified/deleted, 20 new files).
Focus: session/autosave/lock/recovery correctness, strip coordinate math, API contract.
Verified: `pnpm --filter @mtl/web exec vitest run` passes (18 files, 90 tests). No e2e run, per instructions.

**Score: 7/10.** The structure is sound and the lock policy is correct. Most of the old EditorPage logic carried over intact. The main risk is page switching inside one session, which the old per-page navigation never had to handle. Unsaved or unsaveable edits can disappear from view there, and the old recovery re-check on each page open is gone.

## High

### H1. Switching page with edits that cannot be saved hides them; later edits overwrite the IndexedDB record (data loss)
`apps/web/src/features/editor/use-chapter-session.ts:72-110`

`Saver.saveOnce` does nothing when `readOnly` is set (`save.ts:118`). It also fails on network errors (`retryLater`). `doActivate` runs up to 3 flushes. If the page is still dirty after that, it calls `persist()`, takes a snapshot of `prev.base` into the cache, stashes the history, and `load`s the new page anyway. `load` resets `save` to "saved", so the topbar shows "Đã lưu".

Failure scenario:
1. A heartbeat fails (lock `error`, so `lock_denied`), or a PUT returns 423 (`lock_lost`), or the network drops, while page 2 has unsaved edits.
2. The user clicks page 3. Page 2's edits now exist only in IndexedDB, and the UI shows saved.
3. The user goes back to page 2. It loads from the cache (base, without the edits). The stashed history has the same version, so it is restored, even though its patches were recorded against a doc that no longer exists. Undo is a no-op or applies inconsistently; redo re-applies the "lost" edits.
4. The user edits page 2. `persist()` overwrites the IndexedDB record with diff(base → new doc), and the earlier ops are gone for good.

The recovery scan runs once per mount (`scanned` ref), so nothing re-offers the record. This is a regression: the old `EditorPage` called `queue.get(pageId)` on every page load and showed "Khôi phục".

Fix (pick one):
- Refuse the switch while the page is dirty and `readOnly`/error is set: keep the current page and show "Chưa lưu được trang n".
- Or keep a per-page `unsaved` map `{base, baseVersion, doc}`. On return, call `load(base)` then `rebased(base, v, doc, [])`, and only reuse the stash when `prev.doc === prev.base`.
- Either way, in `doActivate` after `load`, call `queue.get(pageId)` and send a non-empty record through the recovery prompt or `deferred`, as the old editor did.
- Add a session test: A is dirty with `readOnly="lock_lost"` → `activate(B)` → `activate(A)` → doc keeps the edits, or the switch is refused.

## Medium

### M1. The recovery gate is skipped when the IndexedDB scan finishes after the lock is held
`use-chapter-session.ts:332-348`, `363-374`

`readOnly="recovery"` is only set when the lock moves to `held` from a stale reason. The scan waits for `statesReady`, which races with lock acquisition. If the lock wins, `readOnly` is already `null` when `recovery` arrives. The effect re-runs, but `null` is not in `stale`, so nothing changes.

Result: the prompt is shown but editing is allowed. Editing the active page (or a page activated next) overwrites that page's IndexedDB record.
- "Khôi phục" then replays the stale in-memory ops onto a base that already contains the new saves (duplicates or conflicts).
- "Bỏ" deletes the record that now holds the current unsaved edits (crash protection lost).

The outcome depends on network timing, so e2e may pass by chance.

Fix: in the lock effect, `if (st === "held" && recovery && s.readOnly === null) s.setReadOnly("recovery")`. Or set it in the scan's `.then` when the lock is held.

### M2. Activation does not block input; edits during the cache-miss fetch are discarded
`use-chapter-session.ts:78-104`

The snapshot (stash + `setCached(prev.base)`) is taken before `await this.deps.fetchPage(pageId)` on a cache miss. During that request the old page stays active and editable. When `load` runs, those edits are replaced and never saved or persisted. The pending Saver timers then act on the new page.

A cache miss happens for pages without a `page_states` row (`/states` drops them, `page-state.ts:124`), for example pages that failed at stage 1 in a `partial_failed` chapter, which is editable and holds the lock. A smaller window exists across `await saver.persist()` (line 79).

The plan's mitigation ("input bị chặn khi activating") is not implemented.

Fix: set an `activating` flag (or temporary `readOnly`) for the whole of `doActivate`. Or fetch before the snapshot and re-check `doc === base` right before `load`, looping back to flush if the page changed.

## Low

### L1. Stale `held` lock state when the lock is re-enabled
`use-chapter-lock.ts:55-84` with `use-chapter-session.ts:338-344`

Disabling the lock does not reset `state`. When `lockEnabled` turns true again (chapter settles after processing or `runAi`), the session effect still sees `held` during the commit where acquire has just started. It clears read-only and runs `saver.flush()`. If anything is dirty, the PUT can reach the server before the lock does: 423, a brief "Mất khoá", then a retry.

Fix: on disable, call `setState({status:"acquiring"})` in the hook's effect (when `!enabled`), or have the session effect ignore `held` until the first acquire after re-enable.

### L2. `restore()` captures `active` once
`use-chapter-session.ts:384-392`

The loop awaits `restoreOther` for each record in turn. If the user switches page meanwhile, `restoreActive` for the page that was active at the start returns silently (pageId mismatch). The record stays in IndexedDB with no prompt.

Fix: read `editorStore.getState().pageId` per item.

### L3. Export dialog opens without a flush
`apps/web/src/features/chapter/chapter-workspace.tsx:186`

Find & replace and glossary both flush first (`openTool`). Export does not, so an export started within about 2s of the last edit uses stale server state. Apply the same flush-then-open.

### L4. "Mở trang" in Find & replace leaves the dialog open
`apps/web/src/features/chapter/FindReplace.tsx:231`

The link targets the same route, so the workspace is not remounted and `dialog` stays `"find"`. The page activates behind the modal. Call `onClose` on click, or close the dialog when `searchPage` changes.

### L5. `partial_failed` chapter with 0 pages (ingest failed)
- The status bar shows "Đang cắt trang theo bóng thoại…" (`chapter-topbar.tsx:171`).
- The primary button is "Chạy lại trang lỗi", which does nothing because there are no pages.
- The server-supported recovery is `commit` (`apps/api/src/routes/chapters.ts:202`).

This matches the old page's behaviour, but `primaryAction` could map `partial_failed && pages===0` to `commit`.

### L6. Switching chapter via history reset the store before the old session's final save
`apps/web/src/app/router.tsx:146`, `use-chapter-session.ts:259`

With `key={chapterId}`, the new instance resets `editorStore` during render, before the old cleanup runs `finalSave`. So `finalSave` sees an empty store, and edits from the last ≤300ms (before the persist timer fires) are lost. This pattern existed before. It is only reachable with back/forward between chapters.

## Checks requested

**(a) Acceptance criteria:** met, apart from the activation input-blocking mitigation (M2).
- Layout widths follow the design (owner decision).
- `mtl.layout` is stored, and the panel starts collapsed below 1600px.
- 4-level page status and the 6-row primary table are implemented.
- Draft chapters show the upload status and drop zone.
- Lock policy follows chapter status.
- At most 4 `PageSlot`s are mounted.
- `?page=` uses replace with a 400ms debounce.
- One multi-page recovery notice is shown.
- Undo history is stashed per page.
- The redirect route exists.
- `rg "EditorPage|PageStrip|ChapterPage\b|canvas/Stage" apps/web/src` returns 0 hits.
- The vitest cases listed in the plan are present and pass.

**(b) Regressions:**
- Autosave, 409 rebase, 423 → `lock_lost` → retry, and the final-save-before-unlock cleanup order are all unchanged. The Saver effect is still declared before `useChapterLock`.
- `runAi` order is flush → pause → serial unlock → API. The server sets `processing` synchronously (`jobs/enqueue.ts:222,290`), so `refetchProgress` correctly keeps the session paused.
- `syncActive` only reloads a clean page whose save status is "saved"; `setStates` and `setCached` reject older versions.
- Rapid clicks: the target check works.
- The real regressions are H1, M1 and M2.

**Coordinate math:** correct.
- `toPage = screenToStrip − activeOff`.
- Mask, OCR and the text layer each sit in a `Group y=offset`. Drag and transform read node-local values, which are page coordinates.
- `TextEditOverlay` adds `activeOffset`.
- `focusRegion` goes through `focusPage(y + offset)`.
- OCR results are guarded by `pageId`.

**(c) Contract:** API changes are additive only.
- `/pages` keeps `image` and adds `images`.
- `/states` is tenant-scoped through `sdb.byId` and the scoped select, and has a tenant test.
- The `EditorPage` → `PageDetail` type rename is internal.

**(d) Patterns:**
- The code is consistent with the existing store, Saver and serial-lock patterns.
- `useStableImages` was moved, not duplicated.
- No new suppressions beyond the existing biome-ignore lines.

**(e) Tooling:** typecheck and lint were already green (per the request). Unit tests were re-run and pass.

## Unresolved questions
- H1: should a page switch be refused while the page is unsaveable, or should the dirty doc be carried per page? This is a product UX choice.
