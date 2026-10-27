---
phase: 1
title: "Data model + API theo user"
status: completed
priority: P1
effort: "2d"
dependencies: []
---

# Phase 1: Data model + API theo user

## Overview
Thay tenant `workspace_id → user_id` ở DB, `scoped()`, storage key, toàn bộ route `/api/w/:ws/*` → `/api/*`; gỡ
organization plugin, role, lời mời; worker token mang `kind` thay vì workspace; khoá chương theo từng tab. Kết thúc
phase: backend chạy được, test API xanh (e2e web tạm đỏ tới phase 3).

## Requirements
- Functional: mọi bảng nghiệp vụ thuộc 1 user; route không có `:ws`; không role; worker nhận job mọi user (D4);
  cài đặt pipeline theo user; khoá chương giữ bởi 1 tab (D6).
- Non-functional: giữ bảo đảm cách ly như cũ (FK kép `(user_id, id)`, `scoped()` ép `user_id`, `byId` khác user →
  404); mọi route `/api/*` (trừ auth/dev/health) bắt buộc đăng nhập; không đổi hợp đồng worker Python.

## Architecture

**DB** (`packages/db/src/schema/app.ts`, `auth.ts`, `scoped.ts`)
- Helper `userId()` = `uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" })` thay
  `workspaceId()`; mọi unique/FK kép/index `*_ws_*` → `*_user_*` trên `(user_id, …)`.
- `workspace_settings` → `user_settings` (`user_id` PK, `pipeline` jsonb); **bỏ `worker_mode`**. Thiếu dòng = mặc
  định (`resolvePipelineSettings({})`), PUT upsert — không cần hook tạo dòng.
- `workspace_fonts` → `user_fonts`; `usage_ledger.user_id` nullable (null = chi phí nền tảng như cũ).
- `worker_tokens`: bỏ `workspace_id`, thêm `kind text not null check in ('mac','modal')`.
- Xoá bảng `organization`, `member`, `invitation`, cột `session.active_organization_id`.
- `scoped.ts`: `WsTable → OwnedTable` (cột `userId`), `scoped(db, userId)`, `Scoped.userId`; logic giữ nguyên.
  (`packages/db/src/testing.ts` không nhắc workspace — không cần sửa.)

<!-- Red Team: drizzle-kit không sinh được snapshot cho rename khi không có TTY — 2026-10-24 -->
**Migration — 3 file sinh bằng `pnpm db:generate`, mỗi file không có cặp drop+add cùng bảng (để drizzle-kit
không hỏi rename, vì không TTY thì nó từ chối):**
1. `0015_single_user_guard_worker_kind`: schema thêm `worker_tokens.kind` (nullable tạm) → generate → nối thêm SQL
   tay vào cuối file: guard `DO $$ BEGIN IF EXISTS (SELECT 1 FROM organization) THEN RAISE EXCEPTION 'reset DB
   trước (docs/development-setup.md)'; END IF; END $$;` **đặt lên đầu file**, rồi
   `UPDATE worker_tokens SET kind = CASE WHEN workspace_id IS NULL THEN 'modal' ELSE 'mac' END;` +
   `ALTER … SET NOT NULL` + check. Snapshot đúng vì cột có trong schema.
2. `0016_drop_workspaces`: schema bỏ `workspace_id` mọi bảng, bảng org/member/invitation/workspace_settings/
   workspace_fonts, `session.active_organization_id` → generate (chỉ drop).
3. `0017_user_ownership`: schema thêm `user_id` + FK/unique/index mới, `user_settings`, `user_fonts` → generate
   (chỉ add, bảng rỗng nên `NOT NULL` không cần default).
- Down (quy ước README:82): `0015.down` bỏ `kind`; `0016.down`/`0017.down` = `RAISE EXCEPTION 'không rollback được
  — reset DB + checkout bản cũ'`.
- Gate: chạy `pnpm db:generate` không TTY sau cùng → "No schema changes"; migrate DB rỗng 0000→0017 OK; DB có
  dòng `organization` → 0015 lỗi rõ ràng, không đổi gì; DB chỉ có token nền tảng → `kind='modal'`.

**Storage** (`packages/shared/src/storage-keys.ts`)
- Prefix `ws/{ws}/` → `u/{userId}/`; `keyBelongsToWorkspace → keyBelongsToUser`. Chỗ ghép tay:
  `lib/chapter-removal.ts:64`, `routes/series.ts:359`, `routes/fonts.ts:80`, `routes/page-state.ts:214`,
  `jobs/enqueue.ts:348`, `jobs/claim-inputs.ts:220`, `routes/export.ts`.

<!-- Red Team: test cách ly mất cơ chế tự tìm route; 86 chỗ gắn middleware riêng — 2026-10-24 -->
**Xác thực + cách ly**
- `middleware/workspace.ts` → `middleware/user.ts` `requireUser()`: session bắt buộc (401), set `userId`, `sdb =
  scoped(db, userId)`. **Gắn 1 lần** trên router người dùng mount ở `/api` sau `/api/auth/*`, `/api/dev/*`, health
  (`app.ts:38-58`) — bỏ 86 chỗ `requireWorkspace(...)` trong `routes/*.ts`. Không role → 7 gate admin biến mất.
- **17 chỗ lọc tenant thủ công ngoài `scoped()` phải đổi sang `user_id` (không được xoá điều kiện):**
  `routes/pages.ts:107`, `routes/series-skip-images.ts:96`, `lib/glossary-scope.ts:16`, `jobs/claim-inputs.ts`
  (4: `:160`, `:289-301`), `jobs/enqueue.ts` (5, vd `:462`), `jobs/queue.ts` (3), `jobs/page-state-writer.ts:24`,
  `jobs/dispatcher.ts:73`. Grep lại `workspaceId` = 0 trước khi chạy test.

**Route**: `/w/:ws/...` → `/...` dưới `/api`. `routes/workspaces.ts` → `routes/me.ts`: `GET /api/me` → `{ id,
email, name, settings: { pipeline } }` (phase 2 thêm `quota`); `PUT /api/settings/pipeline`. Bỏ `GET
/me/workspaces`, `PATCH settings` (worker_mode), link lời mời.

<!-- Red Team: khoá theo userId → đóng 1 tab nhả khoá của tab đang sửa — 2026-10-24 -->
**Khoá chương theo tab (D6)**
- Web gửi header `X-Tab-Id` (uuid trong `sessionStorage`) với mọi request. Holder = `${userId}:${tabId}` (cột
  `locked_by` là text — `schema/app.ts:112`); thiếu header → tabId `default` (script/test).
- `lib/chapter-lock.ts`: acquire/release/assert so holder đầy đủ → chỉ đúng tab mới gia hạn/nhả/ghi; tab khác của
  cùng user nhận 423 `chapter_locked` (giờ là trường hợp thật). `isChapterLocked`/AI writer
  (`page-state-writer.ts:35`) giữ nguyên ngữ nghĩa "có ai đang giữ".
- Bỏ `lib/member-names.ts`, `holder_name`, `lock_holder_is_me`/`is_me` khỏi response; 423 trả `{ error:
  "chapter_locked" }`. Các route gọi lock (pages.ts:92, page-state.ts:151,209, find-replace.ts:169,179,198,
  chapters.ts:141,246,377-388,445-454, series.ts:97, series-ignore-apply.ts:89-168, chapter-removal.ts:40-44) truyền holder.

<!-- Red Team: bỏ sót consumer token worker; dispatcher bật Modal cho mọi job — 2026-10-24 -->
**Worker (D4)** — mọi consumer của `WorkerIdentity.workspaceId` đổi sang `kind`:
- `jobs/queue.ts:55` `workerKind` → `w.kind`; `:98-99` chỉ `kind==='modal'` mới `markDispatchClaimed`;
  `:110-111` bỏ lọc `jobs.workspaceId = token` + join `workspace_settings`/`worker_mode` → token claim mọi job;
  `:207` tính tiền GPU theo `w.kind`.
- `routes/worker.ts:76` `/sessions/end` chỉ `kind='modal'`. `lib/worker-token.ts:3,13-18,38,44,55` đọc/ghi `kind`.
- `scripts/worker-token.ts create --kind mac|modal` (bỏ `--workspace/--platform`, `:19-20,51,56`).
- Dispatcher (`jobs/dispatcher.ts:67-73,129-140`): câu tuổi job chờ lâu nhất trên toàn hàng đợi, **trừ** job LLM
  của user vượt hạn mức (predicate dùng chung với claim — phase 2); nếu có token `kind='mac'` `last_seen_at` trong
  60s → chỉ tính job đã chờ > `MAC_GRACE_S` (60s) để Mac lấy trước, tránh bật Modal rồi để rỗi (tiền GPU rỗi tính
  cho nền tảng + backoff tới 15').
- **Token Mac giờ là credential toàn nền tảng** (claim được job + presigned URL ảnh của mọi user) — ghi docs, chỉ
  cấp cho người vận hành.

**Khác**: `billing/ledger.ts` `workspaceId → userId` (`:116`); `billing/budget.ts` không đổi. Xoá
`lib/invite-email.ts`, `lib/invite-token.ts`, `lib/invite-mail-status.ts`, `lib/workspace-admin.ts` (thay
`lib/create-user.ts`), `lib/mailer.ts` + env SMTP (`env.ts:61-69,85-86`; không còn caller; xác thực email Phase 8
lấy lại từ git), organization plugin + `organizationHooks` trong `auth.ts`. Cổng đăng ký tạm: phase 1 đặt
`emailAndPassword.disableSignUp: true` (phase 2 nối cờ env). `scripts/create-workspace.ts → scripts/create-user.ts`
(`--email --name`, `OWNER_PASSWORD`) qua `lib/create-user.ts` dùng `auth.$context` `internalAdapter.createUser` +
`linkAccount` (không đi đường HTTP sign-up → không bị `disableSignUp` chặn; bỏ `withoutInviteGate`, `auth.ts:24`).

**Worker Python**: chỉ docstring (`mtl_worker/job_fonts.py:3`, `__init__.py:10`, `mtl_pipeline/options.py:1`, `models.py:3`).

## Related Code Files
- Modify: `packages/db/src/schema/{app,auth}.ts`, `packages/db/src/scoped.ts`, `packages/shared/src/storage-keys.ts`,
  `apps/api/src/{app,auth,env}.ts`, `apps/api/src/routes/*.ts`, `apps/api/src/jobs/{queue,dispatcher,enqueue,
  claim-inputs,page-state-writer,runner}.ts`, `apps/api/src/billing/ledger.ts`, `apps/api/src/lib/{chapter-lock,
  chapter-removal,glossary-scope,worker-token}.ts`, `scripts/worker-token.ts`, `package.json`, `apps/api/test/*`,
  `packages/db/test/*`, docstring worker.
- Create: `packages/db/migrations/{0015,0016,0017}_*.sql` + meta + `migrations-down/{0015,0016,0017}*.down.sql`,
  `apps/api/src/middleware/user.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/lib/create-user.ts`, `scripts/create-user.ts`.
- Delete: `apps/api/src/middleware/workspace.ts`, `routes/workspaces.ts`, `lib/{invite-email,invite-token,
  invite-mail-status,workspace-admin,member-names,mailer}.ts`, `scripts/create-workspace.ts`,
  `apps/api/test/{invite-only-auth,invite-email}.test.ts`.

## Implementation Steps
1. Tạo branch `feat/single-user-accounts` từ HEAD hiện tại.
2. Migration 0015 → 0016 → 0017 theo thứ tự trên (mỗi bước sửa schema rồi generate); `scoped.ts`; gate snapshot.
3. Storage keys + `keyBelongsToUser`.
4. `auth.ts` (gỡ plugin, `disableSignUp: true`), `lib/create-user.ts` + script.
5. `requireUser()` mount 1 lần; đổi path route; `routes/me.ts`; 17 chỗ lọc thủ công; bỏ `memberNames`.
6. Khoá theo tab (`X-Tab-Id`).
7. Worker: `kind` ở mọi consumer, dispatcher grace Mac.
8. Test API:
   - `helpers.ts seedWorkspace → seedUser` (27 file); `worker-helpers.ts workerToken(kind)` (13 file, 28 chỗ gọi),
     bỏ `setWorkerMode` (dùng ở `dispatcher`, `budget`, `queue` test).
   <!-- Red Team: claim toàn cục làm test phụ thuộc thứ tự file — 2026-10-24 -->
   - `beforeEach` chung (vitest `setupFiles` hoặc `worker-helpers.ts`) huỷ mọi job chưa kết thúc — DB test dùng
     chung giữa file (`apps/api/vitest.config.ts` `fileParallelism: false`), claim giờ toàn cục.
   - `tenant-isolation.test.ts`: tự tìm route từ router thật với lọc `/api/` trừ `/api/auth`, `/api/dev`, health;
     (a) không session → 401 **mọi** route; (b) giữ meta-test "mọi route có id có ca chéo user" (56 ca, thêm
     `/api/me`, `/api/settings/pipeline`); user B gọi id của user A → 404.
   - Xoá ca role/invite/2-user (`chapters.test.ts:243-270,355-360,442-447,945-969`, `pipeline-settings.test.ts:59-74`,
     `fonts-upload.test.ts:190-194`); thêm ca 2 tab: tab B → 423, tab A đóng không nhả khoá của tab B; giữ
     `ai-write-rules.test.ts`; viết lại `queue.test.ts:101-114` (claim toàn cục), `dispatcher.test.ts` (kind, grace Mac).
9. Docstring worker; gate: `pnpm typecheck && pnpm lint && pnpm --filter @mtl/api --filter @mtl/db --filter
   @mtl/shared test && (cd worker && uv run pytest)`.

## Success Criteria
- [x] `pnpm db:generate` (không TTY) → "No schema changes"; migrate DB rỗng OK; guard + backfill `kind` có test.
- [x] `grep -rn "workspaceId\|workspace_id\|organization\|invitation" apps/api/src packages/*/src scripts` = 0 (trừ
      migration cũ).
- [x] Test cách ly: 401 mọi route không session; 404 chéo user trên đủ 56 ca (thực tế 55 — ca lời mời bỏ; meta-test bắt route có id thiếu ca).
- [x] Gate: typecheck, lint, test api/db/shared, pytest xanh.

## Risk Assessment
- **Phạm vi lớn (~30 file src backend + 27 file test)** → làm theo thứ tự schema → scoped → routes; typecheck dẫn
  đường, grep `workspaceId` = 0 bắt chỗ typecheck không thấy (biến `AppEnv` generic).
- **Xoá nhầm điều kiện lọc tenant** → danh sách 17 chỗ + test 56 ca chéo user.
- **Token Mac rò rỉ = lộ dữ liệu mọi user** → docs + checklist thu hồi token cũ, chỉ cấp cho người vận hành.
- **Đăng ký bị tắt hẳn giữa phase 1 và 2** — chỉ trên branch, không deploy giữa chừng.
