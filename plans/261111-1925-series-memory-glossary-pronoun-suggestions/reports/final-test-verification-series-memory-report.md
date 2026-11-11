# Final test verification: series memory

Date: 2026-11-11. Tree: main (c485335 + uncommitted). No source edits, no commits. Dev servers untouched.

## 1. Quality gates (main tree)

| Command | Result |
|---|---|
| `pnpm lint` (biome) | PASS. 442 files, 0 errors |
| `pnpm typecheck` | PASS. shared, db, web, api tsc clean |
| `pnpm test` | PASS. shared 83/83, web 462/462, db 8/8, api 561 pass + 1 skipped (562). Total 1114 pass, 1 skipped, 0 fail |
| `cd worker && uv run pytest -q` | PASS. 414 passed |
| `cd worker && uv run ruff check` | PASS |
| `pnpm --filter @mtl/web e2e` | FAIL. 100 pass, 1 fail: `block-panel.spec.ts:317` |
| `pnpm --filter @mtl/shared emit` + schema check | PASS. emit output byte-identical to working copy (`diff -r` before/after clean) |

Note: `git diff --exit-code packages/shared/json-schema/` is not usable here, because the feature itself modifies `job-result.schema.json` (+63 lines vs HEAD, expected). Checked emit idempotence instead.

## 2. block-panel.spec.ts:317 investigation

Hypothesis (from phase-04 report): failure caused by other plan's uncommitted `features/chapter/**` edits. **Refuted.**

| Tree | Run | Result of `block-panel.spec.ts:317` |
|---|---|---|
| Main (HEAD + feature + other plan) | full web e2e | FAIL (`expect(aside[aria-label="Chọn & sửa"]).toBeHidden()` received visible, line 339) |
| Feature-only worktree (HEAD + feature patch, no other-plan files) | `block-panel.spec.ts` | FAIL (same assertion, same line) |
| Feature-only worktree | full web e2e | 100 pass, 1 fail (`:317` only) |
| Pure HEAD worktree (c485335, no uncommitted changes) | `-g` single test | FAIL |
| Pure HEAD worktree | `--repeat-each=3` | FAIL 3/3 |

Conclusion: failure reproduces on clean HEAD with no uncommitted changes, deterministically. Not caused by this feature, nor by the other plan's chapter edits. Pre-existing. Plan `261109-1709-self-host-first-run-and-ui-polish/plan.md:59` already records the same error at commit `7e0ed9e`. Not bisected further.

Worktree checks: feature patch = 28 tracked files + 14 untracked (list per task). Typecheck in feature worktree clean. Worktrees removed (`git worktree remove --force`), `git worktree list` shows only main.

## 3. Regression walk

| Test | Result | Changed vs HEAD? |
|---|---|---|
| `apps/api/test/translate-chain.test.ts` | PASS | no (empty diff) |
| `apps/api/test/tenant-isolation.test.ts` (with above, 2 files 37 tests) | PASS | yes (feature edit) |
| `worker/tests/test_translate_carry.py` + `test_openai_provider.py` (41 tests) | PASS | no |
| `packages/shared/test/shared-contracts.test.ts` (18 tests) | PASS | yes (feature edit, +34) |

Regressions found: none.

## Critical issues

- None blocking this feature.
- Pre-existing red e2e on main: `block-panel.spec.ts:317` fails on clean HEAD. Gate #5 ("e2e green") not met by a strict reading, but failure is independent of this feature.

## Recommendations

1. Fix or quarantine `block-panel.spec.ts:317` in its own change. Then re-run full e2e to get 101/101.
2. Bisect the spec back to `7e0ed9e` to find the breaking commit (the panel-delay logic in `features/chapter` is the suspect).
3. Keep the feature-only worktree check as a template for future "is this my failure" questions.

## Status

Status: DONE_WITH_CONCERNS
Summary: all gates green except web e2e 100/101. `block-panel.spec.ts:317` fails on clean HEAD (3/3 repeats), so it is not caused by series memory or the other plan's edits. Regression contracts pass.
Concerns/Blockers: pre-existing e2e failure blocks a clean "full e2e green" sign-off. Needs a separate fix.

## Unresolved questions

- Exact commit that introduced `:317` failure (only known as "at or before `7e0ed9e`").
- Whether the other plan's chapter edits should be committed before this feature to keep the main tree gate-clean.
