# Flaky: ai-write-rules "PUT on a finished page succeeds while the next batch is still queued"

## Repro
- Isolated file x25: 25/25 pass. Full API suite: 1 fail in 4 runs (reproduced). After fix: full suite 8/8, isolated 30/30, typecheck + biome clean.
- Error: `AssertionError: expected false to be true` at test line `expect(rows[1]?.translateQueued).toBe(true)` (after lot 1).

## Root cause (test-only ordering assumption; product behavior correct)
- Ingest completion inserts all `page.prepare` jobs in one tx -> identical `created_at` (`defaultNow()` = tx start, packages/db/src/schema/app.ts:204/283).
- Claim orders `priority, created_at` only (apps/api/src/jobs/queue.ts:113) -> ties returned in arbitrary order.
- Test completed prepares in claim order. Chain lot 1 = all contiguous prepared pages from page 0 (apps/api/src/jobs/translate-chain.ts:~213-224, planBatches max 4). If page 0 prepared after page 1, lot 1 contains pages 0 and 1 -> page 1 `translate_queued=false` -> assertion fails. Correct product behavior: lot covers whatever is ready from chapter start.
- Proof: forcing reverse completion order makes the test fail deterministically with the same assertion.

## Fix
Test completes prepare jobs in reading order (sorted by page index), so lot 1 is always page 0 only. No product change.
