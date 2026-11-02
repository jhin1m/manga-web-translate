---
phase: 1
title: "Hợp đồng shared + version"
status: completed
priority: P1
effort: "2h"
dependencies: []
---

# Phase 1: Hợp đồng shared + version

## Overview
Thêm `Region.style` và `TranslateSettings.thought_font/note_font` vào zod shared, emit JSON Schema cho worker, bump pipeline version.

## Requirements
- `Region.style`: `z.enum(["normal","thought","note"]).optional()`; export `TextStyle` type + `TEXT_STYLES`.
- `TranslateSettings`: `thought_font`, `note_font` = `z.string().min(1).optional()` (comment: job cũ không có → worker dùng font theo kind).
- Worker pydantic `Region` (`worker/mtl_pipeline/schema.py`) không cần `style` cho pipeline nội bộ — style sống ở `TranslateItem` + output state (phase 2).
- `PIPELINE_VERSION = "0.8.0"` + dòng ghi chú lý do trong `worker/mtl_worker/__init__.py`.

## Related Code Files
- Modify: `packages/shared/src/page-state.ts`, `packages/shared/src/job.ts`, `worker/mtl_worker/__init__.py`
- Regenerate: `packages/shared/json-schema/*.schema.json` qua `pnpm schema:emit` (commit; có test chặn lệch zod ↔ file)
- Test: `worker/tests/test_contract_schema.py`, test zod hiện có ở `packages/shared` (nếu có)

## Implementation Steps (TDD)
1. **Tests before** — `test_contract_schema.py`: (a) page state có region không `style` vẫn hợp lệ (đã có → giữ xanh); (b) region `style: "thought"` hợp lệ; (c) `style: "shout"` bị từ chối; (d) translate payload có `thought_font`/`note_font` hợp lệ, thiếu cũng hợp lệ. Chạy → (b)(c)(d) đỏ.
2. Sửa zod `page-state.ts` + `job.ts`.
3. `pnpm schema:emit` → commit schema sinh ra.
4. Bump `PIPELINE_VERSION`.
5. **Regression gate**: `pnpm --filter @mtl/shared typecheck && cd worker && uv run pytest tests/test_contract_schema.py`.

## Success Criteria
- [x] 4 case contract xanh; test cũ không đổi.
- [x] `pnpm typecheck` toàn repo xanh (trường optional không phá chỗ dùng).

## Risk Assessment
- Schema strict: worker < 0.8.0 fail job có region `style` (export/proofread đọc state). Ghi rõ "không rollback worker dưới 0.8.0 sau khi đã dịch" trong comment version, như mốc 0.5.0/0.7.1.
