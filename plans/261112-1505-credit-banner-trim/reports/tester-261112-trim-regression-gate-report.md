# Regression gate: feat/trim-credit-banner (b193169)

Date: 2026-11-12. macOS. Infra: postgres/minio/files-proxy up (no `infra:up` needed). No product code changed.

## Commands and counts

| Step | Command | Result |
|------|---------|--------|
| Typecheck | `pnpm typecheck` | PASS (shared, db, web, api) |
| Lint | `pnpm lint` (biome, 481 files) | PASS, 0 issues |
| Unit shared | `pnpm test` → packages/shared | 9 files, 124 passed |
| Unit db | packages/db | 4 files, 8 passed |
| Unit web | apps/web (vitest, font sync check OK) | 57 files, 515 passed |
| Unit api | apps/api | 67 files, 727 passed, 1 skipped |
| Worker | `cd worker && uv run pytest` | 421 passed |
| Web e2e | `pnpm --filter @mtl/web e2e` (119 tests, 1 worker) | 118 passed, 1 failed |

Api skip: `apps/api/test/local-mode.test.ts:150` `it.skipIf(dumpSkipReason)` dumps DB with pg_dump. Env-dependent (pg_dump version), not branch-related.

## e2e per spec

| Spec | Pass | Fail |
|------|-----:|-----:|
| admin-settings | 7 | 0 |
| block-panel | 22 | 1 (`:317`) |
| chapter-tools | 5 | 0 |
| chapter-topbar | 6 | 0 |
| click-budget | 2 | 0 |
| editor | 21 | 0 |
| fonts | 2 | 0 |
| full-flow | 1 | 0 |
| glossary-language-pair | 2 | 0 |
| pipeline-settings | 1 | 0 |
| proofread | 1 | 0 |
| rail-text-export | 9 | 0 |
| routes | 1 | 0 |
| series-manage | 10 | 0 |
| series-suggestions | 1 | 0 |
| signup | 3 | 0 |
| trim-auto-drop | 3 | 0 |
| trim-learn-band | 1 | 0 |
| trim-source | 1 | 0 |
| typeset-parity | 1 | 0 |
| update-notice | 13 | 0 |
| upload-chapter | 5 | 0 |
| **Total** | **118** | **1** |

Only failure: `e2e/block-panel.spec.ts:317` "double-clicking a block under the future panel with the panel collapsed still edits the text on the image".

## Failure: block-panel.spec.ts:317

Error: `expect(getByRole('complementary', {name: 'Chọn & sửa'})).toBeHidden()` at `block-panel.spec.ts:339`, received visible, 5s timeout. Panel still open after the double-click edit path and `DBLCLICK_GAP` (450ms) wait.

Reruns (single spec, `playwright test e2e/block-panel.spec.ts:317`):
- Branch: full-suite run + 3 isolated runs → fails 4/4, same error.
- `main` (detached worktree at d6c6ebb): 3 isolated runs → fails 3/3, same error (`Received: visible`).

Verdict: **pre-existing on main, deterministic (not flaky)**. Not caused by this branch.
- Spec file untouched on branch.
- `openAfterPointer` / pending `Konva.dblClickWindow` timer logic in `apps/web/src/features/chapter/chapter-workspace.tsx` (~L325-380) is identical on main; branch hunks in that file don't touch it.
- Branch changes (source rail/viewer, toast, fake-worker, upload-manager) are not on the canvas/panel path. fake-worker change keeps page height 1000 when no trim, so `readyChapter` pages are unchanged.

Root-cause not investigated (out of scope). Hypothesis only: the deferred panel-open timer is not cancelled when the second click's dblclick path doesn't emit an `editing` change before the timer fires. Unverified.

## Trim-specific e2e
All 5 trim specs pass: `trim-source` (1), `trim-learn-band` (1), `trim-auto-drop` (3, incl. perf budget at 625ms and hash-threshold test).

## Environment notes
- Main worktree needed the gitignored root `.env` copied in (API env zod requires `BETTER_AUTH_SECRET`). Copied file removed with worktree; worktree removed (`git worktree list` shows only branch).
- e2e uses separate DB `mtl_test_e2e` (global-setup resets it) and ports 5181/8797. Dev DB not touched. Main run re-migrated/reset the e2e DB; branch reruns reset it again.

## Unresolved questions
- Is `block-panel.spec.ts:317` known on main already (CI/tracking)? It fails on main HEAD d6c6ebb now, so either a recent main regression or the test was already red. Who owns it?
- Was the dev `pnpm dev` stack expected to be left running? Not touched.
