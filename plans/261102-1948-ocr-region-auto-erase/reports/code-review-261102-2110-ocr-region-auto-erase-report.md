# Code review: OCR region auto-erase (`page.reinpaint.auto_text_bbox`)

Date: 2026-11-02 · Scope: uncommitted working tree (26 modified + 3 new files, ~+500/-75 LOC) · Score: **7/10**

## Scope
- API: `apps/api/src/routes/page-state.ts`, `apps/api/src/jobs/{enqueue,claim-inputs}.ts`, `env.ts`, tests
- Shared: `packages/shared/src/{job,worker-protocol}.ts` + emitted json-schema (3 files)
- Worker: `worker/mtl_pipeline/textmask.py::bbox_text_mask`, `worker/mtl_worker/handlers.py::handle_reinpaint`, `__init__.py`, tests
- Web: `erase-queue.ts` (+test), `OcrSelect.tsx::useOcrRegion`, `chapter-workspace.tsx`, `tool-panels.tsx`, `api.ts`, `stage-labels.ts`, e2e
- Docs: `editor.md`, `job-queue-worker.md`, `deployment-guide.md`

## Verification run by reviewer
| Check | Result |
|---|---|
| `pnpm typecheck` | pass (shared, db, api, web) |
| `pnpm lint` (biome) | pass, 0 issues |
| `uv run ruff check .` | pass |
| `uv run mypy mtl_pipeline mtl_worker` | pass (38 files) |
| `pnpm schema:emit` re-run | no diff vs working tree → json-schema matches zod |
| zod 4 `.refine` inside `z.discriminatedUnion` (scratch vitest) | works: auto-only OK, mask+offset OK, neither / key-only / bbox+offset rejected |
| `erase-queue.test.ts` | 5/5 |
| worker `test_textmask_bbox.py` + reinpaint runner tests | 8/8 |

## Acceptance criteria
| # | Verdict | Evidence |
|---|---|---|
| 1 | Met | `bbox_text_mask` builds the mask from glyphs only, limited to the box plus dilation (`test_mask_covers_glyphs_and_stays_inside_bbox`, `test_reinpaint_auto_text_bbox_masks_glyphs_inside_bbox_only`). The e2e test covers the API and web side. |
| 2 | Met within the queue | Erases run one at a time. The rev is `max(rev from the job result, rev the page knows)`, with 1 retry on 409. **But** see H1: another reinpaint started outside the queue can silently overwrite an erase. |
| 3 | Met | `!regionId && enabled` at `OcrSelect.tsx:107`. The e2e test covers the checkbox being off. **No test** that "Dịch lại khối" does not erase. |
| 4 | Met | The Mask route still validates the key prefix, `..`, existence, PNG magic and the 5MB limit. Claim still runs `keyBelongsToUser`. The worker `_user_mask` is a pure extraction of the old code. One new behavior: sending both mask sources now returns 400 instead of silently dropping the extra key. That is acceptable. |
| 5 | Met as written | Effect cleanup and `cancel()` both dispose the queue. Dispose cancels the running server job and also cancels a job whose POST was still in flight. **But** see M2: it also cancels erases for blocks that are already inserted. |

## Critical
None.

## High

### H1. Concurrent reinpaints on one page silently lose an erase. The new background queue makes this likely.
- `apps/api/src/jobs/queue.ts:379`: `update(pages).set({ cleanRev: result.clean_rev }).where(eq(pages.id, …))` is an unconditional write, with no compare-and-set on `payload.base_clean_rev`.
- `apps/api/src/routes/page-state.ts:298`: the 409 check only compares against `pages.cleanRev` at enqueue time. A reinpaint that is still running has not changed the rev yet, so a second reinpaint on the same base passes the check.
- `apps/web/src/features/editor/panels/MaskPanel.tsx:44` sends `props.cleanRev` (`activeMeta.clean_rev`). That value stays stale while an auto-erase job is in flight.
- **Scenario:** The user drags boxes A and B. Erase A is running (base N). The user switches to Mask (B) to touch up leftovers and clicks "Xoá chữ vùng đã tô". Mask B is enqueued with base N, and the check passes because cleanRev is still N. Both jobs inpaint `clean@N`. The job that completes last becomes the clean image, so erase A (or the manual mask) disappears. There is no 409 and no error, and the original text reappears under the translated block. The erase failure message even tells the user to "tô Mask (B)", which steers them into this flow. The same race applies to a second tab, and to "Dịch lại trang này" while an erase is in flight.
- The root cause existed before this change, but until now reinpaint only ran in the foreground (Mask B shows a busy state). This feature adds long-running background reinpaints, so the race is now an ordinary workflow.
- **Fix (choose one, the first is preferred):**
  1. Add a CAS at completion: `UPDATE pages SET clean_rev = $rev WHERE id = $page AND clean_rev = $base_clean_rev`. If 0 rows are updated, finish the job as failed with `clean_rev_changed`, using the existing `rejected` path in `complete`. The erase queue already retries 409 at enqueue time; it would need to treat this terminal case the same way, or just surface it.
  2. Reject enqueue with 409 `reinpaint_in_progress` while an active `page.reinpaint` exists for the page. This is simple, but Mask B then gets an error while the auto-erase runs.
  3. Send Mask B through the same per-page queue on the web. This only fixes the single-tab case.

## Medium

### M1. The erase is committed before OCR succeeds, so OCR failure or cancellation still destroys the source glyphs.
- `OcrSelect.tsx:107` pushes to the erase queue as soon as the OCR job is *created*.
- **Scenario A:** OCR hits provider errors, and the job sits in "Chờ AI" with backoff. Meanwhile the erase completes, which is irreversible. The user clicks "Huỷ OCR" expecting nothing to have happened, but the text is already gone from the clean image and no block was inserted.
- **Scenario B:** The OCR job fails permanently (schema or provider error). The result is the same: an erased area with no translated block.
- Mitigation: OCR reads the `original` image, so the user can re-drag the box. With auto-erase on, that second attempt then fails with "Không thấy chữ…", which is confusing.
- The plan chose to run OCR and the erase in parallel for latency. This is a **plan decision**, so present it to the user rather than changing it. Options:
  - (a) Push the erase only after `insertOcrRegion` succeeds. The block still appears first; the clean image updates about one inpaint later.
  - (b) Keep the parallel design, but on OCR failure or cancel, cancel the matching erase if it has not started yet. This needs a per-bbox handle from `push`.

### M2. Page change and "Huỷ OCR" cancel erases for blocks already inserted, with no feedback.
- `OcrSelect.tsx:76` (cleanup) and `:143` (`cancel` → `newQueue`).
- Pages flip on wheel scroll past the page edge (`ChapterCanvas`, `wheel-page-flip.ts`), so a page change is easy to trigger. Each erase takes CTD plus LaMa time, so 3 queued boxes take several seconds.
- **Scenario:** The user drags 3 boxes. All 3 OCR jobs finish and the blocks are inserted. The user scrolls past the bottom of the page. Erases 2 and 3 are cancelled without a message ("Đang xoá chữ gốc…" just disappears). The page now has translated blocks drawn over original text that was not erased.
- "Huỷ OCR" (shown only while OCR is pending) also cancels erases whose OCR already succeeded.
- AC5 asks for cancellation, but cancelling erases that belong to *applied* blocks gives an inconsistent result. Suggested fixes:
  - Keep queues in a module-level `Map<pageId, EraseQueue>` that survives page switches, since erases depend only on page id and rev, not on editor state. Cancel only on explicit user action, or on erases whose OCR is still pending.
  - At minimum, show "N lần xoá chữ đã huỷ" when a dispose drops pending items.
- **Product question** (see below).

### M3. An expected erase failure is shown as a page error that suggests an expensive re-run.
- `apps/api/src/routes/progress.ts:48` sets `latestByPage` to *any* job with `pageId`, including `page.reinpaint` (kept for `RECENT_MS` = 24h). `select-panel.tsx:232` then runs `describeJobError(page.job)`.
- **Scenario:** The user drags a box over text that CTD does not detect, and the worker raises `JobFailure("invalid_input", …)`. The Select panel, which opens right after the OCR block is inserted, shows "Lỗi: ảnh lỗi hoặc vượt giới hạn. Bấm "Dịch lại trang này" hoặc "Chạy lại trang lỗi" để thử lại." That message is wrong, and the suggested action re-prepares and re-translates the page at real cost. A cancelled erase (M2) shows "Đã huỷ xử lý. Bấm Dịch lại trang này…".
- The same leak already existed for Mask and OCR-region jobs. It matters now because "no text in box" is a *normal* outcome of this feature.
- **Fix:** In `latestByPage`, consider only `page.prepare` and `chapter.translate`. Alternatively, make `describeJobError` ignore `page.reinpaint` and `page.ocr_region`, since those already report inline in their panels.

### M4. Missing tests for the riskiest branches
- No test that a re-OCR (`regionId`) does **not** push an erase (AC3, second half).
- No hook-level test that a page change or `cancel()` disposes the queue and calls `cancelJob` on the running erase. AC5 is only tested at the `createEraseQueue` level, not through the `useOcrRegion` lifecycle or StrictMode double effects. I traced it by hand and found it correct, but nothing would catch a regression.
- No API or queue test for the H1 race. Add one once the fix lands.

## Low

### L1. The TS payload type does not express exclusivity
`Extract<JobPayload, {type:"page.reinpaint"}>` is a flat object with every field optional. `enqueueReinpaint` (`enqueue.ts:338`) accepts `{type, page_id, base_clean_rev}` with no mask source, and nothing validates the payload before `insertJob`. The only guard is the route's `ReinpaintBody` refine. Possible fixes:
- Narrow the `enqueueReinpaint` input to `({user_mask_key: string; offset: …} | {auto_text_bbox: BBox}) & base`, or
- `JobPayload.parse(payload)` before insert.

The emitted json-schema also cannot express the refine. The worker accepts both fields and picks `auto_text_bbox`. That is harmless while the API is the only producer.

### L2. Faint-pixel union applies even when the model sees no text
`textmask.py:232`: `pred > BBOX_LOOSE_PRED` (64) is OR-ed in even when `model_sees_text` is false. A box over screentone or hatching where CTD responds weakly (64–127) will still be inpainted. The test `test_faint_model_pixels_inside_bbox_are_kept_but_never_outside` locks this in on purpose. The deviation note says "no fallback because art erase is irreversible", and this partly undercuts that rationale. Consider requiring loose coverage ≥ `MIN_MODEL_COVERAGE`, or gating on `model_sees_text`. Re-measure on the "hair only" sample that motivated dropping the polarity fallback.

### L3. `TILE_H_RATIO = 1.25` duplicates `detect.tile_spans(h_ratio=1.25)`
Import a shared constant so prepare and the bbox erase cannot drift apart (`textmask.py:191`).

### L4. A stuck erase blocks the queue indefinitely with no stall note
If no worker with `page.reinpaint` is online, the panel shows "Đang xoá chữ gốc… (n)" forever, and every later box queues behind it. OCR got `ocrStallNote` in 79a73d6, but the erase has nothing similar. Reuse `ocrStallNote` from the `wait` poll.

### L5. `eraseRef.current = erase` is assigned during render
This works and lint passes. Under a concurrent render that is never committed, the old-page queue could briefly read the new page's `cleanRev`. The 409 retry recovers, so this is benign. An effect-assigned ref or `useEffectEvent` would be cleaner.

## Edge cases checked (no issue found)
- StrictMode double effect: the first effect creates Q1, cleanup disposes it and sets null, the second effect creates Q2. No leaked queue and no double POST.
- POST in flight when the queue is disposed → `cancel(job.id)` after the POST returns. A 409 retry while disposed → rethrows and is swallowed silently.
- Quota-rejected OCR POST → no erase pushed (the push only happens after `startOcrRegion` resolves).
- `_grow_span` always contains `[lo, hi)` and is clamped to the page (checked by hand, including the `start = 0` and `size - need` branches). Tall or webtoon boxes produce more than one tile through `tile_spans`. Spreads are clamped to `page_h`.
- Idempotency: `pageOpKey` hashes the full opts, including the bbox, so different boxes on the same base rev do not dedupe into one job.
- Rev allocation at claim (`pages.nextRev`) is unique per claim, so there is no storage key collision. The only problem is the ordering at completion (H1).
- Contract and rollback: an old worker gets 426 from the MIN bump. The new worker still accepts old `user_mask_key` jobs that are already queued. After an API rollback, a queued `auto_text_bbox` job fails at claim (`keyBelongsToUser(undefined)` → invalid_input path). This matches what `deployment-guide.md` says.
- The worker error message is shown verbatim through `job.error` → `eraseError`, so the user sees the actionable "tô Mask (B)" text in the error strip.

## Positive observations (risk calibration only)
- The diff stays in scope. The pure queue module is injected with its dependencies and tested without React, `assertBBoxInPage` is a real DRY extraction, and claim and enqueue changes are minimal.
- The plan deviation (no polarity fallback) is documented in code, docs and tests, with a measured justification.

## Recommended actions (priority order)
1. **H1**: add a CAS on `base_clean_rev` in the `page.reinpaint` completion, or single-flight reinpaint per page. Add a test.
2. **M3**: stop showing `page.reinpaint` and `page.ocr_region` failures as page-level errors with the "Dịch lại trang này" hint.
3. **M1/M2**: decide with the user (see questions below), then either sequence the erase after OCR success or tie each erase to its OCR, and keep applied-block erases alive across page changes.
4. **M4**: add a hook test (re-OCR does not erase; page change and cancel dispose and call `cancelJob`).
5. Low items as time allows.

## Metrics
- Type coverage: strict TS, no new `any` or lint suppressions (the existing biome-ignore was only reworded).
- Tests: queue 5, worker 7 new, API 2 new, e2e 1 new. None of them cover the H1 race or the hook lifecycle.
- Lint issues: 0 (biome, ruff, mypy).

## Unresolved questions
1. When the OCR fails or is cancelled after the erase already ran, should the erase still apply (M1)? This decides between keeping erase and OCR parallel or running the erase after OCR succeeds.
2. On a page change, should erases for blocks that are *already inserted* continue in the background (M2)? AC5 says cancel pending erases; it does not say whether erases whose OCR already succeeded count as pending.
3. Should the loose `pred > 64` union need the model to see text first (L2)? Only re-measuring on the "hair only" sample can settle this.
