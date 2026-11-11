---
title: "Self-host: hiện phiên bản, báo bản mới, nút Cập nhật ngay, GitHub Release tự động"
description: "App hiện vX.Y.Z, hỏi GitHub tối đa 1 lần/ngày, có chấm nhỏ khi có bản mới. Nút Cập nhật ngay gọi một updater giữ Docker socket, updater sinh runner tách rời chạy compose pull/up đúng thứ tự. release.yml tự tạo Release sau promote."
status: in-progress
priority: P1
effort: 4d
branch: main
tags: [self-host, docker, compose, release, ci, api, web, security]
created: 2026-11-11
---

# Phiên bản, thông báo bản mới, cập nhật trong app

## Vấn đề (đã xác minh)

1. App không biết phiên bản của chính nó. Người dùng phải mở Docker Desktop → Inspect để đọc
   `org.opencontainers.image.version` (ghi chú Release v0.2.0, mục "Cách cập nhật").
2. Không có cách nào báo bản mới. Release v0.2.0 tạo tay. `release.yml:17-18` chỉ có `contents: read`.
3. Cập nhật phải gõ 3 lệnh trong đúng thư mục (`docs/self-host.md:58-66`). Người dùng cuối dùng Windows/PowerShell.

## Thiết kế đã chốt

- **Phiên bản trong image**: `ARG MTL_VERSION` → `ENV` trong `app.Dockerfile`. `release.yml` truyền phiên bản của tag.
  `/api/config` trả `version`. Build không qua release thì là `dev`.
- **Kiểm tra bản mới ở server**, lười, cache trong bộ nhớ. Kết quả gộp với trạng thái updater ở `GET /api/admin/update`.
- **Kiến trúc cập nhật: phương án (a)**.
  - Service `updater` giữ socket, chỉ ở mạng `internal`, có token.
  - Khi được gọi, updater tạo **runner tách rời** (`<project>-update`, ngoài project compose). Runner mount thư mục
    project ở **đúng đường dẫn phía daemon**, rồi tải compose của tag, `pull`, kiểm label, `up -d --wait`. Compose tự
    giữ thứ tự dừng → backup → migrate → chạy lại.
  - App **không** có socket.
- **Release tự động**: job `github-release` chạy sau `promote`, chỉ với tag chính thức. Ghi chú lấy từ
  `docs/releases/vX.Y.Z.md`, không có file thì dùng ghi chú tự sinh. Latest theo kết quả promote.
- **UI**: mọi thứ nằm trong menu tài khoản.
  - Dòng phiên bản.
  - Một mục "Có bản mới" kèm nút "Cập nhật ngay" hoặc "Cách cập nhật".
  - Chấm nhỏ trên avatar.
  - Không banner. Editor không hiện gì.

### So sánh kiến trúc

| Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|
| **(a) updater riêng giữ socket + runner tách rời** | App xử lý file không tin cậy (ảnh, ZIP, font) mà vẫn không ngang root. Bề mặt updater chỉ có 2 route, không nhận image/lệnh/đường dẫn. Runner sống sót khi compose tạo lại updater | Thêm 1 service (~60 MB RAM). Image app nặng thêm binary compose | **Chọn** |
| (b) app mount socket thẳng | Ít service hơn | Mọi lỗi RCE ở app thành root trên máy. Phải bỏ việc hạ quyền xuống uid 1000 (`app-entrypoint.sh:20`), vì socket thuộc root. Vẫn cần runner tách rời vì app là container bị tạo lại | Loại |
| (c) Watchtower hoặc fork | Có sẵn | Upstream đã archive ngày 17/12/2025. Tạo lại từng container, bỏ qua `depends_on … restart: true` (jobs/worker cũ chạy trên schema mới). Không tải compose mới (service mới như updater hay worker thứ 2 không bao giờ xuất hiện). Tự cập nhật theo lịch, ngược với "1 click" (`reports/researcher-docker-desktop-paths-report.md` Q10) | Loại |

## Quyết định tự chốt (kèm lý do)

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Kiến trúc (a). Compose chạy trong **runner tách rời**, không chạy trong updater | `up -d` tạo lại container updater (image đổi). Nếu compose chạy trong đó thì nó tự giết mình khi đang chờ app healthy, để `jobs`/`worker` dừng mà không ai chạy lại |
| D2 | Updater và runner dùng **chính image `mtl`** (lệnh `updater`, `update-run`), thêm binary `docker-compose` (lấy từ `docker:<ver>-cli`, ghim digest). Không có image thứ 3 | Không phải sửa matrix, promote hay danh sách image cho phép. Cùng vòng đời phiên bản với app. Engine API gọi bằng `node:http`, không cần CLI `docker` đầy đủ |
| D3 | Kiểm tra bản mới **ở server**, không ở trình duyệt | (1) CSP: hiện API không đặt CSP (Hono `secureHeaders` mặc định không có), nhưng sau này thêm CSP thì gọi từ trình duyệt sẽ vỡ. Phía server giữ trình duyệt chỉ nói chuyện cùng origin. (2) Riêng tư: trình duyệt sẽ gửi IP, User-Agent và mọi lần mở tab tới GitHub. Server gửi tối đa 1 lần/ngày với UA chung `mtl-selfhost`. (3) Cache: giới hạn 60 req/giờ/IP khi không đăng nhập. Nhiều tab + reload ở trình duyệt có thể chạm, server gộp request. (4) Nút cập nhật cần server biết bản đích, không tin số phiên bản do trình duyệt gửi |
| D4 | Lười (chỉ khi web hỏi, không có timer), cache trong bộ nhớ: thành công 24h, lỗi 6h. Bấm Cập nhật thì kiểm lại một lần, bỏ qua cache | Không ai mở web thì không gọi mạng. Lỗi mạng lúc mới khởi động không che bản mới cả ngày. Kiểm lại lúc bấm tránh trường hợp `:latest` đã sang bản mới hơn bản đang hiện (sẽ thành `version_mismatch`). Đây là hành động của người dùng, có cooldown 60s |
| D5 | Runner tải compose của **tag `v<T>`**, không của `main`. Lệnh tay trong docs vẫn dùng `main` | Compose ở tag là bản đã smoke cùng image T, không đổi được. `main` có thể có thay đổi compose đi trước (quy tắc ở `self-host.md:203-205` là làm tay, dễ sai). Thử rc cũng cần compose ở tag. Người dùng quen `main` cho lệnh tay, nên giữ, vì `main` luôn tương thích image cũ |
| D6 | Bản chính thức: compose chạy với `MTL_TAG=latest`, sau `pull` kiểm label `org.opencontainers.image.version` của cả 2 image **bằng T**. Prerelease (chỉ qua `MTL_UPDATE_TARGET`): `MTL_TAG=T` | Đi đúng đường cập nhật tay, nên sau đó `docker compose up -d` tay không hạ cấp nhầm. Nếu ghim `:T` cho bản chính thức, tag `:latest` ở máy vẫn trỏ bản cũ, lần `up` tay kế tiếp sẽ chạy image cũ trên DB mới và app từ chối khởi động |
| D7 | Đang ghim `MTL_TAG` (image của container app, hoặc `.env` theo `config` không truyền `MTL_TAG`) và đích là bản chính thức → không có nút, chỉ lệnh tay, không có chấm | Cập nhật đè lên ghim thì lần `up` tay sau đó quay về bản ghim (hạ cấp, app từ chối khởi động) |
| D8 | Giữ tuỳ chỉnh bằng cách **khôi phục giá trị từ container đang chạy** (cổng từ `PortBindings`, số worker bằng đếm container, env của app/worker) và truyền làm env của compose. `MTL_SKIP_BOOT_BACKUP` luôn rỗng | Docs dạy cả cách gõ trong shell (`MTL_WORKERS=1 docker compose up -d`). Runner không thấy shell của người dùng. Thiếu bước này, máy ít RAM bị bật lại 2 worker (OOM), hoặc cổng 9090 quay về 8080. Có test quét compose để biến mới không bị quên. Cập nhật trong app luôn phải backup |
| D9 | URL updater cố định `http://updater:8090`. Không có biến môi trường cho URL, repo hay image | Bớt bề mặt cấu hình (YAGNI). Test dùng hook `setUpdaterBaseForTest` |
| D10 | `MTL_UPDATE_TARGET=<semver>` (chỉ cho người phát hành) thay kết quả GitHub, cho phép đích prerelease | Smoke và checklist Windows phải chạy trên rc trước khi tag chính thức. `releases/latest` không bao giờ trả prerelease. Muốn đặt biến này thì phải có quyền trên máy, tức là đã ngang quyền |
| D11 | Mặc định **bật** (quyết định của người dùng). Tắt nút: `MTL_UPDATER=0` (`deploy.replicas` = 0, không mount socket). Tắt hỏi GitHub: `MTL_UPDATE_CHECK=0`. Rootless: `MTL_DOCKER_SOCK` | Hai công tắc tách riêng: riêng tư mạng và quyền socket. `replicas: 0` đã kiểm trên Compose v5.1.2: không tạo container, không tạo bind (research Q5). Không dùng profile, vì profile là opt-in, ngược với mặc định bật |
| D12 | Thư mục project phía daemon = `Mounts[].Source` của `/data/files` trừ `/data/files`. Kiểm chéo với `/data/postgres` và label `working_dir`. Runner mount ở **cùng đường dẫn**. Mọi bind dưới thư mục project mà compose mới resolve ra phải **bằng chuỗi** bind đang chạy, nếu không thì dừng trước khi đổi gì. Dạng `C:\…` và `/run/desktop/mnt/host/wsl/…` bị từ chối ở bản đầu | Chuỗi daemon đã báo thì daemon nhận lại được. So bằng chuỗi chặn hẳn kịch bản "app khởi động với DB trống". Windows chưa chứng minh được dạng nào (research Q1), nên từ chối và hướng dẫn tay an toàn hơn đoán |
| D13 | Runner tên cố định `<project>-update`, không có label compose, `restart: no`, giữ lại sau khi xong | Tên cố định làm khoá (create trùng tên thì 409). Log còn lại để xem (`docker logs mtl-local-update`). Updater mới (sau khi bị tạo lại) vẫn đọc được trạng thái |
| D14 | **Không tự rollback** sau `up`. Lỗi trước `up` thì chưa đổi gì: compose file chỉ ghi ngay trước `up` | Migrate có thể đã chạy, hạ cấp thì app từ chối khởi động (`schema-guard.ts`). Khôi phục backup là quyết định của người dùng, docs đã có |
| D15 | UI: dòng `MTL vX.Y.Z` cuối menu tài khoản. Có bản mới thì chấm nhỏ trên avatar (mở menu một lần là tắt, nhớ theo phiên bản trong `localStorage`) và một mục trong menu. Hộp xác nhận/tiến độ dùng `Drawer variant="modal"` có sẵn. Không có nút "Kiểm tra lại" hay "Ẩn" | Người dùng muốn tối giản, ẩn theo ngữ cảnh, badge nhỏ thay banner. Thanh trên không thêm phần tử nào |
| D16 | Release: job `github-release` (`contents: write` chỉ ở job này) chạy sau `promote`. Dòng đầu `# …` của `docs/releases/vX.Y.Z.md` là tiêu đề. Không có file thì `--generate-notes`, job `test` cảnh báo trước. Release đã tồn tại thì bỏ qua. `--latest` lấy từ output của promote | Release là nguồn của `releases/latest`. Tạo sau promote thì khi người dùng thấy thông báo, `:latest` đã sẵn sàng. Không ghi đè Release làm tay (v0.2.0). Hotfix dòng cũ không bị đánh Latest |
| D17 | Chỉ image `mtl` có `MTL_VERSION`. Worker không cần | YAGNI. Worker đã có label OCI, runner kiểm label của cả hai |
| D18 | Route update nằm trong `adminApi()` (requireUser + requireAdmin), trả 404 ngoài local mode | `admin-access.test.ts` tự kiểm 401/403. Bản VPS cập nhật bằng `infra/deploy.sh`, không dùng tính năng này |
| D19 | Bản phát hành có tính năng này là **v0.3.0** | Tính năng mới + service mới trong compose |

## Luồng dữ liệu

```
Web (menu tài khoản)
  GET /api/config ─────────────────────────────► {local_mode, version}                       (public, no-store)
  GET /api/admin/update ─► App: localGuard → requireUser/Admin
        ├─ updateCheck.get()  ── cache 24h/6h ──► api.github.com/repos/…/releases/latest      (UA mtl-selfhost, 5s)
        └─ updater GET /v1/status (Bearer) ─────► Updater: discover() qua Engine API /v1.44
  ◄── UpdateStatus {current, check, latest, update_available, pinned_tag, updater{ready, reason, run}}

  POST /api/admin/update {version}
      App: localGuard (Host/Origin) → JSON → semver → kiểm lại GitHub (bỏ cache) → == latest? → ghim? → cooldown 60s
      → updater POST /v1/update {version}
          Updater: token → semver → discover() → T > current? → ghim? → không có runner đang chạy?
          → create + start runner "<project>-update"
              (Image = image của updater, Mounts: socket + daemonDir:daemonDir, mạng bridge)
  ◄── 202 {run}
                                   Runner: preflight (thấy compose + data/postgres/PG_VERSION)
                                           download compose@vT → config --format json
                                              → image thuộc allowlist, bind dưới daemonDir == bind đang chạy, .env không ghim
                                           pull (app vẫn chạy) → label version == T (cả 2 image)
                                           .bak + rename (giữ uid/gid/mode) → up -d --wait
                                              (dừng jobs + worker → tạo lại app: backup → migrate → healthy → chạy lại jobs/worker; tạo lại updater)
                                           check mount sau == trước → MTL_UPDATE result=ok
Web theo dõi: status mỗi 2s → app mất kết nối → /api/config mỗi 3s → version == T → reload
```

## Tiến độ (11/11/2026, 23:50)

- Phase 1-7 xong, đã review 2 vòng + sửa; review cuối đang chạy. Phase 8 (cổng phát hành) chưa bắt đầu.
- Gate xanh: lint, typecheck, `pnpm test` (api 705 + 1 skip, web 486, shared 114, db 8), worker pytest 414, web e2e (trừ `block-panel.spec.ts:317` đỏ sẵn và `series-suggestions.spec.ts:18` chập chờn, chạy riêng thì qua).
- Quyết định khi review:
  - Updater chỉ nhận prerelease khi bằng `MTL_UPDATE_TARGET` của container app, và phải mới hơn bản đang chạy.
  - Bind kiểm hai chiều. Service đang chạy mà compose mới thiếu → `invalid_compose`.
  - `MTL_UPDATER` truyền vào app: tắt thì app không gọi mạng tới `updater`.
  - POST tới updater tuần tự; runner kẹt ở `created` quá 60s thì thay mới.
  - Web theo dõi tiếp sau khi kết nối lại tới khi run kết thúc (tối đa 10 phút); màn lỗi `AppShell` chỉ hiện khi không có dữ liệu nào.
- Còn lại: phase 8 cần commit + push, rc.1/rc.2 trên GHCR, smoke macOS thật, máy Windows của user. Chi tiết ở `handoff.md`.
- Báo cáo: `reports/project-manager-261111-implementation-progress-report.md`.

## Phases

| # | Phase | File sở hữu | Phụ thuộc | Effort | Status |
|---|---|---|---|---|---|
| 1 | [Hợp đồng chung](./phase-01-shared-contract.md) | `packages/shared/src/update.ts`, `packages/shared/src/index.ts`, `packages/shared/package.json`, `packages/shared/test/update.test.ts` | — | 1.5h | completed |
| 2 | [Image + GitHub Release](./phase-02-image-version-and-github-release.md) | `infra/docker/app.Dockerfile`, `.github/workflows/release.yml` | — | 2h | completed |
| 3 | [API: phiên bản, kiểm tra, kích hoạt](./phase-03-api-version-check-and-trigger.md) | `apps/api/src/{env,app}.ts`, `apps/api/src/lib/{update-check,updater-client}.ts`, `apps/api/src/routes/{admin,admin-update}.ts`, test liệt kê trong phase | 1 | 5h | completed |
| 4 | [Updater + runner](./phase-04-updater-service-and-runner.md) | `apps/api/src/updater/**`, `apps/api/test/unit/updater-*`, `apps/api/test/unit/fixtures/docker-inspect-*`, `docker-compose.yml`, `infra/docker/app-entrypoint.sh` | 1 | 10h | completed |
| 5 | [Web: phiên bản + cập nhật](./phase-05-web-version-notice-update-flow.md) | `apps/web/src/lib/api.ts`, `apps/web/src/app/app-shell.{tsx,css}`, `apps/web/src/features/update/**`, `apps/web/e2e/update-notice.spec.ts` | 1 | 5h | completed |
| 6 | [Smoke cập nhật macOS](./phase-06-update-smoke-script.md) | `infra/selfhost-update-smoke.sh` | 2, 3, 4 | 3h | completed |
| 7 | [Docs](./phase-07-docs.md) | `docs/self-host.md`, `README.md`, `docs/releases/v0.3.0.md`, `docs/project-roadmap.md` | 3, 4, 5 | 2h | completed |
| 8 | [Cổng phát hành: rc, Windows, tag](./phase-08-release-gate-rc-and-windows.md) | `plans/…/reports/`, fixture Windows thật, journal, dòng `self-host.md:21` | 1–7 | 3h + thời gian người dùng | pending |

Thứ tự chạy:
- Phase 1 và 2 chạy song song.
- Sau phase 1: phase 3, 4, 5 chạy song song (không chung file; `env-local.test.ts` thuộc phase 3, `updater-*` thuộc
  phase 4).
- Phase 6 cần image từ phase 2 và code của phase 3 và 4.
- Phase 7 song song được với phase 6.
- Phase 8 cuối cùng. Phase 8 sửa lại `self-host.md` (của phase 7) và fixture Windows (của phase 4), nhưng chạy tuần tự
  nên không đụng nhau.

Không đụng file đang có thay đổi chưa commit của plan khác: `apps/web/src/features/chapter/**`, `docs/editor.md`,
`docs/design-guidelines.md`. `app-shell.tsx` chỉ import `ShellActivity` từ `features/chapter`, dòng import đó không đổi.

## Ma trận test

| Lớp | Nội dung | Ở đâu |
|---|---|---|
| Unit | semver (prerelease, `0.10 > 0.9`), URL | phase 1 `packages/shared/test/update.test.ts` |
| Unit | kiểm tra bản mới: cache 24h/6h, gộp request, timeout/403/JSON rác/draft/prerelease, dev, tắt, override, URL dựng từ tag | phase 3 `test/unit/update-check.test.ts` |
| Unit | env mới | phase 3 `test/unit/env-local.test.ts` |
| Unit | discovery theo fixture Linux/OrbStack/DD Mac/Windows, so bind, allowlist, args compose, biến compose không bị quên, ranh giới import, server updater với socket giả | phase 4 `test/unit/updater-*.test.ts` |
| API + DB | route `GET/POST /api/admin/update`: 415, 403 cross-site, 400, 409 stale/busy, 422 ghim, 429, 503, 202, 404 ngoài local, token 0600 | phase 3 `test/admin-update.test.ts`. `admin-access.test.ts` tự phủ 401/403 |
| Web unit | reducer theo dõi, timeout chỉ khi mất kết nối, text cho mọi reason, lệnh `curl.exe` hay `curl` | phase 5 `update-model.test.ts` |
| E2E web | chấm, menu, link Release, Cách cập nhật, luồng thành công tới reload, luồng lỗi (mock `page.route`) | phase 5 `e2e/update-notice.spec.ts` |
| Smoke macOS | rcA → rcB thật: thứ tự (docker events), dữ liệu, bind trước = sau, tuỳ chỉnh shell và `.env` giữ nguyên, quyền file compose, `up` tay sau đó, `MTL_UPDATER=0` | phase 6 |
| Thủ công Windows | bootstrap 0.2.0 → rc, cập nhật trong app rc.1 → rc.2, dữ liệu, `Source` trước = sau, đường dẫn có dấu cách và tiếng Việt, ổ D:, tắt, mất mạng, đóng tab | phase 8 |

## Tiêu chí xong (đo được)

1. Image rc có `MTL_VERSION` đúng tag. `/api/config.version` đúng. Menu hiện `MTL v0.3.0-rc.N`. Build dev hiện `MTL dev`
   và không gọi GitHub (unit test đếm số lần fetch = 0).
2. Có bản mới thì avatar có chấm, menu có link `…/releases/tag/vX.Y.Z`. Không quá 1 request GitHub thành công mỗi 24h
   mỗi lần app chạy (unit test). `MTL_UPDATE_CHECK=0` thì 0 request.
3. `FROM=0.3.0-rc.1 TO=0.3.0-rc.2 infra/selfhost-update-smoke.sh` in `UPDATE SMOKE OK` trên macOS. Gồm: jobs/worker
   dừng trước khi app cũ bị huỷ, chạy lại sau khi app mới healthy; backup +1; `verify` dữ liệu đạt; mount trước = sau;
   cổng, số worker, threads giữ nguyên.
4. Checklist Windows (phase 8) đạt mọi ô C, D, E1 trên máy thật của người dùng.
5. Tag `v0.3.0` tạo đúng 1 GitHub Release "Latest", tiêu đề lấy từ `docs/releases/v0.3.0.md`. Tag rc không tạo Release.
6. POST từ origin khác → 403. Không có JSON → 415. Updater không có cổng publish. Gọi updater sai token → 401.
   `MTL_UPDATER=0` → không container updater, menu hiện lệnh tay.
7. Gate xanh: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @mtl/web e2e` (trừ `block-panel.spec.ts:317`
   đỏ sẵn), `cd worker && uv run pytest -q`.

## Tương thích ngược

- **Không có migration DB.** Schema không đổi.
- Compose mới: mọi biến mới có mặc định. Compose mới + image cũ (0.2.0, người dùng ghim) thì service updater restart
  lặp (image cũ không có lệnh `updater`), còn lại chạy bình thường. Đã ghi ở Risks phase 4.
- Image mới + compose cũ (người dùng chỉ `pull`): không có service updater → `reason: unavailable` → menu hiện lệnh tay
  có bước `curl` compose.
- `/api/config` thêm key. Web cũ bỏ qua key lạ, web mới xử lý trường hợp thiếu key.
- Người dùng 0.2.0 phải cập nhật tay **một lần** (lệnh PowerShell ở phase 7 mục 1). Sau đó dùng nút.

## Rủi ro chính

| Rủi ro | Khả năng × Tác động | Giảm thiểu |
|---|---|---|
| Đường dẫn bind sai trên Windows làm app khởi động với DB trống | TB × Cao | D12: kiểm chéo mount, runner thấy `PG_VERSION`, so bind bằng chuỗi **trước khi đổi gì**. Dạng chưa chứng minh thì từ chối và hướng dẫn tay. Checklist Windows là cổng bắt buộc |
| Windows không dùng được cách mount cùng đường dẫn | TB × TB | Lùi về lệnh tay một cách sạch sẽ (`path_mismatch`). Câu hỏi 1 bên dưới |
| Updater ngang root trên máy | Chắc chắn × TB (đã chấp nhận) | Không cổng, mạng `internal`, token, 2 route, không nhận image/lệnh/đường dẫn, chỉ lên bản chính thức mới hơn. Tắt được bằng `MTL_UPDATER=0`. Docs ghi rõ |
| Cập nhật hỏng sau migrate | Thấp × Cao | Backup tự động trước migrate (giữ như cũ, `MTL_SKIP_BOOT_BACKUP` bị ép rỗng). Không tự rollback (D14). Docs khôi phục |
| Mất tuỳ chỉnh (cổng, số worker) sau cập nhật | TB × TB | D8 + test quét biến compose + smoke kiểm cả biến shell lẫn `.env` |
| Đường `latest` (bản chính thức) chưa được smoke trước khi phát hành | Chắc chắn × TB | Chỉ khác giá trị `MTL_TAG` so với đường rc (đã smoke). Unit test khoá giá trị. Smoke lại với đích chính thức ngay sau khi phát hành bản kế tiếp |
| Rootless Linux hoặc ECI làm `up` lỗi mount socket | Thấp × TB | Docs + ghi chú 0.3.0: `MTL_DOCKER_SOCK` hoặc `MTL_UPDATER=0` |

Chi tiết từng rủi ro nằm trong file của từng phase.

## Rollback

- Từng phase revert độc lập, theo thứ tự web → API → updater/compose → CI.
- Không có dữ liệu DB nào phải gỡ. File `data/secrets/updater-token`, `docker-compose.yml.bak` và container
  `mtl-local-update` để lại cũng vô hại.
- Đã phát hành mà updater có lỗi: ra `v0.3.1` với `replicas: ${MTL_UPDATER:-0}` (mặc định tắt). Người dùng chỉ cần cập
  nhật tay một lần. App không bao giờ tự cập nhật nếu người dùng không bấm.

## Câu hỏi chưa giải quyết

1. **Windows không qua được cách mount cùng đường dẫn** (checklist phase 8 mục C hoặc E đỏ, và một rc sửa theo fixture
   thật vẫn không qua): phát hành 0.3.0 với nút **tự lùi về "Cách cập nhật"** trên Windows (an toàn, vẫn có phiên bản +
   thông báo), hay hoãn 0.3.0? Đề xuất: phát hành, vì lùi về lệnh tay là tự động và không mất dữ liệu.
2. **Linux**: có máy Linux (rootful) để chạy `infra/selfhost-update-smoke.sh` không? Nếu không, docs ghi "Linux: cập
   nhật trong app chưa kiểm trên máy thật". Cơ chế giống OrbStack (đã kiểm ở research), nên rủi ro thấp.

Việc nhỏ đã tự quyết, không cần hỏi: số phiên bản 0.3.0 (D19). Không làm cho bản VPS (D18). Thêm một dòng mô tả menu
tài khoản vào `docs/design-guidelines.md` **sau khi** plan đang sửa file đó commit xong, ngoài phạm vi plan này.
