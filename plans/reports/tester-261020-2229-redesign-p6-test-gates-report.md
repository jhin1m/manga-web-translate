# Phase 6 test gates report

Branch: feat/redesign-p6-e2e-cleanup. Worktree: /Users/jhin1m/Desktop/ducanh-project/mtl-wt/r6. No source files modified.

## 1. `pnpm test` (root), 5 sequential runs

| Run | Exit | Time | shared | web | db | api |
|-----|------|------|--------|-----|----|-----|
| 1 | 0 | 27s | 8/8 | 112/112 (21 files) | 3/3 | 143/143 (18 files) |
| 2 | 0 | 25s | 8/8 | 112/112 | 3/3 | 143/143 |
| 3 | 0 | 25s | 8/8 | 112/112 | 3/3 | 143/143 |
| 4 | 0 | 26s | 8/8 | 112/112 | 3/3 | 143/143 |
| 5 | 0 | 25s | 8/8 | 112/112 | 3/3 | 143/143 |

- 5/5 green. 0 failed, 0 skipped. No warnings in logs.
- worker-protocol flake: not reproduced (5/5 pass, includes apps/api).
- Logs: /private/tmp/claude-501/-Users-jhin1m-Desktop-ducanh-project-mtl-wt-r6/a460e187-a3e8-4aa3-b673-94af4d4ae272/scratchpad/test-run-{1..5}.log

## 2. Worker pytest

Command: `cd worker && uv run --dev pytest -q` (documented in `worker/pyproject.toml` `[tool.pytest.ini_options]`, dev extra provides pytest).

- Result: 132 passed, 2 skipped, exit 0.
- Skips (expected, missing model weights): `tests/test_inpaint.py:43` (big_lama), `tests/test_tiling_merge.py:69` (rtdetr_v2_comic).
- Side effect: uv created `worker/.venv` (56 packages). Not a source change.

## 3. E2E (`pnpm --filter @mtl/web e2e`)

- 15 passed, 0 failed (1.1m), exit 0.
- Includes: typeset-parity (82 lines, 28 exact, max 1px, 0 over threshold), full-flow, click-budget, routes-redirect, editor "back/forward straight to another chapter still saves the last edit of the one left".
- Infra used: mtl-dev-postgres, mtl-dev-minio, mtl-dev-files-proxy (all up). E2E servers on its own ports.

## Concerns (non-blocking)

1. React warning during e2e (not a failure): `Cannot update a component (LockBand) while rendering a different component (ChapterWorkspace)`. Setter called during render. `LockBand` is at `apps/web/src/features/chapter/chapter-topbar.tsx:145`, used at `chapter-workspace.tsx:422`. Neither file is in the modified list. Likely triggered by `use-chapter-session.ts` (modified). Not confirmed; needs a dev look.
2. Konva "Several Konva instances detected" warning in typeset-parity run. Probably test-environment only.
3. `flushDetached` has unit coverage in `apps/web/src/features/editor/__tests__/save.test.ts` (lines 199, 217, 226). Good.
4. Test naming: no coverage numbers gathered (not requested).

## Unresolved questions

- Is the LockBand warning pre-existing on `main` or introduced by the phase-6 changes? Needs a check on main.
- Should the flaky worker-protocol test be re-run under parallel load to confirm the per-checkout DB fix? Not done (sequential runs only, per instructions).

Status: DONE_WITH_CONCERNS
Summary: pnpm test 5/5 green (no worker-protocol flake), worker pytest 132 passed/2 skipped (missing weights), e2e 15/15 passed. One React setState-in-render warning (LockBand/ChapterWorkspace) seen during e2e, not a failure.
Concerns/Blockers: LockBand render-phase setState warning needs triage; uv created worker/.venv (ignored, not a source change).
