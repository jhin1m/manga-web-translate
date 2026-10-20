# Cook report — Phase 2: monorepo, DB, auth, storage

- Ngày: 2026-10-20 · Branch: `feat/p2-monorepo-db-auth-storage` · Commit: `bbdcc86` (chưa merge)
- Mode: `--auto`, chỉ phase 2; `plan.md` không sửa; phase-02 → `status: completed`.

## Đã làm
| Mảng | Kết quả |
|---|---|
| Monorepo | pnpm 12 workspace, Node 24 (`engines`, `.nvmrc`, CI), TS strict (import có đuôi `.ts`), Biome 2 |
| Infra dev | `infra/docker-compose.dev.yml`: Postgres 17 `:5442`, MinIO `:9200` (nội bộ), Caddy files proxy `:9100` = `FILES_DOMAIN` (thêm `nosniff`), bucket private qua `mc`. `pnpm infra:up` |
| DB | `packages/db`: schema đủ bảng spec + auth (sinh bằng better-auth CLI), FK kép `(workspace_id, id)` chống trỏ chéo tenant, CHECK cho enum, partial unique `jobs_idempotency_active_uq`, migration `0000_init` + down tay `migrations-down/` |
| `scoped(db, ws)` | select/find/byId/insert/update/delete/transaction luôn lọc + ép `workspace_id`; `byId` không thấy → 404 |
| API | Hono: `/api/auth/*` (better-auth), `GET /api/me/workspaces`, `GET /api/w/:ws`, `PATCH /api/w/:ws/settings` (admin), `GET /api/w/:ws/invitations/:id/link` (admin), `POST /api/w/:ws/chapters/:chapterId/uploads` (presigned POST). `requireWorkspace(role)` đọc `:ws` từ path |
| Invite-only | Hook `user.create.before`: cần `x-invitation-id` (pending, còn hạn, đúng email) **+ `x-invitation-token` = HMAC(secret, id)**; `allowUserToCreateOrganization:false`; `scripts/create-workspace.ts` |
| Storage | `presignPost` (content-length-range + Content-Type cố định, TTL ≤ 15'), `presignGet` (≤ 15', export 5'), `head`, `readPrefix`; ký theo `FILES_DOMAIN`, thao tác nội bộ qua `S3_ENDPOINT` |
| Shared | zod `PageState` + hợp đồng layout (NFC bắt buộc, baseline, stroke ra ngoài — ghi trong comment), `JobType/JobPayload/JobResult/ErrorClass`, `prepareInputRev/translateInputRev/idempotencyKey`, `pageId` (uuid v5), storage keys; JSON Schema commit ở `packages/shared/json-schema/` |
| SPA | login, accept-invite (đăng ký/đăng nhập + nhận lời mời), chọn workspace, form mời (owner/admin) |
| Lint rule | `noRestrictedImports` cho `apps/api/src/routes/**`: cấm `../db(.ts)`, `../../db(.ts)`, `postgres`, `drizzle-orm/postgres-js`, `createDb` |
| Docs | `docs/development-setup.md` |

## Kiểm chứng
- `pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm test` ✓ 35/35 (shared 8, db 3, api 24).
- Tenant: (a) quét **mọi** route `/api/w/:ws` từ router thật → 403; (b) route có id tài nguyên bắt buộc có case → 404 + đối chứng; scoped update/delete/insert/FK kép.
- Invite-only: không lời mời / id không token / token giả / token của lời mời khác / sai email / hết hạn → 403; member thấy invitation id nhưng không lấy được link, không đăng ký thay được; user không tạo được workspace.
- Storage (MinIO thật): quá `maxBytes`, sai Content-Type, POST/GET hết hạn, GET không ký → bị từ chối; `nosniff` có trên response.
- Idempotency: trùng key khi job `queued/running/paused_budget` → 23505; khi `failed/succeeded/cancelled` → tạo được.
- JSON Schema: drift test zod ↔ file; Python `jsonschema` Draft 2020-12 `check_schema` + validate mẫu OK.
- Clone sạch → `pnpm i && infra:up && db:migrate && dev` sẵn sàng 7s (store pnpm + image đã cache; máy mới phụ thuộc tốc độ tải).
- Smoke qua Vite proxy: đăng nhập, list workspace, mời (link log), sign-up không mời → 403; `vite build` OK.

## Code review (subagent code-reviewer)
| # | Mức | Phát hiện | Xử lý |
|---|---|---|---|
| 1 | High | Member đọc invitation id (better-auth list-invitations) → đăng ký giả người được mời, chiếm role | **Sửa**: token HMAC riêng trong link, route link chỉ admin; test thêm |
| 2 | Medium | `usage_ledger` unique có `job_id` null → chi phí nền tảng không khử trùng; `job_id SET NULL` khi xoá job | **Hoãn P3/P7** (chủ ledger quyết khoá dedup cho dòng platform); `NULLS NOT DISTINCT` sẽ làm xoá job vỡ unique nên không áp vội |
| 3 | Medium | Thiếu index `jobs.page_id`, `jobs.lease_owner` | **Sửa** |
| 4 | Low | PATCH settings update→insert có thể đua khi thiếu row | Giữ (row tạo bởi hook khi tạo workspace); upsert khi cần |
| 5 | Low | Lint rule chỉ khớp đường dẫn literal | **Sửa** thêm `../../db`; route nên giữ phẳng |
| 6 | Low | `filename` chưa dùng; `locked_by` text không FK | Giữ cho P3/P4 |

## Lệch spec / quyết định
- Node 24 thay 22 (user cho phép).
- Image MinIO: `pgsty/minio:RELEASE.2026-08-04…` (MinIO ngừng phát hành image chính thức trên Docker Hub; tag cũ pull bị từ chối).
- MinIO tự gửi `nosniff`; Caddy dùng `header >…` để không nhân đôi.
- Lời mời: thêm token HMAC (ngoài spec, để vá #1). Link mời: UI owner/admin + log API.
- `docs/typeset-layout-contract.md` (P1) chưa có ở branch này → hợp đồng layout ghi theo mô tả trong phase-01; cần đối chiếu khi merge P1.
- P1/P7 (libraqm, ONNX, ntfy, Modal…) không thuộc phase này — không đụng.

## Sự cố
- Trong smoke test tôi chạy `pkill -f vite`, có thể đã tắt một dev server Vite **khác** đang nghe cổng 5173 (không thuộc repo này). Cần bật lại tay nếu đang dùng.

## Câu hỏi mở
1. Khử trùng `usage_ledger` cho chi phí nền tảng (`job_id` null) — quyết ở P3/P7.
2. Có cần gửi mail lời mời thật trước P7 không (hiện log + UI)?
3. Khi merge P1: đối chiếu `PageState`/`OcrResult` với `worker/mtl_pipeline/schema.py`.
