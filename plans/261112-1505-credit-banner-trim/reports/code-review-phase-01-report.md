# Code review — Phase 1 (`6f57bbf`, `d7405bc`): source_files.trim

Score: **8.5/10** — Critical 0 · High 0 · Medium 2 · Low 4

## Scope
- 26 files (excluding web), roughly 420 LOC of code and tests plus the drizzle snapshot.
- Verified: `pnpm typecheck` passes (web included). `worker uv run pytest -q` → 421 passed. API `chapters`, `series-skip-images`, `unit/ingest-key` and `queue` → 62 passed. `drizzle-kit check` → no drift.
- I probed the worker contract with old-shape ingest inputs (no `trim` key). It rejects them (see M1).

## Acceptance criteria
| | Result |
|---|---|
| (a) jsonb `{top,bottom,by}`, 0/0 → null, skip and/or trim, height only when row null, 423/409, `no_size`, `trim_too_large` (64), view/GET return trim, `by:"user"` | OK (`chapters.ts:355-397`, `pages.ts:74`) |
| (b) inputs without `by`; crop before `build_pages`; clamp ≥1px; src_y relative to the cropped image; SliceAssembler unchanged; export test | OK (`claim-inputs.ts:168`, `mtl_pipeline/ingest.py:44`, `test_export_slices.py`) |
| (c) untrimmed images keep the exact old hash string; trimmed → `id:top:bottom`; callers | OK. The only caller is `enqueue.ts:216`. `items.sort().join(",")` produces the same bytes as before, and the unit test locks this |
| (d) `filesInsidePage` excludes trimmed files | OK (`series-skip-images.ts:70`, SQL `trim IS NULL`) |
| (e) worker 0.12.0, API MIN 0.12.0, API PIPELINE_VERSION unchanged, schema emitted, contract test | OK. `queue.test.ts` checks that 0.11.0 → 426 |

Regression checks:
- **Skip, commit, retranslate, export:** no regression. Trim is read under the chapter lock in `enqueueIngest`. PATCH requires draft, or `partial_failed` with no pages. So a commit/PATCH race resolves to either "new trim enqueued" or a 409.
- **Reorder:** independent of trim.
- **Skip + trim:** a skipped image is excluded from ingest. Its trim is kept and comes back on un-skip.
- **Retranslate:** does not re-ingest.
- **SliceAssembler:** builds from page renders (`render.py:275`), so the export has no banner.
- **EXIF:** `open_rgb` does `exif_transpose`. That matches browser `naturalHeight`.

## Medium

**M1. New worker + rolled-back API → every ingest fails. This contradicts the phase rollback note.**
`packages/shared/src/worker-protocol.ts:101` declares `trim` as `.nullable()` but not `.optional()`. The emitted schema therefore lists `trim` as **required** (`inputs-chapter-ingest.schema.json` `required: [..., "trim"]`).
- Scenario: deploy 0.12.0, then roll the API back. The old API's MIN is 0.10.0, so it still accepts the 0.12.0 worker. The old `buildInputs` does not send `trim`, so `runner.py:328` raises `ContractError: sources/0: 'trim' is a required property`. Every chapter commit then ends in a failed ingest until the worker is also rolled back.
- Probe result: `validate_contract('inputs-chapter-ingest', {sources:[{…no trim}]})` → REJECTED.
- The phase "Rollback" line says "cột nullable; bỏ code đọc trim là đủ" ("the column is nullable; removing the code that reads trim is enough"). That is wrong.
- The worker already tolerates a missing key (`s.get("trim")`, and `test_worker_runner` says "khoá vắng (ingest cũ)", i.e. a missing key means an old ingest). So only the contract is stricter than the handler.
- Fix: `trim: z.object({...}).nullable().optional()`, re-run `pnpm schema:emit`, and add a contract test case that validates a source without `trim`. The forward direction is unchanged: old workers still need the MIN bump.

**M2. No rollback artifacts for migration 0027.**
- There is no `packages/db/migrations-down/0027_add_source_file_trim.down.sql`. Migrations 0019–0026 all have down files, and the rollback runbook in `docs/deployment-guide.md` depends on running them in reverse order.
- Phase 5 lists `job-queue-worker.md` and others, but not `deployment-guide.md`. That file has a per-version checklist and rollback section (the 0.7.1 / 0.8 / 0.9 / 0.10 / 0.11 notes).
- Fix:
  - Add the down file: `ALTER TABLE source_files DROP CONSTRAINT source_files_trim_chk; ALTER TABLE source_files DROP COLUMN trim;` plus the migration-row cleanup used in the existing down files.
  - Add `deployment-guide.md` to Phase 5 with a "Pipeline 0.12.0" note covering: worker before API, 426 otherwise, and a rollback order that is consistent with M1.

## Low

**L1. `body.height` can turn into a 500 instead of a 400** (`chapters.ts:101`).
- zod v4 `.int().positive()` allows values up to 2^53, but `source_files.height` is a pg `integer`.
- When the row has no height and a client sends `{trim:{top:1,bottom:1}, height: 3000000000}`, Postgres raises 22003 out of range → 500.
- This only hurts the client that sends it, and `UploadFile.height` already has the same issue.
- Fix: `.max(2_147_483_647)`, or better a realistic cap (e.g. 200_000) on `height`, `top` and `bottom`.

**L2. The DB CHECK only constrains `by`** (`migrations/0027…sql:2`).
- A non-object jsonb, or missing/negative `top`/`bottom`, still passes, because `->>'by'` returns NULL and NULL passes the check.
- `claim-inputs.ts:168` would then send `top: undefined`, the key gets dropped, and the worker fails the contract.
- The app is the only writer, so this is acceptable. A tighter alternative is `jsonb_typeof(trim)='object' AND (trim->>'top')::int >= 0 AND …`.

**L3. The worker clamp silently produces a 1-px slice** (`mtl_pipeline/ingest.py:49-51`).
- This happens when the stored height is larger than the real image, i.e. the client lied or mis-measured. Spec-mandated, but the result is a 1-px page that then goes through prepare/OCR with no signal.
- Suggest logging a warning when the clamp changes the values, or clamping to `min(MIN_TRIM_KEEP_PX, h)` rows.

**L4. `np.ascontiguousarray(img[top:h-bottom])` is a no-op view** (`ingest.py:54`).
- A row slice of a C-contiguous array is already contiguous, so the full original buffer, banner rows included, stays alive until `del slices`.
- This uses no more memory than before the change, and no less. The test's `C_CONTIGUOUS` assertion proves nothing beyond that.
- Only matters if you intended to free the banner memory on very tall images. If so, use `.copy()`.

## Info, for Phase 2
- `GET /source-files` and `sourceFileView` do not expose `height`. The web cannot tell whether the API knows the height, so it should always send its measured `height` with `trim`. The server ignores it when the row already has a height.
- The `trim` component of `ingestKey` is functionally redundant, because `ingest_rev` already changes on every commit. It is harmless and matches the spec.
- Public contract changes are all additive: the PATCH body (`skip` is now optional, an empty `{}` is still 400), plus `trim` in the response and GET. The ingest inputs schema change is breaking for workers below 0.12.0, which the MIN bump handles.

## Recommended actions
1. M1: make `trim` optional in `IngestInputs`, re-emit the schema, add a contract case without `trim`, and correct the phase rollback note.
2. M2: add the down migration and a `deployment-guide.md` 0.12.0 checklist (Phase 5).
3. L1: cap `height`/`top`/`bottom`.
4. Optional: L2–L4.

Status: DONE_WITH_CONCERNS
Summary: 8.5/10; 0 critical, 0 high (2 medium: rollback breaks ingest via required `trim`; missing down migration/deploy doc).
Concerns/Blockers: M1 should be fixed before release; both are cheap.
