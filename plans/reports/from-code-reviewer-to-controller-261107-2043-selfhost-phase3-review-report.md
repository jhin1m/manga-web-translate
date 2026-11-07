# Code review — phase 3 self-host (Docker packaging)

Score: **7.5/10**. No blocker for merging the files. Nothing has been published yet, so nothing is live. Fix 5 medium issues before the first `v*` tag (M1 and M4 change what gets shipped; M2, M3 and M5 are wrong or missing docs).

Scope: infra/docker/* (6 files), docker-compose.yml, .github/workflows/release.yml, docs/self-host.md, README.md, docs/deployment-guide.md. Runtime code is untouched (`git status`: only docs, README and the plan are tracked changes), so the VPS path cannot regress.

## Checked myself (in addition to the controller's checks)
- `fonts.ts` reads `/app/worker/fonts/manifest.json`. The dockerignore re-include works (the file is in the image and `/app/worker` holds only `fonts/manifest.json`).
- No `.env*` anywhere in the app image. The worker image has no `.onnx`, tests, spikes or `modal_app.py`.
- Token handoff across images (OrbStack): the app entrypoint (root → chown → setpriv 1000) writes `worker/token` as 0600 1000:1000. The worker image (uid 1000, `:ro`) passes `load_token()`.
- `jobs` needs no egress: the runner only calls `ALERT_NTFY_URL` (not set) and the dispatcher, which is forced off in local mode. So `internal`-only is correct.
- Healthcheck uses `127.0.0.1`, which is in the local-guard allowlist. `MTL_ALLOWED_HOSTS=""` and `MTL_SKIP_BOOT_BACKUP=""` both go through `blank()`, so empty values are safe.
- tsx in the image is 4.23.15 with esbuild 0.28.2, matching the lockfile today (see M4). `/opt/tsx` is on PATH and setpriv keeps the env.
- Acceptance criteria in phase-03 are met based on the controller's evidence. Image size: app is about 510 MB unpacked (Docker reports 707 MB disk usage), worker is 751 MB, so both are under target.

## Medium

**M1 — `latest` moves on any `v*` tag, which can push a downgrade to users.** `.github/workflows/release.yml:46`
`type=raw,value=latest` is unconditional:
- A prerelease tag (`v1.3.0-rc.1`) moves `latest`.
- A hotfix tag on an older line (`v1.1.5` after `v1.2.0`) also moves `latest`.
- A non-semver tag (`vtest`) pushes only `latest`.
After `pull && up -d`, users get old code on a schema that has already been migrated. The docs say downgrades are not supported, and drizzle will not roll back. The old code runs on the new schema with no error at boot.
Fix: remove the raw line and rely on metadata-action's default `flavor: latest=auto`, which skips prereleases. Also add `enable=${{ !contains(github.ref_name, '-') }}` or a release rule: "only tag the newest line; hotfix the old line with `workflow_dispatch` and no latest."

**M2 — The restore / downgrade command does not fully restore the DB.** `docs/self-host.md:88-94`
`pg_restore --clean --if-exists -d mtl` drops only the objects that are in the archive:
- Tables, types and FKs created by newer migrations stay behind.
- An FK from a new table to an old table blocks `DROP TABLE`. pg_restore keeps going and returns non-zero, leaving a half-restored DB.
- `drizzle.__drizzle_migrations` goes back to the old rows. On the next upgrade the migration runs `CREATE TABLE` again and fails, and `app` restarts in a loop.
The controller's check most likely restored a dump of the same version, which does not show this. Line 94 ("Quay về bản cũ sau nâng cấp hỏng") is exactly the case that breaks.
Fix (app, jobs and worker are already stopped): `docker compose exec -T postgres pg_restore --clean --if-exists --create -U mtl -d postgres < data/backups/<file>.dump`. This drops and recreates the `mtl` database (user `mtl` is a superuser in the postgres image). Re-test by restoring an `m<N-1>` dump onto an `m<N>` DB.

**M3 — The documented full backup leaves the stack stopped on Linux.** `docs/self-host.md:77-78`
`docker compose stop && cp -a data … && docker compose start`: on Linux, `data/postgres` is 0700 and owned by uid 999, and `data/secrets` is 0700 and owned by uid 1000. A normal user's `cp` fails, `&&` stops the chain, and `start` never runs, so the app stays down. `cp -a` as non-root also cannot keep file ownership.
Fix: `docker compose stop; sudo cp -a data …; docker compose start` (or split into separate lines), and note that Linux needs `sudo`. The same applies to `rm -rf data` in "Gỡ cài" (line 113).

**M4 — tsx is pinned, but its dependencies are not pinned or vetted.** `infra/docker/app.Dockerfile:32`
`npm i tsx@${TSX_VERSION}` pins only tsx. esbuild (`~0.28`) and get-tsconfig are resolved from the npm registry at build time, with no lockfile and no pnpm `minimumReleaseAge` guard. The amd64 and arm64 builds each resolve separately. A release image can therefore contain a just-published transitive version (a supply-chain risk, and not reproducible). It matches the lockfile today only because nothing new has been published.
Fix (pick one):
- (a) Move `tsx` into `dependencies` of `@mtl/api`. systemd runs tsx in production, so it really is a runtime dependency. This is outside the phase boundary, so the controller or user must approve it.
- (b) Commit `infra/docker/tsx/package.json` plus `package-lock.json` and use `npm ci`.
- (c) Use `pnpm deploy`.

**M5 — The docs do not set a minimum Docker Engine version, but the no-auth model depends on it.** `docs/self-host.md:13`
The "nobody else can reach it" guarantee rests entirely on the `127.0.0.1` port binding. The Host allowlist does not protect against a LAN attacker, because a non-browser client can send `Host: localhost`.
- Docker Engine < 28 on Linux does not block LAN hosts on the same L2 from reaching the container IP directly (`web` network 172.x:8080).
- Docker Engine 28.2.0–28.3.2 has CVE-2025-54388: after a firewalld reload, ports published on `127.0.0.1` can be reached from outside.
Fix: require **Docker Engine ≥ 28.3.3 on Linux** in Yêu cầu. While editing that section, also state Compose ≥ 2.17 (see L3).

## Low

- **L1 — Model download ignores stop signals and leaves temp files.** `infra/docker/worker-entrypoint.sh:15`
  `fetch_models.py` runs as a child of `sh`, and `sh` is PID 1. PID 1 has no SIGTERM handler, so the signal is ignored. A `stop`, `down` or update (`restart: true`) during the first download waits 30 s and then sends SIGKILL. Each kill leaves an orphaned `*.part` file (mkstemp gives each one a different name), about 100–340 MB, and nothing ever cleans them up.
  Fix: in the root block, add `find "$models" -maxdepth 1 -name '*.part' -delete` (compose runs only one worker per directory). Optionally add `trap`/`wait` forwarding or `init: true`.
- **L2 — The docs install the compose file from `main`, which can be ahead of the image.** `docs/self-host.md:22`, README
  Users download the compose file from raw `main`, but the `latest` image comes from the last tag. If `main` adds an env var or service before a release, new users get a compose file that does not match the image.
  Fix: link the compose file from the tag, or attach it to the GitHub Release (`releases/latest/download/docker-compose.yml`, which needs `contents: write`). If the repo is private, the raw URL returns 404.
- **L3 — `depends_on.restart` needs Compose ≥ 2.17.** Older distro builds of `docker-compose-v2` fail validation. The docs only say "Compose v2".
- **L4 — Dockerignore may let `.env` files from a dev tree into local builds.** `app.Dockerfile.dockerignore:7`, `worker.Dockerfile.dockerignore:3`
  `.env*` only matches at the root, and the worker whitelist includes all of `worker/`. A local build from a dev tree that has `apps/*/.env.local` or `worker/.env` would bake secrets into the image. CI builds from a clean checkout, so CI is safe.
  Fix: use `**/.env*` in both files.
- **L5 — Small doc inaccuracies.**
  - `docker image rm ghcr.io/jhin1m/mtl` removes only `:latest`.
  - "Worker chạy thẳng trên máy" on Linux: the token file is 0600 and owned by uid 1000, so `token.py` rejects it unless the host user is uid 1000.
  - The retention rule omits "3 phiên bản schema gần nhất" (line 83).
- **L6 — Build cache: dependencies are reinstalled on every source change.** `app.Dockerfile:28-34`
  The prod reinstall and the tsx download from npm both come after `COPY . .`, so every source change re-runs them. Building prod `node_modules` in a stage that copies only the manifests would cache them. The prod tree also carries drizzle-kit, 3× esbuild and react-dom, about 60 MB pulled in by better-auth peers (informational).

## Accepted deviations (recorded in the phase file, reasons verified)
- `name: mtl-local` avoids a clash with `-p mtl` on the VPS.
- Worker `WORKDIR /app/worker` keeps the repo layout, so `DEFAULT_SCHEMA_DIR` and `WORKER_DIR` resolve correctly.
- tsx lives in `/opt/tsx` rather than `node_modules/.bin`.
- No `HEALTHCHECK` in the Dockerfile, because the image is shared with `jobs`.

## Unresolved questions
1. Is the repo public? If not, the raw URL in the docs and README returns 404 for users even after the GHCR images are made public.
2. Should M4(a) (moving tsx to `dependencies`) be accepted, given it touches `apps/api/package.json`, which is outside the phase boundary?
