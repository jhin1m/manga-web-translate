# Hợp đồng layout chữ (Pillow+raqm ↔ Konva)

Nguồn sự thật cho cách vẽ `TextBox.lines[]`. Server (`worker/mtl_pipeline/render.py`, dùng cho auto-typeset và
export Phase 6) và editor (Phase 5, react-konva) **phải** cùng tuân theo. Phase 2 ghi kiểu dữ liệu vào
`packages/shared/src/page-state.ts`. Đã kiểm bằng spike `worker/spikes/typeset-parity/` (20 box, 33 dòng,
lệch bbox mực từng dòng ≤ 1px — xem `benchmarks/phase-01-results.md`).

## TextBox

| Trường | Ý nghĩa |
|---|---|
| `x, y, w, h` | Khung box, px trên page (float). |
| `rotation` | Độ, chiều kim đồng hồ, quay quanh **tâm box**. |
| `font_family` | `font_id` = tên file font không đuôi trong `worker/fonts/` (vd. `PatrickHand-Regular`); khoá của `fonts/manifest.json`. |
| `font_size` | px theo em (canvas `${size}px`, Pillow `truetype(size)`). |
| `line_height` | Hệ số nhân bước dòng (mặc định 1.15). |
| `pad` | Lề trong (px). |
| `align` | `left` \| `center` \| `right`. |
| `fill` | Màu chữ. |
| `stroke` | `{color, width}`; `width` = bề rộng viền **ra ngoài** glyph (px). |
| `lines[]` | Các dòng **đã ngắt sẵn**. Server chỉ vẽ, không tự ngắt lại. |

## Quy tắc

1. **NFC**: mọi chuỗi chuẩn hoá Unicode NFC trước khi đo và vẽ (cả browser và server).
2. **Metric từ file font**: `ascent`, `descent`, `unitsPerEm` lấy từ `worker/fonts/manifest.json`, do
   `scripts/font_glyph_check.py` sinh từ bảng font: nếu `OS/2.fsSelection` có bit `USE_TYPO_METRICS` → `sTypoAscender`
   / `-sTypoDescender`; ngược lại `hhea.ascent` / `-hhea.descent`. **Không** dùng metric trình duyệt
   (`fontBoundingBoxAscent`…) hay của Konva.Text.
   `ascentPx = ascent · size / unitsPerEm`, tương tự `descentPx`.
3. **Baseline** dòng `i`: `box.y + pad + ascentPx + i · (ascentPx + descentPx) · line_height`.
4. **Toạ độ x** (pen origin) dòng: `box.x + pad`, cộng `(w − 2·pad − advance)/2` khi `center`, `w − 2·pad − advance`
   khi `right`. `advance` đo trên chính renderer (Pillow `getlength` với raqm; canvas `measureText().width`) —
   spike đo chênh advance ≤ 0.03px.
5. **Stroke**: viền ngoài `w` với join tròn (Minkowski glyph ⊕ đĩa bán kính `w`), vẽ **trước**, fill vẽ **đè** lên.
   - Konva: `lineWidth = 2w`, `lineJoin = "round"`, `strokeText` rồi `fillText` (tương đương
     `strokeWidth = 2w` + `fillAfterStrokeEnabled = true`).
   - Pillow: **không** dùng `stroke_width` (offset bị làm tròn → viền trên dày hơn canvas 1–2px, đo ở spike).
     `render.py` dựng mask glyph ở 4× rồi `dilate` bằng đĩa bán kính `4w`, thu nhỏ về 1×.
6. **Glyph ở server** cũng vẽ 4× rồi thu nhỏ: hinting FreeType ở 1× làm dấu chồng (Ô, Ư, ỗ…) lệch 1–2px so với
   canvas (không hinting); ở 4× còn ≤ ¼ px.
7. **raqm bắt buộc**: `PIL.features.check("raqm")` sai → worker từ chối chạy (`RaqmMissing`), không fallback
   basic layout. macOS: `brew install libraqm`; Linux: wheel manylinux của Pillow đã kèm raqm.
8. **Chỉ chữ ngang** (không có chữ dọc trong MVP).

## Editor (Phase 5)

Không dùng `Konva.Text` để vẽ chữ cuối cùng: baseline của nó theo metric trình duyệt, vi phạm quy tắc 2–3.
Dùng `Konva.Shape` tuỳ biến (mẫu trong `worker/spikes/typeset-parity/parity.spec.ts`): đặt `font`,
`textBaseline = "alphabetic"`, tính `x`/baseline theo quy tắc 3–4, vẽ stroke rồi fill theo quy tắc 5.
Font nạp qua `FontFace` từ đúng file trong `worker/fonts/`.
`rotation` quay quanh **tâm box**: Konva mặc định quay quanh góc trái-trên, nên node phải đặt
`offsetX = w/2`, `offsetY = h/2` và `x = box.x + w/2`, `y = box.y + h/2`. Spike chưa đo parity khi có xoay.

## Gate parity

- Đo: mỗi dòng vẽ riêng trên nền trong suốt, bbox các pixel alpha ≥ 128, so từng cạnh.
- Ngưỡng: ≤ 1px mọi cạnh, mọi dòng + owner soi mắt 5 trang.
- Chạy: `cd worker/spikes/typeset-parity && pnpm install && pnpm exec playwright install --only-shell chromium && pnpm test`
  (Node ≥ 24).
