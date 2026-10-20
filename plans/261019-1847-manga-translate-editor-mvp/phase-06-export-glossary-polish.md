---
phase: 6
title: "Export PNG/ZIP/CBZ + ghép strip + glossary/find-replace"
status: pending
priority: P1
effort: "3d"
dependencies: [3, 5]
---
# Phase 6: Export + ghép strip + glossary/find-replace

## Overview
Xuất chương ra PNG/ZIP/CBZ bằng **render phía server** từ `page_state` với chính `render.py` (Phase 1) — một renderer duy nhất cho auto-typeset và export. Xuất strip theo slice gốc hoặc theo page. Find/replace chữ thường trong chương và "áp glossary vào bản dịch đã có". Effort 4d → 3d sau khi cắt `fixed_height`, regex, phạm vi series, pixel-diff (red team, gộp kèm).

## Requirements
- Job `chapter.export` {format: `png_zip`|`cbz`, layout: `original_slices`|`pages`, quality, include_untranslated:false}. Không có layout `fixed_height` (red team, gộp kèm).
- Renderer chỉ vẽ `lines[]` theo hợp đồng layout (NFC, baseline từ ascent/descent, stroke ra ngoài, raqm bắt buộc) (red team #11); thiếu `lines` (box auto chưa qua editor) → wrap bằng typesetter rồi vẽ. Ảnh nền = `clean/{pages.clean_rev}.png`.
- Ghép strip: dùng `pages.source_map` để cắt lại đúng các slice upload gốc. Không còn page overlap (red team #4) → ghép thẳng theo `ord`.
- Output `ws/{ws}/ch/{ch}/export/{jobId}.{zip|cbz}`; **tải qua endpoint có xác thực** `GET /api/w/:ws/exports/:jobId/download` → 302 tới presigned GET **TTL ≤ 5 phút** + `Content-Disposition: attachment`; không phát link dài hạn (red team, gộp kèm). Xoá file export sau 7 ngày (lifecycle rule MinIO).
- **Find/replace (red team, gộp kèm; #6):** chữ thường (không regex), phạm vi **trong chương**, tuỳ chọn phân biệt hoa thường; bắt buộc xem trước danh sách khớp (page, box, trước/sau) rồi mới áp; người gọi phải giữ khoá chương (423 nếu không); áp = 1 transaction, mỗi page_state ghi history với chung `batch_id`, version +1; **hoàn tác** = khôi phục từ `page_state_history` theo `batch_id` (chỉ khi các page chưa bị sửa tiếp, ngược lại báo xung đột).
- Glossary: nút "áp lại glossary" chỉ thay term trong `translation` theo map (không gọi LLM), cùng cơ chế khoá + history + `batch_id` như find/replace, đánh dấu box bị đổi. Muốn dịch lại theo glossary mới → "dịch lại chương" (Phase 4).

## Architecture
```
worker/mtl_pipeline/render.py        render_page(clean_img, page_state, fonts) -> RGBA (Phase 1 tạo; phase này thêm ghép/xuất)
worker/mtl_worker/export.py          tải clean theo rev, render từng page, cắt/ghép theo layout, zip/cbz (ComicInfo.xml tối thiểu), PUT
apps/api/src/routes/export.ts        POST /api/w/:ws/chapters/:id/export → enqueue; GET trạng thái; GET /exports/:jobId/download
apps/api/src/routes/find-replace.ts  POST preview / apply / undo (batch_id) — dùng chapter-lock + page_state_history
```
Ghép strip: render từng page → ghép dọc theo `ord` theo cửa sổ trượt đến ranh giới slice đích (không giữ cả strip trong RAM).

## Related Code Files
Create:
- `worker/mtl_worker/export.py`
- `worker/tests/{test_render_lines.py,test_export_slices.py}`
- `apps/api/src/routes/{export.ts,find-replace.ts}`, `apps/api/test/{export.test.ts,find-replace.test.ts}`
- `apps/web/src/features/chapter/{ExportDialog.tsx,FindReplace.tsx}`
- `apps/web/src/features/glossary/ApplyGlossary.tsx`
- `apps/web/e2e/typeset-parity.spec.ts` + `scripts/typeset-parity.ts` (so bbox glyph Konva headless vs `render.py`, kế thừa spike Phase 1)
Modify:
- `worker/mtl_pipeline/render.py` (thêm render theo cửa sổ cho export)
- `packages/shared/src/job.ts`, `apps/api/test/tenant-isolation.test.ts`

## Implementation Steps
1. Test golden: page_state cố định → ảnh mong đợi (snapshot hash có dung sai) cho `render.py`.
2. Export job + layout `original_slices`/`pages`, CBZ.
3. Endpoint download có xác thực + presigned GET 5 phút.
4. Parity regression: 10 page_state golden, đo bbox glyph từng dòng Konva headless (Playwright) vs render server; chạy trong CI (không cần ảnh có bản quyền — page_state + nền trơn).
5. Find/replace preview/apply/undo theo `batch_id`.
6. Áp glossary vào bản dịch có sẵn.
7. UI dialog export + tiến độ (polling).

## Success Criteria
- [ ] Xuất chương manhwa 40 slice ở layout `original_slices` → đúng 40 file, đúng kích thước gốc từng file.
- [ ] Parity: lệch bbox glyph ≤ 1px trên 10 page_state golden + owner soi mắt 5 trang thật không thấy khác (red team #11).
- [ ] Export 100 trang ≤ 3 phút trên worker Mac, RAM worker ≤ 3GB.
- [ ] Link download hết hạn sau ≤ 5 phút; người ngoài workspace gọi `/download` → 404.
- [ ] Find/replace 1 term trên chương 50 trang < 2s, hoàn tác được; không giữ khoá → 423.
- [ ] CBZ mở được trong 1 reader phổ biến (VD: YACReader/Komga).

## Risk Assessment
| Rủi ro | K×A | Giảm thiểu |
|---|---|---|
| Lệch render browser/server | TB × Cao | Hợp đồng layout, `lines[]`, cùng font, gate bbox glyph ≤ 1px; fallback render Konva headless (Phase 1 NO-GO path) |
| Strip quá lớn tràn RAM | TB × TB | Render theo page, ghép theo cửa sổ slice đích |
| Find/replace phá hỏng nhiều trang | TB × TB | Chữ thường, trong chương, preview bắt buộc, hoàn tác theo `batch_id`, khoá chương |
| Lộ link export | Thấp × TB | Endpoint có xác thực, presigned 5 phút, attachment |

Rollback: export là job riêng; lỗi thì người dùng vẫn tải được ảnh clean + JSON.
