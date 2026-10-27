# Development setup

Yêu cầu: Node 24, pnpm 12, Docker (Compose v2).

```bash
pnpm i
cp .env.example .env              # sửa BETTER_AUTH_SECRET nếu muốn
pnpm infra:up                     # Postgres 17 :5442, MinIO :9200 (nội bộ), files proxy :9100, bucket private
pnpm db:migrate
OWNER_PASSWORD='...' pnpm create-user --email you@example.com [--name "Tên"]    # hoặc đăng ký ở /login
pnpm dev                          # API :8787, SPA :5180 (proxy /api → API)
pnpm jobs                         # process nền: reaper, kill-switch ngân sách (dispatcher Modal khi bật)
```

Worker AI (Python, `worker/`) và token worker: xem [job-queue-worker.md](./job-queue-worker.md).

Mở http://localhost:5180 → `/login`. Mỗi người một tài khoản, không có workspace / lời mời / vai trò. `.env.example` đặt `SIGNUP_ENABLED=true` (kèm `GLOBAL_DAILY_USD=10`, `USER_DAILY_USD=1` — bật đăng ký thì API **không khởi động** nếu thiếu một trong hai, bất kể `NODE_ENV`) nên tab "Đăng ký" ở `/login` dùng được ngay; đăng ký xong web tự đăng nhập (`autoSignIn: false` ở better-auth để email đã có trả cùng phản hồi như email mới, không lộ tài khoản tồn tại). Không đặt / `SIGNUP_ENABLED=false` → đăng ký bị chặn từ trước khi tra email, chỉ `pnpm create-user` (cần `OWNER_PASSWORD` hoặc nhập mật khẩu trên terminal, ≥ 10 ký tự) tạo được tài khoản. Đăng ký có rate limit `/sign-up/email` 5 lần/giờ/IP (bộ nhớ, bật khi mở đăng ký). Production giữ `SIGNUP_ENABLED=false` tới Phase 8 — xem [deployment-guide.md](./deployment-guide.md).

## Reset DB dev

Cần khi DB dev còn dữ liệu workspace từ bản cũ: migration `0015_single_user_guard_worker_kind` báo lỗi nếu còn dòng `organization`, `0016` / `0017` không có đường lùi (file down báo lỗi). Dữ liệu dev bị xoá hết (Postgres + MinIO):

```bash
docker compose -f infra/docker-compose.dev.yml down -v      # -v xoá volume pg-data + minio-data (pnpm infra:down KHÔNG xoá volume)
pnpm infra:up && pnpm db:migrate
OWNER_PASSWORD='...' pnpm create-user --email you@example.com
```

Token worker cũ nằm trong DB nên mất theo: tạo lại bằng `pnpm worker-token create --name mac-$(whoami) --kind mac --out …` ([job-queue-worker.md](./job-queue-worker.md)). Muốn lùi code về bản có workspace thì cũng reset DB + checkout bản cũ.

## Dev auto-login

Đặt trong `.env` (chỉ máy dev, `.env` đã gitignore) tài khoản đã tồn tại (VD tạo bằng `pnpm create-user`):

```bash
DEV_AUTO_LOGIN_EMAIL=you@example.com
DEV_AUTO_LOGIN_PASSWORD=...        # ≥ 10 ký tự
```

Khi chưa có phiên, SPA (chỉ bundle dev, `import.meta.env.DEV`) gọi `POST /api/dev/auto-login` đúng 1 lần/tab rồi vào thẳng app; không bật/thất bại → màn đăng nhập. Bấm "Đăng xuất" → tab đó không tự đăng nhập lại (cờ `sessionStorage`), tab mới thì có. API chỉ mount route khi đủ: `NODE_ENV=development` + 2 biến trên + `BETTER_AUTH_URL` host `localhost`/`127.0.0.1` (log `[dev] auto-login enabled for …` lúc khởi động). `NODE_ENV=production` mà có `DEV_AUTO_LOGIN_EMAIL`/`DEV_AUTO_LOGIN_PASSWORD` → API không khởi động. Bỏ biến = tắt.

Phiên better-auth sống 7 ngày, tự gia hạn khi dùng (tối đa 1 lần/ngày) — cấu hình tường minh ở `apps/api/src/auth.ts`.

## Monorepo

| Thư mục | Vai trò |
|---|---|
| `apps/api` | Hono (Node). Route người dùng `/api/*` (`/api/me`, `/api/settings/pipeline`, series, chương…); better-auth ở `/api/auth/*` |
| `apps/web` | Vite + React SPA |
| `packages/db` | Drizzle schema, migration, `scoped(db, userId)` |
| `packages/shared` | zod: `PageState` (+ hợp đồng layout), `JobType/JobPayload/JobResult/ErrorClass`, giao thức worker, `input_rev`, storage keys; JSON Schema ở `packages/shared/json-schema/` cho worker |
| `worker` | Python: `mtl_pipeline` (pipeline 2 giai đoạn), `mtl_worker` (vòng lặp claim/heartbeat/complete) |
| `infra` | docker-compose dev, Caddy giả lập domain file riêng; production: systemd, Caddy, compose prod, deploy/backup/restore/alert — xem [deployment-guide.md](./deployment-guide.md) |

## Quy ước bắt buộc

- **Người dùng từ phiên, không từ URL / header**: `requireUser` (`apps/api/src/middleware/user.ts`) gắn một lần vào router người dùng ở `/api` sau `/api/auth/*` và `/api/dev/*` → mọi route người dùng trả 401 khi chưa đăng nhập. Mọi bảng dữ liệu có `user_id` (FK `user`, FK ghép `(user_id, id)` cho bảng con); storage key có tiền tố `u/{userId}/`.
- **Không dùng `db` thô trong `apps/api/src/routes/**`** (Biome `noRestrictedImports` chặn). Dùng `c.get("sdb")` — mọi truy vấn, kể cả theo id, tự lọc `user_id`; `byId` không thấy → 404.
- **Route mới có id tài nguyên** phải thêm case vào `RESOURCE_CASES` trong `apps/api/test/tenant-isolation.test.ts`: test tự quét route từ router thật, và meta-test fail nếu route có `:param` thiếu case "user khác → 404".
- **Đăng ký**: `disableSignUp: !SIGNUP_ENABLED` ở `apps/api/src/auth.ts` (không có cổng lời mời / header đặc biệt). Tài khoản tạo khi đăng ký tắt: `pnpm create-user`.
- **Hạn mức chi phí mỗi người**: `USER_DAILY_USD` (`apps/api/src/billing/user-quota.ts`) — xem [job-queue-worker.md](./job-queue-worker.md#hạn-mức-mỗi-người-user_daily_usd).
- **Storage**: key bất biến có revision (`packages/shared/src/storage-keys.ts`); trình duyệt chỉ nhận presigned URL ký theo `FILES_DOMAIN`; POST giới hạn `content-length-range` + Content-Type cố định; GET ≤ 15', export ≤ 5'.
- **Đổi schema zod** → `pnpm schema:emit` và commit `packages/shared/json-schema/` (test chặn lệch).
- **Đổi schema DB** → `pnpm db:generate` (migration chỉ thêm) + viết down tay ở `packages/db/migrations-down/`. Bảng auth sinh bằng `pnpm auth:generate`, không sửa tay.

## Test

`pnpm test` cần `pnpm infra:up`. Mỗi package **và mỗi checkout** dùng DB riêng `<TEST_DATABASE_URL>_<pkg>_<8 hex sha1 của đường dẫn checkout>` (`packages/db/src/testing.ts`), được xoá + migrate lại từ đầu mỗi lần chạy → các git worktree chạy `pnpm test` song song được. DB cũ `mtl_test_api` / `mtl_test_db` (không hậu tố) không còn dùng, có thể `DROP`.

E2E web (Playwright, Chromium): `pnpm --filter @mtl/web e2e` — tự reset DB `mtl_test_e2e`, seed tài khoản/series/token worker, bật API :8797 + Vite :5181 (cổng riêng → chạy song song được với `pnpm dev` 5180/8787; đổi qua `E2E_WEB_PORT`/`E2E_API_PORT`, origin SPA phải nằm trong `MINIO_API_CORS_ALLOW_ORIGIN` của `infra/docker-compose.dev.yml` = 5180 + 5181; sau khi đổi CORS: `docker compose -f infra/docker-compose.dev.yml up -d --wait minio files-proxy` để tạo lại container), upload ZIP 10 trang qua UI (thả vào home → upload xong bấm "Bước 1" → "Bước 2 · Dịch" → sửa → xuất); worker giả lập (`apps/web/e2e/fake-worker.ts`, chỉ dùng trong test) gọi đúng giao thức `/worker/v1`. Lần đầu: `pnpm --filter @mtl/web exec playwright install chromium`.

- API e2e bật dev auto-login cho tài khoản seed (`E2E_OWNER` trong `apps/web/e2e/env.ts`) và `SIGNUP_ENABLED=true` (spec `signup`); viewport 1920×1080 (`playwright.config.ts`, màn ≥ 24": rail công cụ + panel 560px + canvas + cột thumbnail vẫn đủ chỗ).
- Helper `apps/web/e2e/helpers.ts`: `login()` = mở `/` (auto-login), `loginWithForm()` = đăng nhập qua `/login`;
  màn chương: `openPanel(page, "select" | "text" | "table" | "find")` (mở panel qua rail, đang mở thì giữ), `openFind()`,
  `railButton()`, `pageThumbs()` / `pageThumb(page, n)` (thumbnail theo tên truy cập "Trang n · trạng thái").
- Spec: `full-flow` (thả strip ở home → dịch → sửa → xuất), `click-budget` (số thao tác từ home tới editor; thả ảnh = 1 thao tác tới khi chương đang dịch), `routes` (cây route một người dùng; path cũ `/w/...` không còn, không redirect), `upload-chapter`, `editor`, `chapter-tools`, `series-manage`, `glossary-language-pair` (glossary chung theo cặp + cảnh báo đổi ngôn ngữ series), `typeset-parity`, `fonts` (font của bạn), `signup` (đăng ký → home rỗng → tạo series; đăng ký lại cùng email không lộ gì), `pipeline-settings` (Cài đặt chung → Pipeline lưu/tải lại/về mặc định), `proofread` (AI hiệu đính: chạy → Nhận → hoàn tác → Bỏ).
- DB e2e `mtl_test_e2e` **dùng chung mọi checkout** và cổng cố định (5181/8797) → không chạy e2e từ 2 worktree cùng lúc. Gate parity Konva ↔ render.py:
`pnpm --filter @mtl/web e2e typeset-parity` (CI chạy riêng spec này).

## Web (`apps/web`)

- Router: `src/app/router.tsx` (TanStack Router, params type-safe); component ở `src/features/*` nhận params qua props. Cây route:
  - `/` = **Home**: vùng thả file lớn (thả là tạo chương + dịch; dòng xác nhận "Sau khi thả file" chỉ khi không đoán được series hoặc file lỗi), hàng series.
  - `/s/$seriesId[?tab=chapters|glossary|settings]` = **Series** (hàng chương + thả file cho chương kế).
  - `/s/$seriesId/c/$chapterId[?page=<pageId>][&drawer=export]` = **Chương** (editor gộp, toàn màn hình ngoài app shell — xem [editor.md](./editor.md)).
  - `/glossary[?src=&tgt=]` (glossary chung theo cặp nguồn→đích, mặc định ko→vi), `/settings[?tab=pipeline]` (Cài đặt chung: Font / Pipeline, kèm dòng "Hạn mức AI hôm nay" khi đặt `USER_DAILY_USD`), `/login` (Đăng nhập + Đăng ký trên một trang; ngoài app shell).
  - Không có id tài khoản trên URL. Path cũ `/w/$ws/...`, `/workspaces`, `/accept-invite`, trang Thành viên đã bỏ hẳn (không redirect).
- App shell: `src/app/app-shell.tsx` (brand → `/`, menu tài khoản: email / Glossary chung / Cài đặt chung / Đăng xuất).
- Dữ liệu: TanStack Query; tiến độ chương poll `/progress` 2,5s cho tới khi chương ổn định (draft/review/partial_failed/done).
- Gemini free-tier hết hạn mức ngày → worker báo `rate_limited` (429): job trang tự thử lại với backoff tới 16 phút (≤ 20 lần, ~4 giờ) rồi mới hỏng; màn chương báo "tự thử lại lúc …". Muốn dừng sớm: "Huỷ xử lý" ở thanh trên; hết hạn mức xong → "Chạy lại trang lỗi".
- Upload (`features/upload/`): ảnh/ZIP giải nén trong Web Worker, file xếp theo tên (natural sort, không sắp tay) → presigned POST từng file (song song 4, thử lại 3 lần, ký lại khi thử lại) → `POST /chapters/:id/commit` (server kiểm HEAD + magic bytes). `upload-manager` chạy ngoài cây route nên upload tiếp tục khi chuyển màn. Thả file ở home/series: xác định series theo thứ tự series cố định (màn series) → tên file khớp series có sẵn → series của chương gần nhất → series duy nhất (`features/home/drop-to-translate.ts`); có series → tạo chương ngay (số đoán từ tên file nếu chưa trùng, không thì số kế tiếp; mỗi ZIP 1 chương, ảnh lẻ gom 1 chương), mở chương đầu; upload xong **không tự chạy** — chương ở lại nháp tới khi bấm "Bước 1". Không xác định được series (chưa có series, hoặc nhiều series mà chưa có chương nào) hoặc file lỗi → dòng xác nhận cũ. Bước 1 = commit → `chapter.ingest` + `page.prepare` mọi page, xong dừng ở `prepared` ("Chờ dịch"); Bước 2 = `POST /chapters/:id/translate-prepared` → `chapter.translate`. Sai series/số → sửa ở tên chương trên thanh trên (`PATCH /chapters/:id` `{ number?, series_id? }`, trùng số trong series → 409 `chapter_number_taken`). Chương chưa có page (nháp / đang cắt trang / cắt lỗi) hiện ảnh gốc xem trước: Blob local nếu upload trong tab này, không thì URL ký từ `GET /chapters/:id/source-files`.
- Xoá: `DELETE /chapters/:id` và `DELETE /series/:id` — huỷ job đang chạy, xoá hàng DB (FK cascade), rồi dọn object MinIO `u/{userId}/ch/{id}/` + `u/{userId}/pg/{page}/` (lỗi dọn chỉ để lại file mồ côi, có log). Chương đang mở ở tab khác (kể cả tab khác của cùng tài khoản) → 423 `chapter_locked` (`apps/api/src/lib/chapter-removal.ts`).
- Khoá chương: hook `useChapterLock` (`src/features/chapter/use-chapter-lock.ts`), chỉ giữ khi chương ổn định; web gửi header `x-tab-id` (uuid trong `sessionStorage`, `src/lib/api.ts`) ở mọi request nên khoá theo từng tab — xem [editor.md](./editor.md).
- Màn chương: xuất (drawer), tìm & thay, áp glossary (panel Tìm của rail công cụ) — xem [export-and-batch-edit.md](./export-and-batch-edit.md).
- Màn chương tải lazy (chunk riêng chứa Konva) — home/series không kéo theo Konva.
- Giao diện: [design-guidelines.md](./design-guidelines.md).
