# Báo cáo: bỏ MinIO/S3 + hạn mức chỉ từ env (API, infra, docs)

Status: DONE_WITH_CONCERNS · Branch `feat/settings-icons-fonts-drop-minio` (chưa commit)

## 1. Bỏ MinIO/S3, chỉ còn lưu đĩa

**API**
- `storage.ts` luôn dùng disk driver; xoá `storage-drivers/s3-driver.ts`; bỏ `objectTags` (chỉ có nghĩa với S3) khỏi
  `types.ts` / `disk-driver.ts`.
- `env.ts`: bỏ `STORAGE_DRIVER`, `S3_*`, `FILES_DOMAIN`, `FILES_SCHEME`. `FILES_DIR` mặc định `${MTL_DATA_DIR}/files` ở mọi
  chế độ. Production không phải local mà thiếu cả `FILES_DIR` lẫn `MTL_DATA_DIR` thì API từ chối khởi động (nếu không,
  mặc định sẽ rơi vào thư mục release, bị xoá khi dọn release).
- `local/local-secrets.ts`: `DEFAULT_DATA_DIR` = `<gốc repo>/.data` (trước là `/data`, không ghi được trên macOS khi chạy
  `pnpm dev`). Image Docker vẫn đặt `MTL_DATA_DIR=/data`, nên bản self-host không đổi gì.
- `app.ts` luôn mount `/files`; `jobs/runner.ts` luôn chạy `export-cleanup` mỗi giờ.
- Sửa comment ở health, chapters, pages, export, chapter-removal, claim-inputs, files.
- Gỡ `@aws-sdk/*` khỏi `apps/api/package.json`, `pnpm install` (lockfile bớt 335 dòng) và bỏ danh sách
  `minimumReleaseAgeExclude` toàn `@aws-sdk` trong `pnpm-workspace.yaml`.
- `packages/shared/src/worker-protocol.ts`: `Url` nhận cả URL tuyệt đối lẫn `/files/…`. Đã chạy lại `pnpm schema:emit`
  (9 file JSON schema, mỗi file thêm `anyOf`). Dữ liệu trên dây không đổi: self-host vốn đã gửi link tương đối. Validator
  của worker không kiểm `format`, nên worker cũ vẫn chạy được. `job.ts` chỉ sửa comment.

**Test**
- Xoá `storage-presign.test.ts` (chỉ cho S3). Viết lại `unit/env-storage.test.ts`, kiểm mặc định `FILES_DIR` và quy tắc
  bắt buộc ở production.
- Test API dùng thư mục file tạm (`test/files-dir.ts`, global-setup xoá sạch mỗi lượt) và helper `fetchFile` gọi
  `/files` qua app. Assertion kiểu S3 (`X-Amz-*`, `https://`, tag object) đổi sang kiểm tra link `/files`.
- `vitest.unit.config.ts` bỏ `STORAGE_DRIVER`.
- `packages/db/test/remove-global-glossary-migration.test.ts` giờ chỉ migrate tới 0031: file down gỡ dòng migration mới
  nhất, nên khi có 0032 thì thứ tự sẽ sai.

**Infra**
- Compose dev và prod chỉ còn `postgres`. `infra:up` chỉ còn Postgres.
- Xoá `infra/minio-setup.sh`, `infra/files-proxy/`, `infra/minio/lifecycle.json`. Chuyển
  `infra/minio/offsite-lifecycle.json` thành `infra/offsite-lifecycle.json`.
- Caddyfile: bỏ block `FILES_DOMAIN`, thêm `/files/*` vào các đường dẫn chuyển về API.
- `backup.sh` dùng `mc mirror` cho thư mục `FILES_DIR` (bỏ `.tmp/`) lên bucket S3 offsite (`BACKUP_S3_*` giữ nguyên).
- `restore.sh` mirror về `RESTORE_FILES_DIR` và kiểm bằng `[ -f ]`.
- `deploy.sh` đọc `FILES_DIR` trong `shared/.env` rồi `mkdir -p` (thiếu biến thì dừng).
- `mtl-api.service` và `mtl-jobs.service` thêm `ReadWritePaths=/srv/mtl/shared/files`; `mtl-backup.service` sửa mô tả.
- `alert.sh` và `smoke.sh` sửa câu chữ.
- CI: đổi tên bước thành "Start Postgres".
- `.env.example`: bỏ `S3_*` / `FILES_*`, thêm `FILES_DIR=`.
- `.gitignore`: thêm `/.data/` (file này nằm ngoài danh sách sở hữu, nhưng không thuộc web).
- `worker/mtl_worker/client.py`: chỉ sửa comment.

**Docs**: đã sửa `deployment-guide.md` (bảng env có `FILES_DIR`, Caddy, backup/restore, ghi chú migration 0032),
`development-setup.md`, `job-queue-worker.md`, `export-and-batch-edit.md`, `design-guidelines.md` (Cài đặt mở cho mọi
người dùng; người thường chỉ thấy nhóm Chung › Font; AI/Hệ thống chỉ admin; có icon; bỏ "Hạn mức & đăng ký"; `/fonts`
chuyển về `/settings?section=fonts`), `editor.md`, `project-roadmap.md`, `self-host.md`, `README.md`. Không đụng
`docs/journals/*`.

## 2. Hạn mức chỉ từ env

- `lib/system-settings.ts`: `effectiveLimits()` (đồng bộ) chỉ đọc `USER_DAILY_USD`, `GLOBAL_DAILY_USD`,
  `SIGNUP_ENABLED`. `isSignupOpen()` và `userDailyLimitSql()` (tham số SQL từ env) đi theo. Bỏ `storedLimits`,
  `resolveLimits`, `saveLimits`.
- `routes/admin-settings.ts`: `GET /api/admin/settings` chỉ trả `{pipeline, slots}`; bỏ `PUT /settings/limits`.
- Bỏ `todaySpend`, `llmJobsOverUserLimit`, `activeLlmJobs` vì chỉ route đó dùng. `quotaFailMessage()` thành hàm đồng bộ.
- Cập nhật nơi gọi: `auth.ts` (signup), `/healthz.signup` (luôn `open|closed`, không phụ thuộc DB), `billing/budget.ts`
  (kill-switch), `user-quota.ts`, `jobs/queue.ts`. `proofread-estimate` và `llm-refs` chỉ đọc slot, không đổi.
- Migration `0032_drop_system_settings_limits` bỏ 3 cột; có file down
  `migrations-down/0032_drop_system_settings_limits.down.sql`. Schema drizzle và snapshot đã sinh bằng
  `drizzle-kit generate`. Đã thử up → down → up trên DB nháp: đúng cột, đúng dòng `__drizzle_migrations`.
- **Đã áp lên DB dev** (3 cột đều null trước khi áp; số migration 32 → 33).
- Test: viết lại `admin-limits.test.ts` (GET chỉ có pipeline+slots, PUT 404, hạn mức và `/healthz.signup` theo env).
  `signup.test.ts` chuyển sang env, `user-quota.test.ts` theo chữ ký mới.

## 3. Chuyển dữ liệu dev

- `FILES_DIR` thực tế khi chạy `pnpm dev`: `/Users/jhin1m/Desktop/ducanh-project/manga-web-translate/.data/files`
  (`.env` không đặt `MTL_DATA_DIR`/`FILES_DIR`).
- Chép bằng `mc mirror local/mtl /out` trong container `pgsty/minio` dùng chung mạng `mtl-dev_default`. Alias lấy từ env
  của container minio, không in ra.
- Kết quả: **199.532 file**, khớp `mc ls --recursive`; kích thước khớp 100% (so với `mc stat --json`), 0 thiếu.
- Disk driver đọc Content-Type từ sidecar, nên đã sinh 199.532 file `<key>.meta.json` từ `Content-Type` của MinIO
  (png / webp / jpeg / cbz / zip / octet-stream cho font). Thư mục nặng 1,9 GB trên đĩa vì có nhiều file nhỏ.
- Kiểm thật: API dev đang chạy (tsx watch đã nạp code mới) trả `200 image/png` cho ảnh gốc page của chương dev qua link ký
  `/files`, cả gọi thẳng `:8787` lẫn qua Vite `:5180`. `/healthz` cho `storage: true`.
- Đã `stop` và `rm` 2 container `minio`, `files-proxy`. **Volume `mtl-dev_minio-data` còn giữ.** Lệnh xoá (chạy khi đã yên
  tâm):
  ```bash
  docker volume rm mtl-dev_minio-data
  ```
- Lưu ý: `pnpm infra:up` (lúc kiểm) đã tạo lại container `mtl-dev-postgres-1`. Dữ liệu vẫn còn vì nằm trong volume
  `pg-data`, API dev kết nối lại bình thường.

## 4. `.env` dev (không in giá trị, không sửa)

`.env` vẫn còn `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `FILES_DOMAIN`, `FILES_SCHEME`
(dòng 13–21, kèm comment "MinIO"). Không có `STORAGE_DRIVER`. Các biến này giờ bị bỏ qua, vô hại; nên xoá tay cho gọn.

## 5. Lệnh kiểm và kết quả

| Lệnh | Kết quả |
|---|---|
| `pnpm --filter ./packages/* --filter @mtl/api typecheck` | pass |
| `biome check apps/api packages apps/web/e2e/env.ts package.json` | sạch |
| `pnpm --filter @mtl/api test` (Postgres dev, không MinIO) | 70 file, 755 pass, 1 skip |
| `pnpm --filter @mtl/api test:unit` | 20 file, 206 pass |
| `pnpm --filter @mtl/shared test` | 128 pass |
| `pnpm --filter @mtl/db test` | 10 pass |
| `uv run pytest` (contract schema, job fonts, client file urls, drain) | 38 pass |
| `docker compose … config -q`: dev, prod (`PG_PASSWORD=fake`), `docker-compose.yml` gốc | hợp lệ |
| `caddy adapt` (caddy:2) Caddyfile prod | hợp lệ |
| `bash -n` + shellcheck các script đã sửa | chỉ còn info SC1091 (đã có từ trước) |
| `grep -ril minio . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=plans --exclude-dir=journals` | xem dưới |

Kết quả grep: `.env` (của user, xem mục 4) và 3 file nhị phân trong `worker/.venv` (`cv2/.dylibs/libX11`,
`libunistring`, `librt/base64*.so`). Đây là thư viện bên thứ ba, chuỗi trùng ngẫu nhiên. Trong code, docs, infra và
`apps/web` không còn kết quả nào.

## 6. Việc của agent web (`apps/web/**`)

- `apps/web/e2e/upload-chapter.spec.ts:155-156` vẫn chờ thumbnail `src` khớp `/localhost:9100\/.*\/clean\//`. Giờ link
  là `/files/…/clean/…` nên **spec này sẽ fail**.
- `apps/web/vite.config.ts:6-7`: comment còn nhắc `STORAGE_DRIVER=disk`.
- Tôi có sửa `apps/web/e2e/env.ts` (được phép): bỏ comment CORS MinIO, thêm `FILES_DIR: join(tmpdir(), "mtl-e2e-files")`
  để API e2e không ghi vào `.data/files` của dev.

## Câu hỏi còn mở

- Thay đổi `Url` trong `worker-protocol.ts` nới JSON schema của worker (thêm `anyOf` với `/files/`). Dữ liệu trên dây
  không đổi; nếu muốn giữ nguyên tuyệt đối file schema thì có thể hoàn lại và sửa test bằng cách khác.
