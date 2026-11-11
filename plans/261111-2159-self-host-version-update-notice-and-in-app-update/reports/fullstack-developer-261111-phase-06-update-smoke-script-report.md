# Phase 6 report: update smoke script

File: `infra/selfhost-update-smoke.sh` (executable, ~400 dòng). Không đụng file nào khác ngoài phase file (status) và report này.

## Cách dùng
`FROM=0.3.0-rc.1 TO=0.3.0-rc.2 infra/selfhost-update-smoke.sh` (+ `SMOKE_PORT` mặc định 18083, `SMOKE_MODELS_CACHE`, `SMOKE_PAGE`, `SMOKE_KEEP=1`, `--help`).
Project `mtl-upd-smoke`, runner `mtl-upd-smoke-update`, thư mục tạm riêng. Dừng nếu stack/runner cũ còn tồn tại.

## Local mode: không cần đăng nhập
Local mode không có session (`localSession()`), nên không có bước lấy admin session. POST dùng `Origin: http://127.0.0.1:$PORT`
(khớp `Host` nên `localGuard` cho qua) + `content-type: application/json`.

## Script kiểm gì
- Trước khi tạo gì: FROM/TO semver, TO > FROM (so semver tự viết, thử với rc.10 > rc.9, 0.10 > 0.9), tag git `vFROM`/`vTO`,
  manifest GHCR của cả 2 image cho cả 2 bản, FROM official thì `:latest` phải = FROM, FROM prerelease + TO official -> die (D7).
  compose của `vFROM` phải có service updater.
- Cài FROM: `.env` `MTL_THREADS=2`, shell `MTL_PORT/MTL_WORKERS=1/MTL_UPDATE_TARGET=TO` (+ `MTL_TAG=FROM` nếu rc), compose chmod 640.
  `/api/config.version==FROM`, status: `update_available`, `latest==TO`, `updater.ready`.
- Seed qua `selfhost-smoke.mjs run`; mốc: migration, backup, bind Source->Destination mọi container, uid/gid/mode + sha compose, id container app/jobs/worker.
- Âm tính: Origin lạ 403, Host lạ 403, không JSON 415, version 99.0.0 409 `stale`, updater token sai 401 (từ container app), updater không publish cổng.
- `docker events` nền; POST 202 (`run.target`), POST lần 2 -> 409/429.
- Theo dõi tối đa 20 phút: log marker runner + status khi app sống, `/api/config` khi app mất; die sớm nếu runner exit != 0.
- Sau: runner exit 0, marker đúng `UPDATE_STEPS`, `MTL_UPDATE result=ok`; app healthy, jobs/worker/updater/postgres running, RestartCount 0;
  thứ tự events (jobs/worker die/stop trước destroy app cũ và start app mới; không start trước healthy; start cuối sau healthy);
  `verify` dữ liệu; migration >=; backup +1 đúng; bind trước==sau; không bind docker.sock trong app; app bind `127.0.0.1:PORT`; 1 worker;
  env worker `MTL_THREADS=2`,`MTL_WORKERS=1`; env app `MTL_UPDATE_TARGET=TO`; compose == `vTO` byte, `.bak` == `vFROM`, uid/gid/mode giữ;
  `update_available=false`, `run.state=succeeded`; label version image app/jobs/worker/updater == TO.
- `up -d` tay: không hạ cấp (version/label == TO), `verify` lại, bind giữ. TO rc thì đặt `MTL_TAG=TO` (xem lệch dưới).
- `MTL_UPDATER=0 up -d --remove-orphans`: không còn container updater, `updater.reason=unavailable`.
- In bảng thời gian, digest image, `UPDATE SMOKE OK`. Trap dọn runner, stack, data (busybox), thư mục tạm; in log khi lỗi.

## Đã kiểm bây giờ
- `bash -n`, `shellcheck -x`: sạch, 0 cảnh báo.
- Chạy thật: không tham số, semver sai, TO<=FROM, rc->official, tag git thiếu, cổng sai, `--help` -> die rõ, thoát đúng mã.
- Chạy thật tới bước cài với tag cũ `0.1.0-rc.4->0.2.0-rc.1` (manifest GHCR thật qua): die "không có updater" đúng, trap dọn sạch (0 container, 0 thư mục tạm).
- `semver_cmp`, `jget`, template `docker inspect` (binds) thử riêng; `order.mjs` thử với events giả: 1 ca đạt, 3 ca hỏng bị bắt.
- Đã dọn mọi thứ tạo ra.

## Hoãn tới cổng phát hành (cần GHCR tag rc có updater)
Toàn bộ luồng từ `dc up` đến `UPDATE SMOKE OK`: định dạng JSON thật của `docker events` (`Actor.ID`, `health_status: healthy`), runner log
(Tty, đã strip `\r`), marker còn trong log, `stat` uid/gid/mode trên OrbStack/Docker Desktop, quyền chown của runner, thời gian. Cần chạy cả OrbStack lẫn Docker Desktop và viết `update-smoke-<from>-to-<to>-report.md`.

## Lệch so với phase file
- Không chạy chế độ `ocr` (chỉ `run`/`verify`), nên bước 0 "ảnh có >=1 khối chữ" không cần; mặc định dùng `render_lines.png`.
- Bước 9 đặt `MTL_TAG=TO` nếu TO là prerelease: rc không bao giờ là `latest`, `up` tay không ghim sẽ chạy lại image `latest`.
- Điều kiện thứ tự: "trước destroy app cũ" cộng thêm "trước start app mới".

Unresolved: không có.
