# Project sync: series memory completion

Date: 2026-11-11.

## Done
- `plan.md`: frontmatter `status: completed`, Phases table all 6 `completed`, added `## Kết quả` (6 criteria measured, decisions, limitations, leftovers).
- `phase-01..06`: frontmatter `status: completed`. No checkboxes in any phase file, nothing to tick or leave unchecked.
- Open questions: Q2 (smoke cost) marked resolved (~$0.023, 4 chapters). Q1 (editor hint) kept open as later idea.

## Criteria vs evidence
| # | Result |
|---|---|
| 1-2, 4 | Met (API 564 pass / 1 skip after last fixes) |
| 3 | Met (series-suggestions e2e green) |
| 5 | Mostly met: web unit 462, worker 414, lint/typecheck/ruff green. E2E 100/101, `block-panel.spec.ts:317` pre-existing on clean HEAD c485335 (3/3 repeats) |
| 6 | Met on run 2: 0 schema errors, +3.1% out tokens/page (run 1 +15.4%, fallback to 5/3/300), ch2 carry = ch1 memory |

## Risks and concerns
- Strict "e2e green" gate not met: `block-panel.spec.ts:317` needs separate fix, owner unassigned.
- Pronoun suggestion yield 0 in smoke run 2 (n=1, variance vs lower limits unseparated). Tracked under roadmap "Cần đo".
- Known limits: suggestions lack language pair; resume after quota stop writes no memory; badge not live on series page.
- Leftovers: smoke data in dev DB (2 series, 4 chapters); dev worker on 0.11.0 code predating last `？` tweak (API filters it).

## Next actions
- User: delete smoke series; restart dev worker.
- Main agent: separate change for `block-panel.spec.ts:317`; DoD = full e2e 101/101.
- Note: I read plan.md, all phase files, and the final-test, smoke, fix-review reports in full. Did not open the phase-01..05 reports or the two code-review reports; figures for API 564 come from the task brief (fix-review report says 561, final-verification 561+1 skip, taken before the last fixes).

## Unresolved questions
- Commit that introduced `block-panel.spec.ts:317` failure (at or before 7e0ed9e).
- Whether the other plan's uncommitted chapter edits should land before this feature.
- Whether to run a 3rd smoke to separate pronoun yield variance from the 5/3/300 effect.

Status: DONE_WITH_CONCERNS
Summary: Plan and all 6 phases set to completed, results section added, Q2 resolved. Plan is done; the only open gate item is the pre-existing e2e failure, which is outside this plan.
