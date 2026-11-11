---
phase: 1
title: "Hợp đồng chung: semver + kiểu trạng thái cập nhật"
status: completed
priority: P1
effort: "1.5h"
dependencies: []
---

# Phase 1: Hợp đồng chung

## Overview

Một module thuần, không phụ thuộc, dùng chung cho API (phase 3), updater (phase 4) và web (phase 5):
so sánh semver, mã lý do (reason), kiểu JSON của `GET /api/admin/update` và của updater, hằng số repo/URL.
Có module này trước thì phase 2, 3, 4, 5 chạy song song được.

## Context (đã đọc)

- `packages/shared/package.json:5-8`: đã có subpath export `"./series-lang"`. Thêm `"./update"` cùng kiểu, để
  updater import `@mtl/shared/update` mà không kéo `index.ts` (index nạp zod, `@noble/hashes`, uuid qua `job.ts`).
- `packages/shared/src/index.ts:1-11`: chỉ `export *` từng file.
- Release tag: `.github/workflows/release.yml:33-38` chấp nhận `^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`.
  Regex của module phải chặt hơn hoặc bằng (semver 2.0, không build metadata `+…`).

## Files

| Thao tác | File |
|---|---|
| Tạo | `packages/shared/src/update.ts` |
| Sửa | `packages/shared/src/index.ts` (thêm `export * from "./update.ts";`) |
| Sửa | `packages/shared/package.json` (exports `"./update": "./src/update.ts"`) |
| Tạo | `packages/shared/test/update.test.ts` |

## Nội dung `update.ts` (không import gì)

1. Semver:
   - `parseVersion(s)`: bỏ một chữ `v` đầu, khớp semver 2.0 không có `+build`. Sai thì `null`.
   - `compareVersions(a, b)`: thứ tự semver 2.0. Bản có prerelease nhỏ hơn bản chính cùng X.Y.Z. Định danh số so theo
     số (`rc.2 < rc.10`), định danh chữ so theo ASCII, số nhỏ hơn chữ.
   - `isNewer(candidate, current)`, `isPrerelease(v)`.
   - `"dev"` hoặc chuỗi sai định dạng không bao giờ "mới hơn" hay "cũ hơn". Hàm gọi phải xử lý `null`.
2. Hằng số:
   - `RELEASE_REPO = "jhin1m/manga-web-translate"`.
   - `releaseUrl(v)` trả `https://github.com/${RELEASE_REPO}/releases/tag/v${v}`.
   - `composeUrl(ref)` trả `https://raw.githubusercontent.com/${RELEASE_REPO}/${ref}/docker-compose.yml`.
   - `UPDATER_PORT = 8090`, `UPDATER_TOKEN_FILE = "updater-token"` (nằm trong `${MTL_DATA_DIR}/secrets/`).
   - `runnerName(project)` trả `${project}-update`.
   - `ALLOWED_IMAGE_REPOS = ["ghcr.io/jhin1m/mtl", "ghcr.io/jhin1m/mtl-worker", "postgres"]`. `postgres` là
     `docker.io/library/postgres`, phải chuẩn hoá trước khi so.
3. `UPDATE_REASONS` (const array) và kiểu `UpdateReason`:
   `unavailable, not_ready, no_socket, docker_too_old, project_not_found, custom_compose, path_mismatch, pinned, busy,
   cooldown, not_newer, dev_build, stale, download_failed, invalid_compose, image_not_allowed, pull_failed,
   version_mismatch, up_failed, timeout, internal`. Ý nghĩa từng mã nằm ở phase 4 (nơi sinh mã) và phase 5 (câu hiển thị).
4. `UPDATE_STEPS = ["preflight", "download", "pull", "verify", "apply", "check", "done"]`:
   - `apply` = ghi compose rồi `up -d --wait`. Trong bước này app bị tạo lại.
   - `check` = so mount và phiên bản sau khi cập nhật.
5. Kiểu:
   ```ts
   type UpdateRun = { state: "running" | "succeeded" | "failed"; target: string; from: string; step: UpdateStep;
     started_at: string; finished_at: string | null; exit_code: number | null; reason: UpdateReason | null;
     log_tail: string[] };                       // ≤ 40 dòng, mỗi dòng ≤ 300 ký tự
   type UpdaterStatus = { ready: boolean; reason: UpdateReason | null; project: string | null; run: UpdateRun | null };
   type UpdateStatus = {                         // GET /api/admin/update
     current: string;                            // "0.3.0" | "dev"
     check: "ok" | "disabled" | "dev" | "error";
     latest: { version: string; name: string; url: string; source: "github" | "override" } | null;
     update_available: boolean;
     pinned_tag: string | null;                  // MTL_TAG khác "latest"
     updater: UpdaterStatus;                     // updater không gọi được → { ready: false, reason: "unavailable" }
   };
   ```
   `UpdaterStatus` cũng là body của `GET /v1/status` từ updater: một kiểu cho cả hai chặng.

## Tests (`pnpm --filter @mtl/shared test`)

| Ca | Kỳ vọng |
|---|---|
| parse | `v0.3.0` hoặc `0.3.0` → ok. `0.3`, `01.2.3`, `1.2.3+b`, `dev`, `` → `null` |
| prerelease < release | `0.3.0-rc.1 < 0.3.0`, `0.3.0-rc.2 < 0.3.0-rc.10`, `0.3.0-alpha < 0.3.0-rc.1` |
| major/minor/patch | `1.0.0 > 0.99.99`, `0.10.0 > 0.9.0` (so số, không so chuỗi) |
| isNewer với dev/rác | luôn `false` |
| URL | `releaseUrl("0.3.0")`, `composeUrl("v0.3.0")` đúng chuỗi |
| reason/step | mảng không trùng phần tử |

## Done

- `pnpm --filter @mtl/shared test` và `pnpm typecheck` xanh.
- `import { compareVersions } from "@mtl/shared/update"` chạy được từ `apps/api` (tsx) và từ `apps/web` (vite).

## Risks

| Rủi ro | K×T | Giảm thiểu |
|---|---|---|
| So chuỗi thay vì so số làm `0.10.0 < 0.9.0` | TB×Cao | Có test riêng cho ca này |
| Web bundle kéo theo code thừa | Thấp×Thấp | Module không import gì, chỉ vài trăm byte |

## Rollback

Xoá file và dòng export. Chưa ai dùng nếu các phase sau chưa merge.
