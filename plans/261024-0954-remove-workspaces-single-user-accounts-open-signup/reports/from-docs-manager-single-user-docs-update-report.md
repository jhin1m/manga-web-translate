# Báo cáo cập nhật docs: single-user-accounts

Ngày: 2026-10-24

## File đã sửa
- `README.md`: mô tả tài khoản/đăng ký, kiến trúc (`/api/*`, `scoped(db, userId)`), quick start `pnpm create-user`, quy ước migration down "không đảo được thì raise", Deploy (0015–0017 + reset), Phase 8.
- `docs/development-setup.md`: mục "Reset DB dev", đăng ký/`SIGNUP_ENABLED`, quy ước `requireUser`/`user_id`/tenant-isolation, cây route web mới, e2e spec, khoá tab.
- `docs/deployment-guide.md`: env `SIGNUP_ENABLED`/`USER_DAILY_USD`, bỏ SMTP, "Checklist release single-user-accounts", Modal `--kind modal`, dispatcher/Mac grace, token Mac = credential toàn nền tảng.
- `docs/job-queue-worker.md`: worker chung + `kind`, claim/sessions-end, mục mới "Hạn mức mỗi người", "Mac ưu tiên, Modal bù", route không còn `/w/:ws`.
- `docs/editor.md`: khoá theo tab (`x-tab-id`), Font của bạn, route.
- `docs/design-guidelines.md`, `docs/export-and-batch-edit.md`: bỏ role/workspace, route, `skipped` không còn `holder_name`, tên file CSV `glossary-chung-…`, ràng buộc UNIQUE theo `user_id`.
- `docs/typeset-layout-contract.md` (ngoài danh sách cho phép, 1 từ): "của workspace" -> "của người dùng".
- `TODO.md`: không nhắc workspace, không đổi.

## Grep nghiệm thu
Hits còn lại đều có chủ đích: `chapter-workspace*` (tên component/plan), `pnpm-workspace.yaml`, tên migration lịch sử 0012/0013/0015/0016, các câu nói rõ "đã bỏ" (workspace / lời mời / `--workspace` / `--platform` / `worker_mode` / `/w/…` / `/accept-invite`), mục Reset DB / checklist release. `docs/benchmarks`: không có hit.

## Vấn đề chưa giải quyết
1. **`infra/smoke.sh` stale** (code, ngoài phạm vi): vẫn kỳ vọng HTTP 403 chứa "invitation"; hành vi thật khi `SIGNUP_ENABLED=false` là 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` (`apps/api/test/signup.test.ts`). `infra/deploy.sh` sẽ tự rollback mọi deploy cho tới khi sửa. Docs đã ghi cảnh báo; cần sửa script rồi bỏ cảnh báo.
2. `scripts/` / `.claude/scripts/validate-docs.cjs` không có nên chưa chạy validator; link nội bộ mới (`#reset-db-dev`, `#hạn-mức-mỗi-người-user_daily_usd`) đã kiểm bằng mắt theo heading.
3. Mục "Việc chờ owner" ở deployment-guide chưa có mục kiểm tay riêng cho quota 402 / khoá tab — chưa thêm để tránh nhồi.
