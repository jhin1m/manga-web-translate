# Smoke cập nhật trong app: 0.3.0-rc.1 → 0.3.0-rc.2 (macOS, OrbStack)

Ngày 12/11/2026. Lệnh: `FROM=0.3.0-rc.1 TO=0.3.0-rc.2 SMOKE_MODELS_CACHE=<repo>/worker/models infra/selfhost-update-smoke.sh`.
Kết quả: **UPDATE SMOKE OK**, tổng 79s.

## Artifact

- Tag `v0.3.0-rc.1` và `v0.3.0-rc.2` cùng commit `c7501d3`. `release.yml`: `test` và 2 image xanh. `promote` và
  `github-release` bị bỏ qua đúng thiết kế (prerelease). `gh release list` không có Release cho rc.
- Cả 4 image (`mtl`, `mtl-worker` × rc.1, rc.2) có manifest `linux/amd64` và `linux/arm64`, label
  `org.opencontainers.image.version` đúng tag.
- `ghcr.io/jhin1m/mtl:0.3.0-rc.1`: `MTL_VERSION=0.3.0-rc.1`, `docker-compose version` → v5.7.0.

## Đã kiểm (trích log)

- Kiểm âm trước khi cập nhật: 403 Origin/Host lạ, 415 không phải JSON, 409 stale, updater trả 401 khi sai token, updater
  không publish cổng.
- POST → 202, POST thứ hai → 429 cooldown.
- Các bước của runner: preflight → download → pull → verify → apply → check → done, `result=ok`, exit 0. App offline
  khoảng 10s.
- Thứ tự (docker events): jobs/worker dừng trước khi app cũ bị huỷ, chạy lại sau khi app mới healthy.
- Dữ liệu: `selfhost-smoke.mjs verify` đạt (chương, trang, ảnh gốc, export). Migration 27 → 27, backup 0 → 1.
- 12 bind giống nhau trước và sau. Cổng `127.0.0.1:18083`, 1 worker, `MTL_THREADS=2` (`.env`) và
  `MTL_UPDATE_TARGET` (shell) đều giữ nguyên.
- Compose bằng bản ở `v0.3.0-rc.2`, `.bak` bằng bản ở `v0.3.0-rc.1`, uid/gid/mode giữ nguyên (`501 20 640`).
- Sau cập nhật: `update_available=false`, `run.state=succeeded`.
- `docker compose up -d` tay sau đó vẫn chạy rc.2, dữ liệu và bind không đổi.
- `MTL_UPDATER=0`: không còn container updater, `updater.reason=unavailable`.

## Sửa trong lúc chạy

Lần chạy đầu dừng ở bước kiểm "docker-compose.yml was not replaced". Script đòi hash file đổi, nhưng hai tag cùng
commit nên compose giống hệt nhau. Sửa: chỉ đòi hash đổi khi compose của hai tag khác nhau. Việc ghi file đã được
chứng minh qua `.bak == vFROM`. Lần chạy thứ hai đạt.

## Chưa kiểm

- Docker Desktop for Mac (máy này dùng OrbStack). Windows: checklist phase 8. Linux thật.
- Đích chính thức (`MTL_TAG=latest`): chỉ có unit test. Smoke lại sau khi phát hành bản kế tiếp.
- Bootstrap tay 0.2.0 → rc (bước 4 phase 8). `infra/selfhost-smoke.sh` với image rc.
