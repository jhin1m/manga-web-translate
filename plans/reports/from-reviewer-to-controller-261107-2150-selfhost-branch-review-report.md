# Review branch feat/selfhost-local-mode (git diff main...HEAD, bỏ plans/)

Ngày: 2026-11-07 · Reviewer: code-review (chỉ đọc code, không chạy pnpm test/docker, không sửa code)
Phạm vi: 64 file, +3725/−370. Trọng tâm theo yêu cầu: /files, local-guard, requireUser, secrets, boot backup/migrate, export cleanup, Docker/compose, release.yml.

## Tổng kết

| Mức | Số |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 5 |

Không thấy lỗ hổng khai thác được trong route `/files`, local-guard hay đường rò local mode sang bản VPS. Các finding Medium nằm ở đóng gói/phát hành (lộ secret qua build context, lệch phiên bản image, chạy code cũ trên schema mới).

---

## Medium

### M1. `./data` của compose không bị ignore → secret/DB có thể lọt vào image hoặc git
- File: `.gitignore` (không có `data/`), `infra/docker/app.Dockerfile.dockerignore:1-22` (không có `data`), `infra/docker/app.Dockerfile:53` (`COPY . .`), `docker-compose.yml:6` (bind `./data/...` ngay cạnh file compose = gốc repo).
- Kịch bản: maintainer chạy `docker compose up -d` ở gốc repo (compose nằm sẵn ở đó) → tạo `./data/{secrets,postgres,backups,worker}`. Sau đó `docker build -f infra/docker/app.Dockerfile .` (build tay để push, hoặc smoke-like) → `COPY . .` chép `data/secrets/better-auth-secret`, `secrets-key`, `worker/token`, dump DB vào layer image runtime. Push lên GHCR public = lộ khoá ký `/files`, khoá giải mã key AI, toàn bộ dữ liệu. Trên Linux build còn có thể vỡ vì `data/postgres` thuộc uid 999 mode 0700 (permission denied khi gửi context). Ngoài ra `git add -A` sẽ stage cả `data/`.
  (CI checkout sạch nên release.yml không dính; rủi ro ở build/push tay và commit nhầm.)
- Sửa: thêm `data/` vào `.gitignore` và `/data` vào `app.Dockerfile.dockerignore` (worker dockerignore đã là whitelist, ổn). Cân nhắc thêm `**/*.dump`, `**/secrets` cho chắc.

### M2. release.yml đẩy `mtl` và `mtl-worker` độc lập → `latest` lệch phiên bản khi 1 image build lỗi
- File: `.github/workflows/release.yml:23` (`fail-fast: false`), `:44-48`, `:49-58` (mỗi matrix job tự push tag semver + latest).
- Kịch bản: tag `v1.3.0` nâng `MIN_PIPELINE_VERSION` (vd 0.10.0 → 0.11.0). Job `mtl` xanh và push `mtl:latest`; job `mtl-worker` lỗi (QEMU arm64 timeout, uv tải lỗi…). Người dùng `docker compose pull && up -d` → app mới + worker cũ → mọi claim trả 426, job đứng mãi đến khi re-run release. Cùng nhóm: 2 tag push gần nhau (concurrency group theo `github.ref` nên không tuần tự giữa các tag) → tag cũ build xong sau có thể ghi đè `latest` lùi bản.
- Sửa: tách 2 pha — pha build push theo tag bất biến (`{{version}}` hoặc digest, không `latest`); job cuối `needs: [image]` dùng `docker buildx imagetools create` gắn `{{major}}.{{minor}}` + `latest` cho cả hai image chỉ khi cả hai xanh; concurrency group chung (`release`) để tag xử lý tuần tự. Kèm: chạy unit test (ít nhất `pnpm --filter @mtl/api test:unit` + pytest worker) trước khi push.

### M3. Không có chặn hạ cấp: code cũ chạy im lặng trên DB đã migrate bản mới
- File: `apps/api/src/local/boot.ts:29` → `packages/db/src/migrate.ts:12` (drizzle `migrate`), `.github/workflows/release.yml:41-46` (comment thừa nhận `latest` có thể lùi).
- Kịch bản: DB đã ở m<N+3> (bản 1.3). Người dùng ghim `MTL_TAG=1.2.0` mà quên khôi phục dump (docs:106 yêu cầu cả hai), hoặc `latest` bị hotfix dòng cũ kéo lùi (M2). Drizzle chỉ áp migration có `folderMillis` > bản cuối trong DB → bản cũ không áp gì, không báo lỗi → app 1.2 chạy trên schema 1.3: cột NOT NULL mới thiếu giá trị khi insert, cột bị rename → 500, hoặc ghi dữ liệu thiếu trường. Docs ghi "không hạ cấp" nhưng code không thực thi.
- Sửa: trong `bootLocal` (sau backup, trước migrate) so `count(*)`/`max(created_at)` của `drizzle.__drizzle_migrations` với số entry trong `migrations/meta/_journal.json` của image; DB mới hơn → ném lỗi rõ ràng ("DB thuộc bản mới hơn — khôi phục dump m<N> hoặc dùng MTL_TAG mới"). Chi phí nhỏ, chặn được cả 2 đường.

---

## Low

### L1. Dump DB và file người dùng đọc được bởi user khác trên host Linux
- File: `apps/api/src/local/boot-backup.ts:98-103` (pg_dump tạo file theo umask 022 → 0644), `infra/docker/app-entrypoint.sh:10-13` (`mkdir -p` → 0755 cho `files`, `backups`).
- Kịch bản: máy Linux nhiều user; `./data/backups/mtl-*.dump` 0644 trong thư mục 0755 → user khác đọc toàn bộ DB (nội dung truyện, hash token worker, key AI đã mã hoá — khoá ở `secrets/` 0700 nên chưa giải được, nhưng dữ liệu còn lại lộ). Tương tự `./data/files`.
- Sửa: `umask 077` trong entrypoint trước `exec setpriv` (áp cho cả node lẫn pg_dump), hoặc `chmod 700` `backups`/`files` trong entrypoint.

### L2. File tạm mồ côi không bao giờ được dọn
- File: `apps/api/src/local/boot-backup.ts:94,104-105` (`.mtl-…dump.tmp` chỉ xoá trong catch của cùng process; `BACKUP_RE` không khớp nên `pruneBackups` bỏ qua), `apps/api/src/index.ts:10-11` (handler SIGTERM chỉ đăng ký SAU `bootLocal`), `apps/api/src/storage-drivers/disk-driver.ts:198-204` (sidecar đã commit, commit data lỗi → `.meta.json` mồ côi; export-cleanup chỉ dọn thư mục `export/`).
- Kịch bản: `docker compose stop` khi đang pg_dump DB lớn → tsx/node PID 1 không có handler → SIGKILL sau 10s → `.mtl-…dump.tmp` (có thể hàng trăm MB) nằm lại vĩnh viễn; lặp lại mỗi lần dừng giữa boot.
- Sửa: `pruneBackups` xoá thêm `^\.mtl-.*\.dump\.tmp$` cũ hơn vài giờ; thêm `init: true` cho service app/jobs (tini chuyển tiếp signal); tuỳ chọn để `writeAtomic` xoá sidecar khi commit data lỗi.

### L3. POST `/files` đọc cả multipart vào RAM
- File: `apps/api/src/routes/files.ts:118-132` (`c.req.parseBody()` → `formData()` buffer toàn bộ body + Blob).
- Kịch bản: font hệ thống tối đa 100MB (`admin-fonts.ts:22`), upload trang 50MB, web upload song song nhiều slice → đỉnh RAM = số upload đồng thời × (max + 64KB) × ~2 (buffer + Blob). Máy cá nhân ít RAM / Docker Desktop giới hạn 2GB có thể OOM-kill app. Chặn Content-Length trước khi đọc đã đúng, chỉ là trần cao.
- Sửa: chấp nhận được cho 1 người dùng; nếu muốn chặt: parse stream (busboy) ghi thẳng vào `.tmp` và đếm byte, hoặc giới hạn số POST đồng thời.

### L4. Bản VPS: AuthGate phụ thuộc `/api/config` → web mới + API cũ = màn "Không kết nối được máy chủ" thay vì đăng nhập
- File: `apps/web/src/app/layout.tsx:14-28`.
- Kịch bản: deploy VPS cập nhật static web trước API (hoặc rollback API về bản cũ) → `/api/config` 404 → `config.isError` → mọi người dùng kẹt ở màn lỗi, kể cả người đã có phiên hợp lệ. Thời gian ngắn nếu deploy cùng lúc, nhưng rollback API sẽ khoá web hoàn toàn.
- Sửa: coi 404 từ `/api/config` là `{ local_mode: false }` (chỉ lỗi mạng/5xx mới hiện màn lỗi); hoặc xác nhận script deploy luôn cập nhật API trước web.

### L5. release.yml: action ghim theo major tag, không có test gate
- File: `.github/workflows/release.yml:31-49`.
- Kịch bản: workflow có `packages: write`; tag `@v3/@v4/@v5/@v6` có thể bị dời (supply chain) → action bị chiếm quyền push image độc hại lên GHCR mà người dùng `pull` tự động. Đồng thời tag `v*` từ commit chưa qua CI vẫn ra image.
- Sửa: ghim action theo commit SHA (giữ comment version); thêm job test bắt buộc trước `image` (gộp với đề xuất M2).

---

## Đã kiểm, không thấy lỗi (bằng chứng)

- **HMAC `/files`** (`file-signing.ts:29-47`): canonical cố định 7 trường, luôn có mặt, từ chối `\n` → không dời nội dung giữa trường; method nằm trong chữ ký (GET không dùng làm PUT/POST); `exp` safe-integer + so đồng hồ server; so sánh `timingSafeEqual` sau kiểm độ dài/hex. TTL trần áp ở lúc ký (`types.ts:40-43`). Tham số `m` không ký nhưng không dùng.
- **Path traversal** (`disk-driver.ts:61-68`): regex ký tự đầu alnum (chặn `.tmp`, `/abs`), cấm segment rỗng/`.`/`..`, cấm đuôi `.meta.json`, kiểm `startsWith(root+sep)` sau resolve. Hono decode `%2F` không vượt được vì kiểm sau decode. Thư mục → `isFile()` false → 404.
- **Range** (`files.ts:44-60`): chỉ 1 khoảng; `bytes=-0` → 416; start ≥ size → 416; end kẹp size−1; số khổng lồ → 416/kẹp; file rỗng → 416. Content-Length khớp `createReadStream` (end inclusive).
- **POST multipart**: Content-Length bắt buộc + trần trước khi đọc body (Node/llhttp ép đúng CL, từ chối CL+TE); Content-Type field phải khớp ký; size [1,max]; key nằm trong chữ ký. Phản hồi GET có `nosniff` + `CSP: default-src 'none'; sandbox` → file HTML/SVG không chạy cùng origin; content-type upload là enum (`uploads.ts:11,17`). `cd` export ASCII-safe (`export.ts:69-78`) → không ném lỗi header.
- **local-guard** (`local-guard.ts`): Host so theo hostname (chặn DNS rebinding, kể cả `*.localhost`); method không an toàn: Origin phải khớp `host:port` (chặn trang localhost cổng khác), `Origin: null` bị chặn, `Sec-Fetch-Site: cross-site` bị chặn. Không có CORS → trang lạ không đọc được GET. Mount trước mọi route (`app.ts:45`), health dùng 127.0.0.1. `secureHeaders` mặc định có X-Frame-Options + CORP same-origin.
- **requireUser/VPS** (`user.ts:46`, `admin.ts:12-14`, `app.ts:33-60`, `env.ts:13,35`): cờ parse enum chặt (`"yes"`/`"TRUE"` → không khởi động, không ngầm bật); mặc định false; nhánh local chỉ theo `env.MTL_LOCAL_MODE`. Khi local: auth/dev-login không mount, `forceLocalOff` ép tắt signup/dispatcher/ntfy/admin emails/dev login. Admin disable user local bị chặn (`admin-users.ts:82` + `isAdminEmail` true). Tenant-isolation test thêm whitelist chỉ `GET /api/config`.
- **Secrets** (`local-secrets.ts`): `wx` + 0600, dir 0700, env có sẵn thắng file, chờ đọc khi race; entrypoint `chmod 700 secrets` + chown uid 1000; jobs đọc cùng file (cùng uid).
- **Boot backup/migrate**: pg_dump 17 khớp `postgres:17` (`app.Dockerfile` PGDG); không qua shell, mật khẩu qua PGPASSWORD; fail-closed + thoát hiểm; drizzle pg chạy migration trong 1 transaction → crash loop khi migrate lỗi để DB ở m<N>, prune giữ bản mới nhất mỗi 3 thế hệ schema → không mất dump trước nâng cấp.
- **Export cleanup** (`export-cleanup.ts`): đúng mẫu key `storage-keys.ts:16`; `lstat`/`isFile` bỏ symlink; khớp `RETENTION_MS` ở `export.ts:30,97` nên UI không phát link file đã xoá.
- **Compose**: postgres chỉ ở network `internal` (không publish, không ra Internet); app publish `127.0.0.1` duy nhất; worker chỉ mount `data/worker:ro` + models, không thấy secrets/DB; cả 2 image hạ quyền uid 1000 bằng `setpriv` (mất capability). Docs đã cảnh báo Docker Engine < 28.3.3 trên Linux (`docs/self-host.md:14`).
- **Worker** (`client.py`): `base_url` chỉ ảnh hưởng URL tương đối; client file không mang Bearer; `MTL_API_URL=http://app:8080` không có path nên httpx nối đúng `/files/…`.
- **S3 driver**: so diff với `main:apps/api/src/storage.ts` — logic giữ nguyên, chỉ đổi env → config.

## Câu hỏi chưa giải quyết

1. `depends_on: { app: { restart: true } }` có thực sự dừng `jobs`/`worker` TRƯỚC khi recreate app khi `compose pull && up -d` không? Tài liệu Compose chỉ nói "restart sau khi dependency được update"; nếu jobs cũ còn chạy trong lúc app mới migrate thì code cũ có thể ghi vào schema đang đổi (thường chỉ lỗi tạm, nhưng nên xác nhận bằng `docker compose up -d --dry-run` hoặc log thứ tự trong smoke).
2. Script deploy VPS cập nhật API trước hay web trước? (quyết định L4 có cần sửa code không).

Status: DONE
Summary: Review xong 64 file của branch — 0 Critical, 0 High, 3 Medium, 5 Low; không có lỗ hổng khai thác được ở /files, local-guard, requireUser; vấn đề chính ở đóng gói/phát hành.

---

## Kết quả xử lý (2026-11-07, chưa commit)

| Finding | Kết quả | Thay đổi / lý do |
|---|---|---|
| M1 | fixed | `.gitignore`: `/data/`, `*.dump`; `app.Dockerfile.dockerignore`: `/data`, `**/*.dump`. |
| M2 | fixed | `release.yml` 3 job: `test` (kiểm tag semver, `pnpm --filter @mtl/api test:unit`, `uv run --frozen pytest` worker) → `image` (matrix, chỉ push `:<version>` bất biến, `flavor: latest=false`) → `promote` (`needs: [test, image]`, `buildx imagetools create` gắn `:<major>.<minor>` + `:latest`). Thêm sau review vòng 2: tag trôi chỉ dời tới bản mới nhất của nó (re-run 1.3.0 không kéo `:1.3` lùi; hotfix dòng cũ không kéo `:latest` lùi); `set -euo pipefail` + lỗi khi không đọc được danh sách tag. Concurrency: đã thử nhóm chung `release` toàn workflow như yêu cầu, sau đó chuyển xuống job `promote` (`release-promote`, không cancel). Lý do: GitHub chỉ giữ 1 run chờ mỗi nhóm, nên khóa cả workflow sẽ huỷ cả bước build image của tag ở giữa; test/image ghi tag bất biến nên chạy song song an toàn. |
| M3 | fixed | `apps/api/src/local/schema-guard.ts`, gọi trong `bootLocal` TRƯỚC backup + migrate (đổi theo yêu cầu user sau review vòng 2, F6): `max(created_at)` của `drizzle.__drizzle_migrations` > `when` lớn nhất trong `_journal.json` của image thì ném `SchemaNewerThanImageError` kèm hướng dẫn (MTL_TAG mới hoặc khôi phục dump m≤N). Unit test `test/unit/schema-guard.test.ts`. Có thêm mục Xử lý sự cố trong docs. |
| L1 | fixed | Entrypoint: `chmod 700` files/backups/secrets + `umask 077` trước `setpriv`. Docs khôi phục đổi sang `sudo cat … \| pg_restore` vì host user khác uid 1000 không còn đọc được `data/backups`. |
| L2 | fixed | `pruneBackups` xoá `.mtl-*.dump.tmp` cũ hơn 6h (test). Compose: `init: true` cho app và jobs. `writeAtomic`: commit dữ liệu lỗi và đích không có file dữ liệu thì xoá sidecar (test). Còn file cũ thì giữ sidecar, vì ghi đè cùng key gần như luôn cùng loại nội dung. |
| L3 | skipped | Chấp nhận theo quyết định user. |
| L4 | fixed | `fetchAppConfig`: 404 **và 401** thì coi `{ local_mode: false }`. Theo review vòng 2, API cũ chạy requireUser trước 404 nên trả 401 khi chưa đăng nhập. Lỗi mạng/5xx vẫn hiện màn lỗi. Có test. |
| L5 | fixed | Mọi action ghim theo commit SHA (lấy bằng `gh api repos/<repo>/commits/<tag>`), comment là tag. `pnpm/action-setup` ghim đúng commit mà tag `v4` đang trỏ (cùng bản ci.yml đang chạy; tag v4 hiện trỏ một commit revert, khác v4.4.0). |

Kiểm chứng: `pnpm --filter @mtl/api test:unit` 68/68; `pnpm test` (shared 60, web 435, db 8, api 519 + 1 skip); `pnpm typecheck` OK; `pnpm lint` OK; worker pytest 354 passed; `actionlint release.yml` OK; `docker compose config` OK; script promote chạy thử với gh/docker giả (4 kịch bản). `SMOKE_PORT=18081 infra/selfhost-smoke.sh` chạy tới **SMOKE OK**. Lần restart trong smoke đã chạy schema guard trên DB thật. Sau smoke chỉ đổi câu thông báo của guard, web `api.ts`, docs và release.yml; không đổi boot/entrypoint/compose nên không chạy lại smoke.

Review vòng 2: `plans/reports/from-code-reviewer-to-controller-261107-2156-selfhost-review-fixes-report.md` (8/10). Đã sửa F1–F5, F7. Không sửa:
- F6: ĐÃ sửa sau đó theo yêu cầu user — guard chạy trước backup (image cũ crash-loop không dump mỗi lần restart). Docs: thêm `sudo ls`, ghi rõ files/secrets/backups 0700 uid 1000 cần sudo trên Linux, lệnh chép token cụ thể.
- F8: query trùng nhỏ giữa `appliedMigrations` và `readDbMigrations`; guard DB chỉ được smoke kiểm.
- F9: không phải lỗi thật, file tạm được dọn ở lần boot thành công sau.
- Reviewer nói worker thiếu `init: true`: sai, compose đã có từ trước.

Câu hỏi còn mở:
1. Worker pytest chưa từng chạy trên CI ubuntu nên tag release đầu tiên là lần chạy đầu. Nên thử bằng một tag prerelease (vd `v0.x.0-rc.1`) trước.
