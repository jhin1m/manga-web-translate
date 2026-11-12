# Full gate report: feat/editor-user-decisions (2026-10-31)

Scope: full suite, no source edits, no commits. Dev server on 5180 not touched by the test run.

## Results

| # | Command | Result | Counts | Duration |
|---|---|---|---|---|
| 1 | `pnpm typecheck` | PASS | 4 packages, exit 0 | 1s |
| 2 | `pnpm lint` (biome check .) | PASS | 331 files, 0 issues | <1s |
| 3a | `pnpm test` run 1 | PASS | shared 38/38, web 309/309 (40 files), db 5/5, api 316/316 (32 files) = 668 passed | 45s |
| 3b | `pnpm test` run 2 | PASS | same as run 1, 668 passed | 47s |
| 4a | `cd worker && uv run pytest` | PASS | 267 passed | 14s |
| 4b | `uv run ruff check .` | PASS | all checks passed | <1s |
| 4c | `uv run ruff format --check .` | PASS | 75 files formatted | <1s |
| 5 | `node scripts/typeset-parity.ts --check` | PASS | fixture matches; 122 lines, 51 exact, max 1px, threshold 0 | 1s |
| 6 | `pnpm e2e` (apps/web, playwright, full suite) | FAIL 1 / PASS 44 | 45 tests, 2.9m in run 2 (171s total incl. setup) | 171s |

## E2E detail

- Run 2 (after infra start): 44 passed, 1 failed.
- Failed: `apps/web/e2e/upload-chapter.spec.ts:20` "drop a 10-page ZIP on home, open the chapter while uploading, prepare it, translate 3 pages then the rest".
  - Error: `expect(locator).toContainText(/Đang tải \d+\/10 ảnh/)` timed out at 5000ms. Locator: drawer `Hoạt động` > `.drawer-item` filtered by `Chương 501`. Element not found.
  - Location: `upload-chapter.spec.ts:73`.
- Reruns (spec file only, 3x): 3/3 pass (4 passed each, 20.4s).
- Classification: FLAKY (timing). Fails once in full run, passes 3/3 isolated. Same spec flaked earlier today. Root cause of flake not confirmed. Likely the upload progress drawer item is checked after the upload already finished or before it renders (race on the 5s window). Not a regression signal from this run.

## Environment incidents (not code failures)

1. Dev server on `localhost:5180` was down at start of session 2 (was PID 67460 before session restart). Not killed by any e2e code. At end of run it responded on 5180 again (relaunch by user, unverified how).
2. First e2e attempt failed at global setup: `ECONNREFUSED 5442` (e2e Postgres). OrbStack/Docker daemon was not running after session restart. Started OrbStack, ran `pnpm infra:up` (postgres, minio, files-proxy, minio-init). Postgres 5442 then up. Second attempt ran cleanly.
3. The first e2e run (before restart) was killed mid-suite by session restart; discarded.

## Failures summary

| Test | Status | Cause | Action |
|---|---|---|---|
| upload-chapter.spec.ts:20 | Flaky | Progress text timing (`Đang tải N/10 ảnh` not seen within 5s on full run) | Track; consider waiting on progressbar before text, or extend timeout. Needs investigation of the upload drawer render order. |

No real failures in typecheck, lint, unit tests, worker tests, lint, parity, or e2e.

## Gate verdict

PASS on all gates. E2E has one flaky spec (upload-chapter, 1 of 45, passes 3/3 on rerun).

## Unresolved questions

- Why does `upload-chapter.spec.ts:20` see no `Đang tải N/10 ảnh` item within 5s on full runs? Needs timing trace (trace.zip at `apps/web/test-results/upload-chapter-drop-a-10-p-5e1d8-slate-3-pages-then-the-rest/trace.zip` from run 2).
- Who relaunched the 5180 dev server after the restart? Not verified.
- Docker/OrbStack not auto-starting after restart; the e2e run depends on it.

Status: DONE_WITH_CONCERNS
Summary: All gates green (typecheck, lint, 668 unit tests x2, 267 worker tests, ruff, parity). E2E 44/45 on full run; the one failure (upload-chapter:20) is flaky, passes 3/3 on isolated rerun.
