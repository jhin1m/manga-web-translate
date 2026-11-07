---
phase: 3
title: "Dockerfile API + worker, docker-compose.yml, release workflow, docs"
status: completed
priority: P1
effort: "0.75d"
dependencies: [2]
---

# Phase 3: Image, compose, release, docs

## Overview
Đóng gói 2 image (`ghcr.io/jhin1m/mtl` cho `app`/`jobs`, `ghcr.io/jhin1m/mtl-worker`), `docker-compose.yml` 4 service ở gốc repo,
workflow build đa nền tảng khi push tag `v*` (chỉ tạo file, không kích hoạt), `docs/self-host.md` + README.

## Context
- Plan: [plan.md](plan.md) — Decisions 9, 10, 13–17. Phase 2 đã có `bootLocal`, `/readyz`, `SPA_DIR`, `/data/{secrets,files,backups,worker}`.
- Cách chạy hiện tại: `infra/systemd/mtl-api.service:15` (`tsx src/index.ts`, cwd `apps/api`), `infra/systemd/mtl-jobs.service:14` (`tsx src/jobs/runner.ts`).
- Compose prod tham khảo: `infra/docker-compose.prod.yml` (postgres:17 + healthcheck `pg_isready`). CI: `.github/workflows/ci.yml`.
- Monorepo: `package.json` (`packageManager: pnpm@12.14.0`, node ≥ 24), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `packages/` (db, shared…), `apps/{api,web}`.
- Worker: `worker/pyproject.toml` (python 3.12, script `mtl-worker`), `worker/uv.lock`, `worker/models.lock.json`,
  `worker/scripts/fetch_models.py` (tải + kiểm sha256, bỏ qua file đúng), `worker/mtl_pipeline/models.py:59` (`MTL_MODELS_DIR`),
  `worker/mtl_worker/token.py` (file token 600 + cùng uid), `worker/mtl_worker/job_fonts.py:26` (`MTL_FONT_CACHE_DIR`), `worker/fonts/`.
- Docs hiện có: `docs/deployment-guide.md` (runbook VPS), `README.md`.

## Requirements
- Functional
  - `infra/docker/app.Dockerfile` (context = gốc repo):
    - `base`: `node:24-bookworm-slim`, `npm i -g pnpm@12.14.0`, `WORKDIR /app`.
    - `build`: `apt-get install python3 make g++` (fallback build `re2` khi không có prebuilt, nhất là arm64); copy manifest
      (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, mọi `apps/*/package.json`, `packages/*/package.json` cần cho `@mtl/api...` và `@mtl/web...`) →
      `pnpm install --frozen-lockfile --filter "@mtl/api..." --filter "@mtl/web..."` → copy source → `pnpm --filter @mtl/web build`.
      Kiểm `pnpm-workspace.yaml` có cho phép build script của `re2` (pnpm ≥ 10 chặn postinstall mặc định) — nếu chưa thì thêm vào `onlyBuiltDependencies`/`allowBuilds` theo cú pháp repo đang dùng.
    - `runtime`: từ `base`; cài `postgresql-client-17` qua repo apt PGDG (`apt.postgresql.org`, key ở `/usr/share/keyrings`, `bookworm-pgdg`), dọn `curl gnupg` + apt lists;
      `COPY --from=build /app /app`; `ENV NODE_ENV=production MTL_LOCAL_MODE=1 API_PORT=8080 MTL_DATA_DIR=/data SPA_DIR=/app/apps/web/dist`;
      `WORKDIR /app/apps/api`; `EXPOSE 8080`; `ENTRYPOINT ["/usr/local/bin/app-entrypoint.sh"]`, `CMD ["app"]`.
  - `infra/docker/app-entrypoint.sh` (POSIX sh): nếu uid 0 → `mkdir -p` + `chown 1000:1000` các thư mục `/data/{files,secrets,backups,worker}` (không đệ quy vào dữ liệu lớn; `-R` chỉ cho `secrets`, `worker`), `chmod 700 /data/secrets`,
    rồi `exec setpriv --reuid=1000 --regid=1000 --init-groups "$0" "$@"`. Sau đó: `app` → `exec node_modules/.bin/tsx src/index.ts`; `jobs` → `exec node_modules/.bin/tsx src/jobs/runner.ts`; khác → `exec "$@"`.
  - `infra/docker/worker.Dockerfile` (context = gốc repo): `python:3.12-slim`; copy `uv` từ image `ghcr.io/astral-sh/uv:<phiên bản cố định>` (ghim đúng bản `uv --version` máy dev, không dùng `latest`);
    `useradd -u 1000 -m mtl`; `WORKDIR /app`; copy `worker/pyproject.toml worker/uv.lock` → `uv sync --frozen --no-dev --no-install-project` → copy `worker/` (không gồm `.onnx`) → `uv sync --frozen --no-dev`;
    `ENV PATH=/app/.venv/bin:$PATH MTL_MODELS_DIR=/data/models MTL_FONT_CACHE_DIR=/tmp/mtl-fonts PYTHONUNBUFFERED=1`; kiểm `python -c "import cv2, onnxruntime"` trong build (thêm lib apt nếu thiếu, VD `libglib2.0-0`).
  - `infra/docker/worker-entrypoint.sh`: uid 0 → `mkdir -p /data/models && chown 1000:1000 /data/models` → `setpriv` về 1000; rồi `python scripts/fetch_models.py` (lỗi → thoát ≠ 0 để compose restart) → `exec mtl-worker "$@"`.
  - Ignore riêng từng Dockerfile (BuildKit đọc `<Dockerfile>.dockerignore`): `infra/docker/app.Dockerfile.dockerignore` (loại `**/node_modules`, `.env*`, `.git`, `plans`, `worker`, `docs`, `**/dist`, `*.png` ở gốc),
    `infra/docker/worker.Dockerfile.dockerignore` (chỉ giữ `worker/` và `infra/docker/worker-entrypoint.sh`; loại `worker/.venv`, `worker/models/*.onnx`, `**/__pycache__`, `worker/spikes`, `worker/tests`).
  - `docker-compose.yml` (gốc repo), `name: mtl`, 4 service, `restart: unless-stopped`:
    - `postgres`: `postgres:17`, user/pass/db `mtl` (chỉ mạng `internal`, không `ports`), `./data/postgres:/var/lib/postgresql/data`, healthcheck `pg_isready -U mtl -d mtl`.
    - `app`: `ghcr.io/jhin1m/mtl:${MTL_TAG:-latest}`, `command: app`, env `MTL_LOCAL_MODE: "1"`, `DATABASE_URL: postgres://mtl:mtl@postgres:5432/mtl`, `API_PORT: "8080"`,
      `BETTER_AUTH_URL`/`WEB_ORIGIN: http://localhost:${MTL_PORT:-8080}`; volumes `./data/files`, `./data/secrets`, `./data/backups`, `./data/worker` → `/data/…`;
      `ports: ["127.0.0.1:${MTL_PORT:-8080}:8080"]`; `depends_on: postgres: service_healthy`;
      healthcheck `node -e "fetch('http://127.0.0.1:8080/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`, interval 10s, `start_period: 180s`; mạng `internal` + `web`.
    - `jobs`: cùng image/tag, `command: jobs`, cùng env DB, volumes `./data/files`, `./data/secrets`; `depends_on: app: service_healthy`; mạng `internal`.
    - `worker`: `ghcr.io/jhin1m/mtl-worker:${MTL_TAG:-latest}`, env `MTL_API_URL: http://app:8080`, `MTL_TOKEN_FILE: /data/worker/token`, `MTL_PROVIDER: anthropic`, `MTL_WORKER_ID: local`;
      volumes `./data/worker:/data/worker:ro`, `./data/models:/data/models`; `depends_on: app: service_healthy`; mạng `web` (cần Internet tải model + gọi AI).
    - `networks: internal: { internal: true }, web: {}`. Comment đầu file: lệnh chạy/cập nhật + cảnh báo không auth, không đổi `127.0.0.1`.
  - `.github/workflows/release.yml`: `on: push: tags: ["v*"]`; `permissions: contents: read, packages: write`; matrix 2 image
    (`mtl` ← `infra/docker/app.Dockerfile`, `mtl-worker` ← `infra/docker/worker.Dockerfile`, context `.`); steps `actions/checkout@v4`, `docker/setup-qemu-action@v3`,
    `docker/setup-buildx-action@v3`, `docker/login-action@v3` (ghcr.io, `github.actor`, `secrets.GITHUB_TOKEN`), `docker/metadata-action@v5`
    (`ghcr.io/${{ github.repository_owner }}/<name>`, tag `{{version}}`, `{{major}}.{{minor}}`, `latest`), `docker/build-push-action@v6`
    (`platforms: linux/amd64,linux/arm64`, `push: true`, cache `type=gha,scope=<name>`). KHÔNG push tag để kích hoạt.
  - `docs/self-host.md` (tiếng Việt): yêu cầu (Docker Engine/Desktop + compose v2, RAM ≥ 4 GB, ~2 GB đĩa cho model), cài 3 lệnh
    (`mkdir mtl && cd mtl`, tải `docker-compose.yml` từ release/raw GitHub, `docker compose up -d`), lần đầu tải model (theo dõi `docker compose logs -f worker`),
    mở http://localhost:8080, nhập key AI ở Cài đặt → Nhà cung cấp (OCR/inpaint local không cần key), cập nhật (`docker compose pull && docker compose up -d`; ghim bản bằng `MTL_TAG=1.2.3`),
    đổi cổng (`MTL_PORT`), bố cục `./data` (`postgres`, `files`, `secrets`, `backups`, `worker`, `models`), backup tự động 5 bản + khôi phục
    (`docker compose stop app jobs worker` → `docker compose exec -T postgres pg_restore --clean --if-exists -U mtl -d mtl < data/backups/<file>.dump` → `up -d`),
    `MTL_SKIP_BOOT_BACKUP=1` khi pg_dump lỗi, sao lưu cả thư mục `./data/secrets` (mất `secrets-key` = nhập lại key AI), cảnh báo bảo mật (không auth → không mở LAN/Internet, không reverse proxy công khai),
    gỡ cài, xử lý sự cố (quyền `./data`, cổng bận, xem log).
  - `README.md`: mục ngắn "Tự host bằng Docker" (3 lệnh + cảnh báo không auth + link `docs/self-host.md`).
  - `docs/deployment-guide.md`: 1 dòng đầu trỏ sang `docs/self-host.md` cho bản cá nhân.
- Non-functional
  - Không cần `.env`; mọi biến bắt buộc đã có mặc định trong compose/image.
  - Image app không chứa `.env`, `plans/`, model; image worker không chứa model (tải lúc chạy vào `/data/models`).

## Architecture
```
host 127.0.0.1:8080 ──► app (node, uid 1000) ── internal ──► postgres:17
                          ▲  web net                 ▲
                worker ───┘ (http://app:8080)       jobs (internal only)
./data/{postgres,files,secrets,backups,worker,models}  (bind mount)
```

## Related Code Files
- Create: `infra/docker/app.Dockerfile`, `infra/docker/app.Dockerfile.dockerignore`, `infra/docker/app-entrypoint.sh`,
  `infra/docker/worker.Dockerfile`, `infra/docker/worker.Dockerfile.dockerignore`, `infra/docker/worker-entrypoint.sh`,
  `docker-compose.yml`, `.github/workflows/release.yml`, `docs/self-host.md`.
- Modify: `README.md`, `docs/deployment-guide.md` (1 dòng), `pnpm-workspace.yaml` (chỉ khi cần cho phép build `re2`).
- Delete: none.

## Implementation Steps
1. Viết `app.Dockerfile` + ignore + entrypoint; `docker build -f infra/docker/app.Dockerfile -t ghcr.io/jhin1m/mtl:smoke .`; kiểm
   `docker run --rm --entrypoint sh ghcr.io/jhin1m/mtl:smoke -c 'pg_dump --version && node -e "require(\"re2\")" && ls /app/apps/web/dist/index.html'`
   (`pg_dump` phải 17.x; nếu `require` không dùng được do ESM thì `node --input-type=module -e "await import('re2')"` trong `/app/apps/api`).
2. Viết `worker.Dockerfile` + ignore + entrypoint; `docker build -f infra/docker/worker.Dockerfile -t ghcr.io/jhin1m/mtl-worker:smoke .`; kiểm `docker run --rm --entrypoint python … -c "import cv2, onnxruntime, mtl_worker"`.
3. Viết `docker-compose.yml`; `docker compose config` hợp lệ; `MTL_TAG=smoke` chạy thử trong thư mục tạm (smoke đầy đủ ở phase 4).
4. Viết `release.yml`; kiểm cú pháp bằng `actionlint` nếu có (không có thì `python -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" .github/workflows/release.yml`). Không push tag.
5. Viết `docs/self-host.md`, cập nhật `README.md`, `docs/deployment-guide.md`. Kiểm mọi lệnh trong docs khớp tên service/biến trong compose.
6. Kích thước image: ghi `docker images` vào báo cáo (mục tiêu app < 600 MB, worker < 1.5 GB không model).

## Success Criteria
- [x] Cả 2 image build được trên máy dev (arch hiện tại); `pg_dump --version` = 17.x trong image app.
- [x] `docker compose config` không lỗi khi không có `.env`.
- [x] `postgres` không publish cổng; `app` chỉ bind `127.0.0.1` (`docker compose ps` / `docker port`).
- [x] `release.yml` parse được, build 2 image `linux/amd64,linux/arm64`, chỉ chạy khi tag `v*`.
- [x] Docs có cảnh báo không auth + hướng dẫn khôi phục backup.

## Risk Assessment
- **pnpm 12 chặn build script `re2`** → kiểm `pnpm-workspace.yaml`; test `import('re2')` trong image (bước 1).
- **Build arm64 qua QEMU chậm/lỗi native** (re2, wheel Python) → cài toolchain ở stage build; nếu thiếu wheel aarch64 ghi vào báo cáo, không chặn amd64.
- **Bind mount thuộc root trên Linux** → entrypoint chown + setpriv; macOS Docker Desktop bỏ qua uid (vẫn chạy).
- **Postgres major sau này (18 đổi PGDATA)** → ghim `postgres:17`; nâng major là việc riêng (ghi docs).
- **GHCR package mặc định private** → OPEN trong plan.md; docs ghi rõ nếu `pull` báo `denied`.
- **Kích thước image worker lớn** (onnxruntime, opencv) → `--no-dev`, slim, không model.
- Rollback: xoá file mới; không ảnh hưởng runtime VPS.

## Quyết định khi implement (tự chốt)
- **Nâng cấp khi jobs/worker cũ còn chạy**: `jobs`/`worker` dùng `depends_on: app: { condition: service_healthy, restart: true }`. Đã kiểm thực nghiệm (compose v5.1.2): khi `up -d` tạo lại `app`, compose **dừng jobs/worker trước**, tạo lại app, chờ healthy (backup + migrate xong) rồi mới chạy lại → code cũ không chen vào lúc dump/migrate, lệnh cập nhật vẫn là `pull && up -d`. Không cần bước tay.
- **Worker dừng êm**: giữ mặc định worker `MTL_SHUTDOWN_GRACE_S=90` (không override), `stop_grace_period: 100s` (> 90s; mặc định 10s của Docker sẽ SIGKILL giữa job). Hết grace → worker `fail(internal)` (server requeue nếu còn lượt thử). Bản đầu đặt 25s/30s với comment sai "trả job về hàng đợi" — sửa theo yêu cầu user.
- **Tên project compose `mtl-local`** (không phải `mtl` như brief): compose prod trên VPS dùng `-p mtl`; trùng tên mà lỡ chạy trên VPS thì compose coi postgres prod là cùng service → có thể tạo lại với bind mount khác. Container: `mtl-local-<service>-1`.
- **Image app chỉ mang prod deps của cây `@mtl/api`**: stage `prod-deps` (`pnpm install --prod --frozen-lockfile --filter "@mtl/api..."`, chỉ từ manifest → cache tốt) + stage `build` (dev deps web, build SPA); runtime từ `node:24-bookworm-slim` (không pnpm) chép node_modules prod + source + `apps/web/dist`. Lý do: bản đầu (đủ dev deps + pnpm) 990 MB. **`tsx` chuyển từ `devDependencies` sang `dependencies` của `apps/api/package.json`** (NGOÀI ranh giới phase — lockfile chỉ dời 1 mục, không đổi version): prod chạy bằng tsx (cả systemd VPS) nên đúng ngữ nghĩa; review chỉ ra cách cũ `npm i tsx@X` để esbuild/get-tsconfig không ghim theo lockfile.
- **Image app chứa `worker/fonts/manifest.json`** (dockerignore loại `worker` rồi `!worker/fonts/manifest.json`): `apps/api/src/lib/fonts.ts` đọc file này lúc chạy.
- **Image worker giữ bố cục repo** `/app/worker` + `/app/packages/shared/json-schema` → `DEFAULT_SCHEMA_DIR`/`WORKER_DIR` trong code đúng, không cần `MTL_SCHEMA_DIR`. Thêm apt `libraqm0 libfribidi0 libharfbuzz0b` (như image Modal; build assert Pillow có raqm). `uv` 0.13.7 chỉ bind mount lúc build (không nằm trong image, −35 MB). Project cài editable (mặc định uv) → `models.lock.json`, `fonts/` resolve theo `/app/worker`.
- **`pnpm-workspace.yaml` không đổi**: `allowBuilds.re2: true` đã có; re2 tải prebuilt `linux-arm64-137` trong build.
- **Compose chuyển tiếp `MTL_ALLOWED_HOSTS`, `MTL_SKIP_BOOT_BACKUP`** (`${VAR:-}`, rỗng = tắt): không có thì lệnh thoát hiểm `MTL_SKIP_BOOT_BACKUP=1 docker compose up -d app` trong docs vô tác dụng. `BETTER_AUTH_URL`/`WEB_ORIGIN` theo `MTL_PORT`.
- **Log rotation** `json-file` 10m×3 cho mọi service (Docker Desktop mặc định không xoay log; worker chạy lâu).
- **Không có `HEALTHCHECK` trong Dockerfile app** (image dùng chung cho `jobs` — jobs không listen); healthcheck chỉ khai ở service `app` trong compose.
- **Docs ghi các mục chuyển từ phase 2**: bảng env (`MTL_LOCAL_MODE`, `MTL_DATA_DIR`, `MTL_SKIP_BOOT_BACKUP`, `MTL_ALLOWED_HOSTS`, `SPA_DIR`, `API_PORT=8080`), dev đặt `MTL_LOCAL_MODE=1` phải kèm `MTL_DATA_DIR`, worker ngoài compose cần `MTL_ALLOWED_HOSTS`, thu hồi token ⇒ `docker compose restart app worker`, cơ chế nâng cấp an toàn.

### Sau code review (7.5/10, không lỗi chặn — `plans/reports/from-code-reviewer-to-controller-261107-2043-selfhost-phase3-review-report.md`)
- **`:latest` chỉ theo `latest=auto`** của metadata-action (bỏ `type=raw,value=latest`): prerelease không trỏ latest. Hotfix dòng cũ vẫn trỏ latest → comment trong workflow: chỉ tag hotfix trên dòng mới nhất.
- **Khôi phục dùng `pg_restore --clean --if-exists --create -U mtl -d postgres`**: đã kiểm — `--clean -d mtl` để sót bảng của migration mới hơn bản dump (5 lỗi bị bỏ qua), `--create` khôi phục sạch.
- **Docs**: sao lưu/gỡ cài dùng `sudo` + mỗi lệnh 1 dòng (data/postgres 0700 của uid Postgres); yêu cầu Compose ≥ 2.17 (`depends_on.restart`) và **Linux Docker Engine ≥ 28.3.3** (trước 28.0 LAN gọi thẳng được IP container; CVE-2025-54388 lộ cổng localhost khi reload firewalld) — app không auth nên bind 127.0.0.1 là lớp bảo vệ duy nhất; gỡ cài `down --rmi all`; worker ngoài compose trên Linux cần uid 1000 hoặc chép token; câu giữ backup ghi đủ "3 phiên bản schema".
- **Worker `init: true`** (tini PID 1): `sh` PID 1 bỏ qua SIGTERM lúc đang tải model → trước đây đợi hết stop_grace_period rồi SIGKILL.
- **`**/.env*`** trong cả 2 dockerignore (trước chỉ loại `.env*` ở gốc).
- **Không làm**: URL cài đặt trỏ `main` (có thể đi trước image phát hành) — để phase phát hành/attach compose vào GitHub Release quyết; `.part` mồ côi khi bị kill giữa lúc tải — lần tải sau ghi đè cùng tên, không tích luỹ.

## Kết quả (07/11/2026)
- Build arm64 (OrbStack, Docker 29.4): `ghcr.io/jhin1m/mtl:smoke` ≈ 514 MB giải nén / 147 MB nén; `ghcr.io/jhin1m/mtl-worker:smoke` ≈ 546 MB giải nén / 175 MB nén (`docker images` của containerd store cộng cả blob nén nên hiện lớn hơn). Chưa build amd64/arm64 qua QEMU (để CI).
- Image app: `pg_dump` 17.11, `require("re2")` OK (prebuilt linux-arm64), tsx 4.23.15 từ lockfile, không `.env`/`plans`/dev deps. Image worker: `import cv2, onnxruntime, mtl_worker` OK, Pillow có raqm.
- Compose thử (`MTL_TAG=smoke`, thư mục tạm, model nạp sẵn): 4 service healthy/running; SPA 200, `/api/config` `{local_mode:true}`, `/readyz` + `/healthz` 200, Host lạ 403; postgres không publish cổng, app chỉ `127.0.0.1`; worker claim được (token qua `/data/worker` uid 1000); đổi cổng → jobs/worker dừng trước, app tạo lại, chạy lại sau healthy; boot 2 tạo backup; `MTL_SKIP_BOOT_BACKUP=1` bỏ backup; lệnh khôi phục chạy được; volume thuộc root → entrypoint chown + setpriv uid 1000.
- `docker compose config` không `.env` OK; actionlint 1.7.7 OK; `pnpm lint` xanh; `pnpm --filter @mtl/api test:unit` 62/62.
