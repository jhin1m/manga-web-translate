# Scout — gỡ workspace (API + web), 24/10/2026

## Backend
- `middleware/workspace.ts:30-55` `requireWorkspace(minRole)`: `:ws` uuid → member row → set `workspaceId`, `role`,
  `sdb`. Role gate admin chỉ 7 chỗ: `workspaces.ts:39,51,60`, `fonts.ts:67,76,141`, `series.ts:351`. ~70 route khác member.
- Route đều qua `scoped()`; không SQL thô `workspace_id` trong route. `worker.ts` chỉ dùng token.
- Ngân sách toàn cục (`billing/budget.ts`), ledger `workspace_id` null = chi phí nền tảng (`ledger.ts:99-116`).
- Worker mode theo workspace: `queue.ts:55` (kind = token có workspace ? mac : modal), `queue.ts:103-111` join
  `workspace_settings`, `dispatcher.ts:67-73`. `/sessions/end` chặn token workspace (`dispatcher.test.ts:204-215`).
- Storage `ws/{ws}/…`: `shared/src/storage-keys.ts:7-20`, `claim-inputs.ts:160,220,289-301`, `chapter-removal.ts:64`,
  `series.ts:359`, `fonts.ts:80`, `page-state.ts:214`, `enqueue.ts:348`, `export.ts`.
- Khoá chương `lib/chapter-lock.ts` holder = userId (cùng user nhiều tab dùng chung khoá) → chỉ còn vai trò chặn AI
  ghi đè khi đang sửa. `lib/member-names.ts` → `holder_name` (chapters, series-ignore-apply, chapter-removal).
- Lời mời: `auth.ts:45-104`, `lib/invite-{email,token,mail-status}.ts`, `lib/workspace-admin.ts`; mailer chỉ dùng cho mời.
- Scripts: `create-workspace.ts`, `worker-token.ts` (`--workspace|--platform`), `budget-resume.ts` (không đổi).
- Test: `helpers.ts:44 seedWorkspace` dùng ở 27 file; `worker-helpers.ts:29 workerToken`, `:195 setWorkerMode`.
  Xoá: `invite-only-auth`, `invite-email`. Viết lại: `tenant-isolation`. Bỏ ca 2-user: `chapters.test.ts:243-270,
  355-360,442-447,945-969`, `pipeline-settings.test.ts:59-74`, `fonts-upload.test.ts:190-194`. Giữ `ai-write-rules`.
- Worker Python: chỉ 4 docstring nhắc workspace.

## Web
- `app/router.tsx`: home 84-86, picker 90-93, `w/$ws` 95-111, series 118-127, chapter 133-163, glossary 165-189,
  members 191, settings 193-203, legacy redirect 206-250.
- `lib/api.ts:5` `organizationClient()`, `:8-9` header lời mời, `:41` `wsPath`, `:43-47` WorkspaceDetail.
  `lib/current-workspace.ts` (+test) xoá.
- 42 file dùng `ws` (chapter 13, editor 5, series 6, glossary 3, home 3, upload 3, fonts 2, app 2, lib 2, routes 2,
  pipeline 1); 10 gọi `wsPath`.
- Role gate: `router.tsx:125-126`, `home-page.tsx:71-72`, `series-page.tsx:50-51,75,78`,
  `series-settings-form.tsx:4,293,301`, `font-settings.tsx:31,44-50,88,96,140`, `pipeline-settings.tsx:5,74-75,107,109,267`.
- Khoá UI: `use-chapter-lock.ts:18,47-48`, `lock-banner.tsx:9-10`, `chapter-topbar.tsx:184-268`,
  `chapter-workspace.tsx:579,666-671,694,780-784`, `select-panel.tsx:61`, `proofread-panel.tsx:96,110`,
  `text-utils.ts:37-39`, `use-chapter-session.ts:383-422`, `series-page.tsx:314`, `home-page.tsx:239`,
  `ignore-apply-model.ts:4-7`, `series/api.ts:39,63,100-103`, `chapter/api.ts:24`.
- Chữ: `app-shell.tsx:44,46,77,127-133`, `workspaces.tsx` toàn file, `workspace-settings.tsx:14,16`,
  `pipeline-settings.tsx:2,105,107`, `font-settings.tsx:44-45`, `series-settings-form.tsx:293,329`,
  `Properties.tsx:63`, `login.tsx:49`, `accept-invite.tsx`. Giữ: "Tên nhóm dịch" (`series-settings-form.tsx:240`).
- `login.tsx` chỉ đăng nhập; đăng ký hiện chỉ ở `accept-invite.tsx:31-39`.
- E2E: `env.ts:19-34`, `seed.ts:16-25` (`createWorkspace`), `helpers.ts:7-40`; 12 spec dùng `/w/${ws}`; không spec
  nào đăng nhập user thứ 2 (423 holder chỉ mock ở `editor.spec.ts:321-345`).
- Docs: README 3,27,35,119,132,157; development-setup 10,17,45-48,70-79; deployment-guide 1,54,78,107,129,214-216,
  229,244; editor 3,75,106,116; design-guidelines 102,106; job-queue-worker 14-15,169; export-and-batch-edit 98.
