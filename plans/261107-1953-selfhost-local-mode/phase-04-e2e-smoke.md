---
phase: 4
title: "Smoke end-to-end trên thư mục tạm"
status: completed
priority: P1
effort: "0.25d"
dependencies: [3]
---

# Phase 4: Smoke end-to-end

## Overview
Script build 2 image local, chạy `docker-compose.yml` trong thư mục tạm có `./data` trống, kiểm 6 điều kiện của brief qua HTTP thật
(không trình duyệt), rồi down/up để kiểm dữ liệu còn và backup DB được tạo. Chạy tay trên máy dev; KHÔNG đưa vào CI (nặng: build image + tải model).

## Context
- Plan: [plan.md](plan.md) — Decisions 9, 10, 15. Phase 1–3 đã xong (disk driver, local mode, image + compose).
- Compose: `docker-compose.yml` (biến `MTL_TAG`, `MTL_PORT`; service `postgres`, `app`, `jobs`, `worker`), Dockerfile `infra/docker/{app,worker}.Dockerfile`.
- Luồng upload API (đọc schema zod trong file để dựng body đúng):
  `POST /api/series` (`apps/api/src/routes/series.ts:295`) → `POST /api/chapters` (`routes/chapters.ts:180`) →
  `POST /api/chapters/:id/presign` (`chapters.ts:239`, trả `{url, fields}` theo file) → POST multipart tới `url` (tương đối `/files/...`) →
  `POST /api/chapters/:id/commit` (`chapters.ts:273`) → theo dõi `GET /api/chapters/:id` / `GET /api/chapters/:id/pages` (`routes/pages.ts:27`) / `GET /api/jobs/:jobId` (`routes/jobs.ts:33`).
- Export: `POST /api/chapters/:id/export` (`routes/export.ts:83`, body `format`, `layout`, `quality`, `include_untranslated`) → `GET /api/exports/:jobId` → `GET /api/exports/:jobId/download` (302 tới link `/files/...`).
- Smoke cũ của VPS để tham khảo phong cách log/die: `infra/smoke.sh`, `infra/lib.sh`.

## Requirements
- Functional — `infra/selfhost-smoke.sh` (bash, `set -euo pipefail`):
  1. Từ gốc repo build `ghcr.io/jhin1m/mtl:smoke` và `ghcr.io/jhin1m/mtl-worker:smoke` (bỏ qua khi `SMOKE_SKIP_BUILD=1`).
  2. `work=$(mktemp -d)`, copy `docker-compose.yml` vào; `cd "$work"`; `export MTL_TAG=smoke MTL_PORT=${SMOKE_PORT:-18080}`; project `-p mtl-smoke`.
     `trap` khi thoát: `docker compose down` + xoá `$work` (dữ liệu postgres thuộc uid 999 → xoá bằng `docker run --rm -v "$work:/w" busybox rm -rf /w/data`); `SMOKE_KEEP=1` thì giữ và in đường dẫn.
  2b. Nếu đặt `SMOKE_MODELS_CACHE=<dir>` (thư mục model đã tải đúng sha256) thì copy vào `data/models` trước khi up để lần chạy lại không phải tải model; không đặt → kiểm đường tải lần đầu (controller thêm: smoke có thể phải chạy lại sau review).
  3. `docker compose up -d --wait --wait-timeout 900` (lần đầu worker tải model). Kiểm `data/backups` rỗng (DB trống → không backup).
  4. Chạy `node infra/selfhost-smoke.mjs run "$BASE" "$work/smoke-state.json"` (đường dẫn tuyệt đối tới file trong repo).
  5. `docker compose down && docker compose up -d --wait` → `node infra/selfhost-smoke.mjs verify "$BASE" "$work/smoke-state.json"`.
  6. Kiểm có đúng ≥ 1 file `data/backups/mtl-*.dump` (tạo khi khởi động lại). `docker compose restart app` + chờ healthy → số file tăng thêm 1.
  7. Kiểm cấu hình mạng/quyền: `docker compose port postgres 5432` không trả gì; `docker compose port app 8080` = `127.0.0.1:<port>`;
     `data/secrets/*` và `data/worker/token` quyền `600` (`stat -c %a` Linux / `stat -f %Lp` macOS).
  8. In "SMOKE OK" + thời gian từng bước.
- Functional — `infra/selfhost-smoke.mjs` (Node 24, chỉ `fetch` + `node:zlib`, không phụ thuộc):
  - `run`:
    a. `GET /` → 200, `content-type` html, chứa `id="root"` (SPA, không redirect). `GET /api/config` → `local_mode: true`. `GET /api/me` không cookie → 200, `is_admin: true`.
       `GET /api/auth/get-session` → 404.
    b. Sinh 1 PNG 800×1200 (nền trắng + vài khối đen) bằng `zlib.deflateSync` (CRC32 tự tính) — không cần file fixture.
    c. Tạo series + chapter, presign, POST multipart (`fields` + `file`) tới `new URL(url, BASE)` → 2xx, commit.
    d. Poll tới khi mọi trang đã qua `page.prepare` (`succeeded`) — timeout `SMOKE_PREPARE_TIMEOUT_S` (mặc định 900s); job `failed` → in `error` rồi thoát 1.
    e. Không tốn token: chưa cấu hình provider AI nào mà prepare vẫn xong, và `GET /api/me` → `quota.spent_usd === 0`.
    f. Export (`format: "zip"`, `include_untranslated: true`, layout mặc định theo schema) → poll `succeeded` → `GET …/download` với `redirect: "manual"` → 302, `Location` bắt đầu `/files/`;
       GET Location → 200, `content-disposition` có `attachment`, body > 0 byte, 4 byte đầu `PK\x03\x04`.
    g. Ghi `{ seriesId, chapterId, pageIds, exportJobId }` vào file state.
  - `verify`: đọc state; `GET /api/chapters/:id` + `/pages` → đủ số trang như lúc chạy; ảnh gốc 1 trang tải lại được qua URL presign (200, magic PNG); export job vẫn liệt kê ở `GET /api/chapters/:id/exports`.
  - Mọi lỗi in method/URL/status/body (cắt 500 ký tự) rồi `process.exit(1)`.
- Non-functional
  - Chạy được trên macOS (Docker Desktop) và Linux; không ghi gì vào repo (mọi dữ liệu trong `$work`).
  - Không cần `.env`, không cần key AI.

## Related Code Files
- Create: `infra/selfhost-smoke.sh` (chmod +x), `infra/selfhost-smoke.mjs`.
- Modify: chỉ file của phase 1–3 khi smoke lộ bug — mỗi sửa ghi vào báo cáo (file, nguyên nhân, test bổ sung).
- Report: `plans/reports/smoke-<YYMMDD-HHmm>-selfhost-local-mode-report.md` (output rút gọn, thời gian, kích thước image, bug đã sửa, mục license cần rà, câu hỏi còn mở).

## Implementation Steps
1. Đọc schema zod của các route ở mục Context để dựng body đúng; xác định trường trạng thái trang/job sau commit (grep `page.prepare` trong `apps/api/src/routes/chapters.ts`, `routes/progress.ts`).
2. Viết `selfhost-smoke.mjs` (run/verify) — thử nhanh với stack dev phase 2 bước 9 (local mode không Docker) trước khi chạy compose.
3. Viết `selfhost-smoke.sh`, chạy đủ: `infra/selfhost-smoke.sh`. Lỗi → sửa ở phase tương ứng + thêm test unit/integration tái hiện → chạy lại tới khi "SMOKE OK".
4. Chạy lại `pnpm --filter @mtl/api test:unit`, `pnpm test`, `pnpm typecheck`, `pnpm lint` nếu có sửa code.
5. Viết báo cáo vào `plans/reports/`.

## Success Criteria
- [x] `infra/selfhost-smoke.sh` in "SMOKE OK" từ `./data` trống, gồm đủ: mở `/` không đăng nhập; upload chương; `page.prepare` xong không tốn token; export tải được zip;
      `down && up` còn dữ liệu; khởi động lại tạo backup DB.
- [x] Postgres không lộ cổng; app chỉ bind `127.0.0.1`; secret/token quyền 600.
- [x] Báo cáo smoke có trong `plans/reports/`.

## Risk Assessment
- **Lần đầu tải model lâu/hỏng mạng** → timeout cấu hình được (`--wait-timeout`, `SMOKE_PREPARE_TIMEOUT_S`). Mỗi lần smoke là thư mục mới nên luôn tải lại model — chấp nhận để kiểm đúng đường "lần đầu".
- **Cổng 18080 bận** → `SMOKE_PORT`.
- **Prepare chậm trên CPU** → 1 trang nhỏ 800×1200.
- **Trang trắng không có chữ làm pipeline nhánh khác** → vẫn phải `succeeded`; nếu fail vì "không có vùng chữ" thì đó là bug cần sửa (người dùng thật có trang không thoại).
- **Docker cũ không hỗ trợ `--wait`** → yêu cầu compose v2.17+; ghi trong `docs/self-host.md`.

## Quyết định khi implement (tự chốt)
- **Cổng smoke 18081** (`SMOKE_PORT=18081`): 18080 trên máy dev đang bị tiến trình khác của user chiếm (`steam-access-fix.py serve`) — không đụng; mặc định script vẫn 18080.
- **Series `source_lang: "ja"` + commit `target: "prepared"`**: OCR mặc định `manga_ocr` local, dừng sau Bước 1 (chưa có provider → không nối bước dịch). `ko` = strip dừng chờ duyệt cắt trang → không kiểm được prepare.
- **Export `png_zip` + `layout: "pages"`**: spec ghi `"zip"` nhưng enum thật `png_zip|cbz`; `layout` bắt buộc (schema không có mặc định).
- **Poll `GET /api/chapters/:id/progress`** (trạng thái trang + job + lỗi trong 1 lần gọi). Xong = mọi trang `prepared` + `ocr_ready`, job `succeeded`; job `failed|cancelled` → thoát ngay.
- **"Không tốn token"** = `GET /api/admin/providers` rỗng + `quota.spent_usd === 0`.
- **Kiểm cổng postgres bằng cột Ports của `compose ps`** (có `->` = publish): `compose port` in `invalid IP:0` (exit 0) khi không publish → lần chạy đầu báo lỗi giả. App: mọi binding phải đúng `127.0.0.1:<port>->8080/tcp`.
- **Kiểm file `/data` qua `compose exec -T app`** (root trong container): host Linux uid ≠ 1000 / rootless không đọc được `data/secrets` (700).
- **Trang thử có chữ thật** (bổ sung sau smoke đầu): 2 bóng thoại trắng viền đen, chữ Nhật dọc, vẽ bằng Pillow trong image worker. Image không có font CJK → tải Noto Sans JP Bold (OFL, tag `Sans2.004`, sha256 ghim); `SMOKE_FONT` thay font, `SMOKE_PAGE` thay cả trang (khi đó chỉ kiểm ≥ 1 khối có chữ).
- **Kiểm OCR qua `psql`** (`pages.ocr_result`): API chưa trả OCR trước khi dịch; không thêm endpoint (ngoài phạm vi). Assert ≥ 1 khối có text; trang tự vẽ: ≥ 50% ký tự đã vẽ đọc ra. Ảnh xoá chữ kiểm qua `images.clean` của `GET /chapters/:id/pages` (tồn tại, khác ảnh gốc).
- **Cách ly môi trường**: `unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES MTL_SKIP_BOOT_BACKUP MTL_ALLOWED_HOSTS`, luôn `-p mtl-smoke -f $work/docker-compose.yml`; còn stack `mtl-smoke` cũ → dừng, không chiếm.

## Kết quả (07/11/2026)
- SMOKE OK từ `./data` trống (model 1,2 GB tải thật), 117s trên arm64/OrbStack: đủ 6 mục + cổng/quyền. Báo cáo: `plans/reports/smoke-261107-2112-selfhost-local-mode-report.md`.
- Bổ sung OCR thật (21:45): SMOKE OK 118s — manga_ocr đọc `こんにちは元気ですか` (conf 1) + `ありがとうまたね` (0.9993), khớp 18/18 ký tự; ảnh xoá chữ sạch (đã xem), viền bóng còn. `SMOKE_PAGE` (đường dẫn tương đối) OK.
- Code phase 1–3: không có bug → không sửa. Chỉ sửa 2 script phase 4 (lỗi kiểm cổng + 1 major/8 minor theo review 8/10 `plans/reports/from-code-reviewer-to-controller-261107-2115-selfhost-smoke-scripts-review-report.md`). `pnpm lint` xanh.
