# Cook report — Phase 1: Spike & benchmark pipeline (KO manhwa, 2 giai đoạn)

Ngày 20/10/2026 · Nhánh `feat/p1-pipeline-spike-benchmark` (worktree `mtl-wt/p1`) · Mode `--auto` · Không merge.
Plan: `plans/261019-1847-manga-translate-editor-mvp/phase-01-pipeline-spike-benchmark.md` (chỉ đổi `status`; `plan.md` không đụng).

## Kết quả
- Package `worker/mtl_pipeline/` (Python 3.12, uv) đủ module theo Architecture: detect (RT-DETRv2 ONNX + tile 1.25w/overlap 20% + merge mép tile + khử trùng lớp chữ), textmask (comic-text-detector ONNX ∩ box, tinh mask vendor, giãn 2–6px, fallback cực tính), inpaint (flood-fill ROI + LaMa gom cửa sổ), ocr/translate (hợp đồng LLM, lọc mực, validate id, retry 1, low_conf, lô ≤4 trang/≤40 vùng, ngữ cảnh cuộn ≤12 dòng, nhánh `none`), providers Gemini/Anthropic (structured JSON, tắt thinking, token thật, lớp lỗi + `retryable` + usage khi lỗi), typeset/render (hợp đồng layout), images (trần 16384px/60MP, đọc 1 lần, EXIF), models (lock + sha256, chặn pickle), pipeline/cli (`mtl check|prepare|translate|run|bench`), bench (recall/precision IoU 1-1, CER crop GT + e2e, bịa crop rỗng, p50, chi phí/trang, retry 429, blind.html).
- `vendor/` chép từ manga-image-translator @ `d6de6ab` (chỉ phần numpy/opencv, ghi nguồn đầu file).
- Weights: 3 ONNX tải về `worker/models/` (gitignore), `models.lock.json` có URL/revision/sha256; `scripts/fetch_models.py`.
- Fonts: 8 file Google Fonts trong `worker/fonts/` + `manifest.json` (unitsPerEm/ascent/descent từ hhea/OS/2), cả 8 đủ 146 chữ cái tiếng Việt; mặc định PatrickHand / BeVietnamPro / Anton.
- Spike parity `worker/spikes/typeset-parity/` (Node ≥24, Playwright 1.64.0, Konva 10.7.0): **20 box / 33 dòng, lệch bbox mực tối đa 1px → đạt phần tự động**. Hai quyết định có bằng chứng: không dùng `stroke_width` của Pillow (lệch 1–2px), dựng glyph + stroke ở 4× (khử lệch do hinting). Ghi ở `docs/typeset-layout-contract.md`.
- Docs: `docs/typeset-layout-contract.md`, `docs/benchmarks/phase-01-results.md` (gate **chưa đo**, quyết định **GO tạm** theo chỉ đạo).
- Môi trường: `brew install libraqm` (raqm 0.11.0), Playwright chromium headless shell.

## Kiểm chứng
- `uv run pytest -q`: **79 passed** (gồm test dùng weight thật: detector merge qua mép tile, LaMa).
- `ruff check`, `ruff format --check`, `mypy` (33 file): sạch. Spike: `tsc` sạch, `pnpm test` pass.
- Smoke giai đoạn 1 trên strip tổng hợp 720×3200: chữ bị xoá, viền/đuôi bóng giữ nguyên, khung đảo màu `light_on_dark`; detect 1.00s, mask 1.77s, inpaint <0.01s (CPU EP, M6).
- Tester subagent: 7/7 hạng mục pass (`tester-261020-p1-pipeline-validation-report.md`).
- Code-reviewer subagent: 6.5/10, 0 Critical / 4 High / 6 Medium / 11 Low (`code-reviewer-261020-p1-pipeline-review-report.md`). **Đã sửa:** H1 (SFX được khôi phục pixel gốc sau OCR), H2 (fallback trên cửa sổ nới + lọc dáng viền), H3 (flood-fill theo ROI, LaMa gom cửa sổ), H4 (pin `gemini-2.5-flash`, model chưa có giá → lỗi), M1 (usage đi kèm ProviderError, retry lần 2 hỏng → dùng kết quả lần 1), M2 (bench retry theo retry-after, ghi csv dần), M3 (IoU 1-1 + precision, CER crop GT tách e2e), M4 (id thiếu ≠ empty), M5 (cờ `retryable`, thu hẹp except Gemini), M6 (lỗi theo trang + `error.txt`, translate từ chối chương thiếu `ocr.json`), L1, L2, L3, L4, L5, L6, L8, L9, L10 (ghi doc), L11. Tester: bỏ box chữ < 10px, khử trùng text_bubble/text_free.
- Mỗi bản sửa có test mới (13 test thêm).

## Bỏ qua / chưa làm
- **Bench thật chưa chạy**: chưa có API key và golden set (Label Studio, truth.jsonl). Mọi chỉ tiêu gate trừ parity tự động = "chưa đo".
- Finalize của skill cook: không chạy project-management sync (sẽ sửa `plan.md` — trái chỉ đạo), không spawn docs-manager (docs phase 1 đã viết trực tiếp), không chạy journal; commit trực tiếp thay vì git-manager.
- CI chưa có (thuộc Phase 2 monorepo); Node 24 chỉ áp vào `engines` của spike.
- Phần docker compose Postgres/MinIO, P7 (systemd, backup, kill-switch, Modal…) và các câu hỏi mở (ntfy, FILES_DOMAIN, token worker) **không thuộc Phase 1** → không làm ở nhánh này.

## Rủi ro / lưu ý cho phase sau
- Phase file vẫn ghi Pillow `stroke_width` cho stroke; thực tế đã đổi (doc contract là nguồn đúng) — lead cập nhật plan khi được phép.
- Editor Phase 5 phải dùng `Konva.Shape` tuỳ biến theo contract (không `Konva.Text`), xoay quanh tâm qua `offset`; parity khi có xoay chưa đo.
- Thứ tự kênh màu input comic-text-detector: theo đường của manga-image-translator (RGB); repo gốc dmMaze có thể đưa BGR — ảnh hưởng nhỏ với ảnh xám, xác nhận khi bench.
- Bảng giá `PRICES_PER_MTOK` (Haiku 5.5 $0.10/$0.50, Gemini 2.5 Flash $0.30/$2.50) phải kiểm lại lúc chạy bench.
- Ngưỡng heuristic (MIN_INK_RATIO, MIN_TEXT_SIDE, dáng viền 0.8/0.2, ring flood-fill) chưa hiệu chỉnh trên golden.

## Câu hỏi mở
1. M5: Phase 3 dùng `retryable=False` để fail job ngay, hay owner muốn thêm lớp lỗi thứ 4 (`fatal`)? Hiện giữ 3 lớp theo spec.
2. Model Gemini mặc định: giữ `gemini-2.5-flash` hay chuyển Gemini 3 Flash (cần giá + kiểm `thinking_level=MINIMAL`)?
