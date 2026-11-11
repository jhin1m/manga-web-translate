---
phase: 5
title: "Docs"
status: completed
priority: P2
effort: "1h"
dependencies: [2, 3, 4]
---

# Phase 5: Docs

## Overview

Cập nhật docs để khớp hành vi mới: trí nhớ series, gợi ý từ AI, phiên bản worker 0.11.0 và migration 0026. Đọc từng
file trước khi sửa; sửa xong thì kiểm lại ngày, link và các nhận định so với code thật.

**Không sửa** `docs/editor.md` và `docs/design-guidelines.md`. Hai file này đang có thay đổi chưa commit của plan
`261106-1519-ui-simplify-wireframe`, và phase 4 cũng không đổi gì trong editor.

## Files + nội dung

| File | Vị trí | Nội dung |
|---|---|---|
| `docs/job-queue-worker.md` | Sau đoạn **`carry`** (l.153-155) | Đoạn **Trí nhớ series**: lượt dịch cả chương ghi `chapters.translate_memory` (carry + cặp ngôn ngữ); lô chưa có carry trong lượt thì lấy trí nhớ của chương khác gần nhất (D1, D11); lượt một phần không ghi (D2); payload không đổi; trí nhớ không vào input_rev hay idempotency |
| `docs/job-queue-worker.md` | Luồng dịch, cạnh `carry` | `result.new_terms` / `result.pronoun_pairs` (optional, giới hạn 50/30): API lọc rồi lưu vào `series_suggestions`; worker cắt theo UTF-16 như `carry` |
| `docs/job-queue-worker.md` | Lịch sử version (l.292-296) | 0.11.0: prompt + 2 key result optional; **không** nâng `MIN_PIPELINE_VERSION` (API cũ strip key lạ, API mới nhận result thiếu key); API `PIPELINE_VERSION` vẫn 0.4.0 |
| `docs/export-and-batch-edit.md` | Mục `## Glossary` (l.107-143) | Mục con **Gợi ý từ AI**: nguồn, luật lọc (D3, D7, D8, D9), Nhận đi qua POST glossary (`glossary_rev` + 1) hoặc form Xưng hô + Lưu (`settings_rev` + 1), Bỏ thì không quay lại; thêm dòng vào bảng API: `series/:id/suggestions` (GET), `series-suggestions/:id` (PATCH `{dismissed}`) |
| `docs/project-roadmap.md` | "Cần đo / kiểm thử với dữ liệu thật" | Mục: chất lượng gợi ý và trí nhớ series với LLM thật (tỉ lệ rác, token ra mỗi lô ≤ +15%, tên nhất quán giữa chương); link report của phase 6 |
| `docs/project-roadmap.md` | "Phải làm → Deploy" | Thêm `0026_series_memory` vào danh sách migration; ghi chú worker 0.11.0 là tuỳ chọn |
| `docs/deployment-guide.md` | §4 (cạnh "Checklist nâng cấp lên pipeline 0.10.0", l.233) | Ghi chú ngắn: migration 0026 chỉ thêm, nên deploy API và worker theo thứ tự nào cũng được; down ở `packages/db/migrations-down/0026_series_memory.down.sql` |

## Validation

- Mọi tên bảng, cột, route và giới hạn số trong docs phải khớp code đã merge (grep lại sau phase 1–4).
- Link tương đối trong `project-roadmap.md` phải mở được.
- Không ghi mã plan hay phase vào docs như một khái niệm sản phẩm; chỉ link report khi cần.

## Risks / Rollback

Rủi ro thấp. Nếu một phase code bị revert thì revert đoạn docs tương ứng.
