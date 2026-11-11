# Self-host v0.3.0: hiện phiên bản, báo bản mới, cập nhật trong app, và một updater giữ Docker socket

**Date**: 2026-11-11
**Severity**: Medium (chưa phát hành; review bắt được 1 High và 3 Medium trước khi commit, chưa lỗi nào tới người dùng)
**Component**: API (`lib/update-check.ts`, `lib/updater-client.ts`, `routes/admin-update.ts`, `updater/**`), web (`app-shell.tsx`, `features/update`), shared (`update.ts`), `docker-compose.yml`, `app.Dockerfile`, `release.yml`, `infra/selfhost-update-smoke.sh`
**Status**: Phase 1-7 xong, **chưa commit gì**. Phase 8 (cổng phát hành) chưa bắt đầu. Gate xanh trừ e2e `block-panel.spec.ts:317` (đỏ sẵn trên HEAD) và `series-suggestions.spec.ts:18` (chập chờn)

## Đã làm gì

Plan `plans/261111-2159-self-host-version-update-notice-and-in-app-update/`.

- Phiên bản nằm trong image (`ARG MTL_VERSION` thành `ENV`), `/api/config` trả `version`; build ngoài release là `dev`.
- Kiểm tra bản mới lười ở server: cache bộ nhớ 24h khi thành công, 6h khi lỗi, tối đa một lần/ngày tới GitHub. Không có timer.
- Service `updater` giữ socket, chỉ ở mạng `internal`, có token, hai route. Nó sinh **runner tách rời** `<project>-update` chạy `compose pull` rồi `up -d --wait`.
- Web: một dòng `MTL vX.Y.Z` và một mục "Có bản mới" trong menu tài khoản, chấm nhỏ trên avatar. Không banner.
- Job `github-release` sau `promote` (chỉ job này có `contents: write`), docs, và smoke `FROM=rc.1 TO=rc.2`.

## Quyết định chính

- **Updater riêng, không mount socket vào app.** App xử lý ảnh, ZIP, font không tin cậy; mount socket là RCE thành root. Watchtower loại vì đã archive và bỏ qua `depends_on … restart: true`.
- **Compose chạy trong runner, không trong updater.** `up -d` tạo lại updater, nếu compose chạy trong đó thì nó tự giết mình giữa chừng và để `jobs`/`worker` dừng vĩnh viễn.
- **Khôi phục cổng, số worker, env từ container đang chạy.** Runner không thấy shell của người dùng; thiếu bước này máy ít RAM bị bật lại 2 worker (OOM).
- **Không tự rollback sau `up`.** Migrate có thể đã chạy, hạ cấp thì `schema-guard.ts` từ chối khởi động.
- **Windows: từ chối dạng đường dẫn chưa chứng minh** (`C:\…`, `/run/desktop/mnt/host/wsl/…`) và lùi về lệnh tay, thay vì đoán.

## Review bắt được gì

Ba vòng, điểm 7 lên 8,5 lên 9.

1. **High: màn lỗi của `AppShell` gỡ hộp theo dõi.** `if (q.error)` ở `app-shell.tsx:38` unmount tracker đúng lúc app khởi động lại và `/api/me` lỗi. Người dùng nhìn thấy màn lỗi giữa lúc cập nhật, thứ họ sợ nhất. Sửa: màn lỗi chỉ hiện khi không có dữ liệu nào.
2. **Updater nhận mọi prerelease, rồi sau bản sửa lại mất điều kiện "mới hơn".** Vòng 1 thấy prerelease nào cũng qua; tôi chỉ cho phép bằng `MTL_UPDATE_TARGET`. Vòng 2 phát hiện bản sửa đó **tự gây ra** hạ cấp hoặc cài lại (N1): nhánh prerelease bỏ `isNewer`. Bài học: bản sửa cho bất biến phải có test đỏ khi bỏ nó.
3. **Kiểm bind một chiều.** Chỉ duyệt `config.services` của compose mới, nên service bị bỏ khỏi file mới (mount bị dời) lọt qua, và app có thể khởi động với DB trống. Giờ service đang chạy mà thiếu trong file mới thì `invalid_compose`, trước pull, trước khi ghi đĩa.
4. **`runUpdate` không có test**, trong khi nó giữ thứ tự an toàn. Thêm sáu ca lỗi, mỗi ca kiểm compose còn nguyên byte.
5. **Copy tự mâu thuẫn.** Hộp "đã lên bản" ghi "App đã chạy bản vX" ngay trên câu "App chưa chạy lại được". Thêm unit test duyệt mọi reason và e2e chặn câu cũ.

Khác: lỗi sau `apply` không hiện, 429 sau lỗi nhanh làm hộp kẹt "Đang kiểm tra…", `MTL_UPDATER=false` làm `compose config` lỗi `strconv.Atoi` (chỉ nhận `0`/`1`), mã quyết định "(D7)" lọt vào comment.

## Đã kiểm và chưa kiểm

Đã: lint, typecheck, api 705 + 1 skip, web 485, shared 114, db 8, worker pytest 414, `shellcheck`, `docker compose config`, `MTL_UPDATER=0` cho `replicas: 0`, và discovery theo fixture.

**Chưa**, nên đừng tin tính năng này chạy:
- Đường cập nhật thật **sau bước tải về** (`up`, migrate, chờ healthy): chưa chạy lần nào. Mọi thứ sau `pull` mới là unit test với socket giả.
- Windows (fixture là giả), Docker Desktop Mac/Windows, Linux (không có máy, ghi "chưa kiểm" vào docs).
- amd64 (máy dev arm64); compose trong image là v5.7.0, research chỉ kiểm v5.1.2.
- Job `github-release` chưa chạy trên Actions thật; đường `latest` chưa smoke (chỉ khác giá trị `MTL_TAG`).
- 1 test api skip vì thiếu `pg_dump`, đúng test bảo vệ bước "backup +1".

## Việc tiếp theo: cổng phát hành (phase 8)

1. Commit theo từng đường dẫn (không `git add -A`; cây làm việc còn file của plan chapter-topbar), push.
2. Tag `v0.3.0-rc.1`, `rc.2`; kiểm Actions: label `MTL_VERSION`, `docker-compose version`, rc không tạo Release.
3. `FROM=0.3.0-rc.1 TO=0.3.0-rc.2 infra/selfhost-update-smoke.sh` phải in `UPDATE SMOKE OK`; bootstrap tay 0.2.0 sang rc.
4. User chạy checklist Windows (mục C, D, E1, PowerShell, `curl.exe`). Chưa báo đạt thì **không** tag `v0.3.0`.
5. Thay fixture Windows giả bằng `docker inspect` thật, sửa `self-host.md:21`. Windows không qua thì vẫn phát hành, nút tự lùi về lệnh tay.
