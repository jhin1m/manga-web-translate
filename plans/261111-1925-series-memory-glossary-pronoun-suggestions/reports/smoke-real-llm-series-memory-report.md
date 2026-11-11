# Phase 6 smoke report: series memory with real LLM

Verdict: **PASS on run 2** (after the planned prompt fallback). Run 1 failed the normalized token threshold by 0.4pp. Single sample, 2 chapters: treat as a gate, not a statistic.

## Setup
- Worker: `worker/` 0.11.0, `--provider anthropic` (from `MTL_PROVIDER` in `.env`), model in `ai_state.meta`: `claude-haiku-5-5`. OCR/prepare ran on the local pipeline (ledger: gpu_seconds, $0).
- Source: 43 original webp images of dev chapter "Prince Seal Rebellion Log" #3 (en→id, strip mode, 33 pages, translated by worker 0.10.0 = baseline). Downloaded through the source-files URLs and re-uploaded to a new series as 2 chapters split at file boundary: ch1 = files 0–21 (17 pages), ch2 = files 22–42 (16 pages). Same story, sequential.
- Series: run 1 `01a1cab4-d580-7440-97a0-ca1c247ca592`, run 2 `01a1cabd-e412-70d7-9e00-eae024046843` (fresh, no prior glossary).
- Procedure per run: upload both chapters, commit ch1 (`target: translated`), wait `review`, read suggestions, accept, commit ch2 only after acceptance (so ch2 sees accepted glossary/rules), wait `review`, measure.
- Accepted in run 1: term "Donghae Kingdom", term "Your Highness", pronoun rule ajudan→Haegyeol (saya/yang mulia). Run 2: terms "Prince Haegyeol", "Donghae Kingdom", "HIS HIGHNESS" (no pronoun suggestion appeared).
- Cost: LLM ≈ $0.023 for all four chapters (run 1 ≈ $0.012, run 2 ≈ $0.011). Ledger shows no OCR LLM cost.

## Metrics vs thresholds

Baseline (0.10.0, same chapter, 33 pages, 9 jobs): out tokens 12304 → **372.8 per page**, **1367 per batch** (batches avg 3.7 pages).

| Metric | Threshold | Run 1 (prompt 8/5, notes 500) | Run 2 (fallback 5/3, notes 300) | Result |
|---|---|---|---|---|
| New `schema` translate jobs | 0 added | 0 | 0 | PASS |
| Out tokens per page vs baseline | ≤ +15% | 430.1 (**+15.4%**) | 384.2 (**+3.1%**) | FAIL run 1, PASS run 2 |
| Out tokens per batch vs baseline (literal) | ≤ +15% | 1419 (+3.8%) | 1268 (−7.2%) | PASS both, but batches are 3.3 pages vs 3.7 baseline, so not comparable |
| Ch2 first batch `carry` == ch1 `translate_memory` (minus langs) | yes | yes | yes | PASS |
| Ch1 ≥ 9 pages, ≥ 3 batches | yes | 17 pages, 5 batches | 17 pages, 5 batches | PASS |
| Usable suggestions in ch1 | ≥ 1 | 2 terms + 4 pronoun (6 visible) | 3 terms, 0 pronoun | PASS |
| Junk ratio in ch1 suggestions | ≤ 50% | 3/6 = 50% (borderline) | 0/3 (1 title kept, judged useful) | PASS, borderline run 1 |
| Ch2 names consistent with ch1 | yes | partial (DONGHAE, YANG MULIA kept; HAEGYEOL not in ch2 text) | partial (DONGHAE, Yang Mulia; Yeohan new) | weak evidence |
| `chapters.translate_memory` written | yes | yes (notes + empty characters) | yes | PASS |

Per-job out tokens (order = batch order):
- Baseline: 680(1p), 1768, 1311, 1533, 1463, 1439, 1022, 1705, 1383
- Run 1 ch1: 854(1p), 2004, 1507, 1785, 1560; ch2: 470(1p), 1558, 1120, 1963, 1373
- Run 2 ch1: 715(1p), 1800, 1310, 1566, 1507; ch2: 455(1p), 1331, 1043, 1768, 1185

Guard: 4096 output tokens. Highest batch observed: 2004 (run 1). Headroom about 2x.

## Suggestion quality (names only)
Good:
- term Donghae Kingdom → Kerajaan Donghae (place), both runs
- term Prince Haegyeol → Pangeran Haegyeol (person), run 2
- pronoun ajudan → Haegyeol, saya/yang mulia, run 1

Bad:
- speaker "Tokoh pencari" (generic label, not a name), pronoun → Pangeran (run 1)
- listener "Manusia" (generic "human", not a character), run 1
- near-duplicate: ajudan → Pangeran Haegyeol after ajudan → Haegyeol was already accepted. D7 key (speaker, listener) does not merge listener name variants.
- "DesireScans" (scanlation group) was returned as a new term in run 1. Only the D8 identical-translation filter hid it. Prompt exclusion did not work.
- Accepted/glossary terms re-listed in ch2 new_terms (run 2 "Donghae Kingdom"). API hides them correctly.

Filtered correctly by D8 (identical source/target): Haegyeol, Donghae, Yeohan, THE LITTLE MERMAID, uppercase duplicates.

Other observation: run 1 ch1 batch 4 `context_notes` reached ~530 chars against the prompt's ≤ 500 target. Contract cap is 2000, so no failure. Run 2 ch1 notes: 201, 293, 213, 277, 332 chars (one batch still over 300).

## Fallback applied
Run 1 normalized tokens +15.4%, over the threshold. Applied the plan's fallback: `worker/mtl_pipeline/prompts/translate_batch.md` new_terms 8 → 5, pronoun_pairs 5 → 3, context_notes 500 → 300. Worker restarted to load it. Run 2 re-ran the full procedure on a fresh series. `pytest tests/test_translate_learned.py`: 22 passed after the edit.

Trade-off: run 2 produced 0 pronoun suggestions in 2 chapters (run 1 produced 4 in ch1). Either the lower limit or sample variance. Not separable with n=1.

## Environment changes
- Old dev worker (0.10.0, PID 18294 uv / 18332 python) stopped with SIGTERM, exited in ~2s, no jobs in flight.
- Worker started from project root with the user's original command, `nohup uv run --directory worker --env-file ../.env mtl-worker`:
  - PID 5395 / 5397 at 20:03 (run 1), stopped at 20:13 for the prompt change.
  - **Current: PID 22498 (uv) / 22500 (python), started 20:13.** Running 0.11.0 code with the fallback prompt. This is the final state.
  - Logs: `/private/tmp/claude-501/-Users-jhin1m-Desktop-ducanh-project-manga-web-translate/4b61cf4f-dcbb-4297-ab59-bbda52d5b4d0/scratchpad/worker-0.11.0.log` and `.../worker-0.11.0-run2.log`.
- Dev DB test data left behind: 2 series ("Smoke series memory 261111", "... run2"), 4 chapters, 5 glossary entries, 1 pronoun rule (run 1 series). Delete when done.
- Baseline series "Prince Seal Rebellion Log" untouched.
- Repo: only `worker/mtl_pipeline/prompts/translate_batch.md` edited (fallback). Not committed. No API keys or tokens printed.

## Unresolved questions
1. Keep the fallback limits (5/3/300) or revert to 8/5/500? Trade-off: tokens (+15.4% vs +3.1%) against pronoun yield (4 vs 0). Needs a decision, and possibly a 3rd run to tell variance from effect.
2. Docs drift if fallback kept: `plan.md` (line 28, risk table) and `phase-02` still cite 8/5 and 500. Phase 5 docs should match the final values.
3. Why does `carry.characters` stay empty in ch1 (both runs)? Speakers may be unnamed in those pages (baseline also had 0 for its first 5 batches). Not verified against speaker fields.
4. Watermark/group names can leak into new_terms. Only the D8 filter catches them. Worth a worker-side filter or prompt example?
5. D7 does not dedupe pronoun listener-name variants. Decide whether to normalize listener in the key or accept it.
6. Sample is 1 series, 2 chapters, one run each. Variance is unmeasured.

Status: DONE_WITH_CONCERNS
Summary: Smoke with real Anthropic worker passed on run 2 after the planned prompt fallback: 0 schema errors, +3.1% out tokens per page vs baseline, ch2 carry matches ch1 memory. Run 1 was borderline (+15.4%) and run 2 produced zero pronoun suggestions.
Concerns/Blockers: Fallback limits are still in the prompt file and cost pronoun recall. Test data left in dev DB. Decision needed on the limits.
