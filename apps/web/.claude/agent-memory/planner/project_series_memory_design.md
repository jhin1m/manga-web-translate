---
name: project-series-memory-design
description: Series memory feature (2026-11-11) design choices - reuse payload carry, suggestions hidden-when-covered, no MIN_PIPELINE bump
metadata:
  type: project
---

2026-11-11 plan `plans/261111-1925-series-memory-glossary-pronoun-suggestions/`: AI suggests glossary terms + pronoun
pairs (user Nhận/Bỏ at series level, never auto-add), and chapter-end `carry` seeds the next chapter.

Key non-obvious choices: memory reuses existing `payload.carry` so the payload contract is unchanged (worker payload
schema has `additionalProperties: false` — any new payload field forces a `MIN_PIPELINE_VERSION` bump + worker-first
deploy); new result keys are optional and safe in any deploy order (API zod strips unknown keys). API
`PIPELINE_VERSION` (input_rev salt) must never be bumped for prompt changes — it would mark every page stale.
Memory source = nearest other chapter by number (lower first), written only from full-chapter runs.

**Why:** user ranks stability above features; deploy-order freedom avoids 426 queue stalls.

**How to apply:** for future translate-pipeline changes, prefer optional result keys / existing payload fields over new
payload fields; check status of this plan before proposing overlapping work.
