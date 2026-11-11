# Phase 5 docs report

Files changed:
- `docs/job-queue-worker.md`: after `carry` added "Trí nhớ series" (write/read rules) and "Gợi ý từ AI" (limits 50/30, prompt 5/3/300); version history gains 0.11.0 (MIN_PIPELINE_VERSION unchanged).
- `docs/export-and-batch-edit.md`: new subsection "Gợi ý từ AI" under Glossary (filters, dedup keys, cap 200, accept/dismiss, known limitation) + API table (GET suggestions, PATCH series-suggestions).
- `docs/project-roadmap.md`: "Cần đo" item with smoke report link (pronoun yield 0 vs 4); migration 0026 in Deploy list; worker 0.11.0 optional.
- `docs/deployment-guide.md`: short note before OCR checklist (additive migration, any deploy order, down file).
- plan `plan.md` and `phase-02-worker-learned-terms.md`: noted final 5/3/300 values and reason.

Verified in code: `series_suggestions`, `translate_memory`, routes, `MAX_LEARNED_TERMS/PRONOUNS` (50/30), `MAX_PENDING_PER_KIND` (200), worker `PIPELINE_VERSION` 0.11.0. Roadmap link resolves. Largest doc 540 lines.
Not verified: memory write conditions are taken from the brief (series-memory.ts under edit).

Status: DONE
Summary: Docs and plan cross-references updated to the final behavior.
