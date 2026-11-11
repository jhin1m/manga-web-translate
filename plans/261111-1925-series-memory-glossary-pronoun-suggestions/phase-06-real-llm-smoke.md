---
phase: 6
title: "Smoke với LLM thật"
status: completed
priority: P2
effort: "1h"
dependencies: [2, 3]
---

# Phase 6: Smoke với LLM thật

## Overview

Mọi test tự động đều dùng worker giả, nên không đo được 3 điều: (a) field mới có làm tăng lỗi `schema` hay tràn
guard token không, (b) gợi ý có dùng được không, (c) chương 2 có thật sự nhớ chương 1 không. Phase này chạy 2 chương
thật để trả lời. **Đây là cổng trước khi coi tính năng là xong** (tiêu chí 6 trong `plan.md`).

## Cách chạy

1. Dựng stack local theo `docs/development-setup.md`. Worker chạy với `--provider anthropic`, là provider chính của
   dự án.
2. Tạo một series (KO hoặc EN raw), mỗi chương ≥ 9 trang để có ít nhất 3 lô. Dịch chương 1.
3. Kiểm chương 1:
   - Đếm job lỗi `schema` bằng
     `select count(*) from jobs where type='chapter.translate' and error_class='schema' and chapter_id=…`.
   - Lấy `result->'new_terms'`, `result->'pronoun_pairs'` của từng lô.
   - Xem danh sách Gợi ý ở modal Glossary. Ước lượng tỉ lệ rác (từ thường, tên OCR sai).
4. Nhận 2–3 gợi ý, để nguyên số còn lại. Dịch chương 2.
5. Kiểm chương 2:
   - `payload->'carry'` của lô đầu bằng `chapters.translate_memory` của chương 1.
   - Tên nhân vật trong bản dịch thống nhất với chương 1.
6. Đo token ra mỗi lô từ `usage_ledger` (`llm_tokens_out`). So với baseline: dịch lại chương 1 bằng worker 0.10.0
   (checkout bản trước) hoặc lấy job dịch cũ của cùng chương, nếu có.

## Ngưỡng đạt

| Chỉ số | Ngưỡng |
|---|---|
| Lô lỗi `schema` phát sinh thêm | 0 |
| Token ra trung bình mỗi lô so với baseline | ≤ +15% |
| Lô đầu chương 2 có carry từ chương 1 | Có |
| Gợi ý dùng được ở chương 1 | ≥ 1, tỉ lệ rác ước lượng ≤ 50% |

Không đạt thì làm theo thứ tự: hạ giới hạn trong prompt (8/5 mục xuống 5/3, notes 500 xuống 300 ký tự), chạy lại
bước 2–6, rồi ghi lại số đo. Nếu vẫn tăng lỗi `schema` thì dừng release và báo người dùng kèm số đo.

## Output

Report: `plans/261111-1925-series-memory-glossary-pronoun-suggestions/reports/smoke-real-llm-series-memory-report.md`.
Nội dung gồm số đo, ví dụ gợi ý tốt và xấu, kết luận đạt hay không. Report không chứa key, prompt thô hay nội dung
truyện có bản quyền.

## Risks

Phase này tốn một ít tiền API thật, khoảng 2 chương. Nếu người dùng chưa cấu hình key thì đánh `BLOCKED`, và ghi mục
"Cần đo" ở roadmap (phase 5) để làm sau.
