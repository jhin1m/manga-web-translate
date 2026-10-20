# Phase 4 validation: web upload, series, progress

Branch `feat/p4-web-upload-series-progress`, diff `15f95b9..HEAD`. No source/test edits, no commits.

## 1. Static and suite results

| Command | Result |
|---|---|
| `pnpm typecheck` (shared, web, db, api) | PASS, 0 errors |
| `pnpm lint` (biome, 117 files) | PASS, 0 issues |
| `pnpm test` | PASS: web 6/6, shared 8/8, db 3/3, api 76/76 (93 total, 0 failed, 0 skipped) |

## 2. Playwright e2e

`pnpm --filter @mtl/web e2e`: 1/1 PASS (`upload-chapter.spec.ts`, ZIP 10 pages, shuffled names, fake worker, 10 "Sẵn sàng"). Test 3.8s, total run 6.4s. Ports 5180/8797 were free before and after. Playwright started and stopped its own API/Vite processes.

## 3. Build

`pnpm --filter @mtl/web build`: PASS in 86ms. Main JS 416.78 kB (gzip 131.48 kB). CSS 8.62 kB. Worker chunk `unzip-worker` emitted. No warnings.

## 4. Flakiness (API, 4 files, 3 runs)

| Run | Files | Tests | Time |
|---|---|---|---|
| 1 | 4/4 | 28/28 | 3.53s |
| 2 | 4/4 | 28/28 | 3.54s |
| 3 | 4/4 | 28/28 | 3.72s |

No flakes observed.

## 5. Success criteria coverage (plan phase-04, "Success Criteria")

| # | Criterion | Automated coverage | Status |
|---|---|---|---|
| 1 | ZIP 200MB / 150 images done, natural order | Natural sort unit test (`upload.test.ts`); e2e covers 10 pages only | PARTIAL: no large-ZIP or 150-file test |
| 1b | Network drop → retry failed file only | Queue unit test with fake upload (retry, maxAttempts, second run touches failed only) | PARTIAL: no real network drop or MinIO test |
| 2a | Direct 50MB upload rejected by MinIO | `upload-validation.test.ts` "MinIO rejects a direct 50MB upload and wrong Content-Type" | COVERED |
| 2b | HTML renamed `.png` dropped at commit | `upload-validation.test.ts` "drops an HTML file renamed .png" | COVERED |
| 3 | Glossary change, rerun 1 page uses new term + neighbor context | `chapters.test.ts` "retranslating one page after a glossary change..." | COVERED (API only, no UI) |
| 4 | Progress updates ≤3s after worker heartbeat | None. Only constant `PROGRESS_POLL_MS = 2500` (`chapter-page.tsx:25`), no latency test | NOT COVERED |
| 5 | `partial_failed` → retry-failed → `review` | `chapters.test.ts` "partial_failed → retry-failed ... ends in review" | COVERED (API). Provider-recovery wording not tested; no UI button test |
| 6a | 2nd user sees lock holder | `chapters.test.ts` lock test checks API holder/423; UI "đang được X sửa" not tested | PARTIAL (API only) |
| 6b | Write without lock → 423 | `chapters.test.ts` lock test | COVERED |
| 6c | Lock expires after 15 min | `ai-write-rules.test.ts` "an expired lock can be taken over" | COVERED |
| 7 | Owner UI approval; no banned patterns | No automated check. Grep of `apps/web/src` finds no gradient/blur usage (only in a comment in `tokens.css`). Owner approval is manual | MANUAL |

Also covered: tenant isolation on new routes (`tenant-isolation.test.ts`), glossary rev bump scoping, settings_rev bump, MVP ko-only source language.

## Critical issues

None blocking.

## Concerns

- **Unexpected uncommitted change:** `docs/development-setup.md` shows +10 lines (E2E section and Web section). `git status` was clean at start. File mtime 17:32:29, during my API test runs. No test or script writes this file (grep found no references), so another session or agent wrote it. Left untouched. Verify and commit or discard it before shipping.

## Recommendations

1. Add a test that asserts progress polling latency or interval (≤3s), e.g. a unit test on `refetchInterval` / a poll helper. Criterion 4 has no evidence.
2. Add a UI or e2e check for the lock banner ("đang được X sửa") with two sessions.
3. Add an upload-queue test with a large synthetic ZIP (150 entries) to check ordering and memory. Keep it out of e2e.
4. Add an API test for `retry-failed` after provider recovery, if provider state is simulated.
5. Consider a CI grep for banned UI patterns (gradient, backdrop-filter, emoji) in `apps/web/src`.
6. Coverage was not measured (not requested, no coverage script in root `package.json`). Add coverage if a percentage gate is required.

## Next steps (priority)

1. Resolve the uncommitted `docs/development-setup.md` change.
2. Close criterion 4 (progress latency) with a test.
3. Add lock banner test (criterion 6a) for UI.
4. Add large-ZIP ordering test (criterion 1).
5. Add banned-pattern lint check (criterion 7).

## Unresolved questions

- Who modified `docs/development-setup.md` during the run, and is that change meant for this branch?
- Is the 200MB / 150-image ZIP target to be tested automatically, or is it a manual acceptance check?
- Is there a coverage threshold (80%) for this repo? No coverage script exists at root.

Status: DONE_WITH_CONCERNS
Summary: Typecheck, lint, all 93 unit/integration tests, e2e upload flow, web build, and 3x API flakiness runs all pass. Criteria 4 (progress latency ≤3s) and the 200MB/150-image ZIP path have no automated coverage, and an uncommitted docs change appeared mid-run from outside the tests.
