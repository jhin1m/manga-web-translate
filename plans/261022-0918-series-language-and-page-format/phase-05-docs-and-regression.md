---
phase: 5
title: "Docs + hồi quy"
status: pending
priority: P2
effort: "2h"
dependencies: [3, 4]
---

# Phase 5: Docs + hồi quy

## Overview
Cập nhật docs theo hành vi mới và chạy toàn bộ test để xác nhận luồng 2 bước không hồi quy.

## Requirements
- `docs/job-queue-worker.md`: payload `page.prepare` (`source_lang`, `reading_order`), `page.ocr_region.source_lang`, `TranslateSettings.source_lang/target_lang`; commit lấy mode từ `series.page_format`; pipeline version 0.4.0 + worker cũ bị 426.
- `docs/typeset-layout-contract.md` / `docs/editor.md`: chỉ sửa nếu đang ghi "font đủ dấu tiếng Việt" là điều kiện duy nhất → bổ sung es/pt/fr/id.
- Docs liệt kê ngôn ngữ hỗ trợ + bảng mặc định page_format theo nguồn (đặt nơi docs đang mô tả cài đặt series; tìm bằng grep `honorific`).

## Related Code Files
- Modify: `docs/job-queue-worker.md`, docs khác tìm được qua grep `honorific|source_lang|page_format|tiếng Hàn`

## Implementation Steps
1. Grep docs, sửa đúng chỗ, không thêm changelog nếu repo không có.
2. Chạy: `pnpm --filter @mtl/db test`, `pnpm --filter @mtl/api test`, `pnpm --filter @mtl/web test`, `pnpm --filter @mtl/web e2e`, `cd worker && uv run pytest`, typecheck toàn repo.
3. Kiểm tay (nếu có worker local): series ko→vi strip chạy Bước 1 → Bước 2 như cũ; series ja pages upload 3 file → 3 page, thứ tự vùng phải→trái.

## Success Criteria
- [x] Mọi lệnh test xanh; kết quả ghi vào `reports/`.
- [x] Docs khớp code (tên field, version).

## Risk Assessment
- e2e phụ thuộc worker giả lập: nếu không chạy ingest thật, xác nhận mode qua payload job trong DB/API.
