---
name: project-test-db-shared
description: API DB test suite (pnpm test) uses one shared Postgres test DB; never run it concurrently with another session — use test:unit (no Docker) for review checks
metadata:
  type: project
---

`pnpm test` in apps/api hits a single shared Postgres test DB (`fileParallelism: false`); a second concurrent run collides. `pnpm --filter @mtl/api test:unit` (vitest.unit.config.ts, test/unit/**) needs no DB and is always safe.

**Why:** controller explicitly forbade `pnpm test` during review on 2026-11-07 because another run was in progress.

**How to apply:** during reviews run test:unit, `pnpm --filter <pkg> typecheck`, `biome check`, and `pnpm --filter @mtl/web test`; mark DB-suite results as "not verified by reviewer".
