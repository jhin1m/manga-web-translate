# Code review: Cmd+Z undo for bulk edits (aa6b579, e174bdc)

## Scope
- Commits: aa6b579 (Áp kiểu batch mark), e174bdc (Tìm/Thay + glossary, API `versions`). Base fd71708.
- Files: apps/web editor/{history,store,use-chapter-session}.ts, chapter/{chapter-workspace,chapter-topbar,FindReplace,undo-style-text}.tsx/ts, glossary/ApplyGlossary.tsx, apps/api lib/batch-edit.ts, tests, docs.
- Reviewed with `git show` at e174bdc. The working tree has unrelated edits (wheel nav) but none in history.ts, store.ts, use-chapter-session.ts or their tests.
- Checks: vitest chapter-session + history + undo-style-text → 44/44 pass. E2E not run (port clash).

## Overall
The single-batch flows are well handled: carry is set before setCached, and history settles correctly in the restored, orphaned and local cases. The redo stack is cleared, and Cmd+Z inside fields stays native. Tenant scope of the API change is fine: `versions` holds only the chapter's own pages, which `applyBatch` has already written through the scoped `sdb`. The change is additive and backward compatible.

The main defect is that the advertised "further Cmd+Z steps back" chain breaks when two batches touch the same pages. A transient error also permanently removes the undo entry.

## Findings

### 1. Medium-High: undoing two batches in a row skips every page both batches touched
- Where: apps/api/src/lib/batch-edit.ts:147 (version-based `changedSince`), reached through apps/web/src/features/editor/use-chapter-session.ts:406 (only the open page has the `local` fallback).
- Scenario: Áp kiểu (batch1), then Tìm/Thay (batch2) on the same pages, then Cmd+Z, Cmd+Z. Undoing batch2 restores the content but moves each page's version from v+2 to v+3. Batch1's history row expects v+1, so in skip mode the server skips every page in both batches. The open page is restored locally; the other shared pages stay styled. The toast says they were "đã sửa sau đó", though the user never edited them. The result is a chapter left half undone.
- Fix: in skip mode, decide "changed since" by content rather than version alone. Treat a page as unchanged when its current state deep-equals the state the batch wrote, i.e. the history row with version = h.version+1 (its `state` is the content at v+1), or the current state if the version is still v+1. Add an API test for apply A → apply B → undo B → undo A in skip mode.

### 2. Medium: 409 `chapter_busy` (temporary) is treated as final; the mark and pre-batch history are dropped
- Where: apps/web/src/features/chapter/chapter-workspace.tsx:527.
- Scenario: the chapter is `processing` (a page is being translated while the user edits another). Cmd+Z returns 409 `chapter_busy`. `dropBatch` runs, settles the mark as orphaned and throws away every pre-batch step. `setUndoneBatch` also hides the panel's Hoàn tác button. Once the chapter is idle, nothing can undo the batch any more, although the server could. A race in skip mode can also throw `undo_conflict` (`!row`), with the same effect.
- Decision note: the user decided "404/409 drops entry". The trade-off is that a stuck Cmd+Z only matters for a gone batch (404), while a busy chapter is a retry case. Options: (a) drop only on 404, keep on `chapter_busy`/`undo_conflict`; (b) keep the current behaviour. Recommend (a), pending user confirmation.

### 3. Low-Medium: the panel's Hoàn tác and Cmd+Z are not guarded against each other (double undo)
- Where: apps/web/src/features/chapter/chapter-workspace.tsx:548 (checks only `undoKind.isPending`); apps/web/src/features/chapter/FindReplace.tsx:102 (panel undo, fail mode). The mark is only consumed on success.
- Scenario: the user clicks the panel's Hoàn tác and presses Cmd+Z before it returns, so two undo requests are in flight. The later one in skip mode returns `{pages:0, skipped: all}`.
  - If the panel response arrives first, the warn toast "Không hoàn tác được … đã sửa sau khi thay thế" shows after an undo that actually succeeded.
  - If the skip response arrives first, `afterBatchUndo` takes the `local` path. The doc is set back to `before` with the old baseVersion, and autosave hits 409, which causes a rebase or conflict on the open page.
- Fix: have one in-flight flag for both paths. Route the panel undo's pending state through the hooks and check it in `undoEdit`, or disable the panel's Hoàn tác while `undoKind.isPending`. In `afterBatchUndo`, only take the `local` path when the server actually restored at least one page or the batch touched only the open page.

### 4. Low: `recordServerBatch` does not check that the batch was applied on top of the editor's base
- Where: apps/web/src/features/editor/use-chapter-session.ts:368-376.
- Scenario: an AI update lands on the open page (server v+1) before the cache poll reloads the editor (base v). Tìm/Thay then writes v+2, and the mark's `before` is set to the stale v content. Later, edit + Cmd+Z + Cmd+Z sends the batch undo, the server skips the page, and the `local` path writes the v content over the AI update. Autosave then saves it, so the AI content is lost without notice.
- Fix: carry and mark only when `versions[s.pageId] === s.baseVersion + 1`; otherwise do not mark.

### 5. Low: edits made while the undo request is in flight drop out of history
- Where: use-chapter-session.ts:403 (`finishBatch("reload")` empties history immediately).
- Scenario: Cmd+Z on the batch, then the user moves a box before the response. The server restores the open page. The history is emptied and `syncActive` skips the reload because the doc is dirty. The edit stays in the doc on the old base and is rebased after a 409, but it can no longer be undone and the carry is never used. This fails safely (no data loss); noted for completeness.

### 6. Low (test quality)
- `undoBatchServer` in chapter-session.test.ts has no version semantics. Tests pass the skip list by hand, use a fixed `batch-1`, and `before` keeps only the latest batch per page. Findings 1, 3 and 4 cannot show up in these unit tests.
- The workspace wiring (`undoEdit`, the `isPending` guard, `onError` drop, the restored/skipped message arithmetic with `local`) is covered only by e2e.
- apps/web/e2e/chapter-tools.spec.ts:181 checks the server translation right after pressing Cmd+Z in the Find field, without waiting. Since undo is async, the check passes even if the shortcut wrongly fired. Use `expect.poll` over a short window, or assert that no `find-replace/undo` request was sent (`page.waitForRequest` with a timeout, expected to reject).

## Verified (not issues)
- No stale closure: `useShortcuts` keeps a ref refreshed every render, so `undoEdit` reads the current `isPending`. useMutation picks up the latest `hooks` and `styleUndo` on each render.
- Key-repeat Cmd+Z: repeats while pending are dropped; after success, history is restored on reload, and further repeats step back through the pre-batch edits as intended.
- A batch mark never enters `future`: `store.undo` is only called when the mark is not on top, and coalescing needs a non-null key, which marks lack.
- Switching pages: activate clears carry. The stash is keyed by version, so a page the server restored drops its stash, and a skipped page keeps only the steps after the mark (orphaned).
- Skip-mode message: on the `local` path the open page is removed from `skipped` and counted as restored; labels come from `batchLabels`, defaulting to "áp kiểu".
- API: the `versions` keys are pages written in the same scoped transaction, and series-ignore-apply does not expose them.

## Recommended actions
1. Fix the content-aware skip in `undoBatch` and add an API chain test (finding 1).
2. Ask the user whether `chapter_busy` should keep the entry (finding 2).
3. Add a shared in-flight guard and tighten the `local` path condition (finding 3).
4. Add the `baseVersion + 1` guard in `recordServerBatch` (finding 4).

## Unresolved questions
- Does the user accept that `chapter_busy` (a temporary state) permanently removes the Cmd+Z entry and the panel's undo button?

## Re-review 65d3b50

Reviewed with `git show 65d3b50` (the working tree has unrelated edits). Ran vitest on chapter-session and history: 43/43 pass. The API tests were not run because they need the shared test Postgres (global setup), and e2e was not run.

### Status of earlier findings
- **1 (chained undo skips shared pages): fixed.** `undoBatch` now treats a page as unchanged when its version is still v+1, or when the history row at version v+1 (which every writer stores as `(cur.version, cur.state)`) deep-equals the current state. This applies in both skip and fail modes.
  - The comparison is sound. Both sides are jsonb read through the same scoped select, so key order and `undefined` keys do not matter.
  - `valign` is `.optional()` with no default, and no zod transform touches state (`NfcText` is a refine). So "missing" vs `"top"` compares as different, which is the conservative direction.
  - The client never normalizes loaded state.
  - Every page_states writer inserts a history row, and versions never reset, so (page, version) is unique.
  - A pruned v+1 row, or a null state on both sides, cannot cause a false restore: batches only touch non-null states.
  - The API chain test (A → B → same-content re-save → undo B → undo A) covers both the chain and the same-content cases.
- **2 (`chapter_busy` drops the entry): fixed.** Only a 404 drops the entry now. A skip-mode race `undo_conflict` (409 from the guarded UPDATE) is kept and can be retried.
- **3 (double undo): fixed.** The `undoBusy` ref is shared by the toast, Cmd+Z and the panel (`begin`/`end`). `onSettled` sits at hook level, so it still fires if the panel unmounts mid-request. The `restored > 0` gate was added (see R2).
- **4 (stale base): fixed.** The `version !== baseVersion + 1` check returns without carry or mark, and there is a unit test for it.
- **5:** documented in the JSDoc only. Acceptable, since it fails safe.
- **6:** fixed. The fake server is now content-based and per batch, and the e2e test checks that no `/find-replace/undo` request is sent within 1.5 s.

### Semantics, concurrency, performance
- **Fail mode (panel Tìm/Thay, glossary):**
  - An identical re-save no longer conflicts. A real undo-of-undo (content = before ≠ written) still returns 409; `find-replace.test.ts:205` still asserts this.
  - An AI bump on a page the user edited (`ai_update_available`: version+1, state unchanged) is now restorable, which is an improvement.
  - The only new edge: a stale undo of batch A after the same content was re-created by A′ restores the pre-A content (it undoes A′ in effect). Every UI entry point hides or settles A's undo first, so this is informational only.
- **Series-ignore undo:** same outcome as before. Chapters already undone still report "changed"; chapters skipped as `locked` can now be retried.
- **Concurrency:** the reads are not `FOR UPDATE`, but the UPDATE is guarded on `version = now.version`. A concurrent PUT or AI write therefore makes the UPDATE affect 0 rows, which throws a 409 and rolls back the whole transaction. The client now keeps the entry, so a retry works. Correct.

### New findings
- **R1 Low-Medium (perf):** apps/api/src/lib/batch-edit.ts:152-166.
  - `wrote` selects every history row (up to 50 per page, full JSONB state) of every moved page. In the chained-undo case this fix targets, every page is moved: a 200-page chapter means up to 10k state blobs, loaded inside the transaction that holds the chapter write path. `pruneHistory` already loads the same rows once per restored page, so this roughly doubles undo cost; it does not add a new order of magnitude.
  - `wrote.find` is O(H×W).
  - Fix: filter to the needed (page, version) pairs, e.g. `and(inArray(pageId, ids), inArray(version, moved.map(h => h.version + 1)))`. This uses `page_state_history_page_idx`. Then build a `Map<pageId, row>` and keep only rows where `version === h.version + 1`.
- **R2 Low:** apps/web/src/features/editor/use-chapter-session.ts:410.
  - `restored > 0` blocks the in-place restore when the batch touched only the open page. Example: a single-page Tìm/Thay or Áp kiểu, followed by 50+ saves (the v+1 row is pruned) that end back on the batch state. The server skips the page and returns `pages: 0`, so the page stays in the batch state and the toast says it was "đã sửa".
  - Before this commit, that page was restored locally. The unit test at chapter-session.test.ts:632 was widened from `["A"]` to `["A","B"]`, which hides this case.
  - The gate's purpose (the double-undo race) is now covered by `undoBusy`.
  - Fix: `(restored > 0 || skipped.length === 1)` (the batch was just the open page), or drop the gate.
- **R3 Low:** apps/web/src/features/chapter/chapter-workspace.tsx:548 (comment at 525).
  - On error, the toast's Hoàn tác only comes back for non-`ApiError`. The rationale "lỗi từ server thử lại cũng vô ích" contradicts the new keep-on-transient policy.
  - After a 409 `chapter_busy`, 423 or 5xx on an Áp kiểu undo, the history mark is kept but the toast button is gone. A user now on a page outside the batch, whose history has no mark, has no way left to undo it (Áp kiểu has no panel undo).
  - Fix: `if (prev && !(e instanceof ApiError && e.status === 404)) setStyleUndo(prev)`.
- **R4 Low (UX):** apps/web/src/features/chapter/FindReplace.tsx:138. While another undo is in flight, the panel's Hoàn tác silently does nothing; there is no disabled state and no message. Fix: expose `undoBusy` as state, or OR it into `busy`.
- **R5 Low (test quality):** apps/api/test/find-replace.test.ts:336-367.
  - The test depends on order: it relies on earlier tests leaving "ra!" in the main chapter and keeping its lock held, and it sits under `describe("performance")`.
  - `afterA` (line 348) actually holds the state after B.
  - A missing "ra!" fails loudly (undo returns 404), so this is not a phantom pass.
  - Suggest using its own `newChapter` + `lock`, and renaming the variable.

### Plan follow-ups
Findings 1-4 and 6 are complete. R1-R3 are worth a small follow-up; R4 and R5 are optional.
