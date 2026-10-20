# Development setup

Yêu cầu: Node 24, pnpm 12, Docker (Compose v2).

```bash
pnpm i
cp .env.example .env              # sửa BETTER_AUTH_SECRET nếu muốn
pnpm infra:up                     # Postgres 17 :5442, MinIO :9200 (nội bộ), files proxy :9100, bucket private
pnpm db:migrate
OWNER_PASSWORD='...' pnpm create-workspace --name "Nhóm dịch" --slug nhom-dich --owner-email you@example.com
pnpm dev                          # API :8787, SPA :5180 (proxy /api → API)
pnpm jobs                         # process nền: reaper lease hết hạn (tách khỏi API)
```

Worker AI (Python, `worker/`) và token worker: xem [job-queue-worker.md](./job-queue-worker.md).

Mở http://localhost:5180 → đăng nhập owner → "Mời thành viên". MVP chưa gửi mail: link mời (có token đăng ký HMAC) hiện trên UI cho owner/admin và trong log API (`[invite] …`). Người được mời mở `/accept-invite?id=…&token=…` để đăng ký.

## Monorepo

| Thư mục | Vai trò |
|---|---|
| `apps/api` | Hono (Node). Route người dùng `/api/me/*`, `/api/w/:ws/*`; better-auth ở `/api/auth/*` |
| `apps/web` | Vite + React SPA |
| `packages/db` | Drizzle schema, migration, `scoped(db, wsId)` |
| `packages/shared` | zod: `PageState` (+ hợp đồng layout), `JobType/JobPayload/JobResult/ErrorClass`, giao thức worker, `input_rev`, storage keys; JSON Schema ở `packages/shared/json-schema/` cho worker |
| `worker` | Python: `mtl_pipeline` (pipeline 2 giai đoạn), `mtl_worker` (vòng lặp claim/heartbeat/complete) |
| `infra` | docker-compose dev, Caddy giả lập domain file riêng |

## Quy ước bắt buộc

- **Workspace trên URL**: route người dùng là `/api/w/:ws/...` với `requireWorkspace(role)`; không đọc workspace từ header.
- **Không dùng `db` thô trong `apps/api/src/routes/**`** (Biome `noRestrictedImports` chặn). Dùng `c.get("sdb")` — mọi truy vấn, kể cả theo id, tự lọc `workspace_id`; `byId` không thấy → 404.
- **Route mới dưới `/api/w/:ws`** tự được test (a) "ws của B → 403" quét; route có id tài nguyên phải thêm case vào `RESOURCE_CASES` trong `apps/api/test/tenant-isolation.test.ts` (test (b) fail nếu thiếu).
- **Đăng ký chỉ qua lời mời**: hook server yêu cầu header `x-invitation-id` (lời mời pending, còn hạn, đúng email) + `x-invitation-token` = HMAC(secret, id). Member thấy được invitation id qua better-auth nhưng không có token; link lấy qua `GET /api/w/:ws/invitations/:id/link` (admin). Workspace chỉ tạo bằng `pnpm create-workspace`.
- **Storage**: key bất biến có revision (`packages/shared/src/storage-keys.ts`); trình duyệt chỉ nhận presigned URL ký theo `FILES_DOMAIN`; POST giới hạn `content-length-range` + Content-Type cố định; GET ≤ 15', export ≤ 5'.
- **Đổi schema zod** → `pnpm schema:emit` và commit `packages/shared/json-schema/` (test chặn lệch).
- **Đổi schema DB** → `pnpm db:generate` (migration chỉ thêm) + viết down tay ở `packages/db/migrations-down/`. Bảng auth sinh bằng `pnpm auth:generate`, không sửa tay.

## Test

`pnpm test` cần `pnpm infra:up`. Mỗi package dùng DB riêng `<TEST_DATABASE_URL>_<pkg>`, được xoá + migrate lại từ đầu mỗi lần chạy.

E2E web (Playwright, Chromium): `pnpm --filter @mtl/web e2e` — tự reset DB `mtl_test_e2e`, seed workspace/series/token worker, bật API :8797 + Vite :5180 (cổng 5180 khớp CORS MinIO dev nên phải trống), upload ZIP 10 trang qua UI; worker giả lập (`apps/web/e2e/fake-worker.ts`, chỉ dùng trong test) gọi đúng giao thức `/worker/v1`. Lần đầu: `pnpm --filter @mtl/web exec playwright install chromium`. Gate parity Konva ↔ render.py:
`pnpm --filter @mtl/web e2e typeset-parity` (CI chạy riêng spec này).

## Web (`apps/web`)

- Router: `src/app/router.tsx` (TanStack Router, params type-safe); component ở `src/features/*` nhận params qua props. Route editor `/w/$ws/series/$seriesId/chapters/$chapterId/edit/$pageId` nằm ngoài layout workspace (toàn màn hình) — xem [editor.md](./editor.md).
- Dữ liệu: TanStack Query; tiến độ chương poll `/progress` 2,5s cho tới khi chương ổn định (draft/review/partial_failed/done).
- Upload: ảnh/ZIP giải nén trong Web Worker → presigned POST từng file (song song 4, thử lại 3 lần, ký lại khi thử lại) → `POST /chapters/:id/commit` (server kiểm HEAD + magic bytes).
- Khoá chương khi mở editor: hook `useChapterLock` (`src/features/chapter/use-chapter-lock.ts`).
- Màn chương: xuất PNG/ZIP/CBZ, tìm & thay, áp glossary — xem [export-and-batch-edit.md](./export-and-batch-edit.md).
- Route editor tải lazy (chunk riêng) — màn danh sách/chương không kéo theo Konva.
- Giao diện: [design-guidelines.md](./design-guidelines.md).
