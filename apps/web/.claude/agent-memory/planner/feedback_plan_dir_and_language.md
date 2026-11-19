---
name: feedback-plan-dir-and-language
description: Plans for this monorepo go under repo-root plans/ (not apps/web/plans from the hook), written in Vietnamese with diacritics
metadata:
  type: feedback
---

Plans and plan replies are written in Vietnamese with diacritics. Plan dirs live at repo root
`/Users/jhin1m/Desktop/ducanh-project/manga-web-translate/plans/<yymmdd-hhmm-slug>/` (plan.md short + phase-XX-*.md).
When the caller gives an explicit plan dir, use it over the SubagentStart hook's `apps/web/plans/...` naming.

**Why:** the planner subagent starts with CWD `apps/web`, so the hook injects wrong paths; every existing plan lives at
repo-root `plans/`. User's prompts are in Vietnamese and asked explicitly for Vietnamese output.

**How to apply:** check the task prompt for a plan dir first; never create `apps/web/plans/`. Run
`node ~/.claude/scripts/set-active-plan.cjs plans/<dir>` from repo root (no repo-local script; `ck` CLI absent).
Also: user prioritizes stability over features and delegates minor decisions — record self-made decisions with
reasons in a "Quyết định tự chốt" table instead of asking. See [[project-series-memory-design]].
