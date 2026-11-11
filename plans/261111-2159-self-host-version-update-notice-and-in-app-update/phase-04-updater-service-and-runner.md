---
phase: 4
title: "Updater (giữ Docker socket) + runner tách rời chạy compose pull/up"
status: completed
priority: P1
effort: "10h"
dependencies: [1]
---

# Phase 4: Updater + runner

## Overview

Đây là phần rủi ro nhất của plan. Có hai tiến trình, cùng chạy trên image `ghcr.io/jhin1m/mtl` (D2):

- **`updater`**: service compose chạy lâu, có Docker socket, chỉ ở mạng `internal`, không publish cổng. HTTP có 2 route
  `GET /v1/status` và `POST /v1/update`, xác thực bằng Bearer token. Updater **không tự chạy compose**. Nó kiểm trước
  (preflight), rồi tạo một container **runner** rời.
- **runner** (`update-run`): container `<project>-update`, không có label compose nên không thuộc project. Runner mount
  socket và mount thư mục project ở **đúng đường dẫn phía daemon**. Runner tải compose của tag, chạy `pull`, kiểm label,
  ghi file, rồi `up -d --wait`.

Phải tách runner vì `up -d` sẽ tạo lại chính container `updater` (image đổi). Nếu compose chạy trong updater, nó tự giết
mình khi đang chờ app healthy, để lại `jobs`/`worker` đã dừng mà không ai chạy lại (D1, D13).

## Context (đã đọc và trace)

- `docker-compose.yml:16` `name: mtl-local`. `:22-31` anchor `x-app-env` (app + jobs dùng chung). `:51-76` app
  (bind `./data/{files,secrets,backups,worker}`, cổng `127.0.0.1:${MTL_PORT:-8080}:8080`, healthcheck `/readyz`,
  `start_period: 180s`). `:78-92` jobs, `:94-120` worker (`depends_on app: service_healthy, restart: true`,
  `replicas: ${MTL_WORKERS:-2}`, `stop_grace_period: 100s`). `:122-125` mạng `internal` (internal: true) và `web`.
- Biến compose hiện có (`grep -o '\${MTL_[A-Z_]*' docker-compose.yml`): `MTL_PORT`, `MTL_ALLOWED_HOSTS`,
  `MTL_SKIP_BOOT_BACKUP`, `MTL_TAG`, `MTL_WORKERS`, `MTL_THREADS`.
- `infra/docker/app-entrypoint.sh:9-21`: chạy root → `mkdir` + `chown`/`chmod` thư mục `/data/*` → `setpriv` về uid 1000.
  `:23-27`: `app`, `jobs`, hoặc lệnh tuỳ ý. Updater mount `data/secrets` **chỉ đọc**. Nếu đi qua khối root thì `chown`
  trên mount ro sẽ lỗi và `set -e` thoát. Vì vậy hai lệnh mới phải rẽ nhánh **trước** khối này.
- `infra/docker/app.Dockerfile:61-64`: `WORKDIR /app/apps/api`, có `node_modules/.bin/tsx`. Phase 2 thêm `docker-compose`.
- `apps/api/src/local/local-secrets.ts:32-47`: app tạo `data/secrets/updater-token` (phase 3). Updater đọc file này lúc
  có request.
- Research (`reports/researcher-docker-desktop-paths-report.md`):
  - Q4: Compose dùng `HostConfig.Binds` cho short syntax. Hash cấu hình gồm cả bind source đã resolve, nên chuỗi đường
    dẫn khác thì compose tạo lại container.
  - Q4: label `working_dir` và `config_files` ghi đường dẫn theo phía client (Windows có thể là `C:\…`) và nối nhiều file
    bằng dấu phẩy.
  - Q5: `replicas: 0` (đã kiểm trên v5.1.2) không tạo container và không tạo bind source.
  - Q6: socket thiếu thì short syntax tạo thư mục rỗng, `up` vẫn chạy.
  - Q8: `config --format json` cho ra `source` tuyệt đối.
  - Q9: nên ghim `/v1.44`.
  - Q1: trên Windows, dạng `Mounts[].Source` **chưa chắc**. Có thể là `/run/desktop/mnt/host/c/…` hoặc `C:\…`.
  - Q2: OrbStack đã kiểm, toàn bộ cách làm (cùng đường dẫn, `--project-directory`, binary compose) chạy được.

## Files

| Thao tác | File |
|---|---|
| Sửa | `docker-compose.yml` (service `updater`, biến mới trong `x-app-env`, comment đầu file) |
| Sửa | `infra/docker/app-entrypoint.sh` (lệnh `updater`, `update-run` chạy root, trước khối chown) |
| Tạo | `apps/api/src/updater/docker-api.ts` (client Engine API qua unix socket, `node:http`) |
| Tạo | `apps/api/src/updater/discovery.ts` (thuần: tìm project, thư mục daemon, ghim, khôi phục biến) |
| Tạo | `apps/api/src/updater/compose-vars.ts` (bảng biến compose: khôi phục / cố định / bỏ) |
| Tạo | `apps/api/src/updater/runner-plan.ts` (thuần: dựng tham số compose, so bind, allowlist image, đọc marker log) |
| Tạo | `apps/api/src/updater/server.ts` (lệnh `updater`) |
| Tạo | `apps/api/src/updater/runner.ts` (lệnh `update-run`) |
| Tạo | `apps/api/test/unit/updater-discovery.test.ts` |
| Tạo | `apps/api/test/unit/updater-runner-plan.test.ts` |
| Tạo | `apps/api/test/unit/updater-server.test.ts` (socket Docker giả) |
| Tạo | `apps/api/test/unit/updater-compose-vars.test.ts` |
| Tạo | `apps/api/test/unit/updater-import-boundary.test.ts` |
| Tạo | `apps/api/test/unit/fixtures/docker-inspect-{linux,orbstack,docker-desktop-mac,windows-wsl2}.json` |

Ranh giới import: `apps/api/src/updater/**` chỉ import `node:*`, file trong cùng thư mục và `@mtl/shared/update`. Không
import `env.ts` (nó đòi `DATABASE_URL` và ghi secret) hay `db.ts`. Có test riêng kiểm việc này.

## 1. `docker-compose.yml`

```yaml
x-app-env: &app-env
  # … giữ nguyên, thêm:
  MTL_TAG: ${MTL_TAG:-latest}                  # app biết bản đang ghim (ẩn nút, D7)
  MTL_UPDATE_CHECK: ${MTL_UPDATE_CHECK:-}      # 0 = không hỏi GitHub
  MTL_UPDATE_TARGET: ${MTL_UPDATE_TARGET:-}    # chỉ người phát hành thử rc (D10)

  updater:
    image: ghcr.io/jhin1m/mtl:${MTL_TAG:-latest}
    command: updater
    restart: unless-stopped
    init: true
    environment:
      MTL_DOCKER_SOCK: ${MTL_DOCKER_SOCK:-}    # để runner dùng lại đúng chuỗi socket
    volumes:
      - ${MTL_DOCKER_SOCK:-/var/run/docker.sock}:/var/run/docker.sock
      - ./data/secrets:/data/secrets:ro        # chỉ cần updater-token. Updater có socket nên đã ngang root, ro không làm tăng quyền
    deploy:
      replicas: ${MTL_UPDATER:-1}              # MTL_UPDATER=0 → không container, không mount socket (D11)
    networks: [internal]                       # không Internet, không cổng. Runner mới cần mạng
    logging: *logging
```

- Không ai `depends_on: updater` (research Q5: phụ thuộc vào service 0 replica có thể lỗi).
- Comment đầu file thêm `MTL_UPDATE_CHECK`, `MTL_UPDATER`, `MTL_DOCKER_SOCK` vào danh sách biến tuỳ chọn, kèm một dòng
  cảnh báo: "updater giữ Docker socket (ngang quyền root). Tắt bằng MTL_UPDATER=0".
- Tương thích ngược: mọi biến mới đều có mặc định. Image cũ (0.2.0) chạy với compose mới thì service updater chạy
  lệnh `updater`, mà entrypoint cũ coi là "lệnh tuỳ ý". Lệnh này không tồn tại nên container restart lặp. Không hại gì,
  nhưng log bẩn. Chấp nhận, vì quy tắc phát hành chỉ merge compose mới cùng tag có image tương ứng. Ghi vào Risks.

## 2. `app-entrypoint.sh`

Thêm ngay sau `set -eu` (l.7):
```sh
case "${1:-}" in
  updater)    exec node_modules/.bin/tsx src/updater/server.ts ;;
  update-run) exec node_modules/.bin/tsx src/updater/runner.ts ;;
esac
```
Cả hai giữ root, vì socket thuộc root (Linux: `root:docker 660`).

## 3. `docker-api.ts`

- `node:http` với `socketPath` = `/var/run/docker.sock`. Path ghim prefix `/v1.44` (research Q9), timeout 10s/request.
- Hàm: `inspectContainer(idOrName)`, `listContainers({ all, labels: [...], name })`, `inspectImage(ref)`,
  `createContainer(name, body)`, `startContainer(id)`, `removeContainer(id, { force })`, `logs(id, { tail })`
  (runner tạo với `Tty: true` nên log là text thô, không phải demux).
- Map lỗi:
  - `ENOENT`, `EACCES`, `ECONNREFUSED`, `ENOTSOCK`, hoặc socket là thư mục (research Q6) → `no_socket`.
  - HTTP 400 có chữ "client version" → `docker_too_old`. Thêm reason này vào enum ở phase 1, text phase 5: "Docker quá
    cũ, cập nhật Docker Desktop hoặc cập nhật tay".
  - Còn lại → `internal`, kèm message.

## 4. `discovery.ts` (thuần, input là JSON inspect)

`discover({ self, containers }) → { ok: true, info } | { ok: false, reason, detail }`:

1. `self` = inspect `HOSTNAME` (Docker mặc định hostname = 12 ký tự đầu của id, compose không đặt `hostname:`).
   `project = self.Config.Labels["com.docker.compose.project"]`, khớp `^[a-z0-9][a-z0-9_-]*$`. Không có →
   `project_not_found`.
2. `containers` = list `all=true` lọc label `com.docker.compose.project=<project>`. Bắt buộc có đúng 1 `app` và 1
   `postgres`.
3. **Một file compose**: label `config_files` của app tách bằng `,` phải có **đúng 1** phần tử, tên file
   `docker-compose.yml`, nằm trong `working_dir`. So bằng chuỗi, chấp nhận cả `\` lẫn `/`. Sai → `custom_compose`
   (gồm cả trường hợp có `docker-compose.override.yml`).
4. **Thư mục project phía daemon** (D12). Lấy mount `Destination == "/data/files"` của app. `Source` phải kết thúc bằng
   `/data/files` → `daemonDir` = phần còn lại. Kiểm chéo: mount `/var/lib/postgresql/data` của postgres phải có
   `Source === daemonDir + "/data/postgres"`.
   - Chỉ nhận `daemonDir` là đường dẫn POSIX tuyệt đối, không có `..`, không có ký tự điều khiển, không bắt đầu bằng
     `/run/desktop/mnt/host/wsl/` (đường tạm của Docker Desktop, research Q1).
   - Dạng `C:\…` (research Q1 nói có thể gặp) → `path_mismatch` ở bản đầu. **Không tự đổi dạng.** Chỉ thêm đổi dạng
     sau khi checklist Windows (phase 8) chứng minh dạng nào mount lại được.
   - Kiểm chéo với label: `working_dir` sau khi chuẩn hoá phải là **hậu tố** của `daemonDir`. Chuẩn hoá `C:\a\b` thành
     `/c/a/b` (chữ ổ thường) và so không phân biệt hoa thường. Ví dụ:
     - `/run/desktop/mnt/host/c/Users/me/mtl` kết thúc bằng `/c/Users/me/mtl`.
     - `/host_mnt/Users/me/mtl` kết thúc bằng `/Users/me/mtl`.
     - Linux: hai chuỗi bằng nhau.
     Lệch → `path_mismatch`.
5. **Phiên bản đang chạy**: `MTL_VERSION` trong `Config.Env` của app. Không phải semver → `dev_build`.
6. **Ghim**: `Config.Image` của app phải có repo `ghcr.io/jhin1m/mtl`. Repo khác → `image_not_allowed`.
   `pinnedTag = tag !== "latest" ? tag : null`.
7. **Khôi phục biến** theo bảng ở `compose-vars.ts` (D8):

| Biến | Nguồn | Ghi chú |
|---|---|---|
| `MTL_PORT` | app `HostConfig.PortBindings["8080/tcp"][0].HostPort` | |
| `MTL_ALLOWED_HOSTS`, `MTL_UPDATE_CHECK`, `MTL_UPDATE_TARGET` | app `Config.Env` | |
| `MTL_WORKERS` | số container `worker` của project (0 nếu không có) | đếm, không đọc env, để giữ cả trường hợp 0 worker |
| `MTL_THREADS` | env của một container worker bất kỳ | |
| `MTL_DOCKER_SOCK` | env của updater (self) | |
| `MTL_UPDATER` | cố định `1` (updater đang chạy chính là nó) | |
| `MTL_SKIP_BOOT_BACKUP` | **cố định rỗng** | cập nhật trong app luôn backup trước migrate |
| `MTL_TAG` | theo D6: `latest`, hoặc `T` nếu T là prerelease | |

   Truyền các biến này làm env của tiến trình compose trong runner. Env shell thắng `.env` (quy tắc của compose), nên
   giá trị đang chạy được giữ dù người dùng từng gõ trong shell. Biến không có trong bảng thì compose vẫn đọc `.env`
   như thường.
8. `socketSource = MTL_DOCKER_SOCK || "/var/run/docker.sock"`. Dùng **chuỗi người dùng cấu hình**, không dùng
   `Mounts[].Source`, vì Docker Desktop xử lý riêng đúng chuỗi `/var/run/docker.sock` (research Q3).

## 5. `server.ts` (lệnh `updater`)

- `http.createServer`, nghe `0.0.0.0:${UPDATER_PORT}`. Mạng `internal` chỉ có app, jobs, postgres.
- Mọi request:
  - Đọc `/data/secrets/updater-token`. Thiếu → 503 `not_ready`.
  - So `Authorization: Bearer …` bằng `timingSafeEqual` (khác độ dài thì coi là sai). Sai → 401.
  - Body tối đa 1 KB, chỉ nhận `application/json`. Route lạ → 404.
- `GET /v1/status` → `UpdaterStatus`:
  - `ready` = `discover()` ok và không có runner đang chạy.
  - `run` = đọc container `<project>-update` (nếu có): state, label `target`/`from`, `StartedAt`/`FinishedAt`, `ExitCode`.
    Bước và reason lấy từ marker trong `logs --tail 200`. `log_tail` là 40 dòng cuối, đã cắt.
  - Updater bị tạo lại giữa chừng thì bản mới vẫn đọc được runner theo tên, nên trạng thái không mất.
- `POST /v1/update {version}`:
  1. `parseVersion`. Sai → 400 `bad_version`. Cooldown 60s trong bộ nhớ → 429 `cooldown`.
  2. `discover()`. Lỗi → 422/503 kèm reason.
  3. `isNewer(T, current)`. Sai → 422 `not_newer`. `pinnedTag` có giá trị và T không phải prerelease → 422 `pinned`.
  4. Runner tên `<project>-update` đang chạy → 409 `busy`. Đã thoát → xoá rồi tạo mới. Chỉ giữ bản gần nhất để xem log.
  5. `createContainer(<project>-update, …)`:
     ```
     Image: self.Image (sha của chính image đang chạy updater, không pull)
     Cmd: ["update-run"]
     Tty: true
     Env: MTL_UPDATE_TO=T, MTL_UPDATE_FROM=current, MTL_UPDATE_PROJECT=project, MTL_UPDATE_DIR=daemonDir,
          MTL_UPDATE_TAG=<latest|T>, MTL_UPDATE_SOCK=socketSource, và các biến đã khôi phục (đặt tên gốc MTL_PORT=…)
     Labels: io.github.jhin1m.mtl.update-runner=project, …update-target=T, …update-from=current
     HostConfig:
       Mounts: [{Type: bind, Source: socketSource, Target: /var/run/docker.sock},
                {Type: bind, Source: daemonDir, Target: daemonDir}]   # Mounts, không dùng Binds: không phải tách chuỗi theo ":" và ","
       NetworkMode: bridge          # cần Internet để tải compose
       RestartPolicy: {Name: "no"}, Init: true, LogConfig json-file 10m
     ```
     `startContainer`. Lỗi create hay start (vd daemon từ chối mount) → 422 `path_mismatch`, kèm message daemon trong
     `detail`. Lúc này **chưa có gì thay đổi**.
  6. 202 `{ run }` (state `running`, step `preflight`).
- SIGTERM: đóng server rồi thoát. Runner không bị ảnh hưởng.

## 6. `runner.ts` (lệnh `update-run`)

Mỗi bước in một dòng `MTL_UPDATE step=<step>`. Kết thúc in `MTL_UPDATE result=ok` (exit 0) hoặc
`MTL_UPDATE result=fail reason=<reason>` (exit 1). Compose chạy bằng `spawn("docker-compose", args, { env })`, với
`args` luôn bắt đầu bằng `--ansi never --progress plain -p <project> --project-directory <dir>`.

1. **preflight**:
   - Kiểm lại env: semver, `project` đúng regex, `dir` là POSIX tuyệt đối, `tag ∈ {latest, T}`.
   - `<dir>/docker-compose.yml` và `<dir>/data/postgres/PG_VERSION` phải tồn tại. Đây là bằng chứng mount đúng thư mục
     thật. Không có → `path_mismatch`.
   - Chạy lại `discover()` (dùng socket) để lấy mount hiện tại của mọi container trong project.
   - Ghi lại stat (`uid`, `gid`, `mode`) của file compose.
2. **download**:
   - `fetch(composeUrl("v" + T))`, timeout 30s, thử 3 lần, tối đa 64 KB.
   - Ghi vào `<dir>/.docker-compose.update.yml`. File ẩn, compose không tự đọc, xoá trong `finally`.
   - Kiểm bằng `docker-compose -f <tmp> config --format json` với env đã khôi phục (+ `MTL_TAG=tag`). Lỗi →
     `invalid_compose`.
   - `runner-plan.ts` kiểm tiếp:
     - (a) Mọi `services[].image` có repo thuộc `ALLOWED_IMAGE_REPOS`, không có `build:`. Sai → `image_not_allowed`.
     - (b) Với mọi service đang có container, xét các bind mà compose mới resolve ra source nằm **dưới `<dir>`**
       (`./data/*`). Mỗi bind phải **bằng chuỗi** với `Source` đang chạy của cùng `Destination`. Thiếu hoặc lệch →
       `path_mismatch`. Bước này chặn trường hợp "app khởi động với DB trống" **trước khi đổi bất cứ gì**.
       Socket không thuộc tập so: Docker Desktop có thể báo `Source` của socket là một đường nội bộ khác chuỗi đã cấu
       hình (research Q3).
     - (c) Ghim từ `.env`: chạy `config --format json` lần nữa, **không** truyền `MTL_TAG`. Image app phải là
       `ghcr.io/jhin1m/mtl:latest` khi T là bản chính thức. Sai → `pinned`.
3. **pull**: `docker-compose -f <tmp> pull --quiet` (env có `MTL_TAG=tag`), thử thêm 1 lần, tối đa 60 phút. Lỗi →
   `pull_failed`. App vẫn chạy bản cũ trong suốt bước này.
4. **verify**: `inspectImage("ghcr.io/jhin1m/mtl:" + tag)` và `…/mtl-worker:` + tag. Label
   `org.opencontainers.image.version` của cả hai phải **bằng T**. Sai → `version_mismatch`. Trường hợp này xảy ra khi
   `:latest` chưa trỏ tới T hoặc đã trỏ bản mới hơn: compose của tag T có thể không hợp image khác.
5. **apply**:
   - Chép file compose hiện tại thành `docker-compose.yml.bak`. Đổi tên `<tmp>` thành `docker-compose.yml` (rename
     nguyên tử trong cùng thư mục). Trả `uid`/`gid`/`mode` như cũ, để trên Linux file không thành của root và lần
     `curl -O` tay sau đó vẫn ghi đè được. Lỗi chown trên Docker Desktop thì bỏ qua, có log.
   - `docker-compose -f <dir>/docker-compose.yml up -d --wait --wait-timeout 1200`.
     - Compose giữ thứ tự `depends_on … restart: true`: dừng jobs/worker, tạo lại app (backup + migrate), chờ healthy,
       rồi chạy lại.
     - Container updater bị tạo lại, runner thì không.
     - Lỗi hoặc hết giờ → `up_failed` / `timeout`. **Không tự rollback** (D14): migrate có thể đã chạy, hạ cấp thì app
       từ chối khởi động (`apps/api/src/local/schema-guard.ts`). File compose mới giữ nguyên, `.bak` có bản cũ.
6. **check**:
   - Inspect lại. Các bind dưới `<dir>` của mọi container mới phải bằng tập ghi ở preflight. Lệch → báo `path_mismatch`
     với chữ "SAU khi cập nhật", kèm hướng dẫn.
   - App chạy image có label T. `MTL_VERSION` của app = T.
7. **done** → `result=ok`.

Không có lệnh nào nhận chuỗi tự do từ người dùng. Chuỗi duy nhất đến từ ngoài là T, đã qua semver regex (không có
`/`, `..`, khoảng trắng). URL, repo và image đều là hằng số.

## Tests (unit, `pnpm --filter @mtl/api test:unit`)

**Fixtures** `test/unit/fixtures/docker-inspect-*.json`: list + inspect rút gọn của app, jobs, worker×2, postgres,
updater.
- `orbstack.json`: chụp thật trên máy dev (research Q2 đã chạy OrbStack).
- `docker-desktop-mac.json`: chụp thật nếu máy dev có Docker Desktop.
- `linux.json`: viết tay theo dạng OrbStack.
- `windows-wsl2.json`: **viết tay** theo research Q1 (`/run/desktop/mnt/host/c/Users/me/mtl/data/files`, label
  `C:\Users\me\mtl`). Phase 8 thay bằng bản chụp thật.

| Test | Ca |
|---|---|
| `updater-discovery` | mỗi fixture → đúng `project`, `daemonDir`, `current`, `pinnedTag`, env khôi phục (cổng 9090, 1 worker, threads, allowed hosts) |
| | `config_files` có 2 file hoặc có override → `custom_compose` |
| | `/data/files` và `/data/postgres` lệch gốc → `path_mismatch`. `Source` dạng `C:\…` → `path_mismatch`. `/run/desktop/mnt/host/wsl/…` → `path_mismatch` |
| | label `working_dir` không phải hậu tố (khác hoa thường trên Windows thì được) |
| | 0 worker → `MTL_WORKERS=0`. Image `ghcr.io/other/mtl` → `image_not_allowed`. `MTL_VERSION=dev` → `dev_build` |
| `updater-runner-plan` | args compose luôn có `-p`, `--project-directory`, `--ansi never`. `MTL_SKIP_BOOT_BACKUP=""`. `MTL_TAG` = `latest` (T chính thức) / `T` (T prerelease) |
| | so bind: bằng → ok; một target khác source → `path_mismatch`; service mới (không có container) không bị so |
| | allowlist: `postgres:17`, `docker.io/library/postgres:17` ok; `ghcr.io/evil/mtl`, `build:` → `image_not_allowed` |
| | parse marker log: bước cuối, reason, bỏ dòng rác, cắt 40 dòng × 300 ký tự |
| `updater-server` | socket Docker giả (`http.createServer` nghe file socket tạm), token đúng/sai/thiếu/khác độ dài, body > 1 KB, route lạ |
| | POST: không mới hơn → 422; ghim + chính thức → 422; runner đang chạy → 409; cooldown → 429; thành công → create body đúng (Mounts, Env, Labels, Image = image của self, `Tty: true`), start được gọi |
| | socket không tồn tại hoặc là thư mục → status `no_socket`; 400 "client version" → `docker_too_old` |
| `updater-compose-vars` | đọc `docker-compose.yml` ở gốc repo, mọi `${MTL_…}` phải nằm trong bảng (khôi phục / cố định / bỏ). Thêm biến compose mà quên bảng → đỏ |
| `updater-import-boundary` | quét import của `src/updater/**`: chỉ `node:*`, `./*`, `@mtl/shared/update` |

Kiểm thật end-to-end nằm ở phase 6 (macOS) và phase 8 (Windows).

## Done

- Unit test xanh. `pnpm lint`, `pnpm typecheck` xanh.
- Build image local, chạy `docker compose up -d` với compose mới, rồi kiểm:
  - `docker compose ps` có `updater` running.
  - `docker compose exec app node -e "fetch('http://updater:8090/v1/status',…)"` có token → `ready: true` (khi image có
    `MTL_VERSION` semver), không token → 401.
  - `MTL_UPDATER=0 docker compose up -d` → không còn container updater, app vẫn healthy.
- Từ máy host không gọi được updater: không có cổng nào publish (`docker compose ps --format '{{.Ports}}' updater` rỗng).

> Ghi chú 11/11: unit test + lint/typecheck đã xanh. Chạy cập nhật thật end-to-end (runner, up, check mount) chỉ kiểm được với image rc → phase 8.

## Risks

| Rủi ro | K×T | Giảm thiểu |
|---|---|---|
| Đường dẫn sai làm app chạy với DB trống | TB×Cao | Ba lớp trước khi đổi gì: kiểm chéo mount (discovery), file thật nhìn thấy được (preflight), so bind chuỗi-bằng-chuỗi (download b). Dạng lạ → từ chối và hướng dẫn tay. Phase 6 và 8 kiểm thật |
| Windows trả `Source` dạng `C:\…` hoặc daemon không nhận lại `/run/desktop/…` từ trong container | TB×TB | Bản đầu → `path_mismatch` → lệnh tay (an toàn). Sửa bằng fixture thật ở rc kế tiếp |
| Lần đầu cập nhật trong app tạo lại container vì chuỗi đường dẫn khác, và lần `up` tay sau đó tạo lại lần nữa (research Q4) | Cao×Thấp | Dữ liệu là bind nên không mất. Docs ghi rõ. Mỗi lần tạo lại có backup DB, khoảng 1–2 phút |
| Docker rootless: không có `/var/run/docker.sock`, `up` có thể lỗi mount | Thấp×TB | Docs: `MTL_DOCKER_SOCK=$XDG_RUNTIME_DIR/docker.sock` hoặc `MTL_UPDATER=0`. Ghi trong ghi chú 0.3.0 |
| Bật ECI (Docker Desktop Business) chặn mount socket | Thấp×TB | Docs: tắt updater. Người dùng cá nhân không có ECI |
| Image cũ chạy với compose mới thì updater restart lặp | Thấp×Thấp | Quy tắc phát hành (compose mới đi cùng tag). Updater không có ai phụ thuộc |
| Runner bị kill giữa `up` (Docker Desktop restart) | Thấp×TB | Giống cập nhật tay bị ngắt: `docker compose up -d` chạy lại. Docs Sự cố |
| `:latest` chưa kịp dời khi người dùng bấm | Thấp×Thấp | Release chỉ tạo sau promote (phase 2). Kiểm label → `version_mismatch` → "thử lại sau vài phút" |
| App bị chiếm quyền gọi updater | Thấp×TB | Updater chỉ cho cập nhật lên bản chính thức mới hơn, từ artifact chính thức. Không nhận image, lệnh hay đường dẫn |

## Rollback

- Code: revert phase. Compose bỏ service `updater` (người dùng đã có updater giữ container cũ cho tới lần `up` kế tiếp,
  khi đó `--remove-orphans` không chạy nên container mồ côi còn đó; docs hướng dẫn `docker rm -f`).
- Người dùng: `MTL_UPDATER=0` tắt hẳn. Một lần cập nhật hỏng sau migrate → khôi phục backup theo `docs/self-host.md`
  mục Backup DB.
