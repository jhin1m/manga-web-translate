# Phase 3 report: API version check + update trigger

## Env mới (apps/api/src/env.ts)
- `MTL_VERSION` (mặc định `dev`; rỗng = dev; không phải semver = dev build)
- `MTL_UPDATE_CHECK` (`1|true|0|false`, mặc định bật)
- `MTL_UPDATE_TARGET` (optional; không phải semver -> warn 1 lần, bỏ qua; xử lý trong update-check)
- `MTL_TAG` (optional; `latest`/rỗng = không ghim)

## Route
- `GET /api/config` -> `{ local_mode, version }`.
- Hai route dưới nằm trong `adminApi()`; ngoài local mode -> 404 `{error:"not_found"}`.
- `GET /api/admin/update` -> 200 `UpdateStatus`, `cache-control: no-store`. Updater lỗi vẫn 200.
- `POST /api/admin/update {version}` (lỗi dạng `{error: code, reason: code}`):
  415 không phải JSON | 403 localGuard (Origin/Host) | 400 `invalid_body` (zod, <=64 ký tự) / 400 `bad_version`
  | 409 `stale` (kiểm lại GitHub bỏ cache; không có bản mới hoặc != latest) | 422 `pinned` (MTL_TAG ghim + bản chính thức)
  | 429 `cooldown` (60s; mốc đặt trước khi gọi updater, hoàn lại nếu updater từ chối) | status+reason của updater
  | 503 `unavailable` (không nối được updater) | 202 `{run}`. Log `[update] cur → ver`.
- Chấp nhận `version` có tiền tố `v` (bỏ `v` trước khi so/gửi).

## HTTP contract gọi updater
- Base cố định `http://updater:8090` (`setUpdaterBaseForTest` cho test). Mọi request: `Authorization: Bearer <token>`,
  token = `${MTL_DATA_DIR}/secrets/updater-token` (mkdir 0700, file 0600 `wx` qua readOrCreateSecret, cache trong bộ nhớ,
  quên khi 401). `redirect: "error"`.
- `GET /v1/status` (timeout 3s) -> mong `UpdaterStatus` `{ready, reason, project, run}`. Lỗi kết nối/timeout/ENOTFOUND
  -> `{ready:false, reason:"unavailable"}`. 401 hoặc non-2xx -> `reason:"internal"` (401 log 1 dòng).
- `POST /v1/update` (timeout 15s), `content-type: application/json`, body `{"version":"X.Y.Z"}` (không có `v`)
  -> 2xx + `{run: UpdateRun}`. Lỗi: lấy `reason` (hoặc `error`) nếu thuộc `UPDATE_REASONS`, giữ nguyên status;
  không nhận ra -> `internal`. 401 -> 502 `internal`. Lỗi kết nối -> 503 `unavailable`.
- Lưu ý cho phase 4: body lỗi của updater nên có `reason` thuộc UPDATE_REASONS (vd 409 `{reason:"busy"}`).
  `bad_version` không thuộc UPDATE_REASONS nên sẽ thành `internal` (app đã chặn bad_version trước khi gọi).

## File
Sửa: src/{env,app}.ts, src/routes/admin.ts, test/{local-mode,tenant-isolation}.test.ts, test/unit/env-local.test.ts.
Tạo: src/lib/{update-check,updater-client}.ts, src/routes/admin-update.ts, test/unit/update-check.test.ts,
test/admin-update.test.ts.

## Test
- Unit (`pnpm test:unit`): 12 file / 88 test xanh (update-check: dev/disabled/override 0 fetch).
- DB (Postgres test đang chạy): admin-update (19), admin-access, local-mode, tenant-isolation: 4 file, 45 pass,
  1 skipped (đã có sẵn). Updater giả `node:http`, GitHub giả bằng fetch inject, 0 request mạng thật.
- `pnpm typecheck` (apps/api) xanh. Biome sạch trên file phase 3; còn 3 lỗi format/import ở `src/updater/*`
  (phase 4, đang làm, không sửa).
- Chưa chạy: toàn bộ `pnpm --filter @mtl/api test`, gọi tay curl dev server.
