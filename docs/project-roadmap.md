# Lộ trình & việc còn lại

Danh sách việc chưa xong, cần đo với dữ liệu thật và giới hạn đã biết (chuyển từ README, 08/11/2026).

## Cần đo / kiểm thử với dữ liệu thật

Mọi test tự động hiện dùng worker giả lập; chưa có số đo với LLM và GPU thật.

- [ ] **Gate chất lượng pipeline (Phase 1)** trên golden set KO: recall bóng thoại ≥ 90%, `text_free` ≥ 75%, OCR CER
      ≤ 6%, chấm mù bản dịch ≥ 3.5/5, bịa trên crop rỗng ≤ 2%, inpaint không cần sửa ≥ 80%, giai đoạn 1 p50 ≤ 30s/trang,
      chi phí LLM ≤ $0.005/trang. Đang là "GO tạm" — cần API key + gán nhãn golden set, chạy `mtl bench`
      ([phase-01-results.md](./docs/benchmarks/phase-01-results.md)).
- [ ] **Production (Phase 7)**: cold start Modal ≤ 40s, giai đoạn 1 ấm p50 ≤ 10s/trang, chi phí GPU ≤ $1/1000 trang,
      golden set qua Modal không kém local, chạy thử chương KO thứ 2 ([phase-07-prod.md](./docs/benchmarks/phase-07-prod.md)).
- [ ] **Editor**: page 800×12.000 / 20.000px mở < 2s, cuộn ≥ 50fps (M1); Safari 18; reinpaint ≤ 15s với worker Mac thật;
      soi mắt parity chữ Konva ↔ render.py trên 5 trang.
- [ ] **Dịch theo lô với key LLM thật**: chương ≥ 9 trang — trang đầu "Xong" và sửa được khi lô sau còn chạy; token / chương
      so với dịch cả chương không tăng quá ~10% (`usage_ledger`); tên nhân vật nhất quán giữa các lô (`carry`).
- [ ] **Luồng dịch với worker LLM thật**: watermark trong danh sách bỏ qua không vào prompt và không có box; trang ẩn
      không bị dịch; xuất `original_slices` khi có trang ẩn (mở zip kiểm số file / thứ tự).
- [ ] **OCR local (giờ là mặc định) + LaMa manga + AI hiệu đính** (đã đo smoke trên 2 trang manga mẫu, xem
      `plans/reports/overnight-261024-0028-local-ocr-manga-lama-proofread-report.md`): CER MangaOCR / PaddleOCR trên
      golden set thật (KO strip cho PaddleOCR tiếng Hàn, JA trang cho MangaOCR) — chất lượng thấp thì đổi ngôn ngữ đó về
      AI LLM; AI hiệu đính với LLM thật (chất lượng gợi ý, chi phí/chương so với khoảng ước tính ở hộp xác nhận); LaMa
      manga vs Big LaMa trên nền screentone thật; model OCR local đã nạp sẵn trong volume Modal (không tải giữa job).
- [ ] **DeepSeek với key thật**: `json_object` + ảnh (OCR / hiệu đính bằng `deepseek-flash`), worker tắt chế độ suy
      luận (`thinking: disabled`) đúng như docs DeepSeek; `deepseek-v4-pro` (không vision) chỉ gán slot Dịch.
- [ ] **Đợt tính năng nhỏ (kiểm tay)**: soi ≥ 3 trang thật có chữ màu (màu chữ dịch khớp tông gốc, đọc rõ); parity
      chữ Konva ↔ render.py với font tuỳ chỉnh; đăng ký / đăng nhập thật qua `/login` với `SIGNUP_ENABLED=true` trên môi trường thử; kéo-thả sắp ảnh trên Safari; màn series hiện "Xuất lại" sau khi ẩn trang ở chương đã xuất.

## Phải làm

- [ ] **Deploy**: chạy migration mới (`0009_series_skip_images`, `0010_series_ignore_text`,
      `0011_pages_skip_changed_at`, `0012_workspace_fonts`, `0013_workspace_pipeline_settings`,
      `0014_proofread_suggestions`, `0015_single_user_guard_worker_kind`, `0016_drop_workspaces`,
      `0017_user_ownership`, `0018_auth_error_class`, `0019_jobs_progress_counts`, `0020_translate_chain`, `0021_system_settings`, `0022_ai_providers`, `0023_drop_series_llm_tier`, `0024_user_disabled_at`, `0025_system_fonts`) — 0015 từ chối chạy nếu còn dữ liệu workspace nên **bắt buộc reset DB + MinIO và tạo lại
      token worker** theo "Checklist release single-user-accounts" ở `docs/deployment-guide.md`; worker Mac/Modal phải lên pipeline **0.10.0** (key AI theo job qua claim, provider OpenAI / OpenAI-compatible; gồm mọi bản 0.6–0.9) **trước** khi deploy API (`MIN_PIPELINE_VERSION` 0.10.0, worker cũ nhận 426); `.env` API cần `SECRETS_KEY` + `ADMIN_EMAILS` — xem "Checklist nâng cấp lên pipeline 0.10.0" ở `docs/deployment-guide.md`, không thì
      hàng đợi dừng; chương manga đang cắt trang / xoá chữ lúc
      deploy sẽ dừng ở "Chờ dịch" (bấm "Dịch chương" để tiếp) — xem "Checklist nâng cấp lên pipeline 0.7.0" ở `docs/deployment-guide.md` (API deploy trước hoặc cùng web: web mới cần `ocr_ready` trong `/progress`); nạp model
      OCR local + LaMa manga (`fetch_models.py`) vào volume Modal **trước** khi deploy — OCR local giờ là mặc định, xem
      "Checklist OCR local mặc định"; production từng bấm Lưu ở Pipeline chung thì cài đặt đã lưu (OCR = LLM) thắng mặc
      định mới → đổi tay trên UI; VPS cần dựng được addon `re2` — xem checklist ở
      `docs/deployment-guide.md` mục 4.
- [ ] **Phase 8 — trước khi mở đăng ký công khai ở production** (`SIGNUP_ENABLED` giữ `false` và admin không bật trên UI tới lúc này): xác thực
      email, hạn mức dung lượng lưu trữ mỗi người, BYOK, takedown, ToS. (Hạn mức chi phí AI mỗi người
      `USER_DAILY_USD` → 402 và admin nền tảng một phần — Cài đặt, danh sách người dùng, khoá / mở tài khoản — đã có.)
- [ ] **Phase 9 — Chrome extension** (phác thảo, sau MVP).

## Chức năng còn thiếu

- [ ] Đích CJK / Thái, chữ dọc khi typeset; dịch SFX + font SFX; phân loại thoại theo nghĩa (suy nghĩ, hét, khung dẫn).
- [ ] OCR local chưa nhận SFX (mọi vùng coi là chữ thường → bị xoá + dịch). OCR local giờ là mặc định nên SFX bị xoá
      + dịch theo mặc định; cần giữ SFX thì đổi ngôn ngữ đó về AI LLM.
- [ ] Thumbnail do server sinh (thứ tự ảnh trước khi cắt trang đã sắp tay được: kéo-thả / menu / Alt+↑↓).
- [ ] Glossary: chuyển / sao chép entry giữa các cặp ngôn ngữ, cột cặp ngôn ngữ trong CSV.
- [ ] Chống phát lại dispatch Modal triệt để (lưu `dispatch_id` đã nhận).
- [ ] _(Ưu tiên sau cùng)_ AI phân loại ảnh credit / quảng cáo (hiện chỉ học theo dHash + gợi ý theo khổ ảnh); credit
      cùng khổ đã bị ghép vào trang lớn lúc cắt trang chỉ ẩn được cả trang; logo watermark dạng hình.

## Giới hạn đã biết

- Watermark: watermark detector không bắt thì còn trên ảnh.
- Credit cùng mẫu nhưng đổi chữ (đổi tên người dịch) có thể không khớp ảnh đã học.
- Ảnh rất cao (> 16k px) có thể không tính được dấu nhận dạng trên Safari → ảnh đó không tự bỏ (upload vẫn chạy).
- Xem trước font trong danh sách thả xuống cần Chrome/Edge 135+ (`appearance: base-select`); Safari / Firefox chỉ hiện
  font ở ô đang chọn.
- PaddleOCR với chữ dọc (ja/zh) tách cột theo hình chiếu mực — cột sát nhau / chữ nhỏ trên nền art có thể đọc sai
  hoặc rỗng (→ "Cần soát"); manga tiếng Nhật nên dùng MangaOCR.
- Bóng thoại bán trong suốt / chữ có viền trắng dày: nới mask mặc định (2–6px) còn để vệt viền — tăng "Nới mask" ở
  Cài đặt → Pipeline chung → Nâng cao (VD 10–12px).
- Free-tier Gemini hết hạn mức → job tự thử lại tới ~4 giờ trước khi báo lỗi.
- Giá DeepSeek nhập theo giờ cao điểm (thấp điểm rẻ ½) → chi phí hệ thống ghi nhận ≥ thực tế. Ước tính hiệu đính lấy
  trung bình 20 lượt gần nhất, không tách theo model — vừa đổi model thì khoảng ước tính lệch tới khi có lượt mới.
- Số chương chạy cùng lúc = số worker (self-host mặc định 2): chương kế tiếp chỉ bắt đầu khi một chương đang chạy hết job đang xếp hàng; 1 worker thì vẫn lần lượt từng chương. Khi nhiều chương cùng chờ, chương tạo trước xong chậm hơn khoảng N lần với N worker. Chưa chia lượt theo người dùng. Xuất file, tẩy lại trang, OCR vùng (priority 10) luôn chạy trước. Chi tiết: [job-queue-worker.md](./job-queue-worker.md).
