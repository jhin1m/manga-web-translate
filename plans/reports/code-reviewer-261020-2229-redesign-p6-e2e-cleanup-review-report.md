# Code Review: redesign P6 (full-flow e2e, dead-code cleanup, cross-chapter save fix)

## Scope
- Files: 16 modified + 2 new specs (apps/web/e2e/*, apps/web/src/features/{editor,chapter,upload}, styles/tokens.css, packages/db/src/testing.ts); docs diff only skimmed (owned by the docs-manager report)
- LOC: about +217 / -124 in code, plus about 150 in new specs
- Verified: `pnpm typecheck` passes, `pnpm lint` (biome, 234 files) is clean. I did not run any tests, as instructed.
- Score: **8/10**

## Overall Assessment
The phase is in good shape. The acceptance criteria that the code can show are met. The cleanup is real: I checked the removed symbols with rg and found no leftover users, and every plan "Delete" file is already gone. The cross-chapter save fix is correct for the main case, and the ordering it claims (detached PUT → finalSave → unlock) holds. One edge case in the fix leaves a false recovery prompt and can push the last edit into IndexedDB-only. No public contract breaks.

## Critical Issues
None.

## High Priority
None.

## Medium Priority

**M1. `flushDetached` collides with an autosave PUT that is already in flight. It gets a 409 and leaves a stale IndexedDB record behind.** `apps/web/src/features/editor/save.ts:99-112`
Sequence:
1. The 2s debounce fires, and `saveOnce` sends `sent` with `baseVersion=v`.
2. The user presses back or forward, so `flushDetached` takes a snapshot with `base` and `baseVersion=v`. These are stale, because `saved()` has not run yet.
3. The in-flight PUT returns 200 (server is now at `v+1`). The pageId guard at `save.ts:150` returns early because the store was already reset. So `saved()` and `persist()` are skipped, and the pre-PUT IndexedDB record stays.
4. The detached closure sends `PUT(doc, v)`, which returns 409. The error is swallowed and the record stays.

Impact: the next time the user opens chapter A, they see a recovery banner for edits that are already on the server (the scan at `use-chapter-session.ts:419` only checks `ops.length > 0`). If the user typed more after `sent`, those extra edits never reach the server and exist only in IndexedDB until the user accepts recovery. No data is lost, but this is exactly the window the fix targets: an edit, then a quick navigation, while the debounce has just fired.

Fix (pick one):
- In the detached closure, handle a 409 the same way `saveOnce` does: `GET` the page, `rebase(server.state, diffStates(snap.base, snap.doc))`, then PUT once more at `server.version`. The old chapter's lock is still held at that point, so the retry is safe. This also covers server-side find and replace.
- Or record `lastPut = { pageId, sent, version }` in `saveOnce` before the pageId guard. In the closure, if `lastPut.pageId === snap.pageId`: when `snap.doc === lastPut.sent`, call `queue.delete` and stop; otherwise PUT with `lastPut.version`.

Add a unit test with a PUT that is still pending when `flushDetached()` is called. The current tests at `save.test.ts:195-228` only cover an idle chain.

**M2. Three copies of the "create + upload + commit + fake worker until ready" helper.** `apps/web/e2e/helpers.ts:31-71` has the new `apiReadyChapter`. `apps/web/e2e/editor.spec.ts:20-77` (`committedChapter`/`runUntil`/`readyChapter`) and `apps/web/e2e/chapter-tools.spec.ts:24-63` still have their own versions. `editor.spec.ts` now imports both styles. Either switch `editor.spec`'s `committedChapter` to call a shared `apiCommittedChapter` that `apiReadyChapter` builds on, or keep this as a known follow-up. It is a DRY issue, not a correctness bug.

## Low Priority

- **L1.** `save.ts:110` uses `.catch(() => undefined)`. A detached failure (409, 423, or network error) leaves no trace. Add `console.warn("[editor] lượt lưu cuối khi đổi chương lỗi", e)` to match `persistSnapshot` (`save.ts:129`). Otherwise an M1-style problem can only be diagnosed from a recovery banner.
- **L2.** `use-chapter-session.ts:306` runs `flushDetached` (I/O) from a render-phase `useState` initializer. The store reset already ran there, so this adds no new class of problem. Under StrictMode the second call is a no-op because the store is already reset, which is correct. But if React discards a concurrent render (for example an interrupted transition), the old session's edits are flushed and its store reset even though the old screen stays mounted. That is pre-existing for `reset()`. Worth a one-line note in the comment.
- **L3.** The per-checkout hash in `packages/db/src/testing.ts:14-18` covers only the vitest DBs. The e2e DB `mtl_test_e2e` and its fixed ports are still shared across checkouts. This is documented in `docs/development-setup.md:62`, so there is nothing to fix. The name length is fine: `mtl_test_api_xxxxxxxx` is 21 characters, under the 63-character limit.
- **L4.** No e2e covers the auto-login failure path (AuthGate → LoginPage when `/api/dev/auto-login` returns 404). The `/login` route itself is still exercised by `loginWithForm` (`upload-chapter.spec.ts:36`). It sits outside `AuthGate` (`router.tsx:54`), so it is not hidden by auto-login. This is acceptable per the plan's risk table.

## Edge Cases Found by Scout
- Remount behaviour confirmed: `router.tsx:151` has `key={chapterId}`, so a chapter→chapter change mounts a new instance. The new instance's render (and its `useState` initializer) runs before the old instance's effect cleanups, which is the root cause the fix describes.
- Ordering verified: `flushDetached` appends to `saver.chain`. The old cleanup's `finalSave` → `saver.flush()` appends after it, and `finalSave` runs inside `serial`, ahead of `useChapterLock`'s unlock. So the PUT reaches the server while the lock is still held. The unit test at `save.test.ts:195` proves this: the PUT would return 423 if the unlock ran first.
- StrictMode: the effect sequence setup → cleanup → setup sets `activeSaver` to saver, then null, then saver again. The double `useState` call gives a no-op on the second run. Fine.
- Skips are correct: when `readOnly` is `processing`, `recovery`, `lock_lost` or `loading`, there is no detached PUT. In the `lock_lost` case the edits stay in IndexedDB only if the 300ms persist already ran. That matches existing behaviour.
- **Pre-existing, out of scope:** `ChapterSession.activate` (`use-chapter-session.ts:68-75`) is never cancelled on unmount. If page activation is waiting on `fetchPage` when the user switches chapters, the late `doActivate` can `load()` an old-chapter page into the shared `editorStore` after the new session has reset it. Suggest a `dispose()` that sets `target = null`, called from the saver effect cleanup. Separate task.
- Click budget: "Việc cần làm" is limited to 20, with chapters locked by me listed first (`series/api.ts:80`). `click-budget.spec.ts` creates its chapter right before checking, and `chapter-tools` (which runs earlier) creates only 4 chapters, so the target stays visible. Low risk.

## Acceptance Criteria (phase 6)
| Criterion | Status |
|---|---|
| full-flow: created from 1 file on home; chapter URL appears before upload finishes (held storage POSTs); primary button goes Dịch chương → disabled Đang… → Xuất; 3 pages "Xong"; edit visible in GET /pages/:id; no warning region in Export drawer (`aria-label="Trước khi xuất"` confirmed at `export-panel.tsx:151`, so the check is real); download returns 302; 0 pageerror | Implemented; not run here |
| click-budget: Việc cần làm = 1 click, series path = 2 clicks | Implemented |
| routes-redirect: all 6 old paths from the sitemap (7 URLs counting /settings) | Covered (`routes-redirect.spec.ts:27-52`) |
| `rg "series/\$seriesId/upload\|chapters/\$chapterId/edit" apps/web/src` matches only in router.tsx | Verified (router.tsx:203, 220) |
| 1920×1080 viewport, auto-login env = seed owner, `/login` form path kept | Verified |
| Dead code: plan's Delete list gone; `.topbar`/`--topbar-h`/`ed-regions`/`ed-src`/`ed-flags`/`PAGE_STATUS`/`editorKeys`/`UploadManager`/`ChapterSessionApi` have no remaining references | Verified with rg; a CSS class-by-class scan of editor.css and tokens.css found no unused selectors |
| typecheck / lint | Pass |
| pnpm test, e2e | Tester is running them |
| Owner trial run (step 6) | Outside code review |

Remaining dead-code candidates: none that are actually dead. Some exports are used only inside their own file (for example `fetchJob`, `useStableImages`, `mergeGlossary`, `drawBoxText`, `unzipInWorker`). This is harmless, and biome does not flag it.

## Recommended Actions
1. M1: handle 409 with a rebase in `flushDetached`, or skip the PUT when it duplicates an in-flight one, and add the in-flight unit test.
2. L1: warn on detached save failure.
3. M2: merge the e2e chapter factories (can be a follow-up).
4. Separate task: cancel `ChapterSession.activate` on unmount.

## Metrics
- Typecheck: pass. Lint: 0 issues. Tests: not run (concurrent tester).

## Unresolved Questions
- Was the new back/forward e2e (`editor.spec.ts:390`) seen failing before the fix? That would show it reproduces the bug and is not a phantom test.
