---
phase: 5
title: "Docs + gate đầy đủ"
status: completed
priority: P2
effort: "1h"
dependencies: [2, 3, 4]
---

# Phase 5: Docs + gate đầy đủ

## Overview
Cập nhật hợp đồng/tài liệu, chạy gate toàn repo, ghi thứ tự deploy.

## Requirements
- `docs/typeset-layout-contract.md`: mục chọn font — bảng style → slot → fallback; `Region.style`.
- `docs/editor.md`: ô "Loại chữ" ở Properties.
- `docs/deployment-guide.md` (hoặc chỗ đang ghi mốc version): worker 0.8.0 trước → `MIN_PIPELINE_VERSION=0.8.0` → API/web; không rollback worker dưới 0.8.0 sau khi đã dịch.
- Report đo độ chính xác style (từ phase 2) vào `plans/261102-1547-text-style-fonts/reports/`.

## Implementation Steps
1. Sửa docs (đọc trước, sửa đúng chỗ, không thêm changelog thừa).
2. Gate: `pnpm typecheck && pnpm lint && pnpm test && (cd worker && uv run pytest)`.
3. Gate parity typeset không cần chạy lại (không đổi layout) — chỉ chạy nếu phase 2 chạm `render.py`/`measure.ts`.
4. `/ak:code-review` trên diff.

## Success Criteria
- [x] Gate xanh, output dán vào report.
- [x] Docs khớp code (tên trường, fallback, version).

## Risk Assessment
- Deploy sai thứ tự → API gửi `thought_font` cho worker 0.7.x → job fail schema. Bước deploy ghi rõ.
