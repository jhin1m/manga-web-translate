# Release v0.2.0-rc.1: self-host smoke + upgrade 0.1.0 → 0.2.0-rc.1

**Date:** 2026-11-11 (Asia/Saigon)
**Images:** `ghcr.io/jhin1m/mtl:0.2.0-rc.1`, `ghcr.io/jhin1m/mtl-worker:0.2.0-rc.1`
**Both labels:** `org.opencontainers.image.revision=508a3b955d62d91e945c87f94ce7dda90212b931`, `version=0.2.0-rc.1`
**Digests:** mtl `sha256:0a4cdb22…ab48`, mtl-worker `sha256:2a2b4bef…2462`. Manifests are multi-arch (linux/amd64 + linux/arm64). Run host was arm64.
**Public:** anonymous GHCR manifest requests return 200 for both repos.
**Compose:** `docker-compose.yml` is byte-identical between `v0.1.0` and `HEAD` (`git diff v0.1.0 HEAD -- docker-compose.yml` is empty).

## Verdict

**Safe to tag v0.2.0 for the self-host install and upgrade path.** Smoke passes on the rc images. The 0.1.0 → 0.2.0-rc.1 upgrade migrates, backs up, and keeps data intact. The worker connects with no 426. The AI translate path that writes the new memory and suggestions was NOT exercised here (no LLM provider; see Concerns).

## 1. Self-host smoke (rc images)

Command:
```
docker pull ghcr.io/jhin1m/mtl:0.2.0-rc.1
docker pull ghcr.io/jhin1m/mtl-worker:0.2.0-rc.1
docker tag ghcr.io/jhin1m/mtl:0.2.0-rc.1 ghcr.io/jhin1m/mtl:smoke
docker tag ghcr.io/jhin1m/mtl-worker:0.2.0-rc.1 ghcr.io/jhin1m/mtl-worker:smoke
SMOKE_SKIP_BUILD=1 SMOKE_PORT=18082 SMOKE_MODELS_CACHE=<repo>/worker/models infra/selfhost-smoke.sh
```

Deviations:
- Port 18080 was held by a host process (PID 2007, Python, not ours). Used 18082. Not touched.
- Model cache: `worker/models` (dev dir). All 10 files in `worker/models.lock.json` matched sha256 before use. Smoke copies it, so no download.

| Check | Result |
|---|---|
| Pull + tag + revision label | PASS |
| Smoke `SMOKE OK`, exit 0 | PASS (51.0s total) |
| Draw test page (JP text) | PASS (3s) |
| Model cache copy | PASS (1s) |
| First `up`, DB empty → no backup | PASS (12s) |
| HTTP: SPA, local_mode, upload, page.prepare, export | PASS (12s) |
| OCR `pages.ocr_result` matches drawn text | PASS (0s). 18/18 chars, 2 blocks |
| down/up keeps data, verify | PASS (13s) |
| Restart app → +1 boot backup (1 → 2) | PASS (8s) |
| Port bind 127.0.0.1 only, postgres not published, secrets/token 600 | PASS (1s) |
| Cleanup: no `mtl-smoke` containers/networks/volumes, no temp dir left | PASS |

## 2. Upgrade 0.1.0 → 0.2.0-rc.1

Project `mtl-upgrade`, `MTL_PORT=18081`, temp dir under scratchpad (removed afterward).

Commands (summary):
```
git show v0.1.0:docker-compose.yml > docker-compose.yml
MTL_TAG=0.1.0 MTL_PORT=18081 docker compose -p mtl-upgrade up -d --wait
bash scratchpad/scripts/seed-upgrade.sh http://127.0.0.1:18081 page.png state.json   # series + chapter + 1 page upload
POST /api/chapters/<id>/commit  body {"target":"prepared"}  → 202
git show HEAD:docker-compose.yml > docker-compose.yml        # identical to v0.1.0
MTL_TAG=0.2.0-rc.1 MTL_PORT=18081 docker compose -p mtl-upgrade pull
MTL_TAG=0.2.0-rc.1 MTL_PORT=18081 docker compose -p mtl-upgrade up -d
docker compose -p mtl-upgrade exec -T postgres psql -U mtl -d mtl -AtX -c ...
docker compose -p mtl-upgrade down -v --remove-orphans ; busybox rm -rf data ; rm -rf <tmp>
```

Deviation: the 0.1.0 worker model dir was pre-filled with the same sha-verified cache, so no 1.1 GB download. A real first-time update would download it.

Baseline before upgrade (v0.1.0): 26 migrations applied (0000–0025), latest `created_at` `1793780673823`. No `chapters.translate_memory`, no `series_suggestions`. Seeded: 1 series, 1 chapter (`prepared`), 1 page (OCR result md5 `1de0c6f4…`). `GET /api/series/:id/suggestions` → 404 (route absent in 0.1.0, expected).

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | v0.1.0 stack healthy | PASS | up 13s, app healthy, `/readyz` ok |
| 2 | Seed series + chapter, prepare on 0.1.0 worker | PASS | chapter `prepared` ~21s after commit |
| 3 | Update: compose swap + `pull` + `up -d` | PASS | pull 18s, up 13s, exit 0 |
| 4 | `app` healthy after update | PASS | Healthy ~5s after recreate, restart count 0 |
| 5 | Boot backup before migrate | PASS | `data/backups/mtl-20261111T142415Z-m26.dump`. Boot log: `backup …` → `migrate xong` |
| 6 | Migration 0026 applied | PASS | 27 applied. `chapters.translate_memory jsonb`. `series_suggestions` table exists |
| 7 | Old data intact | PASS | Series, chapter, page rows identical before/after. Page `ocr_result` md5 identical. API series/chapter/pages equal except signed-URL `exp`/`sig` |
| 8 | `GET /api/series/:id/suggestions` on old series | PASS | HTTP 200, body `{"terms":[],"pronouns":[]}` |
| 9 | `jobs` + `worker` restart cleanly | PASS | RestartCount 0 for app, jobs, worker-1, worker-2 |
| 10 | Worker connects, no 426 | PASS | Both workers log `mtl-worker 0.11.0 … mode=loop threads=6`. App log: `/worker/v1/claim` 200 ×8, zero 4xx/5xx |
| 11 | New chapter end-to-end on 0.2.0 stack | PASS | `chapter.ingest` succeeded, `page.prepare` succeeded (attempts 1, no error). Chapter `prepared` in 7s |
| 12 | `translate_memory` on chapters | PASS | NULL on old and new chapters (expected until a translate runs) |
| 13 | Teardown: `down -v`, data removed, temp dir removed | PASS | No `mtl-upgrade` containers/networks/volumes left. Port 18081 released |
| 14 | Dev stack untouched | PASS | `mtl-dev-files-proxy-1`, `mtl-dev-postgres-1`, `mtl-dev-minio-1` unchanged (same uptime as before). No mtl-dev or other-project containers touched |

## 3. Timings

| Step | Time |
|---|---|
| Smoke total | 51.0s |
| Smoke: first up (DB empty) | 12s |
| Smoke: HTTP + page.prepare + export | 12s |
| Smoke: down/up | 13s |
| Smoke: restart + backup | 8s |
| Upgrade: v0.1.0 up (cached models) | 13s |
| Upgrade: v0.1.0 prepare of seeded chapter | ~21s |
| Upgrade: `pull` 0.2.0-rc.1 (both images, cached layers) | 18s |
| Upgrade: `up -d` (stop jobs/worker → recreate app → migrate → restart) | 13s |
| Upgrade: new chapter ingest + prepare on 0.2.0 | 7s |

## 4. Log errors (redacted)

- Smoke log: none (no `error`, `warn`, `426`, traceback).
- App, jobs, worker logs on 0.2.0-rc.1: no warn/error/fatal lines, no 426, no traceback.
- Postgres log: 6 `syntax error` lines. These came from MY malformed verification SQL (quoting), not from the app. Not a release issue.
- v0.1.0 container logs were discarded when `up` recreated the containers. Not reviewed.

## 5. Concerns

1. **AI path not exercised.** The smoke and upgrade run have no LLM key. `chapter.translate` (where the new memory and `series_suggestions` rows get written) and `series-suggestions` dismiss (`PATCH`) never ran on the rc image. Covered only by CI unit tests (`apps/api/test/series-memory.test.ts`, worker tests). Recommend one manual translate on the rc image with a real provider before the final tag, if budget allows.
2. **amd64 not run.** Manifest has linux/amd64, but this host is arm64. Windows users will pull amd64. Recommend smoke on an amd64 host or CI.
3. **Clean first-run download not exercised.** Model cache was pre-filled. A new user downloads ~1.1 GB on first worker start.
4. **Rollback not tested.** Docs say no downgrade. Restoring the `mtl-…-m26.dump` backup to 0.1.0 was not tested (out of scope here).

## Unresolved questions

- Should v0.2.0 wait for one real translate run on the rc image (concern 1)?
- Is an amd64 smoke run part of the release checklist, or is CI sufficient?
- Should the first-run model download be timed on a clean machine for the release notes?
