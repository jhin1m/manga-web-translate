# Code review — round 3 web commits (b0612fa, a797c41, 0b0e01c)

Mode: commit review, report only (no edits). Verification: `pnpm exec vitest run` on
`ocr-wait.test.ts`, `undo-style-text.test.ts`, `__tests__/chapter-session.test.ts` → 3 files, 24 tests pass.

## Verdict

- b0612fa: OK. No bug found.
- a797c41: OK. One pre-existing edge case remains (empty page list), plus a DX nit.
- 0b0e01c: Works on the main path. Has 2 real races in the cancel wiring, plus a few UX/consistency issues. None blocks merge, but #1 and #2 are cheap to fix and break what the commit promises ("không áp kết quả").

## Findings (ranked)

### 1. MEDIUM — cancel() while a poll is in flight can still apply the OCR result — CONFIRMED (code read)
`apps/web/src/features/editor/api.ts:75-77` and `canvas/OcrSelect.tsx:59-73`.
`waitJob` checks `signal.throwIfAborted()` only *before* `fetchJob`. `fetchJob` gets no signal. If the user clicks
"Huỷ OCR" during the GET and the job just finished (`succeeded`), `waitJob` returns the job and `start` applies
`insertOcrRegion` / `refreshRegionFromOcr` on the same page. The `s.pageId !== pageId` guard does not help, because
the page has not changed. `cancelJob` on an already-succeeded job is a no-op 200 (queue.ts:698), so nothing on the
server stops it either. Result: the user cancelled, but a new block appears (or the block's text is replaced). It is
undoable, but it contradicts the cancel contract.
Fix: in `start`, after `await waitJob(...)`, add `if (signal.aborted) return;`. Or make `waitJob` re-check
`signal?.throwIfAborted()` after `fetchJob`. Optionally pass `signal` to `fetchJob` (`api()` accepts RequestInit).

### 2. MEDIUM-LOW — cancel before the job id is known leaves the server job running — CONFIRMED
`OcrSelect.tsx:57-58, 88-93`. `OcrWait` appears as soon as `pending` is non-empty, which is before the
`startOcrRegion` POST returns. If the user clicks cancel in that window, `w.jobId === null`, so `cancelJob` is skipped.
When the POST resolves, `wait.jobId` is set and `waitJob` throws immediately, so the UI is clean, but the job stays
queued or running on the server and keeps spending AI calls. Provider/rate-limit errors requeue it up to
`MAX_PROVIDER_RETRIES = 20` times, with backoff up to 960 s (errors.ts:10-13).
Fix: right after `wait.jobId = job.id`, add `if (own.signal.aborted) void cancelJob(job.id).catch(() => {})`.

### 3. LOW-MEDIUM — switching page or unmounting orphans jobs on the server — CONFIRMED (pre-existing, but now cheap to fix)
`OcrSelect.tsx:29-37`. On page change, the effect aborts the old page's controller and calls `waits.current.clear()`
without calling `cancelJob`. The old page's result is always thrown away: `pageSignal` is aborted and the pageId guard
fails. So the server job is pure waste, and the UI no longer knows the job exists, so the user cannot cancel it.
Fix: in the effect cleanup, loop `waits.current` and call `cancelJob(jobId)` (best effort), the same as `cancel()`.

### 4. LOW — cancel feels laggy (up to RTT + 1.5 s) when clicked during a fetch — CONFIRMED
`api.ts:80-88`. If the signal is already aborted when the sleep promise is created, `addEventListener("abort")` never
fires (DOM spec). The loop then sleeps the full `everyMs` before `throwIfAborted`. Meanwhile "Đang OCR…" and the
"Huỷ OCR" button stay on screen, and the user may click again (harmless, just a duplicate POST).
Fix: `if (signal?.aborted) return reject(...)` before adding the listener. Fix #1 (signal on fetch) covers part of this.

### 5. LOW — retry note shows the raw error and ignores `error_class` — CONFIRMED (inconsistent with job-error.ts)
`ocr-wait.ts:8-11`. The header of `chapter/job-error.ts` says raw errors (for example the full Gemini 429 JSON) are
for the details view only, and humanizes them through `error_class` / `provider_retries` in `describeJobError`. The
new note prints `j.error` (160 chars) as-is. The reaper requeue also produces "Lần OCR vừa rồi lỗi (lease expired)".
Suggest: build the note from `ERROR_CLASS[error_class]` / `providerText`, plus "(lần N)" from `provider_retries`.
Reuse `waitingOnProvider` / `describeJobError` for provider classes (DRY), and keep the raw error in `title`.
Semantics vs the API: OK. `requeue()` sets `status=queued`, `error_class`, `error`, `run_after=now()+delay`
(queue.ts:589-606). A brand-new job has `error=null`, so the note stays silent. A re-claimed job (`running`) hides the
note until the next requeue, which is acceptable.
Time math: `clock(run_after)` gives HH:MM in local time. That is fine for 30 s–16 min backoff. The time can show in the
past while the job waits for worker capacity or the breaker. Minor; showing "sắp thử lại" when
`run_after < now` would be nicer. `paused_budget` is not DONE and has no note, so it polls forever. The cancel button
now gives the user a way out, which is good.

### 6. LOW — concurrent OCRs share one `retry` state and make the note flicker — CONFIRMED
`OcrSelect.tsx:23, 59-61`. Take two pending OCRs where only one is requeued with an error. Their polls alternate
`setRetry(note)` and `setRetry(null)` about every 1.5 s. Fix: keep the note per wait (store it in the `waits` entry)
and show the first non-null one.
Also: `cancel()` cancels **every** OCR on the page. The "Huỷ OCR" button next to "Dịch lại khối" of block X also
cancels a region OCR started from the OCR tool. This matches the doc comment ("mọi OCR"); just be aware of it.

### 7. NIT — `role="status"` wraps the button
`tool-panels.tsx:23`. A live region that contains an interactive button gets "Huỷ OCR" re-announced. Put
`role="status"` on the `<p>` only.

### 8. NIT (a797c41) — wording when skipped ids are not in `pages`; DX
`chapter-workspace.tsx:117-141`. If none of the skipped ids map to an `ord`, `parts` is empty and the text becomes
"… trên N trang ·  vì đã sửa sau đó." The old code had the same hole, and it is unlikely because `progress.pages`
lists all pages. The mixed case ("bỏ qua trang 3, trang đang mở (trang 1) giữ nguyên") and the restored=0 case read
correctly, and the ord mapping (+1, sorted) is unchanged. `activeId` is read when the response arrives, not when the
user clicked. That only matters if the user switches page mid-request, so it can be ignored.
DX: `chapter-workspace.tsx` now exports a non-component (`undoStyleText`) next to `ChapterWorkspace`. That breaks
React Fast Refresh for this big module (full reload on edit), and the unit test imports the whole workspace graph.
Move it to `features/chapter/undo-style-text.ts`, like `ocr-wait.ts`.

### b0612fa — no issues
`use-chapter-session.ts:158-166`. The selection is read after the await, on the same page (`s.pageId === pageId`
is checked first). It is kept only if the id exists in `d.state.text_boxes`, and `store.load` drops a null
selection. This matches syncActive. Nit: the same "keep selection" expression now appears 3 times
(`use-chapter-session.ts:163, 182`, `store.ts:137`), so a tiny helper `keptSelection(sel, state)` would remove the
duplication. Pre-existing and unchanged: refreshAi has no `save.status === "saved"` guard (syncActive has one), and
`load` resets history.

## Answers to the specific questions

- Late poll applies output after cancel? **Yes**, if the GET is in flight and the job finished (#1). A late `failed`
  is muted correctly (the catch checks `signal.aborted`). Busy state: cleared in `finally` once `waitJob` rejects,
  with up to 1.5 s of lag (#4).
- Is the in-flight waitJob stopped? Yes. It uses `AbortSignal.any([page, own])`; the sleep rejects and the loop
  throws. The fetch itself is not aborted.
- cancelJob on a running or terminal job: route `POST /api/jobs/:id/cancel` (routes/jobs.ts:38) → `cancelJob`
  (queue.ts:690). For queued/running/paused_budget it marks the job `cancelled` and the worker stops at its next
  heartbeat. For a terminal job it returns the job unchanged with **200, no 409**. Unknown id → 404. The client
  swallows errors, which is fine for best effort.
- Unmount mid-wait: no setState after unmount (every setter is guarded by `pageSignal`/`signal`). The server job is
  orphaned (#3).
- Two concurrent OCRs: the logic is correct (per-id waits, and `pending` is removed per id). The retry note flickers
  (#6). Same bbox → the server's idempotency key returns the same active job (enqueue.ts:102-110), so the client
  holds two waits on one job. Harmless. A cancelled job is no longer "active", so retrying after a cancel creates a
  new job, which is correct.
- Final failure after retries: `waitJob` returns `failed` → `throw Error(done.error)` → `setError`; `pending` is
  removed, and `retry` is cleared when no waits remain. Correct (the message is still the raw error, as before).

## Test gaps and recommendation

apps/web has no `@testing-library/react` or jsdom, so a `renderHook` test would need new deps. Don't add them for
this. In order of value:

1. **e2e (feasible now, cheapest real coverage).** The fake worker does not claim `page.ocr_region`. It is not in
   `ALL_CAPABILITIES` (`e2e/fake-worker.ts:83`), and `readyChapter` stops the worker once the chapter is ready. So
   "Dịch lại khối" leaves a job **queued forever**, which is the exact scenario to test. Add a test in
   `e2e/editor.spec.ts`:
   select a block → click "Dịch lại khối" → expect "Đang OCR…" and the "Huỷ OCR" button → click it while waiting on
   `page.waitForResponse(/\/api\/jobs\/.+\/cancel/)` → expect the button text back to "Dịch lại khối", no error notice,
   and `GET /api/jobs/:id` → `status: "cancelled"`.
   For the retry note: export a small helper from `fake-worker.ts` that claims with `capabilities: ["page.ocr_region"]`
   and POSTs `/worker/v1/jobs/:id/fail` with `error_class: "schema"` (or `"internal"`) and a message. The job
   requeues with `error` set, and the test asserts "Lần OCR vừa rồi lỗi (…)" is visible.
2. **Unit test for `waitJob`** (no new deps). Mock `../../lib/api.ts` (`api`), not `fetchJob`, because the call
   inside the same module can't be mocked. Use fake timers. Cases: `onPoll` is called for queued/running and not for
   done; abort during the sleep rejects immediately; abort during an in-flight fetch that resolves `succeeded` must
   reject (fails today, which pins #1); abort during an in-flight fetch that resolves `queued` rejects without waiting
   1.5 s (#4).
3. **Optional:** move `useOcrRegion`'s start/cancel logic into a plain class with injected deps (`startOcrRegion`,
   `waitJob`, `cancelJob`, editor store), the same pattern as `ChapterSession`, and unit-test it: cancel before the
   job id is known → `cancelJob` is called once the id arrives (#2); page change → `cancelJob` is called for
   outstanding jobs (#3); per-wait retry note (#6).

## Unresolved questions

- Product: should switching page cancel OCR jobs on the server (#3), or should they keep running? Today their results
  are always discarded, so cancelling looks strictly better.
- Should the "Huỷ OCR" next to a block cancel only that block's re-OCR rather than all OCRs on the page?

Status: DONE_WITH_CONCERNS
Summary: b0612fa and a797c41 are correct. In 0b0e01c, a cancel during an in-flight poll can still apply the result,
and a cancel before the job id arrives (or a page switch) leaves the server job running. Both are small fixes, and an
e2e test is feasible because the fake worker never claims `page.ocr_region`.
