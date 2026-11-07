---
phase: 2
title: "Runtime chế độ local (auth, secret, token worker, backup+migrate, export cleanup, web)"
status: pending
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 2: Runtime `MTL_LOCAL_MODE=1`

## Overview
Khi `MTL_LOCAL_MODE=1`: không đăng nhập (user local cố định, là admin), secret tự sinh lưu `/data/secrets`, token worker
tự sinh ở `/data/worker/token`, app tự backup DB rồi migrate trước khi listen, API phục vụ luôn SPA, `jobs` xoá export cũ.
Web bỏ màn `/login` và nút đăng xuất. Không đặt cờ → hành vi VPS y nguyên.

## Context
- Plan: [plan.md](plan.md) — Decisions 6–12. Phase 1 đã có `STORAGE_DRIVER`, `FILES_DIR`, disk driver, `/files`.
- API: `apps/api/src/env.ts` (parse lúc import; superRefine bắt `GLOBAL_*` ở production), `apps/api/src/app.ts` (mount `/api/auth/*`,
  dev-auth, admin, userApi), `apps/api/src/index.ts` (serve ngay ở top-level), `apps/api/src/auth.ts`,
  `apps/api/src/middleware/user.ts` (`requireUser` dùng `auth.api.getSession`; không route nào đọc `c.get("session")` — đã grep),
  `apps/api/src/middleware/admin.ts` (`isAdminEmail` theo `ADMIN_EMAILS`), `apps/api/src/routes/health.ts` + `lib/health.ts`,
  `apps/api/src/jobs/runner.ts` (vòng `every(...)`), `apps/api/src/lib/worker-token.ts` (`hashWorkerToken`, `createWorkerToken`, prefix `mtlw_`).
- DB: `packages/db/src/migrate.ts` (`runMigrations(url)` — drizzle migrator, bảng `drizzle.__drizzle_migrations`), schema user ở
  `packages/db/src/schema/auth.ts`, `workerTokens` ở `@mtl/db`.
- Hằng: `EXPORT_RETENTION_DAYS = 7` ở `packages/shared/src/job.ts:97`; key export `u/{user}/ch/{ch}/export/{jobId}.{zip|cbz}` (`packages/shared/src/storage-keys.ts:16`).
- Worker đọc token: `worker/mtl_worker/token.py` (`MTL_TOKEN_FILE`, bắt buộc quyền 600 + cùng uid).
- Web: `apps/web/src/app/layout.tsx` (`AuthGate`), `apps/web/src/app/app-shell.tsx` (`signOut`, nút "Đăng xuất" ~dòng 101, link Cài đặt theo `me.is_admin`),
  `apps/web/src/app/router.tsx` (`loginRoute` dòng 46), `apps/web/src/routes/login.tsx`, `apps/web/src/lib/api.ts` (`authClient`, xử lý 401),
  `apps/web/src/features/admin/admin-sections.ts` (sections `limits`, `users`).

## Requirements
- Functional (API)
  - `env.ts`: `MTL_LOCAL_MODE` nhận `1|true|0|false` (mặc định false), `MTL_DATA_DIR` (mặc định `/data`), `MTL_SKIP_BOOT_BACKUP` (flag), `SPA_DIR` (optional).
    Trước `parseEnv(process.env)`: nếu raw `MTL_LOCAL_MODE` bật → `applyLocalEnvDefaults(process.env)` (đồng bộ) từ `src/local/local-secrets.ts`:
    - sinh/đọc `${MTL_DATA_DIR}/secrets/better-auth-secret` (48 byte base64url) và `secrets-key` (32 byte base64, khớp regex hiện có) — `mkdirSync(…, {recursive, mode: 0o700})`,
      `writeFileSync(path, v, { flag: "wx", mode: 0o600 })`, `EEXIST` → đọc lại; chỉ gán `process.env.X` khi chưa đặt;
    - mặc định nếu chưa đặt: `STORAGE_DRIVER=disk`, `FILES_DIR=${data}/files`, `BETTER_AUTH_URL`/`WEB_ORIGIN=http://localhost:8080`.
  - `parseEnv` khi local: bỏ yêu cầu `GLOBAL_*` ở production; ép `SIGNUP_ENABLED=false`, `DISPATCHER_ENABLED=false`, `ALERT_NTFY_URL=undefined`,
    `ADMIN_EMAILS=[]`, bỏ `DEV_AUTO_LOGIN_*` (transform sau superRefine; `console.warn` 1 lần nếu người dùng có đặt). Backup S3 nằm ở `infra/backup.sh` — không có trong image nên không cần tắt.
  - `src/local/local-user.ts`: `ensureLocalUser(db)` lấy/tạo user `local@localhost` (name `Local`, `emailVerified: true`, không account/mật khẩu); `getLocalUser()` (ném nếu chưa boot), `setLocalUserForTest(u)`.
  - `src/local/worker-token-file.ts`: `ensureWorkerTokenFile(db, path)`: file có token hợp lệ (`mtlw_…`) và hash có trong `worker_tokens` chưa revoke → giữ; file có nhưng DB thiếu hash (DB bị xoá) → insert lại hash `kind='mac'`, name `local-worker`;
    revoke/không đọc được/không có file → sinh token mới (`generateWorkerToken`), insert, ghi tmp `0600` rồi rename. Thêm helper `registerWorkerToken(token, opts)` vào `lib/worker-token.ts` (dùng chung với `createWorkerToken`).
  - `src/local/boot-backup.ts`: `backupBeforeMigrate({ databaseUrl, dir, keep = 5 })`: `select to_regclass('drizzle.__drizzle_migrations')` null → skip (DB mới);
    ngược lại `execFile("pg_dump", ["--format=custom","--no-owner","--no-privileges","--file", tmp, url])` (không shell) → rename `mtl-<YYYYMMDDTHHMMSSZ>.dump` → `pruneBackups(dir, keep)` (xoá bản cũ, chỉ file khớp `^mtl-\d{8}T\d{6}Z\.dump$`). Lỗi → ném.
  - `src/local/boot.ts`: `bootLocal()` = mkdir `${data}/{files,backups,worker}` → (trừ khi `MTL_SKIP_BOOT_BACKUP`) backup → `runMigrations(env.DATABASE_URL)` → `ensureLocalUser` → `ensureWorkerTokenFile`. Log từng bước.
  - `index.ts`: `async main()`: `if (env.MTL_LOCAL_MODE) await bootLocal()` rồi mới `serve(...)`; boot lỗi → `console.error` + `process.exit(1)`. Giữ `verifyProviderSecrets` và xử lý SIGTERM.
  - `middleware/user.ts`: local → gắn `getLocalUser()`, session tổng hợp (`{ id: "local", userId, token: "local", expiresAt: far-future, createdAt, updatedAt, ipAddress: null, userAgent: null }` ép kiểu `AuthSession["session"]`), `lockHolder` theo tab như cũ, `sdb = scoped(db, id)`.
  - `middleware/admin.ts`: `isAdminEmail` trả `true` khi `env.MTL_LOCAL_MODE`.
  - `app.ts`: local → KHÔNG mount `/api/auth/*`, `devAutoLogin` ép false; thêm `GET /api/config` public (`{ local_mode: env.MTL_LOCAL_MODE }`, `cache-control: no-store`) trước `userApi`;
    `SPA_DIR` đặt → `serveStatic` (`@hono/node-server/serve-static`) cho file tĩnh, `/assets/*` `Cache-Control: public, max-age=31536000, immutable`; GET không thuộc `/api|/worker|/files|/healthz|/readyz` mà không có file → `index.html` (`no-cache`). Đặt sau route API, trước `notFound`.
  - `middleware/local-guard.ts` (plan.md Decision 19): chỉ mount khi `env.MTL_LOCAL_MODE`, đặt đầu chuỗi middleware trong `app.ts` (áp cho `/api`, `/worker`, `/files`, SPA). Host hostname ∉ {`localhost`,`127.0.0.1`,`[::1]`,`app`} ∪ `MTL_ALLOWED_HOSTS` → 403. Method không an toàn: `Origin` có mà host khác `Host` → 403; `Sec-Fetch-Site: cross-site` → 403. Thêm `MTL_ALLOWED_HOSTS` (csv, optional) vào `env.ts`. Unit test: Host lạ (`evil.example`) → 403; `localhost:8080` GET → qua; POST với `Origin: http://evil.example` → 403; POST không Origin (worker) với Host `app:8080` → qua; POST cùng origin → qua.
  - `routes/health.ts`: thêm `GET /readyz` → 200 khi DB + storage ổn (không xét runner), 503 ngược lại, `no-store`. Tách hàm `checkReady()` trong `lib/health.ts`.
  - `jobs/export-cleanup.ts`: `cleanupExpiredExports({ root, now, retentionMs })` duyệt `root/u/*/ch/*/export/*` (bỏ qua symlink, `.meta.json` xoá cùng file), xoá mtime < now − retention; dọn `root/.tmp/*` > 24h. Trả `{ exports, tmp }`.
  - `jobs/runner.ts`: `env.STORAGE_DRIVER === "disk"` → `every("export-cleanup", 3_600_000, …)` log khi xoá > 0. Không migrate ở runner.
- Functional (web)
  - `lib/api.ts`: `fetchAppConfig()` gọi `/api/config` + hook `useAppConfig()` (cache vô hạn; dùng TanStack Query nếu app đã dùng — kiểm `apps/web/src/main.tsx`).
  - `AuthGate`: chờ config; `local_mode` → `<Outlet />` ngay (không `useSession`, không dev-login). Không local → giữ nguyên logic cũ (gọi `useSession` trong component con để không vi phạm rules-of-hooks).
  - `AppShell`: ẩn nút "Đăng xuất" khi local. `router.tsx`: `loginRoute.beforeLoad` local → `redirect({ to: "/" })`.
  - `admin-sections.ts`: hàm lọc bỏ `limits`, `users` khi local; `parseSection`/`validSection` dùng danh sách đã lọc.
- Non-functional
  - Hàm local nhận tham số (dir, db, now) → unit test không cần `/data`.
  - Không thay đổi gì khi `MTL_LOCAL_MODE` không đặt (test cũ phải xanh nguyên).

## Architecture
```
docker start app ─► env.ts: applyLocalEnvDefaults (secrets files) ─► parseEnv
                 └► index.ts main(): bootLocal() = backup(pg_dump) → migrate → local user → worker token file ─► serve :8080
                                     /readyz ok ─► compose: jobs + worker start
jobs ─► env.ts (đọc cùng secrets) ─► runner: reaper/budget… + export-cleanup (1h, disk)
worker ─► MTL_TOKEN_FILE=/data/worker/token (ro) ─► /worker/v1 ; file qua /files (base_url)
browser ─► / (SPA từ SPA_DIR) ─► /api/config {local_mode:true} ─► bỏ AuthGate ─► /api/* (requireUser = user local)
```

## Related Code Files
- Create: `apps/api/src/local/local-secrets.ts`, `apps/api/src/local/local-user.ts`, `apps/api/src/local/worker-token-file.ts`,
  `apps/api/src/local/boot-backup.ts`, `apps/api/src/local/boot.ts`, `apps/api/src/jobs/export-cleanup.ts`, `apps/api/src/middleware/local-guard.ts`, `apps/api/test/unit/local-guard.test.ts`,
  `apps/api/test/unit/local-secrets.test.ts`, `apps/api/test/unit/env-local.test.ts`, `apps/api/test/unit/export-cleanup.test.ts`,
  `apps/api/test/unit/boot-backup-prune.test.ts`, `apps/api/test/local-mode.test.ts` (cần DB), `apps/web/src/features/admin/admin-sections.test.ts`.
- Modify: `apps/api/src/env.ts` (khối local), `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/middleware/user.ts`, `apps/api/src/middleware/admin.ts`,
  `apps/api/src/routes/health.ts`, `apps/api/src/lib/health.ts`, `apps/api/src/lib/worker-token.ts`, `apps/api/src/jobs/runner.ts`,
  `apps/web/src/lib/api.ts`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/app-shell.tsx`, `apps/web/src/app/router.tsx`, `apps/web/src/features/admin/admin-sections.ts`.
- Delete: none (`routes/login.tsx` giữ cho bản VPS).

## Implementation Steps
1. `local-secrets.ts` + `env.ts` (defaults + transform/superRefine local). Unit: `env-local.test.ts` gọi `parseEnv` thuần (production + local không cần `GLOBAL_*`; cờ bị ép tắt; không local thì lỗi `GLOBAL_*` như cũ); `local-secrets.test.ts` trên `mkdtemp` (sinh mới, quyền `0o600`, gọi 2 lần ra cùng giá trị, file có sẵn không bị ghi đè, env đã đặt thì không ghi đè, `secrets-key` qua được regex/32 byte).
2. `worker-token.ts`: tách `registerWorkerToken`; `local-user.ts`; `worker-token-file.ts`.
3. `boot-backup.ts` (+ `pruneBackups` thuần) và `boot.ts`; `index.ts` thành `main()`.
4. `middleware/user.ts`, `middleware/admin.ts`, `app.ts` (auth mount có điều kiện, `/api/config`, SPA), `routes/health.ts` + `lib/health.ts` (`/readyz`).
5. `export-cleanup.ts` + bước trong `runner.ts`.
6. `test/local-mode.test.ts` (Postgres test như các test khác): đặt `env.MTL_LOCAL_MODE = true` trong `beforeAll` (khôi phục ở `afterAll`), `ensureLocalUser(db)`, `createApp()`:
   `GET /api/config` → `{local_mode:true}`; `GET /api/me` không cookie → 200, `is_admin: true`; `GET /api/auth/get-session` → 404; `GET /api/admin/settings` (hoặc route admin GET có sẵn) → 200;
   `ensureWorkerTokenFile` trên tmp: lần 1 tạo file 0600 + row; lần 2 giữ nguyên; xoá row → lần 3 insert lại cùng hash; `authenticateWorker(token)` trả `kind: "mac"`.
   Backup: nếu `pg_dump` có trong PATH (`which`), chạy `backupBeforeMigrate` với `testDatabaseUrl("api")` → có file `.dump` > 0 byte; không có thì `it.skip` kèm lý do.
7. Unit `export-cleanup.test.ts` (`fs.utimes` giả mtime; file trong `export/` cũ bị xoá, mới giữ, file ngoài `export/` không đụng, `.tmp` cũ bị dọn) và `boot-backup-prune.test.ts` (giữ 5 mới nhất, bỏ qua file lạ).
8. Web: `lib/api.ts`, `layout.tsx`, `app-shell.tsx`, `router.tsx`, `admin-sections.ts` + test lọc section. Chạy `pnpm --filter @mtl/web test` + typecheck.
9. Kiểm tay nhanh (không Docker): `MTL_LOCAL_MODE=1 MTL_DATA_DIR=$(mktemp -d) DATABASE_URL=<dev db> SPA_DIR=apps/web/dist pnpm --filter @mtl/api start` sau `pnpm --filter @mtl/web build` → mở http://localhost:8080 (đặt `API_PORT=8080`) thấy app không đăng nhập; `ls $MTL_DATA_DIR/{secrets,worker,backups}`.

## Success Criteria
- [ ] `pnpm --filter @mtl/api test:unit` xanh không cần Docker.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` xanh (gồm `local-mode.test.ts` và toàn bộ test cũ với local tắt).
- [ ] Kiểm tay bước 9: không màn đăng nhập, không nút Đăng xuất, Cài đặt không có "Người dùng"/"Hạn mức & đăng ký", `/readyz` 200, `/healthz` 503 khi chưa chạy `jobs` rồi 200 khi chạy.
- [ ] Khởi động lần 2 trên cùng DB tạo thêm 1 file trong `backups/`; lần 1 (DB trống) không tạo.

## Risk Assessment
- **Lộ API không auth ra mạng** → chỉ bật bằng cờ tường minh; compose bind `127.0.0.1` (phase 3) + cảnh báo README. Không có fallback local ở bản VPS.
- **Race app/jobs sinh secret** → `wx` + đọc lại; jobs còn chờ app healthy.
- **pg_dump client/server lệch version** → image dùng client 17 (phase 3); lỗi → fail-closed + `MTL_SKIP_BOOT_BACKUP`.
- **Migrate lỗi giữa chừng** → app thoát, restart lặp, backup còn; docs phase 3 ghi `pg_restore`.
- **Hooks React khi rẽ nhánh AuthGate** → tách component `SessionGate` cho nhánh VPS.
- **Token worker bị revoke trên UI admin** → boot kế tiếp sinh token mới; worker đang chạy nhận 401 — implementer kiểm `worker/mtl_worker/main.py` xử lý 401 (thoát → compose restart). Ghi kết quả vào báo cáo.
- Rollback: revert phase; cờ tắt mặc định nên VPS không ảnh hưởng.
