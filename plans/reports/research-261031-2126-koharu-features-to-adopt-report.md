# Research: koharu (koharu-rs/koharu) — gì đáng áp dụng cho manga-web-translate

- Ngày: 2026-10-31 21:26 (Asia/Saigon)
- Nguồn: clone `koharu-rs/koharu` @ `cba6e46` (2026-10-30), đọc README, `AGENTS.md`, `packages/docs/**`, crate `koharu-pipeline`, `koharu-translator`, `koharu-ml`, `koharu-renderer`, `koharu-psd`. Không chạy code koharu, không tải weights.
- License code: MIT / Apache-2.0 (port được). Weights từng model license riêng — để Phase 8 rà.

## Tóm tắt

Koharu = app desktop Rust (Tauri + WebGPU canvas), chạy model local. Khác hẳn kiến trúc mình (web multi-user, worker Python ONNX/LLM API) → **không port kiến trúc**, chỉ lấy kỹ thuật cụ thể.

Kết luận thẳng: ở dịch (glossary, carry ngữ cảnh lô, xưng hô, hiệu đính), màu chữ/viền, bỏ rác credit/watermark, xuất ZIP/CBZ — **mình đã hơn hoặc ngang koharu**. Thứ đáng lấy nằm ở 3 chỗ: **typeset (fit chữ vào bóng thoại)**, **detector layout có lớp SFX + panel**, và vài heuristic inpaint/thứ tự đọc rẻ tiền.

Phát hiện phụ (đã kiểm): font mặc định thoại `Bangers-Regular` có dấu tiếng Việt chồng cao hơn ascender rất nhiều (`Ấ` yMax 1384 vs ascender 883, `Ệ` 1045, `Ữ` 979, upm 1000). Block height của mình tính theo ascent/descent → dấu dòng đầu có thể lòi khỏi khung, dòng trên/dưới có thể chạm nhau. Cần soi mắt xác nhận.

## So sánh nhanh

| Mảng | koharu | Mình | Kết luận |
|---|---|---|---|
| Detector | RF-DETR Seg 2XL: `text`, `onomatopoeia`, `bubble`, `panel` + instance mask | RT-DETR v2 comic / CTD (box) + CTD pixel mask | Lấy ý tưởng; port model đắt |
| SFX | Lớp `onomatopoeia` ở detect → không OCR, không dịch, không xoá | LLM OCR gắn `is_sfx` (sau detect+mask); OCR local không nhận SFX | Gap thật ở OCR local |
| Thứ tự đọc | cây panel → bubble → text, mỗi cấp sort trên→dưới, phải→trái | `rtl_order` theo hàng (`detect.py:132`), không biết panel | Đáng lấy nếu có panel |
| OCR | PaddleOCR-VL 1.6 (VLM), MangaOCR, Baberu, Hayai | LLM / MangaOCR / PaddleOCR ONNX | Hayai/Baberu chỉ bench nếu dọc JA vẫn yếu |
| Inpaint | LaMa, AOT, FLUX.2 Klein, RORem; **flat-fill bóng màu đồng nhất trước LaMa** | Big LaMa / LaMa manga, `FloodFillInpainter` theo vòng | Flat-fill rẻ, cần polygon bóng |
| Dịch | JSON schema native, id-based, `minItems=maxItems=N`, tuỳ chọn gửi ảnh trang | Schema native + lô + carry + glossary + xưng hô + hiệu đính | Mình hơn. Chỉ lấy `min/maxItems` |
| Typeset | fit theo **contour bóng**, độ rộng từng dòng, DP ngắt dòng cân, size search không đơn điệu, cờ "dưới cỡ đọc được" | hình chữ nhật nội tiếp, greedy wrap, binary search, MIN 10px im lặng | **Giá trị cao nhất** |
| Font fallback | theo từng cụm grapheme + script run | 1 font/box, check glyph offline | Thấp (đích chủ yếu vi) |
| Dọc CJK / RTL | Có | Không (contract rule 8) | Bỏ qua |
| Xuất | PNG, **PSD nhiều lớp, text sửa được** (EngineData, verify GIMP) | ZIP/CBZ | Lớn, chỉ làm nếu có nhu cầu |
| Pipeline | 1 stage/1 trang, commit ngay, cửa sổ trang lăn, 1 làn GPU, OOM → unload + retry 1 | Job queue + lô dịch, trang đầu xong sớm | Đã tương đương |
| Agent | LLM agent sửa project (text, typography, chạy pipeline) | Không | YAGNI giai đoạn này |

## Khuyến nghị (xếp theo giá trị / công sức)

### Làm sớm — rẻ, ít rủi ro

1. **Chiều cao block theo mực thật (ink ascent) cho dấu tiếng Việt.** Tính `ink_ascent`/`ink_descent` từ bounds glyph thực (hoặc tập ký tự VN) mỗi font, ghi vào `manifest.json` cạnh `read_metrics` (`worker/mtl_pipeline/fonts.py:30`), dùng chung `typeset.py:159` + `render.py:86` + `apps/web/src/features/editor/measure.ts` → giữ parity. Đổi chiều cao mọi font → bump pipeline version theo `docs/typeset-layout-contract.md`. Trước khi sửa: render `ẤỆỮ` nhiều dòng với Bangers để xác nhận lỗi bằng mắt.
2. **Size search chịu được không đơn điệu.** koharu: dò 8 mốc từ max xuống rồi bisect ≤10 lần (`koharu-renderer/src/layout.rs:194-238`). Mình binary search thuần (`typeset.py:170-178`) có thể bỏ lỡ cỡ lớn hơn khi ngắt dòng làm fit không đơn điệu. Hoặc quét tuyến tính 10→64px (rẻ). Port cả TS `fitText` (`measure.ts:80`).
3. **Cờ "chữ dưới cỡ đọc được / tràn" từ server.** `fit_text` hiện rơi xuống MIN_SIZE + hard-wrap im lặng (`typeset.py:181`). Trả cờ vào page state → editor đã có chỗ hiện "tràn khung", thêm "chữ quá nhỏ". Hợp với ưu tiên "ổn định, dễ soát".
4. **`minItems`/`maxItems` = số segment trong JSON schema dịch** (`koharu-translator/src/prompt.rs` `output_schema`). Provider có structured output sẽ chặn thiếu/thừa khối ngay ở decode, giảm retry `schema`. Kiểm Gemini/Anthropic có tôn trọng 2 trường này không trước khi dựa vào.
5. **`font_glyph_check` thêm dấu câu cong** `“ ” ‘ ’ … — –`: `AnimeAce-Bold`, `MightyZeo-Regular` thiếu em/en dash (agent đo, chưa kiểm lại).

### Làm vừa — cần sửa hợp đồng web ↔ server

6. **Ngắt dòng cân (balanced DP) + phạt theo dấu câu.** koharu `layout.rs:1549-1715`, `1995-2026`: sau `.!?` phạt 0, sau `,;:` 20, trước liên từ 40, trước giới từ 300; DP tối thiểu slack² + overflow³. Tiếng Việt cách âm tiết bằng space → port thẳng (đổi danh sách liên từ/giới từ sang vi: "và, nhưng, mà, thì, của, cho, với…"). Hết dòng cuối cụt 1 chữ. Phải port y hệt sang `measure.ts`.
7. **Độ rộng từng dòng theo hình bóng thoại** (thay vì 1 hình chữ nhật nội tiếp, `typeset.py:36`). Bóng elip: dòng giữa rộng tới ~41% hơn (ước lượng hình học, chưa đo) → cỡ chữ lớn hơn, đỡ "chữ bé trong bóng to". Mình có mask bóng (bubble interior, `typeset.py:74`) → lấy profile ngang theo từng dòng từ mask. Đổi schema `lines[]` (thêm width/offset mỗi dòng) ở `packages/shared` → làm sau 6, có spike đo trước.
8. **Flat-fill bóng nền đồng nhất trước LaMa** (`koharu-pipeline/src/stages/inpainting.rs:586-620`, `773-807`: vùng ≥16px, std mỗi kênh < 7–10, chừa mép 3px → tô màu trung vị, bỏ qua LaMa). Nhắm đúng lỗi "vệt viền / bóng bán trong suốt" trong Giới hạn đã biết. Cần polygon/mask bóng — mình có bubble interior từ mask, dùng được. So với `FloodFillInpainter` hiện tại (`inpaint.py:50`) trên vài trang thật trước khi đổi.

### Để sau / chỉ khi có số đo chứng minh

9. **Detector RF-DETR Seg (`mayocream/koharu-layout-rfdetr-seg-2xl-1152`)**: một model cho text + SFX + bubble + panel + mask → giải SFX cho OCR local, thứ tự đọc theo panel, mask sạch hơn. Nhưng: chỉ có safetensors (LibTorch), phải tự export ONNX + kiểm parity; input ép vuông 1152 không tile → manhwa strip dài mất độ phân giải, phải thêm tiling; mask head 288px. Công sức cao. Nếu làm: spike export ONNX + so recall trên golden set KO/JA với RT-DETR hiện tại.
10. **Thứ tự đọc theo panel** (`detection.rs:1669-1760`): chỉ có nghĩa khi detector trả `panel` → đi kèm 9.
11. OCR Hayai / Baberu: chỉ bench nếu PaddleOCR dọc vẫn tệ sau gate chất lượng.
12. **PSD có text sửa được**: ~2k dòng Rust (EngineData 837 dòng), verify GIMP chứ không phải Photoshop. Chưa có nhu cầu trong roadmap → không làm. Nếu cần nhẹ: PSD chỉ lớp pixel (gốc / sạch / chữ) làm được bằng Python dễ hơn.

### Không lấy

- Kiến trúc Tauri/WebGPU canvas, scene/patch có inverse (mình đã có version + undo + autosave).
- Model local LLM GGUF, FLUX/RORem (GPU nặng, lệch hướng web + Modal).
- Font detector 6150 lớp (không khớp bộ font nhỏ của mình), detector SFX MTSv3+TRBA (koharu cũng không nối vào pipeline).
- Dọc CJK, RTL, hyphenation (không có bảng vi).
- Agent sửa project bằng LLM.

## Bước tiếp theo đề xuất

1. Spike 30 phút: render `ẤỆỮ` nhiều dòng Bangers ở editor + `render.py` → xác nhận lỗi dấu (mục 1).
2. Nếu xác nhận → plan nhỏ gộp mục 1–3 + 5 (1 lần bump pipeline version, 1 lần kiểm parity).
3. Mục 4: thử trên provider thật, rẻ, tách riêng.
4. Mục 6–8: plan riêng sau gate chất lượng Phase 1, mỗi mục có số đo trước/sau trên trang thật.

## File tham chiếu koharu (trong clone scratchpad, không lưu vào repo)

- Pipeline/thứ tự: `crates/koharu-pipeline/README.md`, `src/stages/detection.rs` (layout_order 1669, infer_typography 511), `src/stages/inpainting.rs`
- Dịch: `crates/koharu-translator/src/prompt.rs`
- Typeset: `crates/koharu-renderer/src/layout.rs`, `text_renderer.rs`, `fonts.rs`, `shape.rs`
- PSD: `crates/koharu-psd/src/{document,export,engine_data}.rs`
- Model: `crates/koharu-ml/src/koharu_layout_rfdetr_seg_2xl/`

## Câu hỏi chưa giải quyết

- Xuất PSD có phải mục tiêu sản phẩm không? (Hiện báo cáo xếp cuối.)
- Chấp nhận đổi schema `lines[]` (độ rộng từng dòng) không? Quyết khi có số đo spike mục 7.
- Gemini / Anthropic structured output có thực thi `minItems`/`maxItems` không — chưa kiểm.
- Lỗi dấu Bangers mới đo theo bounds glyph, chưa thấy bằng mắt trên trang thật.
