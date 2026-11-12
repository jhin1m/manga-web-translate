# Code Review: fd71708 fix(queue): claim same-timestamp jobs in page order

## Scope
- Files: apps/api/src/jobs/queue.ts (claim select, +4/-1), apps/api/test/queue.test.ts (+33)
- Focus: commit mode, Postgres locking semantics, ordering, other claim paths

## Verdict
No blocking findings. Change is correct and the test discriminates. Low/informational notes only.

## Verification performed
- `vitest run test/queue.test.ts`: 7/7 pass. Full API suite: 32 files / 314 tests pass. `tsc --noEmit` clean, biome clean on both files.
- Postgres semantics (checked against the test DB, in rolled-back transactions):
  - `FOR UPDATE OF jobs SKIP LOCKED` with `LEFT JOIN pages`: legal because `jobs` is the preserved side. Without `OF jobs`
    Postgres would reject it ("cannot be applied to the nullable side of an outer join"). `pages` rows are NOT locked,
    so no new lock-order edge vs. the job -> chapter -> pages order used by claim/complete/fail.
  - Plan with 36k queued rows: `Limit -> LockRows -> Incremental Sort (presorted priority, created_at) -> Nested Loop
    Left Join -> Index Scan jobs_claim_idx + Memoize(pages_pkey)`. Partial index still used, early stop kept;
    0.036 ms vs 0.006 ms before. SKIP LOCKED / EPQ recheck behavior unchanged (LockRows still above the ordered stream).
- Test discriminates: same data shape (5 pages, same created_at, inserted in reverse ord) under the old
  `ORDER BY priority, created_at` returns 104,103,102,101,100 (heap/TID order = insert order); new query returns
  100..104. A `jobs.id`-only tiebreak would also fail, since uuidv7 ids ascend with reverse-ord insertion. So the test
  proves `pages.ord` is what decides order.
- Why the fix matters in prod even though `createIngestedPages` / `retryFailedPages` insert in ord order: btree ties
  are returned in heap TID order, and on a churned `jobs` table new rows reuse freed slots, so TID order is not
  insertion order. Explicit ord + id tiebreak removes that dependence.
- Other claim/select paths (reaper, budget pause, quota fail, dispatcher count) do not order by created_at ties and
  are untouched. No RLS on `pages`, so the join cannot silently null out ord for the worker role.
- `ord` uniqueness: `pages_chapter_idx (chapter_id, ord)` is not unique, but `createIngestedPages` deletes the prior
  ingest's pages first; ties fall through to `jobs.id` (deterministic).

## Findings
### Low
1. apps/api/src/jobs/queue.ts:116 — tie group spans chapters: jobs of two chapters sharing created_at would interleave
   by ord (A0, B0, A1, B1 ...). Only reachable if one transaction enqueues prepare for several chapters; no current
   producer does (prepare is enqueued per chapter in `createIngestedPages` / `retryFailedPages`). Informational; if a
   bulk multi-chapter enqueue is ever added, add `jobs.chapter_id` (or chapter number) before `pages.ord`.
2. apps/api/test/queue.test.ts:100 — test covers only page-bound jobs; the `nulls last` rule for jobs without page
   (comment at queue.ts:105) is unverified. Cheap to add one null-page job (e.g. chapter.export with same created_at)
   and assert it comes last — but needs mixed caps, so optional.
3. apps/api/test/queue.test.ts:119 — `payload as unknown as JobPayload` with only `page_id`, inserted directly
   (bypassing `insertJob`). Works because the page.prepare branch of `buildInputs` reads only page_id + page row;
   `llmJobSql` treats the missing `pipeline.ocr_engine` as LLM, so the test also depends on breaker/budget/quota being
   clear (same exposure as existing page.prepare claim tests; suite passes). Acceptable test shortcut.

### Informational
- Incremental Sort materializes the whole (priority, created_at) tie group per claim call (up to MAX_INGEST_PAGES =
  1000 rows joined + sorted for a fresh ingest). Measured cheap; not a concern at current scale.

## Unresolved questions
- None.
