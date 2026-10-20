# Phase 1 — kết quả benchmark pipeline (KO manhwa, 2 giai đoạn)

> **Trạng thái: CHƯA ĐO trên golden set.** Chưa có API key LLM và chưa gán nhãn golden set → các chỉ tiêu gate
> dưới đây chưa có số. Theo chỉ đạo owner (20/10/2026): **gate coi là GO tạm**; chạy `mtl bench` khi có key +
> golden rồi điền bảng và chốt lại GO/NO-GO.

Máy dev: Apple M6, 12 nhân, onnxruntime 1.31.0 **CPUExecutionProvider**, Pillow 13.0.0 + raqm 0.11.0, OpenCV 5.0.0.

## Gate (golden KO, báo cáo theo tầng)

| Chỉ tiêu | Ngưỡng GO | Kết quả | Ghi chú |
|---|---|---|---|
| Recall bóng thoại (`text_bubble`) | ≥ 90%, không tầng nào < 80% | chưa đo | `recall_text_bubble` (khớp IoU ≥ 0.5, 1-1); xem kèm `precision_text` |
| Recall `text_free` (trừ SFX) | ≥ 75% | chưa đo | `recall_text_free` |
| OCR LLM CER (giai đoạn 1) | ≤ 6% | chưa đo | `ocr_cer` = OCR trên crop GT (tách khỏi lỗi detect); `e2e_cer` = trên box detect đã khớp |
| Chấm mù bản dịch VI (ngữ cảnh cuộn) | TB ≥ 3.5/5 | chưa đo | `blind.html` + `blind_key.json`; ghi chênh so với nhánh `none` |
| Bịa trên crop rỗng (≥ 50 mẫu) | ≤ 2% | chưa đo | `empty_hallucination_rate` |
| Inpaint không cần sửa tay | ≥ 80% (đảo màu ≥ 70%), không seam ở 100% | chưa đo | owner soi `pages/*/clean.png` |
| Giai đoạn 1 p50 (CPU EP, page ≤ 6000px) | ≤ 30 s/trang | chưa đo | `stage1_p50_s` (gồm OCR LLM) |
| Chi phí LLM 2 giai đoạn | ≤ $0.005/trang | chưa đo | `llm_cost_usd_per_page_total` (OCR box detect + dịch ngữ cảnh cuộn); model chưa có trong `PRICES_PER_MTOK` → bench báo lỗi, không tính $0 |
| Parity Konva ↔ Pillow | ≤ 1px bbox mực/dòng trên 20 box + soi mắt 5 trang | **đạt phần đo tự động** (33 dòng, lệch tối đa 1px); soi mắt: chưa | xem dưới |

**Quyết định gate: GO (tạm)** — chờ số đo thật. Nhánh NO-GO giữ nguyên như phase file.

## Đã đo được (không thuộc gate)

### Spike parity layout chữ — 20/10/2026

`worker/spikes/typeset-parity` (Playwright 1.64.0, Chromium headless shell, Konva 10.7.0): 20 TextBox (5 font,
cỡ 18–47.5px gồm cỡ lẻ .5, stroke 0/1.5/2/3.5px, 1–3 dòng, dấu chồng `ếệỗửữẫ` / `ẤẬỖỬỮẪ`, 3 kiểu căn lề).

| Lượt | Cách vẽ server | Dòng lệch > 1px | Lệch tối đa |
|---|---|---|---|
| 1 | Pillow `stroke_width` | 14 / 33 | 2px (viền trên dày hơn) |
| 2 | stroke dựng bằng dilate 4× | 1 / 33 | 2px (dấu chồng Be Vietnam Pro 40px, do hinting) |
| 3 (chốt) | glyph + stroke dựng ở 4× | **0 / 33** | **1px** |

Chênh advance dòng giữa raqm và canvas ≤ 0.03px. Quyết định ghi vào `docs/typeset-layout-contract.md`.

### Thời gian giai đoạn 1 không LLM — ảnh tổng hợp

Strip tổng hợp 720×3200 (4 bóng, 1 khung lời dẫn đảo màu, 1 bóng rỗng; 3 tile): detect 1.00 s, mask
(comic-text-detector + tinh) 1.77 s, inpaint < 0.01 s (toàn flood-fill theo ROI). **Chỉ để tham khảo**, không phải
golden. LaMa chạy 1 lượt cho mỗi nhóm thành phần gần nhau (không phải mỗi chữ 1 lượt).

### Font tiếng Việt

`scripts/font_glyph_check.py`: Be Vietnam Pro (Regular/Bold), Patrick Hand, Itim, Mali, Baloo 2, Anton, Lexend
đều đủ 146 chữ cái tiếng Việt (NFC). Mặc định: `PatrickHand-Regular` (thoại), `BeVietnamPro-Regular` (lời dẫn),
`Anton-Regular` (nhấn mạnh) — owner duyệt lại khi soi bench.

## Cách chạy bench (khi có key + golden)

```sh
cd worker
uv sync && uv run python scripts/fetch_models.py      # weights theo models.lock.json
export GEMINI_API_KEY=… ANTHROPIC_API_KEY=…           # không commit
HF_HUB_OFFLINE=1 uv run mtl bench ../golden --providers gemini,anthropic
```

Golden (local, **không commit**, `golden/` đã trong `.gitignore`):

```
golden/images/*.png      ~30 slice KO strip; đủ ≥ 200 bóng có chữ, ≥ 50 crop rỗng, mỗi tầng ≥ 20
golden/labels.json       COCO export từ Label Studio; category "<kind>:<tầng>"
                         kind ∈ {text_bubble, text_free}; tầng ∈ {white, color, inverted, over_art};
                         thêm "empty" (crop rỗng) và "sfx" (bỏ khỏi recall)
golden/truth.jsonl       {"ann_id": <id annotation COCO>, "text": "<chữ KO đúng>"}
```

Ground truth OCR: chạy OCR bằng provider **so sánh** (`claude-haiku-5-5`, không phải provider mặc định), owner
sửa từng dòng → `truth.jsonl`.

Bench tự chờ theo `retry-after`/backoff khi bị 429 hoặc lỗi tạm (lỗi 4xx vĩnh viễn thì dừng), ghi `bench.csv`
sau mỗi provider. Chi phí phụ của bench (OCR crop GT, crop rỗng, nhánh không ngữ cảnh) tách ở `bench_extra_cost_usd`.

Đầu ra `golden/_bench/`: `bench.csv` (metric, provider, tier, value, n), `pages/<slice>/` (mask, clean, OCR,
`state.<provider>.<rolling|none>.json`, `final.*.png`), `blind.html` (chấm mù, nút tải điểm JSON),
`blind_key.json` (giải mã — mở sau khi chấm).

## Việc còn lại để chốt gate

1. Gán nhãn golden (Label Studio, ~1d) + sinh/sửa `truth.jsonl`.
2. Có `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`; kiểm lại giá trong `PRICES_PER_MTOK` và model mặc định
   (`MTL_GEMINI_MODEL`, mặc định pin `gemini-2.5-flash`; đổi model thì thêm giá vào bảng, model chưa có giá → bench báo lỗi).
3. `mtl bench`, owner chấm `blind.html`, soi inpaint + parity 5 trang → điền bảng gate, chốt GO/NO-GO.
