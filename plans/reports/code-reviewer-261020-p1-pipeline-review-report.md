# Code review — Phase 1 pipeline spike & benchmark (worker/)

Ngày: 20/10/2026 · Nhánh: `feat/p1-pipeline-spike-benchmark` (chưa commit) · Spec: `plans/261019-1847-manga-translate-editor-mvp/phase-01-pipeline-spike-benchmark.md`

## Phạm vi
- `worker/mtl_pipeline/**` (~2.300 LOC, vendor chỉ xét glue), `scripts/`, `tests/` (66 test), spike `typeset-parity/`, `pyproject.toml`, `models.lock.json`, 2 doc, `.gitignore`.
- Kiểm chứng: `uv run pytest -q` → 66 passed (gồm test dùng weight thật, model có sẵn local); `ruff check .` sạch; `mypy` sạch (33 file).
- Probe thực nghiệm (script tạm trong scratchpad, không sửa repo): flood-fill trên strip 800×12000, fallback cực tính với box sát chữ, I/O LaMa ONNX, LaMa theo thành phần, stage 1 trên page 1×1 / 8×8 / 30×500 / 3000×200.

## Đánh giá chung
Cấu trúc bám đúng Architecture; hợp đồng LLM, batching, rolling context, images/models, layout contract đều có và có test. Stage 1 không crash với page tí hon / page thấp hơn tile. Không có secret; weights `*.onnx`, `out/`, `node_modules/` đều bị ignore (đã `git check-ignore`).
Nhưng có 3 lỗi hành vi làm hỏng output thật mà test hiện tại không bắt được (SFX bị xoá, mask fallback rỗng với box sát chữ, LaMa chạy theo từng thành phần nên vượt ngân sách 30 s/trang), cộng với số đo chi phí trong bench có thể ra **$0** mà vẫn qua gate.

**Điểm: 6.5/10**

---

## Critical
Không có.

## High

### H1. SFX luôn bị inpaint rồi không được dịch lại → mất chữ hiệu ứng trên trang
- `textmask.py:115` bỏ qua `r.is_sfx`, nhưng `is_sfx` chỉ được gán ở `ocr.py:92-93`, **sau** khi mask và inpaint đã chạy (`pipeline.py:68-72`, OCR ở `:88`). Lúc tạo mask thì `is_sfx` luôn bằng `False`.
- Hậu quả: SFX `text_free` đè lên art bị xoá trên `clean.png`, rồi `translate_dir` lọc `is_sfx` (`pipeline.py:149`) nên chỗ đó để trống. Việc này trái ngược với biện pháp giảm rủi ro trong spec: "mặc định **không** inpaint/dịch SFX; text_free đè art chỉ inpaint khi mask chặt".
- `tests/test_textmask_polarity.py:86` là phantom test: test này set `is_sfx=True` bằng tay, một trạng thái không bao giờ xảy ra trong pipeline.
- Cách sửa: sau OCR, với các region có `is_sfx`, chép lại pixel gốc vào `clean` trong phần mask của region đó, xoá phần mask ấy, rồi ghi lại `clean.png`/`mask.png`. Cách khác là hoãn inpaint `text_free` tới sau OCR. Kèm theo đó, thêm test đi qua `Pipeline.prepare_page` với provider giả trả `is_sfx=true`.

### H2. Fallback cực tính bỏ mọi nét chạm mép box → mask rỗng khi box ôm sát chữ
- `textmask.py:60-62` loại mọi thành phần liên thông chạm mép box, vì giả định đó là viền bóng. Box `text_bubble`/`text_free` của RT-DETR thường ôm sát chữ, nên glyph nào cũng chạm mép trên hoặc dưới.
- Probe: crop "HELLO" cắt sát có 1476 px mực, `polarity_fallback_mask` trả **0 px**. Region thành `mask_source="none"`, chữ gốc không bị xoá, bản dịch vẽ đè lên chữ Hàn. Đây đúng là nhánh fallback dành cho tầng đảo màu và chữ đè art, nơi comic-text-detector (train trên JA) hay trượt.
- Test `test_fallback_mask_polarity_per_tier` không bắt được vì crop test có lề 30 px quanh chữ.
- Cách sửa: chỉ loại thành phần chạm mép **và** có dáng viền (bề rộng hoặc cao > ~50% cạnh box, hoặc tỉ lệ diện tích/bbox thấp). Hoặc threshold trên cửa sổ box nới thêm `d` px, rồi chỉ loại thành phần chạm mép của cửa sổ đã nới. Thêm test với box cắt sát.

### H3. Inpaint xử lý từng thành phần liên thông trên mảng full-page → vượt ngân sách thời gian và bộ nhớ
- `inpaint.py:24-30` tạo `labels == i` full-page cho mỗi thành phần. `FloodFillInpainter` (`:44-46`) dilate mask full-page cho mỗi thành phần. Probe với 80 thành phần trên 800×12000: **2.6 s, peak 845 MB**, và còn nhân với `--workers 2`.
- `LamaInpainter.inpaint` (`:86-101`) chạy 1 lần LaMa 512² cho **mỗi** thành phần. Các cửa sổ chồng nhau bị inpaint lặp lại. Probe: 10 thành phần trong cùng 1 bóng tốn **13.45 s**, tức khoảng 1.3 s mỗi thành phần. Một trang có khoảng 25 thành phần không phẳng là vượt gate p50 ≤ 30 s/trang.
- Cách sửa: dùng `stats` để cắt ROI (`labels[y:y+h, x:x+w] == i`), dilate trong ROI cộng ring. Với LaMa: gom các thành phần có `crop_window` giao nhau (hoặc gom theo region) thành 1 cửa sổ rồi mới chạy 1 lần.

### H4. Chi phí LLM có thể ra $0 hoặc sai giá mà vẫn "đạt" gate
- `providers/base.py:144`: model không có trong `PRICES_PER_MTOK` thì giá thành `(0, 0)` mà không báo gì. Nếu `MTL_GEMINI_MODEL=gemini-3-flash-…`, `llm_cost_usd_per_page_total` ra 0 và gate ≤ $0.005 tự qua.
- Model mặc định là alias `gemini-flash-latest` (`providers/__init__.py:18`), bị gán cứng giá 2.5 Flash. `thinking_config` (`gemini.py:29`) chọn nhánh theo prefix `gemini-3`, nên khi alias trỏ sang Gemini 3 thì nhánh `thinking_level=MINIMAL` bị bỏ qua và giá cũng sai.
- Cách sửa: pin model ID cụ thể làm mặc định. Ném lỗi khi model không có giá (bench fail sớm). Ghi `resp.model_version` vào `TokenUsage` để đối chiếu.

## Medium

### M1. Usage bị mất trên đường lỗi → chi phí bị đếm thiếu
- `anthropic.py:56-63` tính `usage` rồi `raise` khi `stop_reason` là `max_tokens`/`refusal`; `gemini.py:72` cũng raise khi rỗng. Token đã bị tính tiền nhưng không được ghi.
- `ocr.py:75-82` và `translate.py:91-97`: lần thử 1 lệch id rồi lần 2 lỗi `schema` thì usage của lần 1 mất, đồng thời kết quả lần 1 bị bỏ thay vì đánh `low_conf`.
- `translate_chapter` lỗi giữa chương thì mất toàn bộ usage các lô trước.
- Cách sửa: gắn `usage` vào `ProviderError`, cộng dồn ở caller. Ở lần thử cuối, nếu lỗi thì quay về kết quả lệch trước đó và đánh `low_conf`.

### M2. Bench không chịu được một lần 429
`AnthropicProvider` dùng `max_retries=0` (`anthropic.py:32`). `run_bench` (`bench.py:161-262`) không có retry hay backoff và chỉ ghi `bench.csv` ở cuối. Một `rate_limit` ở trang 25 là mất hết số đo đã trả tiền. Cách sửa: wrapper retry theo `retry_after` trong bench, và ghi row/artefact dần dần.

### M3. Metric recall và CER của bench bị thổi phồng hoặc lẫn lộn
- `bench.py:57-68`: match theo "phần GT nằm trong pred ≥ 50%", không 1-1, không có IoU hay precision. Một box quá to (ví dụ do seam-merge gộp nhầm) đếm là trúng cho mọi GT bên trong, nên recall có thể đạt 100%.
- `bench.py:173-178`: CER ghép **toàn bộ** text của pred với từng GT. Một pred phủ 2 GT thì CER phình. GT bị detect trượt thì pred = `""`, tức lỗi detection bị tính vào CER OCR.
- Cách sửa: dùng IoU ≥ 0.5 với greedy 1-1, thêm row `precision_*`. Đo `ocr_cer` trên crop GT (bỏ qua detector, giống cách làm crop rỗng) và tách riêng `e2e_cer`.

### M4. Id OCR bị thiếu được đánh `empty=True`
`ocr.py:54` tạo `OcrItem(id, empty=True, low_conf=True)`. `translate_dir` (`pipeline.py:149`) bỏ qua item empty, nên chữ đã bị xoá trên `clean.png` mà không có bản dịch, và lỗi này không phân biệt được với "crop không có chữ". Bench hallucination cũng tính item này là "không bịa". Nên dùng `empty=False, source="", low_conf=True`.

### M5. Phân loại lỗi provider khiến Phase 3 retry vô hạn
- `classify_status` (`base.py:126-129`) xếp mọi lỗi khác 429 vào `provider`, kể cả 400/401/403/404/413. Docstring của `ProviderError` nói `provider` "không tính attempt", nên lỗi vĩnh viễn (sai key, model không tồn tại, ảnh quá lớn) sẽ bị retry mãi.
- `gemini.py:62` dùng `except Exception` gom cả bug lập trình (TypeError…) thành lỗi provider có thể retry.
- Cách sửa: 4xx khác 408/409/429 xếp vào lớp tính attempt (hoặc thêm lớp `fatal`; việc này cần owner quyết vì spec chốt 3 lớp). Thu hẹp catch còn `httpx.TransportError`/`TimeoutException`.

### M6. Lỗi một trang ở `prepare_dir` / trang thiếu OCR không có cảnh báo
- `pipeline.py:100-102`: một trang ném lỗi (`ProviderError`, `ImageRejected`) là `f.result()` ném ra và mất timing các trang còn lại.
- `load_page_dirs` (`:118`) lặng lẽ bỏ thư mục không có `ocr.json`, nên `translate` chạy với chương bị khuyết trang: rolling context nhảy trang, trang đó không được render.
- `prepare --no-ocr` rồi `translate` thì in "translate xong 0 trang".
- Cách sửa: thu lỗi theo từng trang. `translate_dir` nên báo lỗi khi có `regions.json` mà thiếu `ocr.json`.

## Low
- L1 `vendor/lama_pre_post.py:20`: heuristic `o.max() <= 1.5` thì nhân 255. Probe xác nhận output của Carve LaMa-ONNX luôn ở thang 0..255, nên crop gần đen tuyền sẽ bị nhân lên thành trắng. Nên dùng thang cố định.
- L2 Giãn hai lần: `merge_mask_list` (REFINEMASK_INPAINT) đã dilate 5×5 (+2 px), sau đó `dilation_px` thêm 2–6 px (`textmask.py:132-139`), nên thực tế là 4–8 px, vượt spec 2–6 px. Nên gọi `refine_mask(..., REFINEMASK_ANNOTATION)` hoặc trừ đi 2.
- L3 `textmask.py:123`: `refine_mask` được gọi cho từng region với full-page `pred_mask`. Vendor `zeros_like(pred_mask)` cấp phát một mảng full-page cho mỗi region. Nên truyền ROI.
- L4 `vendor/ctd_pre_post.py:9-14` đã sửa so với upstream (cvtColor thay vì slicing, cộng `[::-1]`), nên kênh vào model thực tế là BGR. Cần đối chiếu thứ tự kênh với upstream ONNX path. Ảnh hưởng nhỏ vì manga chủ yếu là ảnh xám.
- L5 `bench.py`: tham số `workers` không được dùng. `imgs` giữ mọi page đã decode trong RAM (30 strip 800×12000 ≈ 0.9 GB).
- L6 `bench.py:286`: `blind.html` hiển thị câu nguồn lấy từ OCR của provider đầu tiên cho mọi biến thể. Nếu OCR của provider đó sai, bản dịch của provider kia bị chấm oan.
- L7 Ở `--workers 2`, mỗi ORT session mặc định chiếm mọi core, dẫn tới oversubscription và đo thời gian ở `mtl prepare` không đại diện. Bench chạy tuần tự nên gate không bị ảnh hưởng.
- L8 `tests/test_llm_contract.py:10` import `httpx2`, vốn chỉ là dependency bắc cầu của `anthropic` và không được khai báo.
- L9 `images.open_rgb` mở file 2 lần (TOCTOU với Path), lần decode không truyền `formats=ALLOWED_FORMATS`, và bỏ qua EXIF orientation.
- L10 Spike parity không phủ `rotation`. Konva mặc định xoay quanh góc trái-trên, trong khi contract nói xoay quanh tâm, nên Phase 5 cần ghi rõ việc đặt `offset`.
- L11 `translate.update_context`: `characters` tăng không giới hạn qua chương.

## Đối chiếu acceptance (a)
| Hạng mục | Kết quả |
|---|---|
| Tiling 1.25w / overlap 20% + merge ở mép | Có; test với model thật pass. Lưu ý M3 (merge gộp quá mức thì metric không bắt được) |
| Mask = nét chữ giãn, không phải cả lòng bóng | Có; giãn thực tế vượt 2–6 px (L2) |
| Fallback cực tính | Có; **hỏng với box sát chữ (H2)** |
| Flood-fill + LaMa | Có, đúng I/O (probe MAE 1.1 trên ảnh mượt); **hiệu năng H3** |
| OCR: lọc mật độ mực, validate id, retry 1, low_conf | Có; M1/M4 |
| Batching ≤ 4 trang/≤ 40 vùng, rolling ≤ 12 dòng, nhánh none | Có, có test |
| Providers: tắt thinking, token usage, lớp provider/rate_limit/schema | Có; SDK đã kiểm (anthropic 1.15 có `output_config`, genai có `ThinkingLevel.MINIMAL`); H4/M5 |
| Layout contract NFC/baseline/stroke ra ngoài/raqm bắt buộc | Có. Stroke chuyển sang dilate 4× có bằng chứng spike và đã ghi vào doc; phase file còn ghi `stroke_width` nên cần lead cập nhật |
| images.py trần 16384/60MP/MAX_IMAGE_PIXELS | Có, có test |
| models.py sha256 + từ chối pickle | Có, có test |
| HF_HUB_OFFLINE | `setdefault` ở CLI (pipeline không dùng thư viện HF, nên điều kiện này thỏa một cách hình thức) |

## (c) Secrets/weights
Sạch: không tìm thấy key (`AIza…`, `sk-ant-…`). `worker/models/*.onnx`, `spikes/typeset-parity/out/` (chứa path tuyệt đối) và `node_modules/` đã được ignore.

## (d) Style / YAGNI
Nhìn chung gọn và đúng convention. Ruff và mypy sạch, vendor được loại khỏi lint. Không thấy abstraction thừa. `CompositeInpainter`/`Inpainter` Protocol có lý do dùng. Có 1 phantom test (H1).

## Thứ tự sửa đề xuất
1. H2 (fallback mép), H1 (khôi phục SFX), H3 (ROI + gom cửa sổ LaMa): đều ảnh hưởng trực tiếp chất lượng/thời gian của gate.
2. H4 + M1 (giá/usage đúng), M3 (metric), M2 (bench chịu 429): phải xong trước khi chạy bench có trả phí.
3. M4–M6, rồi các mục Low.

## Câu hỏi mở
- M5: có thêm lớp lỗi `fatal` (4xx vĩnh viễn) không, hay map vào `schema` để tính attempt? Cần owner chốt vì spec ghi 3 lớp.
- L4: cần xác nhận thứ tự kênh màu mà ONNX của comic-text-detector mong đợi.
