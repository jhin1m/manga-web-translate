---
phase: 4
title: "AI hiệu đính (chapter.proofread)"
status: pending
priority: P1
effort: "5h"
dependencies: [1]
---

# Phase 4: AI hiệu đính

## Overview
Job `chapter.proofread` qua hàng đợi hiện có; LLM trả gợi ý theo khối; editor hiện panel "Hiệu đính" trên rail.

## Architecture
- Shared: JobType `chapter.proofread` (LLM, tính tiền), payload `{chapter_id, page_ids, model_tier, settings}`, inputs
  `{pages: [{page_id, ord, width, height, regions:[{id, kind, source, translation}], image}]}`, result
  `{suggestions:[{page_id, region_id, old, suggestion, reason}]}`.
- DB `proofread_suggestions` (ws, chapter, page, job, region_id, old_text, suggestion, reason, dismissed_at) — migration.
  Complete: xoá gợi ý cũ của chương, ghi mới (lọc lại id lạ / trùng bản cũ phía server).
- API: `POST /chapters/:id/proofread` (enqueue; chương review/done/partial_failed), `GET /chapters/:id/proofread`
  (job gần nhất + gợi ý), `PATCH /proofread-suggestions/:id {dismissed}`. Tenant cases.
- Worker: prompt `prompts/proofread_page.md`, provider `proofread_page(req)` (gemini + anthropic), premium model qua
  env `MTL_GEMINI_PREMIUM_MODEL`/`MTL_ANTHROPIC_PREMIUM_MODEL`; ảnh trang gốc thu nhỏ rộng 640, cắt khúc ≤ 1280px
  (tối đa 6) JPEG; mỗi trang 1 call; `validate_suggestions` chặn id lạ / trùng bản cũ / rỗng.
- Web: rail "Hiệu đính" + panel: chưa chạy → nút "Chạy AI hiệu đính"; đang chạy → tiến độ; có gợi ý → danh sách theo
  trang (cũ → mới, lý do), Nhận / Bỏ, "Nhận tất cả" (trang đang mở). Trạng thái suy ra từ text hiện tại: = cũ → chờ,
  = mới → đã nhận, khác → lỗi thời. Nhận = `setRegionTranslation` (undo, autosave, version, lock, relayout).

## Success Criteria
- [ ] API test enqueue/complete/dismiss; worker test validate + handler với provider giả; e2e: fake worker trả gợi
  ý → panel Nhận → bản dịch đổi + lưu.

## Risk Assessment
Ảnh strip dài tốn token: giới hạn khúc; tier premium chưa có giá → server tính giá cao nhất (không $0).
