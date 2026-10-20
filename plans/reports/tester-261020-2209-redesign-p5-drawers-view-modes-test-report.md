# Test report: redesign phase 5 (drawers, view modes, shortcuts)

Branch `feat/redesign-p5-drawers-view-modes`, worktree `mtl-wt/r5`, uncommitted web changes. Report only, no source/test edits, no commits.

## Results

| Step | Command | Result |
|------|---------|--------|
| 1a | `pnpm typecheck` | PASS (shared, db, api, web tsc clean) |
| 1b | `pnpm lint` (biome) | PASS (232 files, no fixes) |
| 2 | `pnpm test` | PASS: shared 8/8, web 109/109 (21 files), db 3/3, api 143/143 (18 files). 0 failed, 0 skipped |
| 3 | `uv run pytest -q` in `worker/` | PASS: 132 passed, 2 skipped, 0 failed (14.7s) |
| 4 | `pnpm --filter @mtl/web e2e` | PASS: 14/14 (52.9s, 1 worker) |

Totals: unit/integration 263 passed / 0 failed; worker 132 passed / 2 skipped; e2e 14 passed / 0 failed.

## Failures

None. No reruns needed, no flakiness observed in this single run.

## Notes

- E2E ports 5181/8797 free before run and free after. Owner's `pnpm dev` (8787, 5180) left untouched.
- `.env` with DEV_AUTO_LOGIN_* left as-is; suites passed with it set.
- Non-blocking console noise in e2e: `[vite] Several Konva instances detected` (console.error from WebServer). Not a failure; likely duplicate Konva module instance. Worth a look.
- Typeset parity gate: 82 lines, 28 exact, max deviation 1px, 0 over threshold.
- `uv run` in `worker/` created `worker/.venv` (gitignored, not in `git status`).

## Coverage gaps (no coverage run requested; mapped by file name)

Changed/new modules with NO direct unit test (only indirect e2e coverage or none):
- [!] `apps/web/src/features/editor/use-shortcuts.ts`: no unit test. Hook wiring for shortcuts; consider a hook test for key dispatch and input-focus guard.
- [!] `apps/web/src/app/drawer.tsx` / `drawer.css`: no unit test. Covered only via e2e (Esc close, `?drawer=export`).
- [!] `apps/web/src/features/chapter/activity-drawer.tsx`: no unit test. e2e only (editor.spec "drawer Hoạt động khi đang dịch" path).
- [!] `apps/web/src/features/chapter/export-drawer.tsx` / `export-panel.tsx`: no unit test. e2e export flow only (chapter-tools.spec).
- [!] `apps/web/src/features/chapter/view-mode-switch.tsx`: no unit test and no e2e reference found. View-mode switching is untested.
- [!] `apps/web/src/features/chapter/lock-banner.tsx`: no unit test and no e2e reference found.
- [!] `apps/web/src/features/chapter/shortcut-help.tsx`: no unit test and no e2e reference found.

Covered:
- `features/editor/shortcuts.ts` -> `__tests__/shortcuts.test.ts`
- `features/chapter/export-warnings.ts` -> `export-warnings.test.ts`

Suggested tests (no edits made):
1. `view-mode-switch`: switching modes updates view and persists; keyboard shortcut for mode change.
2. `lock-banner`: renders when chapter locked (423 / lock state), hidden otherwise.
3. `use-shortcuts`: key dispatch; ignored when focus in input/textarea/contenteditable.
4. `shortcut-help`: opens on `?`/help key, lists bindings from `shortcuts.ts` (single source of truth).
5. e2e: view-mode toggle and shortcut-help open/close (none in current specs).

## Critical issues

None blocking. Gate is green. Main risk is untested view-mode and lock-banner UI.

## Next steps (priority)

1. Add e2e or unit coverage for view-mode switch and lock banner (no coverage at all today).
2. Add unit test for `use-shortcuts` input-focus guard.
3. Investigate duplicate Konva instance warning in dev.
4. Optional: run `pnpm --filter @mtl/web test -- --coverage` to get numeric line/branch metrics (not run here).

## Unresolved questions

- Are view-mode and lock-banner behaviors intentionally deferred to a later phase? If so, no action; if not, they need tests before merge.
- Coverage percentages not measured (no coverage config run requested).

Status: DONE
