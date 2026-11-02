# Phase 1 — Schema chung + API

## Files
- `packages/shared/src/job.ts` — payload `page.reinpaint`
- `packages/shared/json-schema/*` — `pnpm schema:emit`
- `apps/api/src/routes/page-state.ts` — `ReinpaintBody`, route `/pages/:pageId/reinpaint`
- `apps/api/src/jobs/claim-inputs.ts` — input `user_mask` chỉ khi có key
- `apps/api/src/jobs/idempotency.ts` — key theo payload (kiểm bbox vào key)
- `apps/api/src/env.ts` — PIPELINE_VERSION / MIN_PIPELINE_VERSION 0.9.0 + ghi chú
- Test: `apps/api/test/*reinpaint*`, contract schema test của shared

## Bước
1. Payload reinpaint: giữ `user_mask_key` + `offset` nhưng thành optional; thêm `auto_text_bbox: BBox` optional;
   `.refine`: đúng một trong hai (mask người vẽ có cả key + offset, hoặc bbox).
2. Body route: `{ base_clean_rev, user_mask_key?, offset?, auto_text_bbox? }` cùng ràng buộc; bbox kiểm trong page
   (cùng luật `ocr-region`: w,h ≥ 4, không vượt mép). Nhánh mask người vẽ giữ nguyên kiểm key/PNG/size.
3. claim-inputs: `user_mask` chỉ khi có `user_mask_key`; nhánh bbox chỉ `base_clean`.
4. Nâng version 0.9.0, ghi một dòng vào chú thích `MIN_PIPELINE_VERSION`.
5. `pnpm schema:emit`.

## Test
- Route: bbox hợp lệ → 202 job payload có `auto_text_bbox`; bbox ngoài page → 400; gửi cả hai/không cái nào → 400;
  `base_clean_rev` cũ → 409 (giữ).
- claim-inputs nhánh bbox không có `user_mask`.
- Tenant isolation không đổi route (không thêm param).

## Rollback
Revert commit; worker 0.8.0 vẫn chạy với API cũ.
