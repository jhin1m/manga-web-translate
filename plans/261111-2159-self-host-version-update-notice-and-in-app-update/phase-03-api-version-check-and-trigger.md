---
phase: 3
title: "API: phiên bản, kiểm tra bản mới, route kích hoạt cập nhật"
status: completed
priority: P1
effort: "5h"
dependencies: [1]
---

# Phase 3: API – phiên bản, kiểm tra bản mới, kích hoạt

## Overview

1. `GET /api/config` trả thêm `version`.
2. Kiểm tra GitHub phía server, lười (chỉ khi web hỏi), cache trong bộ nhớ (D3, D4).
3. `GET /api/admin/update` gộp: kết quả kiểm tra, trạng thái updater, bản đang ghim.
4. `POST /api/admin/update {version}`: kiểm quyền, CSRF, cooldown, rồi gọi updater qua mạng `internal` bằng token.

App **không** có Docker socket (D1). Mọi việc với Docker nằm ở phase 4.

## Context (đã đọc và trace)

- `apps/api/src/app.ts:47`: `localGuard` chạy trước mọi route khi local mode. `apps/api/src/middleware/local-guard.ts:38-60`
  chặn Host lạ, chặn method ghi có `Origin` khác Host hoặc `Sec-Fetch-Site: cross-site`.
- `apps/api/src/app.ts:52-55`: `/api/config` public, `no-store`, hiện trả `{ local_mode }`.
- `apps/api/src/app.ts:64` mount `adminApi()`. `apps/api/src/routes/admin.ts:10-19`: `requireUser` + `requireAdmin`.
  `apps/api/src/middleware/admin.ts:12-14`: local mode luôn là admin.
- `apps/api/src/index.ts:9-14`: local mode chạy `bootLocal()` (backup + migrate) **rồi mới** `serve`. Vì vậy khi
  `/api/config` trả version mới thì DB đã migrate xong. Web dựa vào điểm này để biết cập nhật xong (phase 5).
- `apps/api/src/env.ts:35-47`: khối biến `MTL_*`. `flag01` (l.13) mặc định `false`, cần biến thể mặc định `true`.
- `apps/api/src/local/local-secrets.ts:32-47`: `readOrCreateSecret(path, generate)` tạo file `wx` mode 0600, process
  đến sau đọc lại. Dùng lại cho token updater, không sửa file này.
- `hono/secure-headers` mặc định **không** đặt CSP (`node_modules/.pnpm/hono@4.13.13/.../secure-headers.js:17-32`), có
  `referrer-policy: no-referrer`.
- Test phải sửa vì `/api/config` thêm key: `apps/api/test/local-mode.test.ts:38-43` (`toEqual({ local_mode: true })`),
  `apps/api/test/tenant-isolation.test.ts:309-313` (`toEqual({ local_mode: false })`). `infra/selfhost-smoke.mjs:96-97`
  chỉ kiểm `local_mode`, không vỡ.
- `apps/api/test/admin-access.test.ts:10-14` quét mọi route của `adminApi()`, bắt 401 (chưa đăng nhập) và 403 (user
  thường). Route mới mount trong `adminApi()` nên được kiểm tự động.

## Files

| Thao tác | File |
|---|---|
| Sửa | `apps/api/src/env.ts` (4 biến mới) |
| Sửa | `apps/api/src/app.ts` (`/api/config` thêm `version`) |
| Sửa | `apps/api/src/routes/admin.ts` (mount `adminUpdateRoutes`) |
| Tạo | `apps/api/src/lib/update-check.ts` |
| Tạo | `apps/api/src/lib/updater-client.ts` |
| Tạo | `apps/api/src/routes/admin-update.ts` |
| Tạo | `apps/api/test/unit/update-check.test.ts` |
| Sửa | `apps/api/test/unit/env-local.test.ts` |
| Tạo | `apps/api/test/admin-update.test.ts` |
| Sửa | `apps/api/test/local-mode.test.ts` (l.38-43) |
| Sửa | `apps/api/test/tenant-isolation.test.ts` (l.309-313) |

Không sửa `apps/api/src/updater/**` (phase 4) và `docker-compose.yml` (phase 4).

## Implementation steps

1. **`env.ts`**, thêm cạnh `MTL_ALLOWED_HOSTS`:
   - `MTL_VERSION: blank(z.string().default("dev"))`. Image đặt sẵn (phase 2). Chuỗi không phải semver thì coi như dev.
   - `MTL_UPDATE_CHECK`: nhận `1|true|0|false`, **mặc định bật**.
   - `MTL_UPDATE_TARGET: blank(z.string().optional())`. Chỉ cho người phát hành thử bản rc (D10). Không phải semver thì
     `console.warn` một lần và bỏ qua.
   - `MTL_TAG: blank(z.string().optional())`. Compose truyền vào (phase 4). Dùng để biết bản đang ghim.
2. **`app.ts`** l.52-55: `return c.json({ local_mode: local, version: env.MTL_VERSION })`.
3. **`lib/update-check.ts`**. Factory `createUpdateCheck({ fetch, now, current, enabled, override })` để test, export
   một singleton dùng `env`, kèm `setUpdateCheckForTest`.
   - `get()` trả `{ check, latest }`:
     - `parseVersion(current) === null` → `{ check: "dev", latest: null }`, không gọi mạng.
     - Có `override` hợp lệ → `{ check: "ok", latest: { version: override, name: "v…", url: releaseUrl(…), source: "override" } }`,
       không gọi mạng (kể cả khi `enabled = false`).
     - `enabled = false` → `{ check: "disabled", latest: null }`.
     - Còn lại: trả cache nếu còn hạn. Hết hạn thì gọi GitHub, có gộp request đang bay (nhiều tab chỉ tạo 1 request).
   - Request: `GET https://api.github.com/repos/${RELEASE_REPO}/releases/latest`. Header `Accept: application/vnd.github+json`,
     `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: mtl-selfhost` (không kèm phiên bản hay id máy).
     `signal: AbortSignal.timeout(5000)`. Không gửi token.
   - Parse: `tag_name` qua `parseVersion`. `draft` hoặc `prerelease` là `true` thì coi là lỗi. `name` lấy chuỗi đã trim,
     cắt 120 ký tự, rỗng thì `v${version}`. `url = releaseUrl(version)`, **không** dùng `html_url` từ response.
   - Cache: thành công giữ 24h, lỗi giữ 6h (D4). Lỗi in đúng một dòng `[update-check] <lý do>`, không in stack.
   - `update_available = latest !== null && isNewer(latest.version, current)`.
4. **`lib/updater-client.ts`**:
   - Base `http://updater:${UPDATER_PORT}`. Có `setUpdaterBaseForTest(url)`. Không đọc biến môi trường cho URL (D9).
   - Token: lần gọi đầu chạy `readOrCreateSecret(join(env.MTL_DATA_DIR, "secrets", UPDATER_TOKEN_FILE), () =>
     randomBytes(32).toString("base64url"))`, rồi nhớ trong bộ nhớ.
   - `status()`: `GET /v1/status`, timeout 3s. Lỗi kết nối (ENOTFOUND khi compose cũ không có service updater hoặc
     `MTL_UPDATER=0`, ECONNREFUSED, timeout) → `{ ready: false, reason: "unavailable", project: null, run: null }`.
     401 → `reason: "internal"`, log một dòng (token lệch).
   - `start(version)`: `POST /v1/update`, body `{ version }`, timeout 15s. Trả `{ ok: true, run }` hoặc
     `{ ok: false, status, reason }`.
5. **`routes/admin-update.ts`** (mount trong `adminApi()`, nên đã qua `requireUser` + `requireAdmin`):
   - Không phải local mode → 404 `not_found` cho cả hai route. Bản VPS cập nhật bằng `infra/deploy.sh`.
   - `GET /update`: chạy song song `updateCheck.get()` và `client.status()`. Trả `UpdateStatus` (phase 1) với
     `pinned_tag = MTL_TAG && MTL_TAG !== "latest" ? MTL_TAG : null`, header `cache-control: no-store`.
   - `POST /update`:
     a. `content-type` không phải `application/json` → 415. Lớp này thêm vào `localGuard`: form HTML cross-site không
        gửi được JSON nếu không có preflight.
     b. Body `{ version: string }` (zod, tối đa 64 ký tự). `parseVersion` lỗi → 400 `bad_version`.
     c. `get({ fresh: true })`: bỏ qua cache và hỏi GitHub một lần (D4). Lỗi mạng thì dùng kết quả cache. Nếu
        `!update_available` hoặc `latest.version !== version` → 409 `stale` (web đang hiện bản cũ, hoặc `:latest` đã
        sang bản mới hơn). Bước này tránh lỗi `version_mismatch` ở runner.
     d. `pinned_tag` có giá trị và `version` không phải prerelease → 422 `pinned`.
     e. Cooldown: trigger được nhận gần nhất cách chưa tới 60s → 429 `cooldown`.
     f. `client.start(version)`. Updater không gọi được → 503 `unavailable`. Updater trả lỗi → giữ nguyên status và
        reason. Thành công → 202 `{ run }` và log `[update] ${current} → ${version}`.
6. **`routes/admin.ts`**: `app.route("/", adminUpdateRoutes)`.

## Tests

`apps/api/test/unit/update-check.test.ts` (không cần Docker, dùng fetch giả và đồng hồ giả):

| Ca | Kỳ vọng |
|---|---|
| newer release → available, url built from tag | `url` = `releaseUrl`, bỏ qua `html_url` giả trong response |
| same / older release → not available | |
| dev or non-semver current → no fetch | fetch gọi 0 lần, `check: "dev"` |
| MTL_UPDATE_CHECK=0 → no fetch | `check: "disabled"` |
| override wins, no fetch, even when disabled | `source: "override"` |
| invalid override ignored | warn 1 lần, quay về GitHub |
| cache 24h on success | 2 lần `get()` trong 24h → 1 fetch, qua 24h → fetch lại |
| cache 6h on failure | timeout, 403 rate limit, 500, JSON rác, `tag_name` sai, `draft`/`prerelease` true → `check: "error"`, 6h sau mới gọi lại |
| concurrent calls share one request | 5 `get()` song song → 1 fetch |
| fresh bypasses cache, falls back to cache on error | `get({fresh:true})` luôn fetch. Fetch lỗi → trả kết quả cache cũ, không ghi đè cache tốt bằng lỗi |
| name trimmed to 120 chars, empty → v… | |

`apps/api/test/unit/env-local.test.ts`: thêm ca mặc định `MTL_VERSION = "dev"`, `MTL_UPDATE_CHECK` mặc định `true`,
`"0"` → `false`, `"yes"` → throw, `MTL_TAG` để trống thì `undefined`.

`apps/api/test/admin-update.test.ts` (bộ test có DB, local mode như `local-mode.test.ts:24-35`). Updater giả là
`node:http` nghe `127.0.0.1:0`, kiểm luôn header `Authorization: Bearer <token>`. Kiểm tra bản mới thay bằng
`setUpdateCheckForTest`.

| Ca | Kỳ vọng |
|---|---|
| GET status merges check + updater + pinned_tag | đúng `UpdateStatus` |
| updater down → ready false, reason unavailable | GET vẫn 200 |
| POST without JSON content-type | 415 |
| POST cross-site (`Origin: http://evil.test`) | 403 (localGuard) |
| POST bad version / stale version | 400 / 409 |
| POST pinned + stable target → 422; pinned + prerelease override → 202 | |
| POST success → 202, updater nhận đúng `{version}` và token | |
| POST twice within 60s → 429 | |
| updater replies 409 busy → 409 busy | |
| not local mode → 404 on both routes | |
| token file created 0600 under MTL_DATA_DIR/secrets on first call | |

Thêm: `/api/config` có `version` (sửa 2 test cũ đã nêu). `admin-access.test.ts` phải xanh mà không cần sửa.

## Done

- `pnpm --filter @mtl/api test:unit` và `pnpm --filter @mtl/api test` xanh, `pnpm lint` và `pnpm typecheck` xanh.
- Gọi tay với dev server ở local mode: `curl -s localhost:8080/api/admin/update` khi không có updater trả
  `updater.reason = "unavailable"`, `check: "dev"`.

## Risks

| Rủi ro | K×T | Giảm thiểu |
|---|---|---|
| GitHub chậm làm GET status treo | TB×TB | Timeout 5s, gộp request đang bay, cache lỗi 6h. Web không chờ status mới render shell |
| Trang lạ trong trình duyệt gọi POST | Thấp×Cao | `localGuard` (Origin, Sec-Fetch-Site, Host) + bắt JSON + phải khớp đúng version server đang biết + cooldown |
| Lộ phiên bản qua `/api/config` công khai (bản VPS) | Thấp×Thấp | Bản VPS không đặt `MTL_VERSION` nên hiện `dev`. Phiên bản của app mã nguồn mở không phải bí mật |
| Token updater lệch (xoá tay file) | Thấp×Thấp | Updater đọc file mỗi request, app đọc lại khi nhận 401 |

## Rollback

Revert phase: `/api/config` mất `version`, web (phase 5) ẩn nhãn phiên bản (đã xử lý thiếu key). Route mất thì web
nhận 404 và ẩn thông báo. File `updater-token` còn lại vô hại.
