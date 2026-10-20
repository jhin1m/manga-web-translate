---
phase: 2
title: "Scaffold monorepo, DB schema, auth+workspace, storage"
status: completed
priority: P1
effort: "4d"
dependencies: []
---
# Phase 2: Scaffold monorepo, DB schema, auth + workspace, storage

## Overview
Dựng nền TypeScript: pnpm monorepo, Postgres + Drizzle với schema multi-tenant, better-auth (organization plugin = workspace, **đăng ký chỉ qua lời mời**), MinIO + presigned POST/GET, workspace nằm trên URL + helper `scoped()`. Chạy song song với Phase 1 (không chạm `worker/`).

## Requirements
- Node 22 LTS, pnpm workspaces, TypeScript strict, Biome (lint+format).
- Docker Compose dev: Postgres 17, MinIO. Không Redis.
- Mọi bảng nghiệp vụ có `workspace_id`; mọi truy vấn — **kể cả tra theo id** — đi qua `scoped(db, wsId)`; cấm import `db` thô trong route (lint rule) (red team #13).
- **Workspace trên URL:** mọi route người dùng là `/api/w/:ws/...`; middleware `requireWorkspace(role)` lấy `:ws` từ path, kiểm membership qua session. Không dùng header workspace (red team #13).
- **Đăng ký chỉ qua lời mời:** tắt tự tạo organization (`allowUserToCreateOrganization: false`); sign-up chỉ thành công khi email có invitation còn hạn; workspace đầu tạo bằng `scripts/create-workspace.ts` (red team #8).
- MVP dùng role mặc định better-auth: `owner`/`admin` (quản lý thành viên, token worker) và `member` (mọi việc nội dung). Ma trận role chi tiết → Phase 8 (red team #8).
- Storage private, **MinIO trên domain riêng** (VD `files.<domain>`), header `X-Content-Type-Options: nosniff`; upload người dùng bằng **presigned POST** có `content-length-range` + `Content-Type` cố định; presigned GET TTL ngắn (≤ 15 phút xem ảnh, ≤ 5 phút tải export) (red team #12). R2 không hỗ trợ POST policy → MVP dùng MinIO.
- `git init`, CI GitHub Actions: typecheck, test.

## Architecture
```
apps/web        Vite + React SPA (shell + login + nhận lời mời ở phase này)
apps/api        Hono (Node adapter): /api/w/:ws/* (người dùng), /worker/v1/* (Phase 3)
packages/db     Drizzle schema + migrations + scoped helper
packages/shared zod: PageState (+ hợp đồng layout), TextBox, Region, JobType, JobPayload, JobResult, ErrorClass
                → JSON Schema cho worker
worker/         Python (Phase 1/3)
infra/          docker-compose.dev.yml, systemd (Phase 7)
```
Bảng (Drizzle, `uuid v7` PK trừ chỗ ghi khác, `created_at/updated_at`). `workspace_quotas`, `audit_log` **không** tạo ở đây — Phase 8 tạo khi dùng; `dispatches` do Phase 7 tạo; `runtime_flags` do Phase 3 tạo (red team, gộp kèm):
| Bảng | Cột chính |
|---|---|
| `user`, `session`, `account`, `verification` | do better-auth sinh |
| `organization` (= workspace), `member` (owner/admin/member), `invitation` | do organization plugin sinh |
| `workspace_settings` | workspace_id PK, worker_mode (`mac`\|`modal`) (red team #9) |
| `series` | workspace_id, title, source_lang, target_lang, honorific_policy, pronoun_rules jsonb, style_prompt, default_fonts jsonb, llm_tier, **glossary_rev int, settings_rev int** (red team #3) |
| `chapters` | workspace_id, series_id, number, title, status(`draft`/`ingesting`/`processing`/`review`/`partial_failed`/`done`) (red team #7), ingest_rev int, locked_by, locked_at |
| `source_files` | workspace_id, chapter_id, ord, storage_key, bytes, mime, width, height (slice gốc upload) |
| `pages` | id = uuid v5(chapter_id, ingest_rev, ord) **tất định** (red team #4), workspace_id, chapter_id, ord, width, height, original_key, original_sha256, **clean_rev, mask_rev, next_rev** (red team #2, #6), ocr_result jsonb (artifact giai đoạn 1), prepare_input_rev, source_map jsonb (slice→y-range), cut_flag, status(`pending`/`preparing`/`prepared`/`translating`/`ready`/`failed`) |
| `page_states` | page_id PK, workspace_id, version bigint (**không bao giờ reset**), state jsonb, ai_state jsonb, ai_rev int, state_origin(`ai`\|`user`), ai_update_available bool, updated_by (red team #1) |
| `page_state_history` | workspace_id, page_id, version, state jsonb, actor(`user:<id>`\|`job:<id>`), batch_id null (find/replace, glossary), created_at — giữ 50 bản/page (red team #1) |
| `glossary_entries` | workspace_id, series_id null=toàn workspace, source_term, target_term, note, case_sensitive |
| `jobs` | workspace_id, type, status(`queued`/`running`/`succeeded`/`failed`/`cancelled`/`paused_budget`), priority, payload jsonb, result jsonb, input_rev, idempotency_key, attempts, max_attempts, provider_retries, run_after, lease_owner (= worker_tokens.id), lease_token, lease_expires_at, progress, stage, error_class, error, pipeline_version, chapter_id, page_id, dispatch_id null (red team #2, #3, #7, #14) |
| — index | `UNIQUE (idempotency_key) WHERE status IN ('queued','running','paused_budget')` — chỉ job đang hoạt động (red team #3) |
| `worker_tokens` | name, token_hash, workspace_id null=platform worker, capabilities text[], last_seen_at, revoked_at |
| `usage_ledger` | workspace_id null (= chi phí nền tảng, VD GPU rỗi), job_id, attempt, seq, kind(`pages`/`llm_tokens_in`/`llm_tokens_out`/`gpu_seconds`/`gpu_idle_seconds`/`storage_bytes`), quantity, unit_cost_usd (bảng giá server), cost_usd, created_at — append-only, `UNIQUE (job_id, attempt, seq, kind)` (red team #2, #14) |

Storage key — **bất biến, có revision** (red team #2):
```
ws/{ws}/ch/{ch}/src/{uploadId}.{ext}           slice gốc upload
ws/{ws}/ch/{ch}/ingest/{ingest_rev}/{ord}.png  ảnh page logic sau ingest
ws/{ws}/pg/{page}/clean/{rev}.png              ảnh đã xoá chữ; pages.clean_rev trỏ tới rev thắng
ws/{ws}/pg/{page}/mask/{rev}.png
ws/{ws}/pg/{page}/user-mask/{uuid}.png         mask người vẽ (Phase 5)
ws/{ws}/ch/{ch}/export/{jobId}.{zip|cbz}
```
Không bao giờ ghi đè object; object mồ côi (attempt thua) dọn bằng job GC sau MVP.

`input_rev` (red team #3), định nghĩa ở `packages/shared/src/job.ts`:
- `page.prepare`: `sha256(original_sha256 | series.settings_rev | pipeline_version)`
- `chapter.translate`: `sha256(sorted(page_id:prepare_input_rev) | series.glossary_rev | series.settings_rev | pipeline_version)`
- `idempotency_key = sha256(type | target_id | input_rev | options)`. `glossary_rev` tăng khi sửa glossary của series (sửa entry cấp workspace → tăng mọi series trong workspace, cùng transaction); `settings_rev` tăng khi đổi cài đặt ảnh hưởng dịch/typeset.

## Related Code Files
Create:
- `package.json`, `pnpm-workspace.yaml`, `biome.json`, `tsconfig.base.json`, `.github/workflows/ci.yml`
- `infra/docker-compose.dev.yml`, `.env.example`
- `packages/db/{drizzle.config.ts,src/schema/*.ts,src/scoped.ts,src/index.ts,migrations/}`
- `packages/shared/src/{page-state.ts,job.ts,index.ts}`, `packages/shared/scripts/emit-json-schema.ts`
- `apps/api/src/{index.ts,auth.ts,storage.ts,middleware/workspace.ts,routes/workspaces.ts,routes/uploads.ts}`
- `apps/api/test/tenant-isolation.test.ts`
- `apps/web/{index.html,vite.config.ts,src/main.tsx,src/routes/login.tsx,src/routes/accept-invite.tsx,src/lib/api.ts}`
- `scripts/create-workspace.ts`

## Implementation Steps
1. `git init`, pnpm workspace, Biome, tsconfig, CI (typecheck + test).
2. docker-compose dev (Postgres, MinIO + bucket private bằng `mc`; MinIO ở host/port riêng để mô phỏng domain riêng, policy `nosniff`).
3. better-auth + drizzle adapter + organization plugin; sinh schema bằng CLI; email+password; chặn sign-up không có invitation; tắt tạo organization; `scripts/create-workspace.ts`.
4. Schema nghiệp vụ ở bảng trên; migration đầu tiên (gồm partial unique index idempotency).
5. `scoped(db, wsId)`: query builder luôn `where workspace_id = wsId`, có `byId(table, id)` → không thấy = 404. Middleware `requireWorkspace(role)` đọc `:ws` từ path.
6. `storage.ts`: `presignPost(key, contentType, maxBytes, ttl)`, `presignGet(key, ttl, disposition?)`, `head(key)`, `readPrefix(key, n)` (magic bytes, dùng ở Phase 4).
7. `packages/shared`: zod `PageState` + hợp đồng layout (NFC, baseline, stroke ra ngoài — từ `docs/typeset-layout-contract.md` của Phase 1), `JobType` enum đầy đủ, `JobPayload`/`JobResult`/`ErrorClass`; xuất JSON Schema.
8. Test cô lập tenant: 2 workspace; với **mọi** route: (a) `:ws` của B, người gọi thuộc A → 403; (b) `:ws` của A nhưng id tài nguyên thuộc B → 404 (red team #13).
9. SPA: login, nhận lời mời, chọn workspace; không style cầu kỳ.

## Success Criteria
- [x] `pnpm i && docker compose up && pnpm db:migrate && pnpm dev` chạy từ clone sạch < 5 phút.
- [x] Seed workspace bằng script; mời thành viên (link invite log ở dev) → đăng ký được; đăng ký không lời mời → bị từ chối; user không tạo được workspace mới.
- [x] Test cô lập tenant (cả 2 kiểu a/b) pass cho 100% route đã có.
- [x] Presigned POST: file > `maxBytes` hoặc sai Content-Type → MinIO từ chối; URL hết hạn sau TTL; GET không ký → 403; response có `nosniff`.
- [x] Partial unique index: tạo job trùng key khi job cũ `failed` → được; khi job cũ `queued` → vi phạm unique.
- [x] JSON Schema từ `packages/shared` được commit và worker đọc được.

## Risk Assessment
| Rủi ro | K×A | Giảm thiểu |
|---|---|---|
| Rò dữ liệu giữa workspace (route tra theo id) | TB × Cao | Workspace trên URL, `scoped().byId`, test kiểu (b) cho mọi route; RLS khi mở SaaS (Phase 8) |
| Schema better-auth thay đổi giữa phiên bản | Thấp × TB | Pin version, sinh schema bằng CLI, không sửa tay bảng auth |
| Lệch schema TS ↔ Python | TB × TB | Một nguồn (zod) → JSON Schema → worker validate; test contract ở Phase 3 |
| Upload file độc/khổng lồ | TB × Cao | Presigned POST giới hạn dung lượng + kiểm magic bytes khi commit (Phase 4) + domain riêng + nosniff |
| Lách invite-only qua API better-auth | Thấp × Cao | Hook chặn ở server (không chỉ UI), test sign-up trực tiếp API |

Rollback: greenfield; migration additive, `drizzle-kit drop` trên dev.
