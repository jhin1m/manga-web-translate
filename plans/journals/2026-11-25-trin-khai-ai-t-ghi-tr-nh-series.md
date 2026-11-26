---
title: Triển khai AI tự ghi trí nhớ series
date: 2026-11-25
summary: "Plan 261124-1418 xong phase 1–4; còn treo smoke LLM thật, restart worker, commit"
---

# Triển khai AI tự ghi trí nhớ series

**Date**: 2026-11-25 10:26 · **Severity**: Medium · **Component**: worker, API, web, db · **Status**: Ongoing (chưa smoke, chưa commit)

## What happened
- Phase 1–4 của `plans/261124-1418-auto-apply-series-memory/plan.md` xong: migration 0030 (`glossary_entries.origin`, `series.style_origin`, khoá sổ `series_suggestions` thêm tiền tố cặp ngôn ngữ); worker 0.13.0 trả `style_note`; `applyLearned` ở nhánh complete `chapter.translate` tự ghi thuật ngữ/xưng hô/Giọng văn với `origin='ai'`; PATCH series có `pronoun_keys_seen` và chế độ bảo vệ body cũ; web bỏ Nhận/Bỏ, thêm chip "AI".

## The brutal truth
- Plan ghi sai: zod 4 và JSON Schema đếm độ dài theo code point, không phải UTF-16. Cắt theo UTF-16 vẫn an toàn, nhưng plan đã khẳng định một điều sai mà không kiểm.
- Route glossary suýt deadlock với AI ghi cùng thuật ngữ: Postgres kiểm unique index trước khi FK lấy KEY SHARE trên dòng series. Phải tăng `glossary_rev` (khoá series) ở đầu transaction. Lỗi kiểu này test một kết nối không bao giờ bắt được.
- Lỗi cũ lòi ra: JSONB đổi thứ tự khoá trong `pronoun_rules` làm `settings_rev` tăng oan, giờ so theo nội dung.
- E2E chập chờn: trang series ngừng poll khi chương dừng ở `prepared`. Đổi series test sang `page_format: "pages"`.

## Decision
- Khoá series trước trong route glossary; DELETE series khoá chương theo id trước khi xoá. Có test hai transaction thật, đỏ khi dời bước tăng rev về cuối.

## Review và kiểm
- Worker+API: 0 Critical/High, 2 Medium (test khoá lại thứ tự khoá; tài liệu rollback sai) đã sửa. Web: 0 Critical/High, 2 Medium ở test đã sửa; a11y chip AI đã sửa. Báo cáo trong `reports/` của plan.
- API 777 qua (1 skip), web unit 568, worker 445, shared 128; lint + typecheck sạch; e2e `series-auto-memory` qua 3 lần liên tiếp, `series-manage` và `glossary-language-pair` qua.

## Lessons
- Có thứ tự khoá thì phải có test hai transaction thật giữ nó lại.
- Kiểm hành vi thư viện (độ dài chuỗi) bằng code trước khi ghi vào plan.

## Next steps
- Smoke LLM thật trước release: 43 ảnh nguồn của smoke cũ đã mất khỏi DB dev/MinIO, người dùng chọn để sau.
- Restart worker dev để nạp 0.13.0 (đang chạy bản cũ).
- Commit thay đổi.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
