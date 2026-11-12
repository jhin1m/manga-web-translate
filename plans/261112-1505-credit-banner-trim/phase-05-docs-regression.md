---
phase: 5
title: "Docs + hồi quy"
status: completed
priority: P2
effort: "0.5d"
dependencies: [1, 2, 3, 4]
---

# Phase 5: Docs + hồi quy

## Overview
Cập nhật docs theo hành vi mới, chạy hồi quy toàn luồng với chương thật có banner, ghi lưu ý phát hành (MIN 0.12.0).

## Requirements
- Docs:
  - `docs/editor.md`: mục rail ảnh gốc (Cắt mép / Bỏ cắt, phím, cờ), mục credit (học dải, tự cắt, giới hạn mới).
  - `docs/job-queue-worker.md`: "Ingest strip / pages" — cắt `trim` trước khi ghép; `src_y` theo ảnh đã cắt;
    dòng version 0.12.0.
  - `docs/export-and-batch-edit.md`: `original_slices` xuất slice đã cắt mép.
  - `docs/project-roadmap.md`: bỏ phần "credit cùng khổ … chỉ ẩn được cả trang" cho trường hợp dải ở mép; giữ giới
    hạn dải giữa ảnh + AI.
  - `README.md` dòng "Lọc rác": thêm cắt mép credit.
  - Ghi chú phát hành: worker phải ≥ 0.12.0 (Mac, Modal, self-host lên cùng lúc với API). Phát hành **một lần** sau
    khi xong cả 5 phase (rc → smoke → tag cùng commit → GitHub Release).
<!-- Updated: Validation Session 1 - phát hành một lần sau cả 2 đợt -->

- Hồi quy: gate chung, e2e toàn bộ, worker pytest; kiểm tay chương mẫu thật có banner (fake worker được).

## Related Code Files
- Modify: các file docs ở trên; `docs/releases/` bản kế tiếp nếu repo đang dùng.

## Implementation Steps
1. Sửa docs (đọc trước khi sửa; kiểm link, tên field khớp code).
2. `pnpm typecheck && pnpm lint && pnpm test`, `pnpm --filter @mtl/web e2e`, `cd worker && uv run pytest`.
3. Kiểm tay: cắt tay chương N → Luôn cắt → chương N+1 tự cắt → Dịch → xuất cả 2 kiểu, mở file xem.
4. Ghi kết quả vào `plan.md` (mục kết quả hồi quy) + `/ak:journal`.

## Success Criteria
- [x] Toàn bộ gate xanh (trừ `block-panel.spec.ts:317` đỏ sẵn trên `main`); kết quả ghi trong `plan.md`. Kiểm tay chương thật: còn mở.
- [x] Docs không còn nói "chỉ ẩn được cả trang" cho banner ở mép.

## Risk Assessment
- Quên ghi lưu ý phát hành → worker cũ bị 426 sau deploy. Mitigation: đưa vào checklist release rc → smoke → tag.
