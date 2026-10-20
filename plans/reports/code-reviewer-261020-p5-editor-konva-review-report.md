# Code review — Phase 5 editor react-konva (`9d2e564..HEAD`, 5 commits)

Scope: 52 files, +4473/−20. API `apps/api/src/routes/page-state.ts` + tests; web `apps/web/src/features/editor/**`; touchpoints app.ts, router.tsx, tenant-isolation test, biome.json, packages/shared/src/page-state.ts.
Baseline re-run: `pnpm typecheck` OK, `pnpm lint` OK (154 files), `pnpm test` OK (shared 8, web 40 + font drift check, db 3, api 89). E2E not run (owned by another agent).

## Overall
The API is solid: it uses scoped `sdb`, version-conflict handling is atomic (`WHERE version = expected` inside a tx), the mask key is bound to the ws+page prefix, and tenant-isolation cases were added. The weak spots are on the client, in the lifecycle around lock, save and unmount, and in some edge cases where data can silently be lost. All zustand selectors return primitives or existing references, so there is no zustand v5 render-loop risk.

## Critical
None (no tenant leak, no blind overwrite on the server).

## High

1. **Leaving the editor drops autosave: unlock runs before the final PUT.** `EditorPage.tsx:60` (`useChapterLock`) declares its effect before the saver effect (`EditorPage.tsx:95-119`). On unmount React runs cleanups in declaration order, so `unlockChapter` (`use-chapter-lock.ts:81`) is sent before the `flush()` → PUT. The server then returns 423, the Saver flips to `lock_lost`, and the edits stay only in IndexedDB. Trigger: click "← Chương" (`Toolbar.tsx:39`, a plain Link that does not flush) within 2s of an edit. `pagehide` has the same order: the keepalive DELETE fires before the PUT, and the PUT is not keepalive. This breaks the spec requirement "Autosave … + khi rời trang". The e2e only covers reload, not navigating back to the chapter.
   Fix: `await saver.flush()` before navigating away from the editor (wrap the back Link like `goTo` does). Also release the lock only after the save chain finishes, e.g. pass `useChapterLock` a `beforeRelease` hook, or move lock ownership into a component that wraps the saver.

2. **Read-only stuck after `lock_lost` when the heartbeat takes the lock back.** `EditorPage.tsx:122-133` depends only on `lock.state.status`. Scenario: the user is idle for more than 14 minutes, the heartbeat stops, and the server lock expires while the hook still shows `held`. The user edits, the PUT gets 423, and the store goes to `lock_lost`. The next heartbeat succeeds and calls `setState({status:"held"})`, but the status string has not changed, so the effect does not re-run and the editor stays read-only until reload.
   Fix: depend on `lock.state` (the object) or `expiresAt`. Or on 423, have the Saver call `lock.retry()` and then flush.

3. **TileLayer closes tile bitmaps that are still attached to a `KImage`.** `TileLayer.tsx:80-86`: the cleanup closes all tiles and swaps `cache.current` but schedules no re-render. The render that has just committed (bitmap → null when toggling `\` or when clean_rev changes) still points the `KImage` nodes at the old tiles. If Konva's `batchDraw` (rAF) runs after the passive effect, `drawImage` on a closed `ImageBitmap` throws InvalidStateError ("image source is detached"). This hits the before/after toggle, which is used often.
   Fix: call `bump()` after the reset, or keep the old tiles until the new ones are ready and close them after the next draw (`layer.batchDraw()` then rAF → close). Another option is to add `revKey` to the `KImage` key so the old nodes unmount before close.

## Medium

4. **Save errors leave status stuck on "saving" with no retry.** `save.ts:91-99`: if `api.get` (in the 409 branch) or `persist()` (`save.ts:80`, `:86`, `:98`) throws, the error escapes `saveOnce` and `flush` swallows it (`save.ts:53`). No retry timer is set, so the status stays "saving". If IndexedDB fails (quota, Safari private mode, or `indexedDB` undefined in `pending-queue.ts:28` at module load), autosave never sends a PUT at all. The `persist` rejection from `schedule()` is also an unhandled rejection.
   Fix: put a separate try/catch around persist (log it and continue the PUT), and route the 409 GET into the same error/retry branch.

5. **Zombie Saver after unmount.** `EditorPage.tsx:116-117` calls `flush()` then `dispose()`. If that last `saveOnce` hits a network error, it sets a new `saveTimer` (`save.ts:107-108`) after dispose, so the old Saver keeps retrying every 5s against the singleton `editorStore`. On the next editor mount (possibly another page or chapter) two Savers race on the same store, which breaks single-flight, and a resulting 409 wipes the new session's undo history.
   Fix: add a `disposed` flag that blocks rescheduling and set-state calls.

6. **Singleton `editorStore` is never reset on unmount** (`store.ts:182`). The previous session's doc, base, readOnly and mask carry over into the next mount. Panels read `s.doc` before `load`, so they briefly show the old page, and the old Saver/flush can PUT a stale doc. Fix: reset to `initial()` in the EditorPage cleanup, after the final flush.

7. **Conflicts live only in memory.** `store.ts:40` and `load()` (`store.ts:98-110`) reset `conflicts`. After a 409 rebase, the conflicting local values are removed from `doc`, and `persist()` writes base→doc without them. Switching pages (`goTo`) or a crash therefore loses the unresolved edits with no trace, which contradicts "không mất patch, liệt kê bỏ/khôi phục". Fix: store the conflicts in the `PendingRecord`, or block page switching while conflicts remain.

8. **Every 409 wipes undo history, even when the server state is unchanged.** `store.ts:155-166`. When a chapter is locked, the AI writer (`page-state-writer.ts:36-44`) only bumps `version` and `ai_state` and leaves `state` alone. Each AI re-run while the user is editing therefore causes a 409 and loses the whole undo stack (spec: ≥ 100 steps). Fix: if `same(server.state, base)`, just update `baseVersion` and re-PUT without touching history.

9. **AI banner is not refreshed during the session.** `EditorPage.tsx:84-87`: `Saver.get` throws away `ai_state`, `ai_rev` and `ai_update_available`. When an AI write causes a 409, `store.ai` stays stale, so the banner does not appear until reload or reinpaint. Fix: call `setAi(...)` inside `get`.

10. **Presigned image URLs expire after 15 minutes** (`MAX_GET_TTL_S`). `useBitmap` re-fetches the URL on every `\` toggle (`TileLayer.tsx:32-55`, keyed by revKey). After 15 minutes the toggle returns 403 and shows an image error. The client ignores `expires_at`. Toggling also re-downloads and re-decodes the whole 12k–20k px image each time, so before/after comparison is slow. Fix: keep both bitmaps (original and clean) in memory, or have each TileLayer keep its own bitmap, and refresh the URLs from `expires_at` or on a 403.

11. **`pruneHistory` in the route duplicates the writer and is heavy.** `page-state.ts:57-66` selects every history row including the `state` jsonb (≤ 51 full states) on every autosave (about every 2s while typing). The exported `pruneHistory` in `page-state-writer.ts:52` already selects only `version` with offset/limit. This is also a retention problem: 50 snapshots ≈ 100s of continuous typing, so AI and older versions are pushed out of `page_state_history` very quickly. Fix: select only `version`, or extend Scoped with a projection; consider coalescing user history (for example, insert at most one history row per N minutes per actor).

12. **IndexedDB is keyed only by `pageId`.** `pending-queue.ts:33`. The lock is per user, not per tab, so two tabs from the same user on one page overwrite each other's pending record, and recovery may restore the other tab's ops. Fix: guard with a BroadcastChannel, or key by `(pageId, tabId)`.

## Low

13. `store.resolveConflict` (`store.ts:172-177`) removes the conflict even when `apply` was a no-op (readOnly). The UI disables the button, but the store API itself is unsafe. Only filter the conflict out when `apply` actually ran.
14. OCR bbox can be rounded out of the page: `useOcrRegion` (`OcrSelect.tsx:37-42`) rounds x and w separately, so x+w can be page.w+1 and the server returns 400 `bbox_out_of_page`. Use floor/ceil, then clamp.
15. With the OCR tool and readOnly, `Stage.tsx:132` still lets the user drag and enqueue a job, but `apply` no-ops and the result is silently dropped (wasted worker run). Block it or show a message.
16. `waitJob` (`api.ts:64-80`) adds an abort listener on every poll and never removes it, and does not check `signal.aborted` before the loop.
17. Reinpaint does not check `offset` or mask size against the page (`page-state.ts:153-176`). The PNG IHDR is in the first 24 bytes, so `readPrefix(24)` would give w/h for a bounds check. Defense in depth; it depends on whether the worker clamps.
18. `assertChapterLock` runs outside the PUT transaction (TOCTOU with lock steal). `If-Match` covers state integrity, so the risk is low.
19. Restoring idempotent ops (crash after a successful PUT) still produces a doc that is a different reference, so it PUTs an identical state and bumps version plus history needlessly. The banner also counts N changes that are not real.
20. Transformer lookup `findOne('#'+CSS.escape(id))` (`TextLayer.tsx:38`): Konva's selector does not understand CSS escapes, so it breaks if an id starts with a digit. Current ids (`tb-…`, `r…`) are fine. Prefer `findOne((n) => n.id() === selection)`.
21. The global Space keydown `preventDefault` (`Stage.tsx:88-91`) blocks activating focused buttons with Space (a11y).
22. Brush `onMove` copies the whole points array on every move (O(n²) for long strokes) and re-renders MaskLayer and MaskPanel each time.
23. Reinpaint key validation is duplicated between the route and `enqueueReinpaint` (DRY, not wrong).

## Specific checks requested

- **(a) Acceptance:**
  - Met: undo 120 mixed operations (unit, through `history.ts` directly — not through store coalescing); 409 rebase lists conflicts (unit, save.test); crash recovery (unit + e2e, e2e not re-run here); AI banner and per-region apply; page strip and arrow-key navigation through a chapter.
  - Partial: "không mất patch" — conflicts are lost on page switch or crash (#7); the banner only refreshes on reload (#9).
  - Not measurable here: 12k/20k open time < 2s, ≥ 50fps, Safari 18 (note: the full-page source ImageBitmap 800×20000 = 16M px is close to the iOS limit, and wider pages exceed it), reinpaint ≤ 15s, how VI stacked diacritics actually render (manifest says `viComplete: true` for all fonts).
  - Plan step 11 asks for Playwright "undo 100 bước" — not in the e2e.
- **(b) Touchpoints:** app.ts adds one route registration; router.tsx swaps only the component, and the imports still in use (`Link`) are fine; tenant-isolation only appends cases, and the bodies are valid so the cross-ws check reaches 404; biome ignores `apps/web/public/fonts` (it only holds ttf + manifest, OK); `packages/shared/src/page-state.ts` changes only a comment. No regression found.
- **(c) Public contract:** no breaking change. The new endpoints match the spec. `EditorPage.state: PageState | null` on the client is looser than the server, which is harmless.
- **(d) Patterns:** routes follow the existing pattern (`requireWorkspace`, `parseJson`, `sdb.byId`, `jobView`, `inJobTx`). `pruneHistory` reimplements the writer's version (#11).
- **(e) Correctness:**
  - Version conflict is atomic; OK.
  - Mask key: the prefix is bound to ws+page and the POST policy has a fixed key, a PNG content-type and ≤ 5MB; OK.
  - Transformer rotation math with the offset at the center: correct. After scaling, the offset point still maps to `(node.x(), node.y())` = new center, so `x = cx − w'/2`; it is consistent with the contract (rotation around the box center) and with the textarea overlay (`transform-origin: center`).
  - History coalescing: the merge order of patches/inverse is correct, and undo clears the key on the redo entry; OK.
  - Races and state machine: see #1, #2, #4–#8.
  - measure.ts matches typeset.py (MIN/MAX, binary search, greedy wrap, hard wrap); the only difference is `\n`, which is documented.
  - Text drawing uses a custom Shape, stroke-then-fill with `lineWidth = 2w` and round join; this follows the contract.
  - Design: no gradient or glass; the accent `#1f4fd1` matches `--c-accent`.

## Recommended order
1. #1 (flush before unlock or navigation), #2 (lock state dependency), #3 (tile close).
2. #4, #5, #6 (Saver/store lifecycle).
3. #7, #8, #9 (no edit loss, keep undo, AI banner).
4. #10, #11; the rest as convenient.

## Unresolved questions
1. Should rebase-conflict loss on page switch be blocked (prompt), or should conflicts be persisted to IndexedDB? This is a product decision.
2. Does the worker `page.reinpaint` clamp `offset` + mask size to the page? If not, #17 should be raised in priority.
3. Should user history in `page_state_history` be kept per autosave (current behavior, very fast churn), or coalesced by time/actor? This affects how much AI history can be recovered.
4. Is opening one page in two tabs as the same user a supported scenario (#12)?
5. Can the Safari 18 / iOS check with 20k px pages run on a real device? A full-page source bitmap might hit the decoded-image limit.

Status: DONE_WITH_CONCERNS
Summary: The API is correct and tenant-safe. The web editor is functionally complete, but leaving the editor loses the autosave (unlock runs before the PUT), read-only can get stuck after lock_lost, and TileLayer can draw closed bitmaps.
Concerns/Blockers: Fix #1–#3 before merge; #4–#9 affect the "không mất chỉnh sửa" requirement.

## Re-review (fix commit 8b11ab3)

Scope: `git diff 51dcba9..8b11ab3` (12 files). I read the code; I did not re-run the gates (reported green: typecheck, lint, unit, e2e 2/2). The server lock is per user (`chapter-lock.ts:28-45`, `assertChapterLock` compares only `userId`), and the reasoning below relies on that.

### Verdict per item
| # | Verdict | Notes |
|---|---|---|
| 1 final save before unlock | **Fixed for in-app navigation; tab close is partial** | `back()` flushes before navigating. `finalSave` (`EditorPage.tsx:42-55`) retakes the lock after a 423, then flushes and unlocks. `saveOnce` persists to IndexedDB before the PUT, so a failed retake still leaves a draft. Cleanups run in declaration order, so the `retryLock` subscription is gone before the 423 arrives (no stray `acquire`). **Still open:** on `pagehide` the lock hook's keepalive DELETE (`use-chapter-lock.ts:75`, registered first) fires before the editor's PUT, which is not keepalive (`EditorPage.tsx:131`). Tab close or hard navigation therefore still depends on IndexedDB recovery. Acceptable given the e2e crash coverage; document it as known. |
| 2 lock state dependency + retry | **Fixed** | The effect depends on `lock.state`, so every heartbeat re-runs it (cheap, idempotent). On the transition to `lock_lost` it calls `retry()` once. With per-user locks, a `held` → 423 loop only happens if another tab of the same user unlocks in between, and that converges. |
| 3 tile close | **Fixed** | The map is swapped at render time, keyed by the source bitmap, so the committed `KImage` nodes stop referencing old tiles, and old tiles are closed 1s later. StrictMode double render: the second pass sees `src === bitmap`, so it does not swap or schedule a second timer. A discarded concurrent render leaves the ref already swapped, but the next render computes the same thing, so it is idempotent. Late `createImageBitmap` results check `map !== cache.current.map` and close themselves. The StrictMode mount→cleanup→mount `closeAll` runs on an empty map (bitmap is still null at mount). The e2e toggles `\` 4× with `pageerror` = []. |
| 4 save errors | **Fixed** | `persist` catches; the failure path for the 409 reload goes to `retryLater` (error status, retry timer). A test covers it. |
| 5 zombie Saver | **Fixed** | The `disposed` flag stops `schedule` and the retry timer. `start()` re-arms it after the StrictMode double effect. `flush` still works after dispose, which `finalSave` needs. |
| 6 store reset | **Fixed (on mount)** | `useState(() => reset())`: StrictMode runs the initializer twice, which is harmless. The router reuses `EditorPage` across chapter and page params (`router.tsx:126-128`, no key), so this only runs on a real mount from another route. At that point no other component subscribes to the store, so you get no "update while rendering another component" warning. |
| 8 undo kept when server unchanged | **Fixed** | `same(server, s.base)` keeps history. A unit test covers the version-only bump plus undo. |
| 9 AI info on 409 | **Fixed** | |
| 10 URL expiry / re-decode | **Fixed, with a new perf cost** (see N1) | A 10-minute `reloadImages` interval refreshes the URLs. `revKey` is stable, so no re-decode. The original layer stays mounted after the first compare. |
| 13 / 14 / 15 / 16 / 19 / 20 / 21 | **Fixed** | `resolveConflict` guards readOnly. The OCR bbox uses floor/ceil and is clamped to the page. OCR is blocked in readOnly. `waitJob` removes its listener and calls `throwIfAborted`. A restore whose result equals the base deletes the record instead of PUTting. `findOne` now uses a predicate. Space is skipped on buttons. |
| 7, 11, 12, 17, 18, 22, 23 | Not addressed (not claimed) | Carry over. |

`originalFor` set during render (`Stage.tsx:185-187`) uses the supported "adjust state while rendering" pattern. It is guarded by `originalFor !== pageId`, so it cannot loop and the extra render is synchronous.

### New findings
- **N1 (Medium, perf/memory): hidden TileLayers keep cutting tiles.** `TileLayer.tsx:101-129`: the tile-cut effect ignores `visible`, so on every scroll or zoom the hidden layer (clean while viewing the original, or the original after the first compare) also runs `createImageBitmap` for the viewport ±1. Both full-page source bitmaps also stay decoded: an 800×20000 RGBA page is about 64 MB each, so about 128 MB plus tiles. That matters on iOS Safari (open question #5). Fix: skip the cut effect when `visible === false` (keep the existing tiles; add `visible` to the deps so the cut runs on show).
- **N2 (Low): `finalSave` lock ops bypass the hook's `serial` chain.** `EditorPage.tsx:46,53`: `lockChapter`/`unlockChapter` are not serialized with `use-chapter-lock.ts` `serial()`. If the user re-enters the same chapter's editor while a `lock_lost` final save is still in flight, the `finally` unlock can land after the new mount's lock and silently release it (same user). This self-heals: the next PUT gets 423, then `lock_lost`, then `retry`. Fix: export `serial` and wrap both calls.
- **N3 (Low): `finalSave` can mutate the next session's store.** `EditorPage.tsx:48`: `s.setReadOnly(null)` runs after `await lockChapter`. If a new editor mounted meanwhile (`reset()` at :79), it clears that session's `"loading"` before its own lock is `held`. Then the old Saver's `flush` runs against the new store. If it is the same page, it is a harmless duplicate PUT; otherwise it is a no-op. Guard: capture `pageId`/`doc` before the await and bail if `editorStore.getState().pageId` changed, or use a session token.
- **N4 (Low, UX): a final save interrupted by a fast re-entry still shows the recovery prompt.** When `reset()` runs mid-PUT, the old `saveOnce` returns before `saved()` and `persist()`, so the IndexedDB record survives. The new `restore` same-state check deletes it on accept, but the user is still asked. Optional: if `rebase(base, ops)` equals the base at load time, delete the record silently in the load effect instead of prompting.

### Re-review verdict
All 3 Highs are resolved for in-app flows. Mediums #4, #5, #6, #8, #9 and #10 are fixed, and so are the claimed Lows. No new Critical or High. N1 is the only item worth fixing before the iOS check. N2 to N4 are narrow races that self-heal.
