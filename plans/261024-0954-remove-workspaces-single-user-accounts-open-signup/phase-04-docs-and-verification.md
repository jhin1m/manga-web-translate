---
phase: 4
title: "Docs + kiểm tra cuối"
status: completed
priority: P2
effort: "0.5d"
dependencies: [3]
---

# Phase 4: Docs + kiểm tra cuối

## Overview
Cập nhật README / docs theo mô hình 1 người 1 tài khoản, checklist deploy (reset DB, env mới, token worker mới),
code review, chạy toàn bộ gate.

## Requirements
- Docs khớp code: không còn invite-only, workspace trên URL/API, role, Thành viên, `create-workspace`,
  `--workspace`/`--platform`, `worker_mode`, `workspace_settings`, SMTP mời.
- Ghi rõ: token Mac là credential toàn nền tảng; job không-LLM của user vượt hạn mức chỉ chạy trên Mac.

<!-- Red Team: regex gate yếu, thiếu dòng docs, quy ước file down — 2026-10-24 -->
## Related Code Files
- Modify:
  - `README.md`: 3, 27, 35-36, 48, 65, **82** (quy ước `migrations-down/` — thêm câu "migration không đảo được thì
    file down báo lỗi reset DB"), 119, 132, 157.
  - `docs/development-setup.md`: 10, 17, **21** (worker token), 45-48, 70-79 + mục **reset DB dev** (`docker compose
    down -v` / xoá volume Postgres + MinIO → `pnpm db:migrate` → `pnpm create-user`).
  - `docs/deployment-guide.md`: 1, 54, 78, 99, 107, 129, **146-147** (`worker-token create --kind modal` + xoay secret
    Modal `MTL_TOKEN`), 157, 163, 167-168, 214-216, 229, 244 + env `SIGNUP_ENABLED`/`USER_DAILY_USD`.
  - `docs/job-queue-worker.md`: 13-15, 153, 159, 169-170, 201, 219 + worker chung, `kind`, grace Mac, hạn mức user.
  - `docs/editor.md`: 3, 75 (khoá theo tab), 106, 110-117. `docs/design-guidelines.md`: 102, 106.
  - `docs/export-and-batch-edit.md`: 19, 21, 48, 67, 98. `TODO.md` nếu nhắc workspace.

## Implementation Steps
1. Sửa docs theo danh sách; mục "Checklist release single-user-accounts" trong `deployment-guide.md`:
   - reset DB + MinIO; `pnpm db:migrate` (0015–0017);
   - thu hồi mọi token worker cũ, tạo lại `--kind mac` (chỉ người vận hành) / `--kind modal` + cập nhật secret Modal;
   - env: **`SIGNUP_ENABLED=false` bắt buộc ở production tới Phase 8** (xác thực email + hạn mức dung lượng);
     `USER_DAILY_USD`; xoá `SMTP_URL`/`MAIL_FROM`;
   - smoke: đăng ký khi tắt bị chặn (cả email đã có), `pnpm create-user`, đăng nhập, dịch 1 chương.
2. `/ak:code-review` (backend tenancy + quota + khoá tab, web) → sửa finding.
3. Gate đầy đủ: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `cd worker && uv run pytest`, `pnpm --filter @mtl/web e2e`.
4. Báo cáo `plans/reports/` + cập nhật trạng thái plan.

## Success Criteria
- [x] Tất cả gate xanh trên HEAD cuối.
- [x] `grep -rniE "workspace|/w/:ws|/w/\$ws|worker_mode|--workspace|--platform|invite|lời mời|Thành viên|font (của )?nhóm|owner/admin|create-workspace" README.md docs`
      chỉ còn allowlist có chủ đích (tên component `chapter-workspace*`, "nhóm dịch", lịch sử migration cũ).
- [x] Mọi lệnh / env trong docs có thật (đối chiếu `package.json`, `env.ts`, `scripts/`).

## Risk Assessment
- Docs lệch code → đối chiếu từng lệnh/env bằng grep; checklist deploy là gate, không phải gợi ý.
