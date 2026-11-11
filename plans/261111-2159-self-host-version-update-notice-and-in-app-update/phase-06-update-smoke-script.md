---
phase: 6
title: "Smoke tích hợp: cập nhật trong app từ bản A lên bản rc B (macOS Docker Desktop)"
status: completed
priority: P1
effort: "3h"
dependencies: [2, 3, 4]
---

# Phase 6: Smoke cập nhật trong app

## Overview

Script mới `infra/selfhost-update-smoke.sh`, cùng kiểu `infra/selfhost-smoke.sh`. Chạy tay trên máy dev, không đưa vào CI.

Script làm các bước sau:
1. Cài bản A (image GHCR thật, compose của tag `vA`) trong thư mục tạm.
2. Đặt tuỳ chỉnh bằng biến shell **và** bằng `.env`, rồi seed dữ liệu.
3. Bấm "Cập nhật ngay" qua HTTP, giống web làm.
4. Chờ app lên bản B, rồi kiểm dữ liệu, thứ tự dừng/khởi động, đường dẫn bind, tuỳ chỉnh và file compose.

Updater kéo image từ GHCR, nên A và B phải là tag đã push. Image build local (`:smoke`) không dùng được (D6).

## Context (đã đọc)

- `infra/selfhost-smoke.sh:15-22`: `set -euo pipefail`, `. infra/lib.sh`, `unset COMPOSE_FILE … MTL_*` để biến của dev
  không lọt vào compose. `:52-53`: thư mục tạm qua `pwd -P` (macOS `/var` → `/private/var`). `:56-73`: `cleanup` dùng
  `trap EXIT`, `SMOKE_KEEP`, xoá `data` bằng busybox (uid 999/1000).
- `infra/selfhost-smoke.mjs:3-7`: chế độ `run` (upload, `page.prepare`, export, ghi state) và `verify` (dữ liệu còn sau
  down/up). Dùng lại nguyên file này, **không sửa**. `run` cần `SMOKE_PAGE_FILE`.
- Upgrade smoke 0.1.0 → 0.2.0-rc.1 làm tay (`plans/261111-1925-…/reports/release-v0-2-0-rc1-smoke-upgrade-report.md` §2):
  dùng `git show vX:docker-compose.yml`, project riêng, cổng riêng, đếm migration qua psql. Script này tự động hoá cùng
  ý đó cho đường trong app.
- `infra/lib.sh:9-11`: `log`, `die`, `need`.

## Files

| Thao tác | File |
|---|---|
| Tạo | `infra/selfhost-update-smoke.sh` |

Không sửa `infra/selfhost-smoke.sh` và `infra/selfhost-smoke.mjs`.

## Tham số

```
FROM=0.3.0-rc.1 TO=0.3.0-rc.2 infra/selfhost-update-smoke.sh
  FROM, TO              bắt buộc, semver, TO > FROM, cả hai đã có image GHCR + tag git
  SMOKE_PORT=18083      cổng app
  SMOKE_MODELS_CACHE    như smoke cũ (bỏ qua tải model)
  SMOKE_PAGE            ảnh trang. Mặc định worker/tests/reference/render_lines.png (kiểm ở bước 0 xem có ≥ 1 khối chữ, không có thì bắt buộc truyền)
  SMOKE_KEEP=1          giữ stack + thư mục
```

Project `mtl-upd-smoke`. Nếu project đã tồn tại thì dừng, như smoke cũ ở `selfhost-smoke.sh:42-44`.

## Các bước

0. Kiểm `docker compose version` và `git rev-parse vFROM vTO`. `FROM` là prerelease thì set `MTL_TAG=$FROM`
   (D7 cho phép vì `TO` là prerelease). `FROM` chính thức thì giữ `latest` và **chỉ chạy được nếu `:latest` = FROM**.
   Không bằng thì die kèm hướng dẫn.
1. Thư mục tạm (`pwd -P`). Lấy compose bằng `git show "vFROM:docker-compose.yml"`. Ghi `.env` có `MTL_THREADS=2` (biến
   lấy từ `.env`). Export trong shell: `MTL_PORT`, `MTL_WORKERS=1`, `MTL_UPDATE_TARGET=$TO` (biến chỉ có trong shell,
   updater phải khôi phục được từ container).
2. `dc up -d --wait --wait-timeout 900`. `/api/config.version == FROM`. `GET /api/admin/update`: `update_available`,
   `latest.version == TO`, `updater.ready == true`.
3. Seed: `node infra/selfhost-smoke.mjs run "$BASE" state.json`. Ghi lại các mốc:
   - số migration (`select count(*) from drizzle.__drizzle_migrations`);
   - số file backup;
   - `docker inspect` (`Mounts[].Source/Destination`) của mọi container trong project;
   - stat (uid, gid, mode) của `docker-compose.yml`;
   - sha256 của `docker-compose.yml`.
4. Kiểm âm (nhanh, trước khi cập nhật):
   - `POST /api/admin/update` với `Origin: http://evil.test` → 403.
   - Không có `content-type` JSON → 415.
   - `version` khác `TO` → 409.
   - Gọi thẳng updater bằng token sai, từ trong container app
     (`dc exec -T app node -e "fetch('http://updater:8090/v1/status',{headers:{authorization:'Bearer x'}})…"`) → 401.
5. Bắt `docker events --since <t0> --filter label=com.docker.compose.project=mtl-upd-smoke --format '{{json .}}'` chạy
   nền vào file.
6. `POST /api/admin/update {"version": TO}` (có `Origin` đúng) → 202. POST lần hai ngay sau đó → 409 `busy` hoặc 429.
7. Theo dõi như web, giới hạn 20 phút: gọi status khi app còn trả lời, mất kết nối thì gọi `/api/config`, tới khi
   `version == TO`. In từng bước runner mỗi khi đổi.
8. Kiểm sau cập nhật:
   - Container `mtl-upd-smoke-update` đã thoát với mã 0. Log có đủ các dòng `MTL_UPDATE step=` theo đúng thứ tự
     `UPDATE_STEPS` và dòng `MTL_UPDATE result=ok`.
   - `dc ps`: app healthy. jobs, worker, updater, postgres running. RestartCount = 0.
   - **Thứ tự** (từ file events): `stop`/`die` của mọi container `jobs` và `worker` có trước `destroy` của container app cũ.
     `start` của jobs và worker mới có sau `health_status: healthy` của app mới.
   - **Dữ liệu**: `node infra/selfhost-smoke.mjs verify "$BASE" state.json` đạt. Số migration ≥ trước đó. Số backup +1.
   - **Đường dẫn**: với mỗi service, tập `Source→Destination` của bind giống hệt trước khi cập nhật.
   - **Tuỳ chỉnh**: app bind `127.0.0.1:$SMOKE_PORT`. Có đúng 1 container worker. Env worker `MTL_THREADS=2`. Env app
     `MTL_UPDATE_TARGET=$TO`.
   - **File**: `docker-compose.yml` giống byte với `git show vTO:docker-compose.yml`. `docker-compose.yml.bak` giống
     byte với bản `vFROM`. uid, gid, mode giữ như trước.
   - `GET /api/admin/update`: `update_available == false`. `run.state == "succeeded"`.
9. Người dùng tự chạy compose sau khi cập nhật: `dc up -d --wait` từ thư mục tạm, cùng biến shell. Lệnh phải thành công
   (được phép tạo lại container), sau đó `verify` lần nữa vẫn đạt.
10. Tắt updater: `MTL_UPDATER=0 dc up -d --wait`. Không còn container updater. `GET /api/admin/update` →
    `updater.reason == "unavailable"`.
11. In bảng thời gian từng bước (như `selfhost-smoke.sh:33-39`, `:192-195`), rồi in `UPDATE SMOKE OK`. `cleanup` xoá thêm container
    `mtl-upd-smoke-update`.

## Done

- `FROM=<rcA> TO=<rcB> infra/selfhost-update-smoke.sh` in `UPDATE SMOKE OK` trên macOS Docker Desktop. Có thêm OrbStack
  thì chạy cả hai.
- Báo cáo `plans/…/reports/update-smoke-<from>-to-<to>-report.md` có bảng kiểm, thời gian, digest image, log lỗi đã che
  thông tin riêng (theo mẫu báo cáo rc của 0.2.0).
- `bash -n` và `shellcheck` (nếu có) sạch.

> Ghi chú 11/11: script đã viết và qua review. Chạy thật `UPDATE SMOKE OK` + báo cáo cần 2 image rc trên GHCR → phase 8.

## Risks

| Rủi ro | K×T | Giảm thiểu |
|---|---|---|
| Smoke chỉ đi đường prerelease (`MTL_TAG=TO`), không đi đường `latest` | Chắc chắn×TB | Hai đường chỉ khác giá trị tag. Unit test phase 4 khoá giá trị. Chạy lại smoke với `TO` chính thức ngay sau khi phát hành (phase 8 bước 7) |
| Lần cập nhật in-app đầu tiên phải có 2 rc (bản 0.2.0 không có updater) | Chắc chắn×Thấp | Phase 8 push `rc.1` và `rc.2` |
| Tốn băng thông vì kéo image thật | TB×Thấp | Layer dùng chung. `SMOKE_MODELS_CACHE` |
| Đụng stack dev hoặc stack thật | Thấp×Cao | Project, cổng, thư mục riêng. Không đụng `mtl-local`/`mtl-dev` (kiểm như mục 14 của báo cáo 0.2.0) |

## Rollback

Xoá script. Không ảnh hưởng runtime.

## Trạng thái thực hiện

- Script `infra/selfhost-update-smoke.sh` đã viết xong, `bash -n` + `shellcheck` sạch, các đường lỗi sớm đã chạy thật.
- **Chạy live (`UPDATE SMOKE OK`) làm ở cổng phát hành (phase 8)**, khi đã có tag git + image GHCR `0.3.0-rc.N` có updater.
  Báo cáo `update-smoke-<from>-to-<to>-report.md` (bảng kiểm, thời gian, digest) viết sau lần chạy đó.
- Khác phác thảo: không chạy chế độ `ocr` của smoke cũ (chỉ cần `page.prepare` thành công); sau cập nhật, `up` tay đặt
  `MTL_TAG=$TO` khi `TO` là prerelease (người dùng rc phải ghim, vì bản prerelease không bao giờ là `latest`).
