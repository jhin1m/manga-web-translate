---
title: "Plan: AI tự ghi trí nhớ series thay cho gợi ý"
date: 2026-11-24
summary: Lập plan 261124-1418; red-team lật lại thứ tự khoá và trần sổ trước khi code
---

# Plan: AI tự ghi trí nhớ series thay cho gợi ý

## What happened
- Người dùng muốn AI tự bổ sung glossary, xưng hô, giọng văn cho series thay vì Nhận/Bỏ gợi ý. Đã chốt "ghi thẳng vào, nhãn AI" và "cộng dồn vào series".
- Bản plan đầu đặt việc ghi Giọng văn lúc đóng lượt dịch (`rememberRunMemory`), khẳng định "không đường nào khoá series rồi mới khoá chương".
- Red-team (3 reviewer) chứng minh sai: reaper (`apps/api/src/jobs/reaper.ts:15-27`) và claim (`queue.ts:259-316`) gọi `terminal` cho nhiều chương trong một transaction, nên khoá series ở đó tạo vòng với complete của chương khác. DELETE series cũng khoá series trước rồi cascade chương.
- Các lỗi khác tìm được: trần 200 tính trên cả sổ làm AI ngừng học hẳn; tab web cũ và form mở lâu xoá mất cặp AI hoặc Giọng văn AI; form gửi diff rỗng bị API trả 400; cắt `style_note` theo ký tự trong khi zod đếm UTF-16; thiếu `pnpm schema:emit` và các file provider.

## Decision
- Mọi việc ghi của AI chỉ chạy ở nhánh complete `chapter.translate` (một chương). Giọng văn được ghi ở lô đầu có `style_note`. DELETE series khoá các chương trước.
- Sổ `series_suggestions` thành danh sách khoá đã gặp, khoá có tiền tố cặp ngôn ngữ. Trần tính trên số entry AI còn sống.
- Người dùng chọn bỏ qua gợi ý cũ (không áp), và chấp nhận tốn khoảng 50–80 token mỗi lô khi cố ý để trống Giọng văn, thay vì nâng `MIN_PIPELINE_VERSION`.

## Next steps
- `/ak-cook plans/261124-1418-auto-apply-series-memory/plan.md`. Phase 2 và 3 chạy song song được sau phase 1.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
