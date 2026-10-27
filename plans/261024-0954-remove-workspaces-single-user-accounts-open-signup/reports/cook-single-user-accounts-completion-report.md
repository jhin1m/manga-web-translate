# Hoàn tất — bỏ workspace, 1 người 1 tài khoản, mở đăng ký (24/10/2026)

Branch `feat/single-user-accounts` (từ `a61e405`), chưa commit.

## Gate (HEAD cuối, working tree)
| Gate | Kết quả |
|---|---|
| `pnpm typecheck` | 0 lỗi |
| `pnpm lint` | sạch |
| `pnpm test` | shared 37, db 5, api 246, web 197 — pass |
| `cd worker && uv run pytest` | 217 pass |
| `pnpm --filter @mtl/web e2e` | 36 pass |
| `drizzle-kit generate` (không TTY) | No schema changes |

## Đã làm
- DB: migration 0015 (guard có `organization` → lỗi; `worker_tokens.kind`), 0016 (drop), 0017 (`user_id`, `user_settings`,
  `user_fonts`) + down; test guard/backfill (`packages/db/test/single-user-migration.test.ts`).
- API: `/api/*`, `requireUser` gắn 1 lần; `GET /api/me` (+quota), `PUT /api/settings/pipeline`; worker chung (`kind`,
  grace Mac ở dispatcher); khoá theo tab (`x-tab-id`); `SIGNUP_ENABLED` / `USER_DAILY_USD`; 402 + fail
  `quota_exceeded` ở claim/runner/heartbeat; `pnpm create-user`, `worker-token --kind`; xoá invite/mailer/organization.
- Web: route mới, `useMe`, đăng ký trên `/login`, "Cài đặt chung", bỏ role gate, chữ khoá theo tab, câu hạn mức.
- E2E: seed/helpers mới, `signup.spec`, `routes.spec` (thay redirect), ca 2 tab thật ở `editor.spec`, `fonts.spec`.
- Infra: `infra/smoke.sh` kiểm 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` thay 403 lời mời.
- Docs: README + docs/* (docs-manager), checklist release single-user-accounts.
- Sửa thêm: số chương ngẫu nhiên ở `editor.spec` (đụng 501 của `upload-chapter.spec`) → bộ đếm.

## Câu hỏi còn mở
1. Review H1/M2/M3 (xem `from-code-reviewer-single-user-accounts-review-report.md`).
2. Câu hỏi mở của plan: production giữ `SIGNUP_ENABLED=false` tới Phase 8? Giá trị `USER_DAILY_USD` khi deploy ($1?).
3. Soi tay luồng đăng ký → xuất trên trình duyệt (owner).
