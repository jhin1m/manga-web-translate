# Smoke self-host 0.3.0-rc.3: fresh install + cập nhật từ rc.2 + trim (Docker, macOS)

Ngày 13/11/2026 (giờ Asia/Saigon; log container ghi UTC 12/11 18:xxZ). Tag `v0.3.0-rc.3` = commit `7924851`, `v0.3.0-rc.2` = `c7501d3`.
Kết quả: **fresh SMOKE OK (49s), UPDATE SMOKE OK (79s), trim PASS (2 lần)**. Không sửa code sản phẩm, không tag, không push.

## Artifact

- GHCR `ghcr.io/jhin1m/mtl:0.3.0-rc.3` và `mtl-worker:0.3.0-rc.3`: manifest list có `amd64` + `arm64`; label
  `org.opencontainers.image.version=0.3.0-rc.3`. Digest app `sha256:47ca9a67…`, worker `sha256:1f7f9952…`.
- Worker chạy `mtl-worker 0.12.0` (`PIPELINE_VERSION`), API `MIN_PIPELINE_VERSION` mặc định 0.12.0.
- `docker-compose.yml` ở `v0.3.0-rc.3` **giống hệt** `v0.3.0-rc.2` (`git diff` rỗng). Chỉ `infra/selfhost-update-smoke.sh` đổi khác.
- Migration: rc.2 = 27, rc.3 = 29 (0027 `source_file_trim`, 0028 `series_skip_image_edge`).
- Môi trường: **OrbStack 29.4.0 (aarch64)**, context active `orbstack`. Brief ghi Docker Desktop, không khớp (xem Concerns).

## Đã chạy (lệnh)

```sh
# 0. tag local :smoke trỏ bản rc.3 (ghi đè :smoke cũ = build 0.2.0-rc.1), pre-pull rc.2
docker tag ghcr.io/jhin1m/mtl:0.3.0-rc.3 ghcr.io/jhin1m/mtl:smoke
docker tag ghcr.io/jhin1m/mtl-worker:0.3.0-rc.3 ghcr.io/jhin1m/mtl-worker:smoke
docker pull ghcr.io/jhin1m/mtl:0.3.0-rc.2 ; docker pull ghcr.io/jhin1m/mtl-worker:0.3.0-rc.2

# 1. fresh install (giữ stack để chạy trim)
SMOKE_SKIP_BUILD=1 SMOKE_PORT=18090 SMOKE_MODELS_CACHE=<repo>/worker/models SMOKE_KEEP=1 infra/selfhost-smoke.sh

# 2. upgrade rc.2 -> rc.3 (lần 1 không giữ stack; lần 2 giữ stack để chạy trim trên bản đã nâng)
FROM=0.3.0-rc.2 TO=0.3.0-rc.3 SMOKE_PORT=18083 SMOKE_MODELS_CACHE=<repo>/worker/models infra/selfhost-update-smoke.sh
FROM=0.3.0-rc.2 TO=0.3.0-rc.3 SMOKE_PORT=18083 SMOKE_KEEP=1 SMOKE_MODELS_CACHE=<repo>/worker/models infra/selfhost-update-smoke.sh

# 3. trim ad hoc (harness không có bước trim): scratchpad/trim-check.mjs, không commit
node trim-check.mjs http://127.0.0.1:18090 worker/tests/reference/render_lines.png 20 40
node trim-check.mjs http://127.0.0.1:18083 worker/tests/reference/render_lines.png 20 40   # sau khi nâng lên rc.3
```

## Kết quả 1: fresh install rc.3 (`selfhost-smoke.sh`, port 18090)

- Stack `mtl-smoke`: postgres, app, updater, jobs, 2 worker (mặc định `MTL_WORKERS=2`). Worker log: `mtl-worker 0.12.0`.
- Đạt: SPA 200 + local_mode + `/api/me` admin, upload + commit, `page.prepare` (chapter `prepared`, 1 trang, xoá chữ rev 1),
  0 provider AI / `spent_usd=0`, export png_zip 37598 byte.
- OCR thật: `こんにちは元気ですか` / `ありがとうまたね`, khớp **18/18** ký tự vẽ.
- Down/up giữ dữ liệu (verify OK), backup 1 → 2 sau restart app, postgres không publish, app `127.0.0.1:18090->8080/tcp`,
  2 secret + token quyền 600.
- Không có 426 (`pipeline_too_old`) trong log app/jobs/worker. Worker claim được job `chapter.ingest` và `page.prepare`.
- Timing: vẽ trang 2s, nạp model 1s, up lần đầu 13s, HTTP 11s, OCR 0s, down/up 13s, backup restart 9s, cổng 0s, **tổng 49s**.

## Kết quả 2: trim (ad hoc, cùng flow harness + PATCH trước commit)

Flow: `POST /api/series` → `POST /api/chapters` (kèm width/height) → upload presign →
`PATCH /chapters/:id/source-files/:fileId {trim:{top:20,bottom:40}, height:260}` → `POST commit {target:prepared}` → poll → đọc PNG IHDR.

- Nguồn `render_lines.png` **360x260**, trim 20/40 → kỳ vọng 200. Page clean = **360x200**. PASS.
- Trên bản fresh rc.3 (18090): PASS, prepared trong ~6s.
- Trên bản đã nâng từ rc.2 (18083, worker 0.12.0 sau update): PASS, 360x200. Đây là bằng chứng job claim trên worker mới sau nâng cấp.
- Lần đầu thử với giả định sai 800x1200 → `400 trim_too_large` (chừa ≥64px). Đây là guard đúng, không phải bug sản phẩm.

## Kết quả 3: cập nhật rc.2 → rc.3 (`selfhost-update-smoke.sh`, port 18083)

Lần 1 (không giữ stack): **UPDATE SMOKE OK, 79s**. Lần 2 (`SMOKE_KEEP=1`, để chạy trim): **exit 0**, cùng kết quả.

- Cài FROM rc.2: `update_available=true`, `latest=0.3.0-rc.3`, updater ready. Baseline: migrations 27, backups 0, compose `501 20 640`, 12 bind.
- Âm tính: 403 Origin lạ, 403 Host lạ (DNS rebinding), 415 non-JSON, 409 stale, updater 401 khi sai token, updater không publish cổng.
- POST → 202, POST thứ hai → 429 cooldown.
- Runner: `preflight download pull verify apply check done`, `MTL_UPDATE result=ok`, exit 0. Thứ tự: jobs/worker dừng trước khi app cũ bị huỷ (#34), app mới start (#48), jobs/worker start sau healthy (#55).
- Dữ liệu: `verify OK` (chương, trang, ảnh gốc, export). Migration 27 → **29**, backup 0 → 1.
- 12 bind giống hệt trước/sau. Cổng `127.0.0.1:18083`, 1 worker, `MTL_THREADS=2` (.env), `MTL_UPDATE_TARGET=0.3.0-rc.3` (shell) giữ nguyên.
- Compose == v0.3.0-rc.3, `.bak` == v0.3.0-rc.2, uid/gid/mode giữ `501 20 640`. Sau update `update_available=false`, `run.state=succeeded`. Mọi service `app/jobs/worker/updater` chạy image label `0.3.0-rc.3`.
- `docker compose up -d` tay sau đó vẫn rc.3, dữ liệu và bind không đổi. `MTL_UPDATER=0`: không còn updater, `updater.reason=unavailable`.
- Không có 426 trong container log (lần 2, các container còn sống).

Timing lần 1: install rc.2 14s, seed 14s, âm tính 0s, trigger 1s, chờ version mới 27s, check 1s, verify 1s,
up tay 14s, `MTL_UPDATER=0` 7s, **tổng 79s**. Mỗi `docker manifest inspect` ~7s (4 lần), nên preflight chậm.

## Dọn dẹp

- Fresh stack `mtl-smoke`: `docker compose -p mtl-smoke down`, xoá data bằng busybox, xoá temp dir.
- Upgrade stack (lần 2): `docker rm -f mtl-upd-smoke-update`, `compose down`, xoá data và temp dir.
- Kiểm: không còn compose project, container, network, volume, temp dir nào có `smoke`/`upd`.
  3 container `mtl-dev-*` (postgres, files-proxy, minio) vẫn chạy, không đụng.
- Giữ lại (local): image tag `ghcr.io/jhin1m/mtl:smoke` và `mtl-worker:smoke` (giờ trỏ rc.3, trước là build 0.2.0-rc.1), và các image rc.2/rc.3 đã pull.

## Concerns / lệch so với brief

1. **Docker Desktop không được dùng.** Máy chạy OrbStack (context `orbstack`). Docker Desktop for Mac chưa kiểm, giống rc.2.
2. **Port 18080 đang bị Python PID 2007 giữ** (không phải của tôi, không đụng). Dùng 18090 và 18083.
3. **Harness không có bước trim.** Trim kiểm bằng script riêng, chạy trên stack đã dựng (không tự động trong CI/smoke). Nên thêm bước trim vào `selfhost-smoke.mjs` nếu muốn lặp lại.
4. **Compose rc.2 == rc.3**, nên bước "compose đã được thay" chỉ chứng minh qua `.bak == v0.3.0-rc.2` và giữ uid/gid/mode. Đây là cùng caveat với rc.2 report.
5. Lần cập nhật đầu chưa có job nào chạy trên worker sau nâng cấp (seed chạy trước update). Đã bù bằng trim trên stack đã nâng (lần 2).

Status: DONE_WITH_CONCERNS

## Unresolved

- Có cần chạy lại trên Docker Desktop thật (máy khác) trước khi publish không? Brief yêu cầu, nhưng máy này không có.
- Có đưa bước trim vào `selfhost-smoke.mjs` không (hiện chỉ có ad hoc)?
- `docs/releases/v0.3.0-rc.3.md` chưa kiểm (không nằm trong procedure smoke).
