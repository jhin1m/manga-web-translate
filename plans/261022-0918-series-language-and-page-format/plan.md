---
title: "Series language and page format"
description: "Series chọn ngôn ngữ nguồn/đích tự do, thêm page_format (strip|pages) dùng khi commit, OCR/dịch nhận đúng ngôn ngữ, thứ tự đọc phải→trái cho manga Nhật."
status: completed
priority: P1
effort: "2-3d"
tags: [api, worker, web, db, i18n]
created: 2026-10-22
---

# Series language and page format

## Overview

Bỏ khoá cứng KO→VI. Series chọn nguồn `ko|ja|zh|en`, đích `vi|en|id|es|pt|fr`. Thêm `page_format` (`strip|pages`)
trên series, mặc định theo nguồn (ja → pages, còn lại → strip), commit chương dùng nó. Worker nhận ngôn ngữ qua
payload (prompt OCR/dịch thành tổng quát), manga Nhật dạng pages sắp vùng chữ phải→trái.

## Quyết định đã chốt (user, 2026-10-22)

1. Ngôn ngữ đích: `vi, en, id, es, pt, fr` — đều Latin. Đã kiểm 9 font trong `worker/fonts/` có đủ glyph es/pt/fr
   (id không cần dấu) → không cần font mới, `wrap_words` theo dấu cách vẫn đúng. CJK/Thái để plan khác.
2. Xưng hô: **tổng quát hoá** — giữ `honorific_policy` + `pronoun_rules` cho mọi đích; câu chỉ dẫn kính ngữ sinh
   theo cặp nguồn→đích; nhãn UI "Cách xưng hô / gọi nhau", placeholder theo đích.
3. Tạo series (trang chủ + ô series mới khi thả ảnh) có select ngôn ngữ nguồn; `page_format` suy ra phía server.
4. Thứ tự đọc phải→trái khi `source_lang = ja` **và** `page_format = pages`.
5. Không chặn nguồn nào; nguồn ≠ ko hiện ghi chú "chưa kiểm định kỹ" (không chặn lưu).

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Shared contract + DB migration](./phase-01-start.md) | Pending |
| 2 | [Phase 2: API series, commit, enqueue](./phase-02-api-and-db.md) | Pending |
| 3 | [Phase 3: Worker ngôn ngữ + thứ tự đọc](./phase-03-worker-language-and-reading-order.md) | Pending |
| 4 | [Phase 4: Web cài đặt + tạo series](./phase-04-web-settings-and-create.md) | Pending |
| 5 | [Phase 5: Docs + hồi quy](./phase-05-docs-and-regression.md) | Pending |

Phụ thuộc: 1 → 2 → (3 ∥ 4) → 5. Phase 3 và 4 không chung file.

## Success Criteria

- [ ] Tạo/sửa series với mọi cặp nguồn∈{ko,ja,zh,en} × đích∈{vi,en,id,es,pt,fr}; không còn lỗi "MVP chỉ hỗ trợ tiếng Hàn".
- [ ] Series cũ có `page_format` backfill (ja → pages, khác → strip); series mới mặc định theo nguồn khi không gửi.
- [ ] `POST /chapters/:id/commit` không có body `mode` → dùng `page_format` của series; payload ingest đúng mode.
- [ ] `page.prepare` / `page.ocr_region` / `chapter.translate` mang ngôn ngữ; prompt OCR/dịch không còn ghi cứng Hàn/Việt.
- [ ] ja + pages → id vùng chữ (`r0..`) theo hàng trên→dưới, trong hàng phải→trái; mọi trường hợp khác giữ y nguyên thứ tự cũ.
- [ ] Luồng 2 bước (Bước 1 cắt trang + xoá chữ + OCR, Bước 2 Dịch) không đổi hành vi với series ko→vi.
- [ ] `pnpm --filter @mtl/api test`, `pnpm --filter @mtl/web test`, `pnpm --filter @mtl/web e2e`, `cd worker && uv run pytest` xanh.
- [ ] Docs cập nhật (`docs/job-queue-worker.md`, `docs/typeset-layout-contract.md` nếu nhắc font/tiếng Việt).

## Lệch so với plan khi làm (sau code review)

- `enqueueIngest(…, mode?)`: bỏ trống → `series.page_format` (không bắt mọi caller truyền mode).
- Thêm `chapters.ingest_mode` (cùng migration 0005): thứ tự đọc theo mode chương đã thực sự cắt; đổi `page_format`
  **không** tăng `settings_rev` (tránh chạy lại Bước 1 cho trang lỗi khi đổi định dạng).
- Field ngôn ngữ mới trong payload job là optional (job xếp hàng trước 0.4.0 vẫn qua JSON Schema; worker mặc định ko/vi/ltr).
- `rtl_order` so với box mở hàng (box cao vắt khung không gộp hai hàng).
- `LANG_NAMES`, `HONORIFIC_EXAMPLES` dùng chung ở `series-lang.ts`; ví dụ kính ngữ ko giữ "-nim, -ssi" như cũ.
- Review: `reports/code-review-series-language-report.md`. Còn mở: glossary cấp workspace áp cho mọi cặp ngôn ngữ (M3).

## Ngoài phạm vi

- Đích CJK/Thái, chữ dọc khi typeset, font mới.
- Tự đổi `page_format` của chương đã ingest (chỉ áp cho lần commit sau).
- Auto-detect ngôn ngữ nguồn từ ảnh.

<!-- slug: series-language-and-page-format -->
