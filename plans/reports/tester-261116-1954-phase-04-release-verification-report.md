# Phase 4 release verification (2026-11-16)

Scope changed twice mid-run (CPU load). Final scope: gate + arm64 image + update substitute. RAM, thumbnail stress, amd64 rebuild, Windows dropped.

## Results

| Step | Result | Key numbers |
|---|---|---|
| typecheck (`pnpm typecheck`) | PASS | all packages |
| lint (`pnpm lint`, biome) | PASS | 498 files, no fixes |
| unit tests (`pnpm test`) | PASS | shared 124/124, web 552/552, db 8/8, api 762 passed + 1 skipped (763) |
| worker `uv run pytest` | PASS | 421 passed, 21.4s |
| web e2e (`pnpm e2e`, 1 worker) | 1 FAIL | 119 passed, 1 failed of 120, 9.0 min |
| docker arm64 build (`app.Dockerfile`) | PASS | inspect size 764.5 MB (v0.3.0 arm64: 694.4 MB, +70 MB) |
| sharp in arm64 image | PASS | `require('sharp')` ok, sharp 0.35.5, Node v24.22.3; 10x10 WebP = 44 bytes |
| amd64 image | PASS (earlier, pre-scope-cut) | 709 MB; sharp ok, WebP 44 bytes. No further amd64 work; CI multi-arch on rc is the real check |
| self-host smoke (`selfhost-smoke.sh`) | PARTIAL | run 1 failed: port 18080 held by host process `steam-access-fix` (not product). run 2 on `SMOKE_PORT=18090` reached "verify OK: chapter prepared, 1 page, export 37598 bytes" at 13:14:16Z, then stopped by me for scope. Backup-on-restart and down/up steps not reached |
| update smoke (`selfhost-update-smoke.sh`) | BLOCKED as scripted | requires TO as GHCR tag + git tag; local `:smoke` cannot be used. Needs an rc pushed to GHCR (not done, per no-push rule) |
| update smoke, manual substitute | PASS | see below |

### Manual upgrade substitute (v0.3.0 → local build)
- Stack: v0.3.0 compose (`git show v0.3.0:docker-compose.yml`), `ghcr.io/jhin1m/mtl:0.3.0` (pulled read-only), `MTL_UPDATER=0`. Only `postgres` + `app` started.
- Before: 29 migrations applied, no `series.cover_key`. Seeded 1 series row.
- Upgrade: `MTL_TAG=smoke` (local arm64 build of current tree), `docker compose up -d app`.
- Boot log: `[boot] backup /data/backups/mtl-…-m29.dump` → `migrate xong` → `api listening`. `/readyz` 200.
- After: 30 migrations; `series.cover_key` text, nullable; seeded row preserved (`upgrade-check`, cover_key NULL).
- Gap: only `app` upgraded. `jobs` and workers stayed on 0.3.0, so mixed-version state not tested.

### e2e failure
`apps/web/e2e/block-panel.spec.ts:317` (known baseline):
```
Error: expect(locator).toBeHidden() failed
> 339 |   await expect(blockPanel(page)).toBeHidden();
```
Baseline on v0.3.0 NOT confirmed (would need worktree + install; skipped for CPU). `editor.spec.ts:111` passed; no flake observed, so no rerun.

### Not run (dropped by scope)
- RAM delta (`docker stats`) during ~20 thumbnails.
- 20-chapter series thumbnail check (302 + WebP ≤ 40 KB).
- Windows user test; docs/release notes; tag/release (not allowed).

## Cleanup
- Stacks `mtl-smoke`, `mtl-upd-manual` torn down, temp dirs removed. `mtl-dev-*` left running.
- Local images kept: `ghcr.io/jhin1m/mtl:smoke`, `mtl-worker:smoke`, `mtl-verify:arm64`, pulled `mtl:0.3.0` + `mtl-worker:0.3.0`. `mtl-verify:amd64` removed.
- Repo: no product files changed by me. `git status` shows others' pending edits (README, docs, docs/releases/v0.4.0.md, a docs report). Not mine.

## Critical issues
- None blocking the arm64 image or the upgrade path.
- Update smoke as scripted cannot run without an rc pushed to GHCR.

## Recommendations
1. Run `infra/selfhost-smoke.sh` to completion (SMOKE_PORT free, SMOKE_MODELS_CACHE=worker/models) before tagging.
2. Push rc to GHCR, then run `FROM=0.3.0 TO=0.4.0-rc.1 infra/selfhost-update-smoke.sh`.
3. Measure RAM + thumbnail 302/WebP size in a separate low-load session.
4. Confirm block-panel:317 baseline on v0.3.0 (worktree) so the failure is classed as pre-existing.

## Unresolved questions
- Is block-panel.spec.ts:317 really pre-existing on v0.3.0? Not confirmed.
- Does update smoke need a real rc tag (GHCR push) for the release flow? Yes per script; user to decide.
- Thumbnail RAM delta and 302/WebP ≤ 40 KB check still unmeasured.
- Mixed-version (app 0.4 + jobs/worker 0.3) behaviour untested.

Status: DONE_WITH_CONCERNS
Summary: Gate green (typecheck, lint, 1446 unit tests, 421 pytest), e2e 119/120 with the known block-panel:317 failure. arm64 image builds and loads sharp; manual v0.3.0→local upgrade applies migration 0029 with data intact. Full selfhost smoke, scripted update smoke (needs GHCR rc), RAM and thumbnail checks remain open.
Concerns/Blockers: scripted update smoke blocked on GHCR rc push; selfhost smoke not run to completion.
