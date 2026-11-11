# Báo cáo phase 4: updater + runner

Status: DONE_WITH_CONCERNS. Unit xanh (169 test, 17 file), `tsc` và `pnpm lint` sạch.

## Compose (`docker-compose.yml`)
- `x-app-env` thêm `MTL_TAG` (mặc định latest), `MTL_UPDATE_CHECK`, `MTL_UPDATE_TARGET` (mặc định rỗng).
- Service `updater`: image `ghcr.io/jhin1m/mtl:${MTL_TAG:-latest}`, `command: updater`, `init`, `restart: unless-stopped`,
  mount `${MTL_DOCKER_SOCK:-/var/run/docker.sock}` và `./data/secrets:ro`, `deploy.replicas: ${MTL_UPDATER:-1}`, chỉ mạng `internal`, không `ports`, không ai `depends_on`.
- Comment đầu file: thêm `MTL_UPDATE_CHECK`, `MTL_UPDATER`, `MTL_DOCKER_SOCK` và cảnh báo socket ngang root.
- `app-entrypoint.sh`: `updater` và `update-run` rẽ nhánh trước khối root/chown.

## HTTP updater (cổng 8090, nghe 0.0.0.0)
- Mọi request: đọc `/data/secrets/updater-token` mỗi lần. Thiếu file: 503 `not_ready`. Bearer sai hoặc khác độ dài (`timingSafeEqual`): 401 `{error:"unauthorized"}`. Route lạ: 404.
- `GET /v1/status` trả 200 `UpdaterStatus`. Runner đang chạy thì `ready:false, reason:"busy"`. Lỗi socket vẫn trả 200 với `reason` (`no_socket`, `docker_too_old`, `project_not_found`, ...).
- `POST /v1/update {version}`: 415 sai content-type, 413 body > 1 KB, 400 JSON hỏng hoặc version không phải semver trần (cấm tiền tố `v`). Thành công: 202 `{run}`.
- Lỗi có dạng `{error, reason, detail?}`, `reason` thuộc `UPDATE_REASONS`. Mã trạng thái:

| reason | HTTP |
|---|---|
| `cooldown` | 429 |
| `busy` (runner chạy, hoặc create trùng tên) | 409 |
| `no_socket`, `docker_too_old` | 503 |
| `not_newer`, `pinned`, `dev_build`, `custom_compose`, `path_mismatch`, `image_not_allowed`, `project_not_found` | 422 |
| `internal` | 500 |

- Thứ tự POST: parse version, cooldown 60s (chỉ tính sau khi tạo runner thành công), runner đang chạy (409), discover, `isNewer`, ghim (chỉ chặn bản chính thức), tạo runner. Daemon từ chối create/start: 422 `path_mismatch` kèm message, container tạo dở bị xoá.
- Khớp client phase 3 (đọc `reason` rồi `error`). Ghi chú: client có ví dụ 409 `not_newer`; tôi giữ 422 theo plan, vì client chuyển nguyên status.

## Runner (`update-run`, container `<project>-update`)
- Tạo từ id image của updater, `Tty`, `Mounts` (socket và `daemonDir` cùng đường dẫn), bridge, `restart: no`, nhãn `io.github.jhin1m.mtl.update-{runner,target,from}`. Env: `MTL_UPDATE_{TO,FROM,PROJECT,DIR,TAG,SOCK}` và các biến đã khôi phục.
- Bước: preflight (thấy compose và `data/postgres/PG_VERSION`, discover lại, ghi stat) → download (3 lần, 30s, tối đa 64 KB, ghi `.docker-compose.update.yml`, `config --format json`, kiểm allowlist, bind chuỗi-bằng-chuỗi, `.env` không ghim) → pull (2 lần, 60 phút) → verify (label cả 2 image bằng T) → apply (`.bak`, chmod/chown về như cũ, rename, `up -d --wait --wait-timeout 1200`) → check (bind sau bằng trước, app chạy đúng T) → done.
- Log: dòng `MTL_UPDATE step=<step>`, kết thúc `MTL_UPDATE result=ok` hoặc `MTL_UPDATE result=fail reason=<reason>`. Exit 0 hoặc 1. Không tự rollback.
- Biến compose: bảng trong `compose-vars.ts` (restore: cổng, allowed hosts, update check/target, số worker đếm container, threads, docker sock; fixed: `MTL_UPDATER=1`, `MTL_SKIP_BOOT_BACKUP=""`; target: `MTL_TAG`). Bản chính thức dùng `MTL_TAG=latest`, prerelease dùng `MTL_TAG=T`.

## Đã kiểm trên máy (OrbStack, Engine 29.4.0, Compose v5.1.2)
- Unit: discovery theo 4 fixture, runner-plan, compose-vars (quét `${VAR}`), import-boundary, server với socket Docker giả.
- Fixture `orbstack` chụp thật từ stack thay thế (alpine, `sleep`) phản ánh compose, đường dẫn viết lại thành `/Users/me/mtl`. `linux`, `docker-desktop-mac`, `windows-wsl2` viết tay, đã ghi chú trong file; Windows cần phase 8 thay.
- Chạy `createUpdaterServer` với daemon thật: `ready:true`; POST tạo runner thật (daemon nhận Mounts bind), cooldown 429.
- Build image local từ Dockerfile hiện tại (tag tạm), `docker compose up -d --wait` với compose mới. Updater chạy, `Ports` chỉ `8080/tcp` (EXPOSE, không publish), `curl localhost:8090` từ host không tới được. Từ container app: không có file token 503, không header hoặc sai token 401, đúng token 200 `ready:true, project:mtl-local`.
- POST bản rc giả `0.3.0-rc.99` trên image local: runner thật qua preflight (thấy compose, `PG_VERSION`, discover khớp), dừng ở download với 404 (`download_failed`), status đọc đúng step và reason, file `.docker-compose.update.yml` được xoá, compose không đổi.
- `MTL_UPDATER=0 docker compose up -d --remove-orphans`: container updater bị gỡ, app vẫn healthy. `docker compose config` hợp lệ cả hai chế độ.
- Đã dọn: stack, container runner, image tag tạm.

## Chưa kiểm (để phase 6 và 8)
- Từ download trở đi với artifact thật: `config` trên compose tag thật, pull GHCR, kiểm label version, ghi compose rồi `up --wait`, thứ tự dừng/chạy lại, check sau cập nhật, chown/mode trên Linux. Test unit chỉ phủ các hàm thuần.
- Docker Desktop Mac và Windows (dạng `Source`), Linux thật, rootless, ECI. Mount socket bằng `Mounts` trên Docker Desktop chưa thử.

## Rủi ro mở
- Marker bước đọc từ 1000 dòng log cuối (plan ghi 200): `up` in nhiều dòng có thể đẩy marker ra khỏi 200 dòng.
- Phân loại `timeout` khi compose tự hết hạn dựa vào regex trên output; nếu không khớp sẽ ra `up_failed`.
- Updater nhận cả bản prerelease nếu app gửi (app là bên chặn qua `MTL_UPDATE_TARGET`), theo D10.
- `docker-compose` binary trong image là của phase 2; build local đã chạy được `docker-compose version`.
- Image 0.2.0 với compose mới: updater restart lặp (đã chấp nhận ở plan).

Unresolved: không có câu hỏi chặn.
