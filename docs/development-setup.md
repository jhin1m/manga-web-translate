# Development setup

Yêu cầu: Node 24, pnpm 12, Docker (Compose v2).

```bash
pnpm i
cp .env.example .env              # sửa BETTER_AUTH_SECRET nếu muốn
pnpm infra:up                     # Postgres 17 :5442, MinIO :9200 (nội bộ), files proxy :9100, bucket private
pnpm db:migrate
OWNER_PASSWORD='...' pnpm create-workspace --name "Nhóm dịch" --slug nhom-dich --owner-email you@example.com
pnpm dev                          # API :8787, SPA :5180 (proxy /api → API)
pnpm jobs                         # process nền: reaper, kill-switch ngân sách (dispatcher Modal khi bật)
```

Worker AI (Python, `worker/`) và token worker: xem [job-queue-worker.md](./job-queue-worker.md).

Mở http://localhost:5180 → đăng nhập owner → "Mời thành viên". MVP chưa gửi mail: link mời (có token đăng ký HMAC) hiện trên UI cho owner/admin và trong log API (`[invite] …`). Người được mời mở `/accept-invite?id=…&token=…` để đăng ký.

## Dev auto-login

Đặt trong `.env` (chỉ máy dev, `.env` đã gitignore) tài khoản đã tồn tại (VD owner tạo bằng `pnpm create-workspace`):

```bash
DEV_AUTO_LOGIN_EMAIL=you@example.com
DEV_AUTO_LOGIN_PASSWORD=...        # ≥ 10 ký tự
```

Khi chưa có phiên, SPA (chỉ bundle dev, `import.meta.env.DEV`) gọi `POST /api/dev/auto-login` đúng 1 lần/tab rồi vào thẳng app; không bật/thất bại → màn đăng nhập. Bấm "Đăng xuất" → tab đó không tự đăng nhập lại (cờ `sessionStorage`), tab mới thì có. API chỉ mount route khi đủ: `NODE_ENV=development` + 2 biến trên + `BETTER_AUTH_URL` host `localhost`/`127.0.0.1` (log `[dev] auto-login enabled for …` lúc khởi động). `NODE_ENV=production` mà có `DEV_AUTO_LOGIN_EMAIL`/`DEV_AUTO_LOGIN_PASSWORD` → API không khởi động. Bỏ biến = tắt.

Phiên better-auth sống 7 ngày, tự gia hạn khi dùng (tối đa 1 lần/ngày) — cấu hình tường minh ở `apps/api/src/auth.ts`.

## Monorepo

| Thư mục | Vai trò |
|---|---|
| `apps/api` | Hono (Node). Route người dùng `/api/me/*`, `/api/w/:ws/*`; better-auth ở `/api/auth/*` |
| `apps/web` | Vite + React SPA |
| `packages/db` | Drizzle schema, migration, `scoped(db, wsId)` |
| `packages/shared` | zod: `PageState` (+ hợp đồng layout), `JobType/JobPayload/JobResult/ErrorClass`, giao thức worker, `input_rev`, storage keys; JSON Schema ở `packages/shared/json-schema/` cho worker |
| `worker` | Python: `mtl_pipeline` (pipeline 2 giai đoạn), `mtl_worker` (vòng lặp claim/heartbeat/complete) |
| `infra` | docker-compose dev, Caddy giả lập domain file riêng; production: systemd, Caddy, compose prod, deploy/backup/restore/alert — xem [deployment-guide.md](./deployment-guide.md) |

## Quy ước bắt buộc

- **Workspace trên URL**: route người dùng là `/api/w/:ws/...` với `requireWorkspace(role)`; không đọc workspace từ header.
- **Không dùng `db` thô trong `apps/api/src/routes/**`** (Biome `noRestrictedImports` chặn). Dùng `c.get("sdb")` — mọi truy vấn, kể cả theo id, tự lọc `workspace_id`; `byId` không thấy → 404.
- **Route mới dưới `/api/w/:ws`** tự được test (a) "ws của B → 403" quét; route có id tài nguyên phải thêm case vào `RESOURCE_CASES` trong `apps/api/test/tenant-isolation.test.ts` (test (b) fail nếu thiếu).
- **Đăng ký chỉ qua lời mời**: hook server yêu cầu header `x-invitation-id` (lời mời pending, còn hạn, đúng email) + `x-invitation-token` = HMAC(secret, id). Member thấy được invitation id qua better-auth nhưng không có token; link lấy qua `GET /api/w/:ws/invitations/:id/link` (admin). Workspace chỉ tạo bằng `pnpm create-workspace`.
- **Storage**: key bất biến có revision (`packages/shared/src/storage-keys.ts`); trình duyệt chỉ nhận presigned URL ký theo `FILES_DOMAIN`; POST giới hạn `content-length-range` + Content-Type cố định; GET ≤ 15', export ≤ 5'.
- **Đổi schema zod** → `pnpm schema:emit` và commit `packages/shared/json-schema/` (test chặn lệch).
- **Đổi schema DB** → `pnpm db:generate` (migration chỉ thêm) + viết down tay ở `packages/db/migrations-down/`. Bảng auth sinh bằng `pnpm auth:generate`, không sửa tay.

## Test

`pnpm test` cần `pnpm infra:up`. Mỗi package **và mỗi checkout** dùng DB riêng `<TEST_DATABASE_URL>_<pkg>_<8 hex sha1 của đường dẫn checkout>` (`packages/db/src/testing.ts`), được xoá + migrate lại từ đầu mỗi lần chạy → các git worktree chạy `pnpm test` song song được. DB cũ `mtl_test_api` / `mtl_test_db` (không hậu tố) không còn dùng, có thể `DROP`.

E2E web (Playwright, Chromium): `pnpm --filter @mtl/web e2e` — tự reset DB `mtl_test_e2e`, seed workspace/series/token worker, bật API :8797 + Vite :5181 (cổng riêng → chạy song song được với `pnpm dev` 5180/8787; đổi qua `E2E_WEB_PORT`/`E2E_API_PORT`, origin SPA phải nằm trong `MINIO_API_CORS_ALLOW_ORIGIN` của `infra/docker-compose.dev.yml` = 5180 + 5181; sau khi đổi CORS: `docker compose -f infra/docker-compose.dev.yml up -d --wait minio files-proxy` để tạo lại container), upload ZIP 10 trang qua UI (thả vào home → "Dịch chương" → sửa → xuất); worker giả lập (`apps/web/e2e/fake-worker.ts`, chỉ dùng trong test) gọi đúng giao thức `/worker/v1`. Lần đầu: `pnpm --filter @mtl/web exec playwright install chromium`.

- API e2e bật dev auto-login cho owner seed (`E2E_OWNER` trong `apps/web/e2e/env.ts`); viewport 1920×1080 (`playwright.config.ts`, để bố cục mặc định của màn chương hiện đủ 4 vùng).
- Helper `apps/web/e2e/helpers.ts`: `login()` = mở `/` (auto-login), `loginWithForm()` = đăng nhập qua `/login`.
- Spec: `full-flow` (thả strip ở home → dịch → sửa → xuất), `click-budget` (số thao tác từ home tới editor), `routes-redirect` (URL cũ → mới), `upload-chapter`, `editor`, `chapter-tools`, `typeset-parity`.
- DB e2e `mtl_test_e2e` **dùng chung mọi checkout** và cổng cố định (5181/8797) → không chạy e2e từ 2 worktree cùng lúc. Gate parity Konva ↔ render.py:
`pnpm --filter @mtl/web e2e typeset-parity` (CI chạy riêng spec này).

## Web (`apps/web`)

- Router: `src/app/router.tsx` (TanStack Router, params type-safe); component ở `src/features/*` nhận params qua props. Cây route:
  - `/` = **Home** của workspace hiện tại (`src/lib/current-workspace.ts`: localStorage `mtl.ws` nếu còn là thành viên → workspace duy nhất → `/workspaces` để chọn): vùng thả file lớn, dòng xác nhận "Sau khi thả file", "Việc cần làm" (chương chưa xong của workspace), hàng series.
  - `/w/$ws/s/$seriesId[?tab=chapters|glossary|settings]` = **Series** (hàng chương + thả file cho chương kế).
  - `/w/$ws/s/$seriesId/c/$chapterId[?page=<pageId>][&drawer=export]` = **Chương** (editor gộp, toàn màn hình ngoài app shell — xem [editor.md](./editor.md)).
  - `/w/$ws/glossary`, `/w/$ws/members`, `/workspaces`.
  - Mọi path cũ redirect: `/w/$ws[/series[/$s[/settings]]]`, `.../series/$s/upload` (→ series), `.../chapters/$c` (→ chương), `.../chapters/$c/edit/$pageId` (→ chương `?page=`).
- App shell: `src/app/app-shell.tsx` (brand → `/`, đổi workspace khi > 1, menu tài khoản: Glossary chung / Thành viên / Đăng xuất).
- Dữ liệu: TanStack Query; tiến độ chương poll `/progress` 2,5s cho tới khi chương ổn định (draft/review/partial_failed/done).
- Upload (`features/upload/`): ảnh/ZIP giải nén trong Web Worker, file xếp theo tên (natural sort, không sắp tay) → presigned POST từng file (song song 4, thử lại 3 lần, ký lại khi thử lại) → `POST /chapters/:id/commit` (server kiểm HEAD + magic bytes). `upload-manager` chạy ngoài cây route nên upload tiếp tục khi chuyển màn. Upload xong **không** tự dịch: bấm "Dịch chương" (= commit). Chương chưa có page (nháp / đang cắt trang / cắt lỗi) hiện ảnh gốc xem trước: Blob local nếu upload trong tab này, không thì URL ký từ `GET /chapters/:id/source-files`.
- Khoá chương: hook `useChapterLock` (`src/features/chapter/use-chapter-lock.ts`), chỉ giữ khi chương ổn định — xem [editor.md](./editor.md).
- Màn chương: xuất (drawer), tìm & thay, áp glossary (tab bảng dưới) — xem [export-and-batch-edit.md](./export-and-batch-edit.md).
- Màn chương tải lazy (chunk riêng chứa Konva) — home/series không kéo theo Konva.
- Giao diện: [design-guidelines.md](./design-guidelines.md).
