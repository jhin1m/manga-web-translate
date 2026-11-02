# Brainstorm: font theo kiểu chữ + hiệu ứng chữ

Ngày 2026-11-02. Trạng thái: user đã duyệt cả 2, làm A trước.

## Yêu cầu gốc
"Tự detect font gốc để chọn font gần giống; màu chữ theo chữ gốc, thêm gradient?"

## Hiện trạng (scout)
- Màu gốc ĐÃ có: worker đo `region.text_color`/`outline_color` (`worker/mtl_pipeline/textcolor.py`), typeset giữ màu gốc nếu tương phản ≥ 3 (`typeset.py` `style_for`). Contract: `docs/typeset-layout-contract.md`.
- Không có nhận font. Report koharu đã loại font detector 6150 lớp (không khớp bộ 35 font).
- Nguồn `ko/ja/zh/en` → chữ gốc là font CJK; so hình dạng với font Latin/VN vô nghĩa (trừ nguồn en).
- Translate (`translate_batch.md`) chỉ nhận text, không ảnh. OCR (`llm` vision mặc định / `manga_ocr` / `paddle_ocr` local) là call riêng.
- Series `default_fonts` = jsonb (`packages/db/src/schema/app.ts:77`) → thêm khoá không cần migration.
- `fill` = 1 hex; editor Konva ↔ export Pillow (`render.py`) phải lệch ≤ 1px, có gate `scripts/typeset-parity.ts`.

## Quyết định của user
- Font: nhận **kiểu chữ** → font theo slot series (không nhận font hình học).
- Thêm kiểu: **Suy nghĩ/nói thầm**, **Viết tay/ghi chú** (+ Thoại, Dẫn truyện sẵn có).
- Không chắc → rơi về Thoại; editor có ô "Loại chữ" để đổi nhanh.
- Màu gốc: không có lỗi cụ thể; user muốn "hiệu ứng edit đẹp" → giao mình chọn.
- Gradient: làm sau.

## Phương án đã cân nhắc
| Phương án | Kết luận |
|---|---|
| Model nhận font (koharu/YuzuMarker) | Loại: lớp Google Fonts/CJK không map được sang 35 font |
| So hình glyph crop vs font render sẵn | Chỉ hợp nguồn en → loại |
| LLM dịch phân loại kiểu (text-only) | **Chọn**: ~0 chi phí thêm, mọi ngôn ngữ; độ chính xác khá (không thấy hình bóng) |
| Thêm ảnh vào call dịch để thấy bóng mây | Để sau: tăng token đáng kể; đo lại nếu A sai nhiều |
| Bóng mờ / glow | Loại: blur Konva ≠ cv2 → khó giữ ≤ 1px |
| Viền đôi + bóng đổ cứng | **Chọn**: tái dùng mask glyph dilate hiện có, parity giữ được |

## Thiết kế A — kiểu chữ → font
- `Region.style?: "normal" | "thought" | "note"` (shared `page-state.ts` + worker `schema.py`); thiếu = `normal`.
- `TranslateItem.style` (default `normal`); prompt: ngoặc （…）/(…), độc thoại → `thought`; chữ ngoài bóng nhỏ kiểu ghi chú/viết tay → `note`; không chắc → `normal`.
- Series slot mới `thought`, `note` (jsonb, không migration). Fallback (chốt ở plan): slot trống → font theo kind như `normal` (text_free → narration → dialogue; còn lại dialogue).
- Payload job: `thought_font?`, `note_font?` optional (như `narration_font`); deploy worker trước API.
- `typeset.py:197 font_for` chọn theo style rồi kind.
- Editor: Properties thêm select "Loại chữ" → set `region.style` (nếu box có region) + `font_family` = slot series tương ứng. Form/sidebar series thêm 2 ô.
- Touchpoints: `packages/shared/src/{page-state,job}.ts`, `worker/mtl_pipeline/{schema,translate,typeset,pipeline}.py`, `prompts/translate_batch.md`, `apps/api/src/jobs/{enqueue,claim-inputs}.ts`, `apps/api/src/routes/series.ts`, `apps/web/src/features/series/{series-settings-form,series-sidebar}.tsx`, `apps/web/src/features/editor/{panels/Properties.tsx,actions.ts}`, `chapter-workspace.tsx`.

## Thiết kế B — hiệu ứng chữ
- `TextBox.stroke2?: {color, width} | null` (viền ngoài cùng, width tính thêm ra ngoài viền 1), `TextBox.shadow?: {color, dx, dy} | null` (cứng, không blur).
- Thứ tự vẽ: shadow (lớp ngoài cùng dịch dx,dy) → stroke2 (dilate w1+w2) → stroke1 → fill.
- Pillow: tái dùng `_line_alpha` với w khác + offset. Konva: thêm lượt strokeText lineWidth 2(w1+w2), shadow = vẽ lớp ngoài cùng lệch dx,dy.
- Auto-typeset không set hiệu ứng (chỉ tay). Properties: mục "Hiệu ứng" thu gọn mặc định.
- Contract doc + gate parity: thêm box có stroke2/shadow; tràn margin render tính thêm w2 + |dx|,|dy|.
- Touchpoints: `page-state.ts`, `worker/mtl_pipeline/render.py`, `canvas/TextBoxNode.tsx`, `panels/Properties.tsx`, `scripts/typeset-parity.ts`, `docs/typeset-layout-contract.md`, `docs/editor.md`.

## Tiêu chí nghiệm thu
A:
- Chương mới: region có `style`; box `thought`/`note` dùng font slot tương ứng; slot trống → fallback đúng.
- Trang/job cũ (không style, không trường font mới) chạy y như trước.
- Đổi "Loại chữ" trong editor đổi font + lưu được, undo được.
- Test worker (prompt schema, font_for), API (payload), web (action) xanh.
B:
- Gate parity ≤ 1px với box có stroke2 và shadow, mọi font không bị loại trừ.
- Box cũ không có trường mới render y hệt.
- Export PNG/CBZ khớp editor.

## Rủi ro
- A: LLM text-only đoán `thought` kém với bóng mây không ngoặc → mitigated bởi fallback Thoại + đổi nhanh. Đo trên vài chương thật; nếu tệ cân nhắc gửi thumbnail.
- A: thêm trường output tăng token dịch nhẹ (~1 token/vùng).
- B: margin layer render/rotation phải tính thêm hiệu ứng, không thì bị cắt.
- B: thay đổi contract → giữ trường optional, không bump hành vi box cũ.

## Ngoài phạm vi
Gradient, preset kiểu, bóng mờ/glow, nhận font hình học, SFX, hút màu từ ảnh (E4), gửi ảnh vào call dịch.

## Câu hỏi còn mở
- Khi đổi font slot series, box đã có trong chương cũ có đổi theo không? Đề xuất: không (giống slot hiện tại).
