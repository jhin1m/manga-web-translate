---
phase: 2
title: "Màu chữ theo màu gốc khi typeset"
status: completed
priority: P1
effort: "1.5d"
dependencies: []
---

# Phase 2: Màu chữ theo màu gốc khi typeset

## Overview
Auto-typeset dùng màu chữ và màu viền của chữ gốc (đỏ trên bóng trắng, trắng viền đen trên art, vàng viền nâu…) thay vì
chỉ đen/trắng theo polarity, với fallback khi màu gốc không đủ tương phản trên nền đã xoá chữ.

## Hiện trạng
- `worker/mtl_pipeline/typeset.py:182-188` `style_for(region, size)`: chỉ dựa `region.polarity` → `#000/#fff` + viền
  ngược màu. Không nhìn ảnh.
- Lúc Bước 1 (prepare), `textmask.build_text_mask` (`textmask.py:118-160`) có **ảnh gốc + mask nét chữ chưa giãn**
  (`local`) cho từng region → chỗ duy nhất có đủ dữ liệu lấy màu chữ. Lúc Bước 2 (translate) chỉ còn ảnh sạch.
- Region đi prepare → translate qua dạng shared: `runner.py:region_to_shared/region_from_shared`,
  `handlers.py` (output `polarity`), zod `packages/shared/src/page-state.ts:28-37` (Region) + OcrRegion trong `job.ts`.
- Editor: `apps/web/src/features/editor/actions.ts:178-187` `contrastStroke` (mirror rule viền), hợp đồng
  `docs/typeset-layout-contract.md:19-20, 35-38, 71`.

## Requirements
- Functional:
  - Bước 1 lưu cho mỗi region chữ (không bubble, không SFX): `text_color` (hex) và `outline_color` (hex | null — null khi
    chữ gốc không có viền riêng).
  - Bước 2 chọn `fill`/`stroke`:
    1. `fill = text_color` nếu tương phản với nền sạch (median ảnh clean trong vùng typeset) ≥ 3:1, **hoặc** có
       `outline_color` tương phản với nền ≥ 3:1 (chữ viền đè art).
    2. Không đạt → fallback polarity như hiện tại.
    3. Màu gần đen/trắng (ΔE nhỏ) snap về `#000000`/`#ffffff` để tránh `#0b0a0c` lấm tấm.
    4. `stroke.color = outline_color` nếu có và tương phản với fill ≥ 3:1; không thì `contrastStroke(fill)` (đen/trắng
       theo độ sáng — cùng ngưỡng với editor). Bề rộng viền giữ nguyên quy tắc hiện tại.
  - Region không có màu (trang Bước 1 trước bản này) → đúng hành vi cũ.
- Non-functional: không thêm input job, không tải thêm ảnh; chi phí tính màu ≪ inpaint.

## Architecture
- Module mới `worker/mtl_pipeline/textcolor.py` (thuần numpy/cv2, test được riêng):
  - `glyph_colors(img_rgb, local_mask, box) -> (text_rgb, ring_rgb | None)`: median pixel dưới mask **co 1px** (bỏ viền
    khử răng cưa; quá ít pixel thì dùng mask gốc); `ring` = dải `dilate(local, ~3px) − local` → median.
  - `resolve_colors(text_rgb, ring_rgb, bg_rgb) -> (text_hex, outline_hex | None)`: ring khác nền sạch rõ (ΔE > ngưỡng)
    và khác màu chữ → là viền thật; ngược lại outline = None.
  - `contrast_ratio`, `snap_bw`, `contrast_stroke` (luminance) — dùng chung cho typeset.
- `build_text_mask`: sau khi có `local` cho region → gọi `glyph_colors`, gắn tạm `r.text_rgb`, `r.ring_rgb`.
- Prepare (handler + `pipeline.py` local CLI): sau inpaint, `bg = median(clean[bbox])` → `resolve_colors` → set
  `r.text_color`, `r.outline_color`.
- `Region` (pydantic `schema.py`) thêm `text_color: str | None = None`, `outline_color: str | None = None`;
  `region_to_shared/from_shared` + output prepare mang 2 trường.
- zod: `Region` và OcrRegion thêm `text_color: HexColor.nullable().optional()`, `outline_color` tương tự (optional →
  page state cũ vẫn parse). `pnpm schema:emit`.
- `typeset.style_for(region, size, bg_rgb)`: rule ở Requirements; `typeset_region` truyền median `clean_rgb` trong
  `rect`.
- Editor: `contrastStroke` giữ nguyên ngưỡng = `contrast_stroke` worker (ghi rõ trong hợp đồng). Không thêm UI mới.
- `PIPELINE_VERSION` → 0.5.0 (prepare input_rev đổi theo version; trang cũ không tự chạy lại). Phải đặt
  `MIN_PIPELINE_VERSION` ≥ 0.5.0: schema input worker có `additionalProperties: false` nên worker cũ từ chối region có màu.

## Related Code Files
- Create: `worker/mtl_pipeline/textcolor.py`, `worker/tests/test_textcolor.py`
- Modify: `worker/mtl_pipeline/textmask.py`, `schema.py`, `typeset.py`, `pipeline.py`, `worker/mtl_worker/handlers.py`,
  `runner.py`, version file worker; `packages/shared/src/page-state.ts`, `packages/shared/src/job.ts` (+ JSON Schema
  emit); `docs/typeset-layout-contract.md`, `docs/job-queue-worker.md`
- Verify: `apps/api` lưu output prepare nguyên khối (không lọc trường) — nếu có map tay thì thêm 2 trường.

## Implementation Steps
1. `textcolor.py` + unit test trên ảnh tổng hợp (vẽ chữ bằng PIL lên nền).
2. Hook vào `build_text_mask` + prepare; thêm trường schema Python + shared; `schema:emit`.
3. `style_for` mới + test `test_typeset_*` (bổ sung test gọi thẳng `style_for`).
4. Chạy `mtl` CLI trên 2-3 trang mẫu trong repo (nếu có) và soi ảnh render; ghi nhận ngưỡng ΔE/tương phản đã chọn.
5. Cập nhật hợp đồng layout mục fill/stroke + doc worker; tăng `PIPELINE_VERSION`.

## Tests (worker, ảnh tổng hợp)
- Chữ đỏ trên bóng trắng → fill đỏ, viền trắng.
- Chữ trắng viền đen trên nền art sẫm/sặc sỡ → fill trắng, viền đen (outline phát hiện được).
- Chữ vàng nhạt trên nền trắng, không viền → fallback đen (tương phản < 3:1).
- Chữ đen gần đen (`#0b0a0c`) → snap `#000000`.
- Region không có `text_color` → kết quả y hệt rule polarity cũ.
- zod: page state không có 2 trường vẫn parse; có trường sai định dạng → lỗi.

## Success Criteria
- [x] Test trên xanh; test typeset/polarity cũ không đổi.
- [ ] Soi mắt ≥ 3 trang thật có chữ màu: màu chữ dịch khớp tông chữ gốc, đọc rõ.
- [x] Editor hiển thị đúng fill/stroke mới (đã có sẵn, chỉ kiểm); `contrastStroke` đổi sang ngưỡng luma 128 khớp worker.

## Risk Assessment
- Mask lẹm viền bóng → ring lấy nhầm nét viền bóng thành outline. Giảm: dải ring mỏng, yêu cầu ring khác nền sạch
  **và** chiếm đủ tỉ lệ quanh nét; sai thì vẫn đọc được vì fill đã qua kiểm tương phản.
- Chữ gradient/hiệu ứng → median ra màu trung gian; chấp nhận, người dùng sửa tay.
- `mask_source = "none"` → không có màu → fallback polarity.
- Rollback: revert worker (trường optional, dữ liệu đã lưu vô hại).

## Ghi chú hoàn thành
- Ngưỡng: viền ΔE>20 (CIE76) so với nền và chữ; snap đen/trắng ΔE<12; tương phản WCAG ≥3; viền đen khi luma>128.
- Mục "soi mắt ≥3 trang thật" chưa tick: repo không có trang mẫu (chỉ `worker/tests/reference/render_lines.png`).
