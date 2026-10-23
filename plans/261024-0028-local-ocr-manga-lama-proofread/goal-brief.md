# Goal brief — OCR local + LaMa manga + AI hiệu đính + cài đặt pipeline

Chạy qua đêm, không có người trả lời. Gặp quyết định mở → chọn phương án đơn giản, an toàn, ghi lại vào báo cáo cuối;
KHÔNG dừng để hỏi.

## Nguồn tham khảo

- Repo tham khảo: https://github.com/MashiroSaber03/Saber-Translator (GPL-3.0; MVP được phép dùng lại code/model GPL —
  ghi rõ nguồn trong code + `THIRD_PARTY` note). Bản clone sẵn (chỉ đọc):
  `/private/tmp/claude-501/-Users-jhin1m-Desktop-ducanh-project-manga-web-translate/1a422444-08df-4e32-bc97-079736f0921d/scratchpad/saber/repo`
  — chỗ đáng xem: `src/interfaces/` (manga_ocr, paddle_ocr_onnx, ocr_48px, lama_interface, ctd),
  `src/core/ocr.py`, `src/core/inpainting.py`, `src/core/detection.py`, `src/shared/ai_provider_manifest.json`, phần
  AI 校对 (proofread) trong `src/backend_v2/translation` hoặc tương tự.
- Dùng `/ak:xia` thoải mái để phân tích/port từng tính năng.
- Dự án mình: đọc `README.md`, `docs/job-queue-worker.md`, `docs/editor.md`, `docs/development-setup.md`,
  `docs/design-guidelines.md`, `docs/typeset-layout-contract.md` trước khi code.

## Phạm vi

### 1. Cài đặt pipeline (workspace — "Cài đặt nhóm")

Thêm mục cài đặt pipeline ở cấp workspace (trang `apps/web/src/routes/workspace-settings.tsx`). Mỗi option có nhãn
tiếng Việt + thuật ngữ gốc tiếng Anh + tooltip giải thích ngắn (user không nhớ thuật ngữ). Tối thiểu:

| Nhóm | Option (thuật ngữ) | Giá trị |
|---|---|---|
| Phát hiện chữ | **Text detector** | `rtdetr_v2_comic` (mặc định hiện tại) / `comic_text_detector` (CTD) — chỉ những detector worker đã có/port được |
| | **Detection threshold** (ngưỡng tin cậy) | số, mặc định = giá trị hiện tại |
| Nhận dạng chữ | **OCR engine** theo ngôn ngữ nguồn | `llm` (mặc định hiện tại) / `manga_ocr` (chỉ `ja`) / `paddle_ocr` (`ko`/`zh`/`ja`/`en`) |
| Xoá chữ | **Inpainter** (Bubble/Text remove) | `lama_manga` / `big_lama` (hiện tại) — giữ fallback flood-fill như `CompositeInpainter` đang làm |
| | **Mask dilation** (nới mask, px) | số, mặc định = hiện tại |
| | **Inpainting size** (cạnh tối đa crop đưa vào model) | số, mặc định = hiện tại |
| Hiệu đính | **AI proofread** model | Standard / Premium như chọn model dịch |

Quy tắc:
- Mặc định của mọi option = hành vi hiện tại → workspace cũ chạy y hệt (không regress).
- Snapshot cài đặt vào payload job lúc enqueue (worker không tự đọc DB) — đi qua hợp đồng zod `packages/shared` →
  `pnpm schema:emit` → JSON Schema cho worker. Worker cũ không hiểu field mới phải bị chặn bằng
  `MIN_PIPELINE_VERSION` (bump `PIPELINE_VERSION` worker).
- DB: migration mới + file down viết tay ở `packages/db/migrations-down/`. Route mới dưới `/api/w/:ws` phải có case
  trong `apps/api/test/tenant-isolation.test.ts`. Chỉ owner/admin sửa được (theo cách các cài đặt nhóm hiện có làm).
- UX: tối giản (xem memory: ẩn theo ngữ cảnh, không thêm nút thừa). Cài đặt nâng cao (threshold, dilation, size)
  gom vào mục thu gọn "Nâng cao".

### 2. OCR local

- `manga_ocr` cho `ja`; PaddleOCR (ưu tiên bản ONNX như Saber `paddle_ocr_onnx_interface.py`, tránh kéo cả
  paddlepaddle) cho `ko`/`zh`/`ja`/`en`.
- Ưu tiên ONNX Runtime, tránh thêm torch nếu có lựa chọn (worker chạy Mac local + Modal GPU). Nếu manga-ocr bắt buộc
  torch/transformers, ghi rõ cân nhắc dung lượng trong báo cáo; có thể dùng bản ONNX cộng đồng nếu có.
- Model mới vào `worker/models.lock.json` (url cố định revision + sha256), tải lazy như model hiện có; cập nhật
  `worker/modal_app.py` image nếu cần dependency mới.
- Giữ nguyên các bảo vệ hiện có của OCR LLM: `MIN_INK_RATIO` (crop rỗng → empty), `low_conf`, thứ tự id. Kết quả
  OCR local phải ra đúng `OcrResult`/`OcrItem` như LLM để phần sau (dịch, editor, "OCR lại vùng tự vẽ") không đổi.
- Không có token LLM cho OCR local → usage = 0, không tính vào kill-switch ngân sách.
- "OCR lại vùng tự vẽ" trong editor cũng dùng engine theo cài đặt.

### 3. LaMa bản manga

- Thêm inpainter LaMa huấn luyện cho manga (Saber gọi "lama漫画", xem `lama_interface.py`/`lama_mpe_interface.py`
  và nguồn model họ tải). Ưu tiên ONNX; nếu chỉ có checkpoint torch thì convert sang ONNX bằng script trong
  `worker/scripts/` và ghi lại cách làm + nơi lưu model (không commit file model nặng vào git).
- Cắm vào `worker/mtl_pipeline/inpaint.py` theo `Inpainter` protocol, giữ `CompositeInpainter` + crop window logic.
- Chọn qua cài đặt `Inpainter`. Reinpaint trong editor cũng tôn trọng lựa chọn.

### 4. Chế độ AI hiệu đính (proofread)

- Hành động mới ở cấp chương sau Bước 2: "AI hiệu đính". Tạo job `proofread` qua hàng đợi hiện có (fencing,
  heartbeat, thử lại, kill-switch ngân sách tính token).
- Input cho LLM: theo trang/khối ngữ cảnh — văn bản gốc + bản dịch hiện tại của từng box, glossary (chung + series),
  quy tắc xưng hô/kính ngữ/giọng văn của series, ảnh trang (vision) nếu provider hỗ trợ. Prompt nằm trong
  `worker/mtl_pipeline/prompts/` như các prompt khác.
- Output: chỉ **gợi ý** cho box cần sửa (box id, bản đề xuất, lý do ngắn) — KHÔNG tự ghi đè bản dịch. Chặn gợi ý trùng
  bản cũ / box id lạ (giống `validate_ids`).
- Editor: gợi ý hiện trong 1 panel của rail công cụ (đúng mô hình "rail icon + 1 panel"): xem cũ → mới, Nhận / Bỏ
  từng cái, "Nhận tất cả". Nhận gợi ý đi qua đường sửa text hiện có (undo/redo, autosave, version, khoá chương,
  auto-typeset lại box). Box đã bị người sửa sau khi tạo gợi ý → gợi ý đó đánh dấu lỗi thời.
- Sửa / dịch lại sau lần xuất cuối → chương hiện "Xuất lại" như luồng hiện có.

## Ngoài phạm vi

Manga Insight, trình đọc, giá sách, plugin, browser extension, OCR 48px, YOLO detector mới, PDF/MOBI import.

## Cách làm

1. Tạo branch `feat/pipeline-settings-local-ocr-proofread` từ `main`. Làm toàn bộ trên branch đó.
2. `/ak:plan` → lưu plan vào thư mục này (`plans/261024-0028-local-ocr-manga-lama-proofread/`), chia phase.
   Thứ tự đề xuất: (a) hợp đồng cài đặt + DB + API + UI cài đặt với mặc định = hiện tại; (b) LaMa manga;
   (c) OCR local; (d) proofread; (e) docs + README.
3. `/ak:cook` từng phase. Commit sau mỗi phase xanh, conventional commit, không nhắc AI, không plan ID trong code /
   commit message.
4. Kiểm tra mỗi phase: `pnpm typecheck && pnpm lint && pnpm test` (cần `pnpm infra:up`), `cd worker && uv run pytest`,
   e2e `pnpm --filter @mtl/web e2e` khi đụng UI. Không làm yếu test để qua.
5. Model thật: nếu tải được model, chạy smoke test thật trên ảnh mẫu có sẵn trong repo (tìm trong `worker/tests`,
   `worker/spikes`, `docs/benchmarks`) cho OCR local + LaMa manga; ghi kết quả (thời gian/trang, nhận xét chất lượng,
   CER nếu có nhãn). Không có thì ghi rõ "chưa đo thật".
6. Cuối cùng chạy `/ak:code-review` trên diff của branch, sửa finding thật.
7. Cập nhật `README.md` (Tính năng hiện có, Việc còn lại — gỡ mục OCR local khỏi "Chức năng còn thiếu"), docs liên
   quan, và checklist deploy (migration mới, bump `MIN_PIPELINE_VERSION`, dependency/model worker mới) trong
   `docs/deployment-guide.md`.

## Cấm

- Không push, không merge vào `main`, không tạo PR, không deploy, không SSH server, không đụng production.
- Không commit secret / `.env` / file model nặng. Chỉ sửa `.env.example` nếu cần biến mới.
- Không xoá / sửa lịch sử git đã có. Không đổi hành vi mặc định của workspace hiện có.

## Điều kiện hoàn thành

- 4 mục phạm vi chạy end-to-end trên branch, tất cả check ở bước 4 xanh, code review xong.
- Báo cáo `plans/reports/overnight-261024-0028-local-ocr-manga-lama-proofread-report.md`: đã làm gì theo phase,
  commit list, kết quả test, kết quả smoke test model thật (hoặc lý do chưa chạy), quyết định đã tự chốt khi thiếu
  thông tin, checklist deploy, câu hỏi còn mở.
