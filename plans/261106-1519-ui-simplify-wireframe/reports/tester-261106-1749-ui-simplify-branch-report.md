# Tester report: feat/ui-simplify (2026-11-06)

Commit under test: 3ce279e (HEAD before test commit). New commit: db628aa `test(web): cover shell activity button for a failed upload`.

## Gate results

| Gate | Result |
|------|--------|
| `pnpm typecheck` | pass (exit 0) |
| `pnpm lint` (biome) | pass, "Checked 398 files. No fixes applied." |
| `pnpm test` shared | 6 files, 60 tests pass |
| `pnpm test` web | 52 files, 417 tests pass (sync-fonts check + vitest) |
| `pnpm test` db | 4 files, 8 tests pass |
| `pnpm test` api | 44 files, 435 tests pass (~53s) |
| Unit total | 940 tests, 0 fail |

## E2E (`pnpm --filter @mtl/web e2e`)

- Run 1: 93 passed (5.0m), exit 0
- Run 2: 93 passed (5.0m), exit 0
- Flaky: none. Same 93 names both runs, no retries needed.
- Log files: `/private/tmp/claude-501/-Users-jhin1m-Desktop-ducanh-project-manga-web-translate/be03f1b8-d8be-4e09-aec4-4a71583881b5/scratchpad/e2e-run1.log`, `.../e2e-run2.log`

## New spec (Việc 1)

File: `apps/web/e2e/upload-chapter.spec.ts` (+57 lines, last test).
Name: "shell activity button shows only while an upload has failed, and its drawer retries the upload to completion".

Flow:
1. Series page, no uploads → `Hoạt động` button count 0.
2. Cross-origin POST (presigned storage) → 500 with ACAO header, counted. Two loose PNGs dropped on the series zone → chapter opens.
3. Wait for ≥6 rejections (2 files × MAX_ATTEMPTS 3).
4. Click "Series e2e" → button visible. Open drawer → item `data-chapter=<id>` shows "Lỗi 2 ảnh · đã tải 0/2" and "Thử lại".
5. Open route (flag `storageOpen`, requests continue) → click "Thử lại" → "Đã tải xong 2 ảnh", Thử lại gone.
6. Close drawer → button hidden again.

No store stubbing. Real API and MinIO used.

Mutation check (temporary, reverted): removed `hasFailed ||` from `ShellActivity` in `activity-drawer.tsx`. Test failed at the first `toBeVisible` on the button (element not found, 34.7s). Product file restored from scratchpad copy, `git checkout` run, diff clean.

## Test-plan notes

- Test is placed last in the file, after the other upload tests. The drop uses the series zone, so it does not depend on the account having exactly one series.
- Relies on MAX_ATTEMPTS=3 and 2 files for the rejection count (≥6). If retry policy changes, update the threshold.

## Concerns

- None blocking. All gates green, 2/2 e2e passes.

## Unresolved questions

- None.
