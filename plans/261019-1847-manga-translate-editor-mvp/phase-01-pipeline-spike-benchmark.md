---
phase: 1
title: "Spike & benchmark pipeline (KO manhwa, 2 giai đoạn)"
status: completed
priority: P1
effort: "5d"
dependencies: []
---
# Phase 1: Spike & benchmark pipeline (Python CLI trên Mac, chỉ KO)

## Overview
Dựng pipeline **2 giai đoạn** dưới dạng package Python dùng lại được (không phải code vứt đi) và đo trên golden set **KO manhwa** (red team #10):
- **Giai đoạn 1 — theo trang, song song:** detect → text mask (có cực tính) → inpaint → OCR bằng LLM vision (chỉ chép chữ, gọi cuối cùng để artifact trước LLM không mất khi provider lỗi).
- **Giai đoạn 2 — theo chương, tuần tự:** dịch gộp nhiều trang/call theo thứ tự trang, kèm glossary + quy tắc xưng hô + ngữ cảnh cuộn → typeset (red team #5).
Kèm spike hợp đồng layout chữ Pillow+raqm ↔ Konva (red team #11). Kết thúc bằng gate go/no-go.

JA/ZH/EN, OCR local (manga-ocr, RapidOCR), baseline Torii → **sau MVP** (red team #10).

## Requirements
- **Chỉ KO manhwa strip** (user chốt KO trước, 20/10/2026; red team #10 cắt phần còn lại khỏi gate).
- Golden set (local, **không commit**, `.gitignore`): ~30 slice KO strip, chọn sao cho đủ **cỡ mẫu tối thiểu ≥ 200 bóng có chữ và ≥ 50 crop rỗng**; thiếu thì thêm slice. Phân tầng loại bóng: **trắng / màu / đảo màu (chữ trắng nền tối) / chữ đè art**; mỗi tầng ≥ 20 mẫu, báo cáo số đo theo tầng (red team #10).
- Gán nhãn box bằng **Label Studio** (local, 1d, export COCO) (red team #10).
- Ground truth OCR = OCR của LLM **provider so sánh** (không phải provider mặc định, tránh thiên vị) → owner sửa từng dòng → `truth.jsonl` (red team #10).
- 1 provider mặc định (Gemini Flash-class) + 1 provider so sánh (`claude-haiku-5-5`) (red team #10).
- Detect + mask: **không tự viết phần đã có sẵn**. RT-DETRv2 (ogkalu) cho box bóng/chữ; `comic-text-detector` (ONNX `comictextdetector.pt.onnx` từ release manga-image-translator) cho mask chữ mức pixel. Chép từ manga-image-translator: pre/post-process của comic-text-detector, `mask_refinement` (tinh mask + giãn), ghép textline thành vùng, pre/post-process LaMa.
- Inpaint: flood-fill + LaMa (big-lama ONNX); MI-GAN/OpenCV Telea chỉ khi LaMa quá chậm (red team #10).
- Được dùng/chép code và model từ bất kỳ repo nào (kể cả GPL) nếu nhanh hơn tự viết; ghi nguồn trong comment để Phase 8 rà.
- Python 3.12, `uv`; onnxruntime **CPU EP là chuẩn đo**; CoreML EP chỉ thử tuỳ chọn, không đưa vào gate (onnxruntime không có "MPS" EP) (red team #15).
- Weights: chỉ `.onnx`/`.safetensors` (không pickle/`.pt`/`.ckpt`); `worker/models.lock.json` (URL, revision, sha256); `HF_HUB_OFFLINE=1` khi chạy bench và production (red team #15).
- Thinking tắt/thấp nhất cho mọi call LLM; ghi token in/out thực tế.

## Architecture
Package `worker/mtl_pipeline/` (Phase 3 bọc thành worker):
```
detect.py        RT-DETRv2 ONNX; tile(h_window=1.25*w, overlap=20%); merge box qua IoU/union ở mép tile; class bubble|text_bubble|text_free
textmask.py      chạy comic-text-detector ONNX theo cùng tile → mask chữ pixel; cắt mask theo box RT-DETRv2; refine + giãn 2–6px
                 (chép mask_refinement của manga-image-translator); KHÔNG phải cả lòng bóng → giữ đuôi bóng/viền (red team #15)
                 fallback: box không có mask từ model → threshold theo cực tính (histogram + viền) tự viết
vendor/          code chép nguyên từ manga-image-translator (comic_text_detector/, mask_refinement.py, lama pre/post); mỗi file ghi nguồn + commit ở đầu file
inpaint.py       interface Inpainter; FloodFillInpainter (chỉ trên mask chữ giãn, nền phẳng), LamaInpainter (crop 512 quanh mask)
ocr.py           giai đoạn 1: LLMProvider.ocr_page(OcrRequest) -> OcrResult (chỉ chép chữ, không dịch)
translate.py     giai đoạn 2: LLMProvider.translate_batch(TranslateRequest) -> TranslateResult (gộp nhiều trang)
providers/       base.py, gemini.py, anthropic.py (structured JSON output); phân loại lỗi provider/rate_limit/schema (dùng ở Phase 3)
typeset.py       distance transform → hình chữ nhật nội tiếp; binary search cỡ chữ; wrap greedy theo từ; xuất TextBox + lines[]
render.py        vẽ lines[] theo hợp đồng layout (dưới); dùng chung cho auto-typeset và export (Phase 6)
images.py        mở ảnh an toàn: đọc header trước, trần 16384px/cạnh, ~60MP/file, Image.MAX_IMAGE_PIXELS (red team #12, dùng ở Phase 3)
models.py        đọc models.lock.json, kiểm sha256 khi khởi động, từ chối định dạng không phải onnx/safetensors
schema.py        pydantic: Region, OcrResult, TextBox, PageAiState (nguồn cho JSON schema dùng chung Phase 2)
cli.py           mtl prepare <dir> | mtl translate <dir> --context rolling|none | mtl run <dir> (cả 2 giai đoạn)
bench.py         chạy golden set, xuất bench.csv (theo tầng) + HTML so sánh mù side-by-side
spikes/typeset-parity/  Playwright + Konva headless vẽ cùng TextBox → so bbox glyph với render.py
```

### Hợp đồng LLM (red team #5)
Giai đoạn 1 — OCR, 1 call/trang:
```json
// request: crops đánh id (đã chuẩn hoá cực tính) ; KHÔNG gửi thumbnail cạnh dài 1024 (strip KO chỉ còn ~136px bề rộng).
//          Nếu cần ảnh ngữ cảnh: tile theo bề rộng (cạnh ngắn ≥ 512px), chỉ bật khi bench chứng minh có ích.
// response:
{"items":[{"id":"r3","source":"…","is_sfx":false,"empty":false,"confidence":0.9}]}
```
Giai đoạn 2 — dịch, 1 call / lô K trang liên tiếp (mặc định 4 trang hoặc ≤ 40 vùng, cái nào tới trước):
```json
// request: pages[{ord, regions[{id, kind, bbox_norm, source}]}] theo thứ tự đọc + glossary series + pronoun_rules
//          + honorific_policy + ngữ cảnh cuộn (≤ 12 dòng nguồn+dịch cuối của lô trước, danh sách nhân vật/xưng hô đã dùng)
// response:
{"items":[{"id":"r3","translation":"…","speaker":"?"}],"context_notes":"…"}
```
Ước tính chi phí trước bench (giá provider phải kiểm lại lúc chạy, red team #5): giai đoạn 1 ~1.5k token vào (crops) + ~0.3k ra/trang; giai đoạn 2 ~0.8k vào (glossary + ngữ cảnh chia đều cho lô 4 trang) + ~0.4k ra/trang → ~2.3k vào + ~0.7k ra/trang, dưới trần $0.005/trang ở model Flash-class. Bench ghi token thật và thay số này.

Mỗi page ghi `meta.context_used` = `rolling|neighbors|none` (red team #5).
Chống bịa: lọc crop có mật độ mực < ngưỡng trước khi gửi; `empty:true` khi không có chữ; validate đủ id; thiếu/thừa id → retry 1 lần trong worker rồi đánh cờ `low_conf`.

### Hợp đồng layout chữ (red team #11) — chốt ở spike này, Phase 2 ghi vào `packages/shared/src/page-state.ts`
- Text chuẩn hoá **NFC** trước khi đo/vẽ (cả browser và server).
- Baseline dòng i = `box.y + pad + ascent + i·(ascent+descent)·line_height`, ascent/descent đọc từ bảng `hhea`/`OS/2` của **file font** (không dùng metric trình duyệt).
- `stroke.width` = bề rộng **ra ngoài** glyph. Pillow: `stroke_width=w`; Konva: `strokeWidth=2w` + `fillAfterStrokeEnabled=true`.
- Pillow **bắt buộc raqm** (`PIL.features.check('raqm')`, không có → worker từ chối khởi động); không fallback basic layout.
- Gate so khớp: lệch bbox glyph từng dòng ≤ 1px + owner soi mắt 5 trang (bỏ pixel-diff %).

## Related Code Files
Create:
- `worker/pyproject.toml`, `worker/uv.lock`, `worker/.python-version`, `worker/models.lock.json`
- `worker/mtl_pipeline/{__init__,detect,textmask,inpaint,ocr,translate,typeset,render,images,models,schema,cli,bench}.py`
- `worker/mtl_pipeline/providers/{base,gemini,anthropic}.py`
- `worker/mtl_pipeline/vendor/` (code chép từ manga-image-translator, giữ gần nguyên bản để dễ so/cập nhật)
- `worker/mtl_pipeline/prompts/{ocr_page.md,translate_batch.md}`
- `worker/models/README.md` (trỏ tới `models.lock.json`; weights không commit)
- `worker/fonts/` (font đủ dấu tiếng Việt) và `worker/scripts/font_glyph_check.py`
- `worker/spikes/typeset-parity/{package.json,parity.spec.ts,render_boxes.py}`
- `worker/tests/{test_tiling_merge.py,test_textmask_polarity.py,test_typeset_fit.py,test_llm_contract.py,test_image_limits.py,test_models_lock.py}`
- `docs/benchmarks/phase-01-results.md`, `docs/typeset-layout-contract.md`
- `.gitignore` (golden/, worker/models/*.onnx, *.safetensors, .env)

## Implementation Steps
1. `uv init worker`; thêm onnxruntime, numpy, opencv-python-headless, pillow, pydantic, httpx, google-genai, anthropic. Kiểm `PIL.features.check('raqm')`; build Pillow có raqm (libraqm qua Homebrew/manylinux) — bắt buộc.
2. Golden set: chọn ~30 slice KO, gán box trong Label Studio (1d), đếm mẫu theo tầng; thiếu cỡ mẫu → thêm slice.
3. Tải weight RT-DETRv2 ONNX + `comictextdetector.pt.onnx` + big-lama ONNX; ghi `models.lock.json`; `models.py` kiểm sha256, từ chối pickle.
4. Chép vào `vendor/` từ manga-image-translator: comic-text-detector (pre/post-process ONNX), `mask_refinement`, pre/post LaMa; chạy thử trên 3 slice trước khi nối vào pipeline.
5. `detect.py` + tiling; test merge box trên ảnh tổng hợp có bóng vắt qua ranh giới tile.
6. `textmask.py`: mask comic-text-detector ∩ box RT-DETRv2 + refine/giãn; fallback cực tính; test trên 4 tầng (trắng/màu/đảo màu/đè art).
7. `inpaint.py` flood-fill + LaMa (pad 32px, ghép bằng mask feather).
8. `ocr.py` + 2 provider; sinh ground truth từ provider so sánh, owner sửa.
9. `translate.py` gộp lô + ngữ cảnh cuộn; prompt tiếng Việt (xưng hô, kính ngữ KO -nim/-ssi giữ hay chuyển, tên riêng theo glossary).
10. `typeset.py` + `render.py` theo hợp đồng layout; glyph test "ếệỗửữẫ" trên Be Vietnam Pro, Patrick Hand, Itim, Mali, Baloo 2, Anton, Lexend; chọn 2–3 font mặc định; `font_glyph_check.py` xuất `worker/fonts/manifest.json` (unitsPerEm, ascent, descent từ `hhea`/`OS/2`) để editor (Phase 5) dùng cùng metric.
11. Spike parity: 20 TextBox mẫu (có stroke, nhiều dòng, dấu chồng) → Konva headless vs `render.py`, so bbox glyph từng dòng.
12. `bench.py` 2 giai đoạn × 2 provider; nhánh **không ngữ cảnh** (dịch từng trang riêng) chạy thêm 1 lượt vì giai đoạn 2 chỉ là text (rẻ, < $0.10 cho cả golden set) để đo lợi ích ngữ cảnh. HTML so sánh mù (ẩn tên model/nhánh).
13. Viết `docs/benchmarks/phase-01-results.md` + quyết định gate.

## Success Criteria
Gate **GO** khi đạt hết (trên golden KO, đúng cỡ mẫu tối thiểu, báo cáo theo tầng):
- [ ] Detection recall bóng thoại ≥ 90%, text_free (không tính SFX) ≥ 75%; không tầng nào < 80% với bóng thoại.
- [ ] OCR qua LLM (giai đoạn 1): CER ≤ 6% so với `truth.jsonl`.
- [ ] Owner chấm mù bản dịch VI (2 giai đoạn, ngữ cảnh cuộn) trung bình ≥ 3.5/5; ghi chênh lệch so với nhánh không ngữ cảnh.
- [ ] Crop rỗng (≥ 50 mẫu): tỉ lệ bịa ≤ 2%.
- [ ] Inpaint: ≥ 80% vùng chữ trong bóng không cần sửa tay, đuôi bóng/viền còn nguyên; tầng đảo màu ≥ 70%; seam mép tile không thấy ở zoom 100%.
- [ ] Mac M-series, onnxruntime **CPU EP**: giai đoạn 1 p50 ≤ 30s/trang (page logic ≤ 6000px); chi phí LLM tổng 2 giai đoạn ≤ $0.005/trang (token đo thực, không thinking).
- [ ] Spike parity: lệch bbox glyph ≤ 1px trên 20 box mẫu + owner soi mắt 5 trang không thấy khác (red team #11).

**NO-GO / điều chỉnh:** recall < 80% → thử RF-DETR seg của Koharu hoặc chỉ dùng box của comic-text-detector; mask đảo màu < 70% → thử mask/inpaint pipeline của BallonsTranslator; dịch < 3/5 → thử model premium, đổi default + ghi giá; Mac CPU > 60s/trang → local chỉ cho dev, Modal sớm hơn; parity > 1px không sửa được → export render bằng Konva headless (Playwright) phía server thay Pillow, ghi lại quyết định.

## Risk Assessment
| Rủi ro | Khả năng × Ảnh hưởng | Giảm thiểu |
|---|---|---|
| SFX/chữ đè art bị xoá xấu | Cao × TB | Cờ `sfx`, mặc định **không** inpaint/dịch SFX; text_free đè art chỉ inpaint khi mask chặt |
| Chữ trắng viền đen / narration đảo màu bị mask sai | TB × Cao | Mask pixel từ comic-text-detector; fallback cực tính theo box; tầng đảo màu đo riêng (red team #15) |
| comic-text-detector train trên manga JA, kém với chữ KO | TB × TB | Đo recall mask riêng theo tầng; kém → dùng fallback cực tính cho box đó |
| Code chép từ manga-image-translator kéo theo dependency nặng (torch) | TB × TB | Chỉ chép phần pre/post-process numpy/opencv, chạy bằng onnxruntime; không import package gốc |
| Xoá cả lòng bóng làm mất đuôi bóng | TB × TB | Mask = vùng giãn của mask chữ (red team #15) |
| Seam tile strip dài | TB × TB | Overlap tile 20% khi detect, merge union ở mép; inpaint crop quanh mask không theo tile |
| LLM bịa trên crop rỗng | TB × Cao | Lọc mật độ mực, `empty` flag, validate id, ≥ 50 mẫu rỗng |
| Ground truth thiên vị provider | TB × TB | Seed từ provider so sánh, owner sửa từng dòng |
| Konva ≠ Pillow (stroke, baseline, shaping) | TB × Cao | Hợp đồng layout + spike parity ngay Phase 1 (red team #11) |
| Thinking token đội chi phí | TB × Cao | Tắt thinking, `max_output_tokens`, assert token out/trang trong bench |
| Weight độc hại (pickle) / tải nhầm revision | Thấp × Cao | Chỉ onnx/safetensors, `models.lock.json` sha256, `HF_HUB_OFFLINE=1` (red team #15) |
| Golden set có bản quyền | — | Chỉ local, không commit, không đưa vào CI |

Rollback: phase chỉ là package độc lập; bỏ được mà không ảnh hưởng phần khác.
