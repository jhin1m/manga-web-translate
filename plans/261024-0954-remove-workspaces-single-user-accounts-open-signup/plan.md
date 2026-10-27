---
title: "Bỏ workspace — mỗi người dùng một tài khoản, mở đăng ký"
description: "Xoá hẳn workspace/nhóm (DB, URL, API, UI); dữ liệu thuộc thẳng user; đăng ký tự do có cờ env + hạn mức USD/ngày mỗi user"
status: completed
priority: P1
effort: "4-5d"
branch: feat/single-user-accounts
tags: [auth, tenancy, migration, billing, web]
created: 2026-10-24
blockedBy: []
blocks: []
---

# Bỏ workspace — mỗi người dùng một tài khoản, mở đăng ký

## Overview

Workspace (better-auth organization) là ranh giới tenant: mọi bảng nghiệp vụ có `workspace_id` + FK kép
`(workspace_id, id)`, route `/api/w/:ws/*`, web `/w/$ws/*`, storage `ws/{ws}/…`, role owner/admin/member,
đăng ký chỉ qua lời mời. Người dùng thực tế dùng 1 người / 1 tài khoản → bỏ hẳn khái niệm nhóm.

Branch mới `feat/single-user-accounts` tách từ HEAD `feat/pipeline-settings-local-ocr-proofread` (`a61e405`,
chưa merge — plan dựa vào code pipeline settings / proofread). Merge branch kia trước, rồi branch này.

Scout: [reports/scout-remove-workspace-report.md](./reports/scout-remove-workspace-report.md)

## Quyết định đã chốt với user (24/10/2026)

| # | Quyết định |
|---|---|
| D1 | **Xoá hẳn** workspace khỏi DB / URL / API / UI (không chỉ ẩn UI) |
| D2 | **Mở đăng ký tự do** (bỏ lời mời, organization plugin, Thành viên, chọn/đổi workspace, role) |
| D3 | **Reset DB dev** — production chưa deploy thật; không migrate dữ liệu cũ; storage prefix mới `u/{userId}/` |
| D4 | **Worker chung toàn hệ thống** — mọi worker (Mac/Modal) nhận job mọi user; bỏ `worker_mode` theo workspace |
| D5 | **Cờ env `SIGNUP_ENABLED` + hạn mức `USER_DAILY_USD` mỗi user** (vượt → 402, không ảnh hưởng user khác) |
| D6 | **Giữ khoá chương** (chống AI ghi đè khi đang sửa), bỏ phần nhóm (tên người giữ khoá, "X đang sửa") |

Chi tiết thực thi chốt sau red team: hạn mức tính mọi chi phí (LLM + GPU), vượt thì job LLM **fail
`quota_exceeded`** (không pause), job không-LLM chỉ chạy trên Mac; đăng ký mặc định tắt; khoá chương theo tab
(`X-Tab-Id`); migration tách 0015/0016/0017.
| D7 | "Cài đặt nhóm" → **"Cài đặt chung"** (giữ tab Font + Pipeline) |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Data model + API theo user](./phase-01-data-model-and-api.md) | Completed |
| 2 | [Đăng ký mở + hạn mức mỗi user](./phase-02-backend-auth-quota.md) | Completed |
| 3 | [Web một người dùng](./phase-03-web-single-user.md) | Completed |
| 4 | [Docs + kiểm tra cuối](./phase-04-docs-and-verification.md) | Completed |

Phụ thuộc: 1 → 2 → 3 → 4 (tuần tự; 1 đổi hợp đồng API mà 3 dùng).

## Success Criteria

- [x] Không còn bảng `organization` / `member` / `invitation`, cột `workspace_id`, `session.active_organization_id`;
      `pnpm db:generate` không TTY → "No schema changes".
- [x] API `/api/*` không có `:ws`; mọi route (trừ auth/dev/health) 401 khi chưa đăng nhập; user A không đọc/ghi được
      dữ liệu user B (404, đủ 56 ca).
- [x] Đăng ký email/mật khẩu không cần lời mời khi `SIGNUP_ENABLED=true` (mặc định tắt); khi tắt bị chặn mà không lộ
      email đã tồn tại; rate limit sign-up.
- [x] User vượt `USER_DAILY_USD` hôm nay (mọi chi phí) → endpoint LLM 402; job LLM của user fail `quota_exceeded`;
      Modal không chạy job của user đó; user khác không bị ảnh hưởng.
- [x] Web: route `/`, `/s/$seriesId`, `/s/$seriesId/c/$chapterId`, `/glossary`, `/settings`, `/login` (đăng nhập +
      đăng ký); không còn chữ "nhóm" / "workspace" / "Thành viên" / "lời mời" ở UI (trừ "nhóm dịch" trong ignore-text).
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `cd worker && uv run pytest`, `pnpm --filter @mtl/web e2e` pass.

## Gate kiểm tra theo phase

Phase 1–2 đổi hợp đồng API → e2e web chỉ chạy được lại sau phase 3. Gate phase 1–2: typecheck + lint + test
shared/db/api + pytest. Gate phase 3–4: thêm e2e đầy đủ.

## Ngoài phạm vi

Xác thực email, chống nhiều tài khoản rác, hạn mức dung lượng lưu trữ / số series mỗi user, BYOK, quota tháng / gói
trả phí, admin panel, xoá tài khoản (Phase 8).

## Câu hỏi còn mở

1. Mở đăng ký không xác thực email → 1 người tạo nhiều tài khoản để nhân hạn mức ngày và lấp dung lượng MinIO (chưa
   có hạn mức lưu trữ/user). Plan này: checklist deploy **bắt buộc `SIGNUP_ENABLED=false` ở production**; xác thực email
   (mailer xoá ở phase 1, lấy lại từ git) + hạn mức dung lượng để Phase 8. Đồng ý?
2. Giá trị `USER_DAILY_USD` khi deploy (đề xuất $1/ngày).

## Red Team Review

### Session — 2026-10-24
**Findings:** 15 (15 accepted — #7 một phần, 0 rejected) · gộp từ 25 finding của 3 reviewer (Security Adversary,
Assumption Destroyer, Failure Mode Analyst)
**Severity breakdown:** 2 Critical, 10 High, 3 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Hạn mức chỉ chặn LLM, chi phí GPU vẫn làm cạn ngân sách chung → ảnh hưởng user khác | Critical | Accept | Phase 2 |
| 2 | Snapshot drizzle cho 0015 không sinh được (prompt rename không TTY) | Critical | Accept | Phase 1 |
| 3 | Pause/resume đóng băng chương, lặp giữa process, limit=0 lọt | High | Accept (fail thay pause) | Phase 2 |
| 4 | "Vượt tối đa 1 job" sai — thiếu kiểm ở heartbeat | High | Accept | Phase 2 |
| 5 | Cổng đăng ký trong databaseHooks lộ email tồn tại | High | Accept | Phase 1, 2, 3 |
| 6 | `SIGNUP_ENABLED` mở khi quên `NODE_ENV` | High | Accept | Phase 2 |
| 7 | Rate limit sign-up lỏng, không hạn mức lưu trữ | High | Accept một phần (rule + checklist; dung lượng → Phase 8) | Phase 2, 4, plan |
| 8 | Test cách ly mất tự tìm route; 17 chỗ lọc thủ công; 86 chỗ gắn middleware | High | Accept | Phase 1 |
| 9 | Bỏ sót consumer token worker; token Mac thành credential toàn nền tảng | High | Accept | Phase 1, 4 |
| 10 | Dispatcher bật Modal cho mọi job khi bỏ worker_mode | High | Accept | Phase 1, 2 |
| 11 | Claim toàn cục làm test API phụ thuộc thứ tự file | High | Accept | Phase 1 |
| 12 | Playwright chờ `/api/me/workspaces` đã xoá | High | Accept | Phase 3 |
| 13 | Khoá theo userId: đóng tab nhả khoá của tab đang sửa | Medium | Accept (khoá theo tab) | Phase 1, 3 |
| 14 | Migration không backfill `kind` token cũ | Medium | Accept | Phase 1 |
| 15 | Gate docs yếu, thiếu dòng, quy ước file down; sai sự thật trong plan | Medium | Accept | Phase 1–4 |

Loại khỏi đề xuất: giới hạn số job LLM chạy song song mỗi user (heartbeat đủ chặn), lưu rate limit vào DB (1 process API).

### Whole-Plan Consistency Sweep
- Delta: pause → fail `quota_exceeded`; chi phí quota = LLM + GPU; khoá theo tab `X-Tab-Id`; migration 0015–0017 +
  file down; `SIGNUP_ENABLED` mặc định false; `disableSignUp` thay hook; mailer xoá; `requireUser` mount 1 lần.
- Đã quét: plan.md + 4 phase không còn "pause theo user", "resume lọc user", "0015 duy nhất", "không có file down",
  "databaseHooks" (cho cổng mới), "withoutSignupGate", "SMTP đã có", "ledger ghi lúc complete", "uploads.ts commit".
- Mâu thuẫn còn lại: 0.
