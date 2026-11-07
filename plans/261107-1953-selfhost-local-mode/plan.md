---
title: "Self-host chế độ local (Docker 1 lệnh, không MinIO, không tài khoản)"
description: "MTL_LOCAL_MODE=1: driver lưu đĩa + /files ký HMAC, user local cố định, secret tự sinh, compose 4 service, image GHCR"
status: in-progress
priority: P1
effort: 4d
branch: feat/selfhost-local-mode
tags: [selfhost, docker, storage, auth, infra]
created: 2026-11-07
blockedBy: []
blocks: []
---

# Self-host chế độ local

Mục tiêu: người dùng tải `docker-compose.yml`, chạy `docker compose up -d`, mở http://localhost:8080 là dùng được.
Cập nhật: `docker compose pull && docker compose up -d`. Không `.env`, không script cài. Bản VPS (S3/MinIO + better-auth) giữ nguyên.

Bối cảnh: memory `selfhost-local-mode-direction` (07/11/2026). Docs: `docs/deployment-guide.md`, `docs/job-queue-worker.md`.
`docs/system-architecture.md` không tồn tại — không tham chiếu.

## Phases (chạy TUẦN TỰ — cùng đụng `apps/api/src/env.ts`, `apps/api/src/app.ts`)

| # | Phase | File | Status | Effort |
|---|-------|------|--------|--------|
| 1 | Driver lưu đĩa + route `/files` + test 2 driver | [phase-01-disk-storage-driver.md](phase-01-disk-storage-driver.md) | completed | 1.5d |
| 2 | Runtime chế độ local (auth, secret, token worker, backup+migrate, export cleanup, web) | [phase-02-local-mode-runtime.md](phase-02-local-mode-runtime.md) | completed | 1.5d |
| 3 | Dockerfile API + worker, compose, release workflow, docs | [phase-03-docker-compose-release.md](phase-03-docker-compose-release.md) | pending | 0.75d |
| 4 | Smoke end-to-end trên thư mục tạm | [phase-04-e2e-smoke.md](phase-04-e2e-smoke.md) | pending | 0.25d |

Phụ thuộc: 2 ← 1 (driver + `STORAGE_DRIVER`), 3 ← 2 (entrypoint gọi boot local), 4 ← 3 (image + compose).

## Ranh giới file theo phase (không phase nào sửa file của phase sau)

- P1: `apps/api/src/storage.ts`, `apps/api/src/storage-drivers/*`, `apps/api/src/routes/files.ts`, `apps/api/src/env.ts` (chỉ khối storage), `apps/api/src/app.ts` (chỉ mount `/files`), `apps/api/src/lib/health.ts` (chỉ `storage`), `worker/mtl_worker/client.py` (base_url cho client file), test storage, `apps/api/vitest.unit.config.ts`, `apps/api/package.json` (script `test:unit`).
- P2: `apps/api/src/env.ts` (khối local mode), `apps/api/src/app.ts` (auth mount, `/api/config`, SPA, `/readyz`), `apps/api/src/index.ts`, `apps/api/src/local/*`, `apps/api/src/middleware/{user,admin}.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/lib/{health,worker-token}.ts`, `apps/api/src/jobs/runner.ts`, `apps/api/src/jobs/export-cleanup.ts`, `apps/web/src/**` (AuthGate, AppShell, router, admin sections, api config).
- P3: `infra/docker/*` (gồm `*.Dockerfile.dockerignore`), `docker-compose.yml` (gốc repo), `pnpm-workspace.yaml` (chỉ nếu cần cho phép build `re2`), `.github/workflows/release.yml`, `docs/self-host.md`, `README.md`, `docs/deployment-guide.md` (1 dòng trỏ sang self-host).
- P4: `infra/selfhost-smoke.sh`, `infra/selfhost-smoke.mjs`; chỉ sửa file P1–P3 khi smoke lộ bug (ghi lại trong báo cáo).

## Decisions (tự chốt, kèm lý do)

1. **URL file ở disk driver là tương đối** `/files/<key>?…`; worker resolve theo `MTL_API_URL` bằng `httpx.Client(base_url=api)` cho client file (httpx giữ nguyên URL tuyệt đối → S3 không đổi). Lý do: `presignGet` dùng chung cho browser (route) và worker (`claim-inputs.ts`); URL tương đối đúng cho browser cùng origin, worker chỉ cần 1 dòng. Phương án "audience=worker + base nội bộ" phải sửa 4 call site trong `claim-inputs.ts` và thêm env — phức tạp hơn. Giao thức JSON worker giữ nguyên.
2. **Khoá ký `/files` dẫn xuất từ `BETTER_AUTH_SECRET`**: `HMAC-SHA256(BETTER_AUTH_SECRET, "mtl-files-v1")`. Không thêm secret thứ 4; đổi secret = mọi link cũ hết hiệu lực (TTL ≤ 15' nên vô hại). Driver nhận key qua tham số (test không cần env).
3. **Chọn driver bằng `STORAGE_DRIVER=s3|disk`** (mặc định `s3`; `MTL_LOCAL_MODE=1` ⇒ mặc định `disk`). Biến `S3_*`/`FILES_DOMAIN` thành optional, bắt buộc khi driver = s3 (superRefine). VPS không phải sửa `.env`.
4. **Content-Type lưu ở sidecar** `<path>.meta.json` (ghi atomic cùng file). Key kết thúc `.meta.json` bị từ chối. Không dùng xattr (không portable trên bind mount macOS/Windows).
5. **POST multipart**: policy (exp, max, ct) nằm trên query có ký; `fields` chỉ có `Content-Type` (web/test giữ nguyên cách gửi). Server so field `Content-Type` == ct đã ký (403), kiểm `Content-Length` ≤ max + 64 KiB trước khi đọc body (thiếu → 411), byte file ∈ [1, max] (400). Thành công 204 như MinIO. Body đọc vào bộ nhớ (trần = max upload) — chấp nhận cho 1 người dùng.
6. **Web biết chế độ local qua `GET /api/config`** (public, `{ local_mode }`) thay vì cờ build Vite: 1 image dùng cho mọi cấu hình, test được ở API.
7. **Local mode không mount `/api/auth/*` và `/api/dev/*`** (404). `requireUser` gắn user local (email `local@localhost`, tạo/lấy lúc boot). `isAdminEmail` trả true khi local mode → user local là admin. Mục Cài đặt "Người dùng" và "Hạn mức & đăng ký" ẩn ở local mode.
8. **Secret tự sinh đồng bộ trong `env.ts` trước khi parse** (file `0600` ở `/data/secrets/`, mở `wx` → tránh race app/jobs). Token worker sinh sau migrate (cần DB) vào thư mục riêng `/data/worker/token` — worker chỉ mount thư mục này (read-only), không thấy `BETTER_AUTH_SECRET`/`SECRETS_KEY`.
9. **Migrate chỉ chạy ở `app`** (trước khi listen): backup → migrate → bootstrap user/token. `jobs` và `worker` `depends_on: app: service_healthy`. Healthcheck dùng route mới `GET /readyz` (DB + storage, KHÔNG gồm runner) — dùng `/healthz` sẽ deadlock vì runner = jobs đang chờ app.
10. **Backup DB mỗi lần app khởi động** khi DB đã có bảng `drizzle.__drizzle_migrations` (DB trống lần đầu thì bỏ qua). `pg_dump -Fc` → `/data/backups/mtl-<UTC>.dump` (ghi tạm rồi rename), giữ 5 bản mới nhất (implement: tên `mtl-<UTC>-m<N>.dump`, giữ thêm bản mới nhất của 3 phiên bản schema gần nhất — restart sau nâng cấp không xoá bản trước nâng cấp). **pg_dump lỗi → app thoát (fail-closed)**, thoát hiểm bằng `MTL_SKIP_BOOT_BACKUP=1` (ghi trong docs). Lý do: ưu tiên an toàn dữ liệu khi nâng cấp hơn là "luôn chạy".
11. **Đường nâng cấp**: `drizzle-orm` migrator chỉ áp migration chưa chạy → DB cũ chạy được sau `compose pull`. Migrate lỗi → container restart lặp, bản backup vừa tạo còn nguyên; docs ghi cách `pg_restore`. Không hỗ trợ hạ cấp.
12. **Export cleanup**: bước riêng trong `jobs` mỗi 1 giờ, chỉ khi driver = disk; xoá file `u/*/ch/*/export/*` có mtime > `EXPORT_RETENTION_DAYS` (7, `packages/shared/src/job.ts`) và file tạm `.tmp/*` > 24h. S3 vẫn dùng lifecycle MinIO.
13. **Quyền bind mount**: entrypoint chạy root → `mkdir -p` + `chown 1000:1000` các thư mục `/data/*` của mình → `exec setpriv --reuid=1000 --regid=1000 --init-groups`. Cả app và worker chạy uid 1000 (khớp kiểm `st_uid` trong `worker/mtl_worker/token.py`). Lý do: Docker tạo `./data` thuộc root trên Linux.
14. **Image API**: `node:24-bookworm-slim`, pnpm `12.14.0` cài qua npm (không dựa corepack), chạy bằng `tsx` như systemd hiện tại (`infra/systemd/mtl-api.service`). `postgresql-client-17` từ apt PGDG (client 15 của bookworm không dump được server 17).
15. **Tag image theo `MTL_TAG`** (`image: ghcr.io/jhin1m/mtl:${MTL_TAG:-latest}`), cổng theo `MTL_PORT` (mặc định 8080, luôn bind `127.0.0.1`). Smoke dùng `MTL_TAG=smoke` để không đè/kéo `latest`.
16. **Worker trong compose**: `--provider anthropic` (memory `worker-provider-anthropic-primary`); key AI lấy từ slot DB (Cài đặt → Nhà cung cấp). OCR/inpaint local mặc định nên `page.prepare` không tốn token.
17. **Dockerfile đặt ở `infra/docker/`**, compose ở gốc repo (người dùng tải 1 file). Context build: gốc repo cho cả 2 image (entrypoint nằm ở `infra/docker/`), lọc file bằng `<Dockerfile>.dockerignore` riêng của BuildKit thay vì 1 `.dockerignore` chung.
18. **Test disk driver không cần Docker**: config riêng `apps/api/vitest.unit.config.ts` (không globalSetup Postgres), thư mục `apps/api/test/unit/`. Bộ contract dùng chung chạy cho disk (unit) và S3 (`storage-presign.test.ts`, cần MinIO như hiện tại).

19. **Chống DNS rebinding + CSRF ở local mode** (controller thêm khi duyệt plan): bind `127.0.0.1` không đủ vì trang lạ trong trình duyệt người dùng vẫn gửi request tới `localhost:8080`, và app không có auth. Middleware `local-guard` (chỉ khi `MTL_LOCAL_MODE`) chạy trước mọi route: (a) hostname của header `Host` phải thuộc `localhost`, `127.0.0.1`, `[::1]`, `app` (tên service compose, worker gọi qua đây) hoặc `MTL_ALLOWED_HOSTS` (csv) → ngược lại 403 — chặn DNS rebinding; (b) request không phải GET/HEAD/OPTIONS: có `Origin` thì host của Origin phải bằng `Host`, có `Sec-Fetch-Site: cross-site` thì 403 — chặn CSRF (form/fetch từ site khác). Worker không gửi `Origin` nên không ảnh hưởng. Không bật CORS ở local mode. Lý do: rủi ro thật, chi phí nhỏ, không đổi giao thức web/worker.

Không có plan đang mở nào đụng storage/auth/env/infra (đã quét `plans/*/plan.md` chưa completed) → không `blockedBy`.

## OPEN — needs user

- **Tên image GHCR & quyền public**: `ghcr.io/jhin1m/mtl`, `ghcr.io/jhin1m/mtl-worker` theo brief; package GHCR mặc định private sau lần push đầu — owner phải đặt public trên GitHub thì người dùng mới `pull` được không cần login. Khó đảo ngược khi đã phát hành (người dùng ghim tên image).
- **Rà license trước phát hành công khai** (ngoài phạm vi; GPL/weights trong image worker — ghi vào báo cáo cuối, xem `worker/THIRD_PARTY.md`).

## Acceptance (toàn plan)

- [ ] `pnpm typecheck && pnpm lint && pnpm test` xanh (CI hiện có, S3 driver).
- [ ] `pnpm --filter @mtl/api test:unit` xanh không cần Docker (disk driver + route `/files` + env local).
- [ ] `infra/selfhost-smoke.sh` pass đủ 6 kiểm của phase 4.
- [ ] Bản VPS không đổi hành vi khi không đặt `MTL_LOCAL_MODE`/`STORAGE_DRIVER`.

## Ngoài phạm vi

Windows/PowerShell, GPU NVIDIA, báo "có bản mới" trong UI, rà license (chỉ ghi chú), kích hoạt workflow release (không push tag).
