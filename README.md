# Manga Web Translate

Web app dịch manga/manhwa, mỗi người một tài khoản riêng (đăng ký mở được bằng `SIGNUP_ENABLED`, mặc định tắt): thả ảnh hoặc ZIP một chương → hệ thống ghép/cắt trang, xoá chữ +
OCR (Bước 1), dịch theo ngữ cảnh cả chương + tự chèn chữ (Bước 2) → sửa tay trong editor → xuất ZIP/CBZ.

> Trạng thái: **MVP nội bộ** (Phase 1–7 xong). Production chưa mở đăng ký công khai (`SIGNUP_ENABLED=false`), chưa đo chất lượng/chi phí trên dữ liệu thật
> — xem [Việc còn lại](#việc-còn-lại).

## Tính năng hiện có

- **Upload**: thả ảnh lẻ / ZIP ở home hoặc màn series → tự đoán series + số chương, upload nền (song song, thử lại, tải
  tiếp sau khi đóng tab). Cột ảnh gốc hiện ngay khi đang tải; xoá / khôi phục và sắp lại thứ tự ảnh trước Bước 1
  (kéo-thả, menu chuột phải, Alt+↑/↓, có hoàn tác).
- **Pipeline 2 bước**: Bước 1 = ghép slice → cắt trang theo detector → xoá chữ (inpaint) + OCR (LLM hoặc local),
  song song theo trang. Bước 2 = dịch tuần tự theo chương (ngữ cảnh cuộn), auto-typeset theo hợp đồng layout dùng chung web ↔ server;
  màu chữ / viền lấy theo chữ gốc (đỏ, vàng viền nâu…), không đủ tương phản thì về đen / trắng.
- **Editor** (react-konva): xem từng trang, sửa box chữ, undo/redo, autosave có version + khôi phục bản nháp, vẽ mask
  để xoá chữ lại, OCR lại vùng tự vẽ, Xem gốc / Chia đôi, bảng văn bản cả chương, khoá chương theo tab đang sửa; rail
  công cụ + 1 panel theo công cụ, thanh nổi cạnh khối, cột thumbnail trang.
- **Bỏ rác**: ẩn trang sau Bước 1 (không dịch, không xuất, khôi phục được); học ảnh credit theo series ("Luôn bỏ ở
  series này" → chương sau tự bỏ ảnh giống, dHash); gợi ý "Có thể là credit" theo khổ ảnh; danh sách chữ watermark bỏ
  qua theo series (không gửi LLM, không chèn chữ; khớp bỏ qua dấu cách, mục `/regex/` chạy RE2 ở API); áp ngược danh
  sách cho chương đã dịch (xem trước → ẩn box → hoàn tác).
- **Series**: ngôn ngữ nguồn `ko | ja | zh | en` → đích `vi | en | id | es | pt | fr`, định dạng strip / từng trang,
  kính ngữ, quy tắc xưng hô, giọng văn, font mặc định theo loại chữ (dropdown xem trước bằng chính font đó),
  model Standard / Premium.
- **Cài đặt pipeline** (Cài đặt chung → Pipeline; nhãn tiếng Việt + thuật ngữ gốc + tooltip): detector
  (RT-DETR v2 comic / Comic Text Detector), OCR engine theo ngôn ngữ nguồn (AI LLM / **MangaOCR** cho tiếng Nhật /
  **PaddleOCR** cho Hàn–Trung–Nhật–Anh, cả hai chạy local bằng ONNX, không tốn token, không tính ngân sách), model xoá
  chữ (Big LaMa / **LaMa manga**), model AI hiệu đính (Standard / Premium); "Nâng cao": ngưỡng tin cậy, nới mask, cỡ
  vùng xoá chữ. Mặc định = hành vi cũ; cài đặt được chụp vào job lúc chạy (Bước 1, xoá chữ lại, OCR vùng tự vẽ).
- **AI hiệu đính**: rail công cụ → "Hiệu đính" chạy cho cả chương đã dịch (bản dịch hiện tại + glossary + xưng hô /
  giọng văn của series + ảnh trang) → gợi ý theo khối (cũ → mới, lý do), Nhận / Bỏ từng cái, "Nhận tất cả" ở trang
  đang mở. Không tự ghi đè: Nhận = sửa bản dịch thường (hoàn tác, autosave, version); khối đã sửa khác → "Lỗi thời".
- **Tài khoản**: một người = một tài khoản, dữ liệu (series, glossary, font, cài đặt) riêng từng người. Đăng ký email /
  mật khẩu ở `/login` khi `SIGNUP_ENABLED=true`; tắt thì tạo tài khoản bằng `pnpm create-user`. Hạn mức chi phí AI mỗi
  người mỗi ngày (`USER_DAILY_USD`, hiện ở Cài đặt chung). Font tuỳ chỉnh TTF/OTF upload ở Cài đặt chung hoặc ngay
  trong dropdown font mặc định của series, dùng trong editor, font mặc định series, auto-typeset và bản xuất.
- **Glossary**: chung theo cặp ngôn ngữ + riêng series, CSV, áp glossary hàng loạt; tìm & thay có hoàn tác.
- **Xuất**: ZIP PNG / CBZ, theo trang hoặc cắt lại đúng slice gốc; cảnh báo trước khi xuất; sửa / dịch lại / ẩn hay
  khôi phục trang sau lần xuất cuối → chương hiện "Xuất lại".
- **Vận hành**: hàng đợi job có fencing, worker Python pull-only (Mac local hoặc Modal GPU), kill-switch ngân sách,
  backup Postgres + MinIO, `/healthz` — xem [deployment-guide.md](./docs/deployment-guide.md).

## Kiến trúc

| Thư mục | Vai trò |
|---|---|
| `apps/api` | Hono (Node 24), better-auth, route người dùng `/api/*` (`requireUser`, dữ liệu lọc theo `user_id`), API worker `/worker/v1/*` |
| `apps/web` | Vite + React SPA, TanStack Router/Query, zustand, react-konva |
| `packages/db` | Drizzle schema + migration (có down viết tay), `scoped(db, userId)` cô lập dữ liệu theo người dùng |
| `packages/shared` | Hợp đồng zod dùng chung (page state, job, giao thức worker) → JSON Schema cho worker |
| `worker` | Python: `mtl_pipeline` (detect, inpaint, OCR/dịch LLM, typeset, export), `mtl_worker` (claim/heartbeat/complete) |
| `infra` | docker-compose dev (Postgres 17, MinIO, proxy domain file), production: systemd, Caddy, backup |

Storage private: trình duyệt chỉ nhận presigned URL TTL ngắn trên domain file riêng; key bất biến theo revision.

## Bắt đầu nhanh

Yêu cầu: Node 24, pnpm 12, Docker (Compose v2); worker cần Python + `uv`.

```bash
pnpm i
cp .env.example .env
pnpm infra:up && pnpm db:migrate
OWNER_PASSWORD='...' pnpm create-user --email you@example.com     # hoặc đăng ký ở /login (.env.example bật SIGNUP_ENABLED)
pnpm dev     # API :8787, web http://localhost:5180
pnpm jobs    # process nền: reaper, kill-switch ngân sách
```

Hoặc một lệnh: `pnpm dev:all` (infra + migrate + API/web + jobs + worker; worker đọc `MTL_*` và key LLM từ `.env`).
Ctrl+C dừng tất cả, Docker vẫn chạy (`pnpm infra:down`).

Worker AI + token worker: [docs/job-queue-worker.md](./docs/job-queue-worker.md). Chi tiết setup, dev auto-login, quy
ước bắt buộc: [docs/development-setup.md](./docs/development-setup.md).

## Kiểm tra

```bash
pnpm typecheck && pnpm lint && pnpm test           # cần pnpm infra:up
pnpm --filter @mtl/web e2e                         # Playwright + worker giả lập (lần đầu: playwright install chromium)
cd worker && uv run pytest
```

Đổi schema zod → `pnpm schema:emit`; đổi schema DB → `pnpm db:generate` + viết file down ở
`packages/db/migrations-down/` (migration không đảo được thì file down `RAISE EXCEPTION` báo reset DB + checkout bản cũ).
Route mới có id tài nguyên phải có case trong `apps/api/test/tenant-isolation.test.ts` (test tự quét router thật, thiếu case
user khác → fail). Dev đang có DB cũ (còn workspace): reset DB trước khi migrate — xem
[development-setup.md](./docs/development-setup.md#reset-db-dev).

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [development-setup.md](./docs/development-setup.md) | Cài đặt, monorepo, quy ước, test, web |
| [job-queue-worker.md](./docs/job-queue-worker.md) | Hàng đợi, giao thức worker, lỗi, ingest, ngôn ngữ, ảnh/trang/chữ bỏ qua |
| [editor.md](./docs/editor.md) | Màn chương + editor, khoá, lưu, rail ảnh gốc, xoá/ẩn, ảnh tự bỏ |
| [export-and-batch-edit.md](./docs/export-and-batch-edit.md) | Xuất, tìm & thay, glossary |
| [typeset-layout-contract.md](./docs/typeset-layout-contract.md) | Hợp đồng layout chữ Konva ↔ render.py |
| [design-guidelines.md](./docs/design-guidelines.md) | Bố cục, nguyên tắc UI |
| [deployment-guide.md](./docs/deployment-guide.md) | Production: VPS, Modal, backup, kill-switch |
| [benchmarks/](./docs/benchmarks/) | Gate chất lượng / chi phí (chưa có số đo thật) |

## Việc còn lại

### Cần đo / kiểm thử với dữ liệu thật

Mọi test tự động hiện dùng worker giả lập; chưa có số đo với LLM và GPU thật.

- [ ] **Gate chất lượng pipeline (Phase 1)** trên golden set KO: recall bóng thoại ≥ 90%, `text_free` ≥ 75%, OCR CER
      ≤ 6%, chấm mù bản dịch ≥ 3.5/5, bịa trên crop rỗng ≤ 2%, inpaint không cần sửa ≥ 80%, giai đoạn 1 p50 ≤ 30s/trang,
      chi phí LLM ≤ $0.005/trang. Đang là "GO tạm" — cần API key + gán nhãn golden set, chạy `mtl bench`
      ([phase-01-results.md](./docs/benchmarks/phase-01-results.md)).
- [ ] **Production (Phase 7)**: cold start Modal ≤ 40s, giai đoạn 1 ấm p50 ≤ 10s/trang, chi phí GPU ≤ $1/1000 trang,
      golden set qua Modal không kém local, chạy thử chương KO thứ 2 ([phase-07-prod.md](./docs/benchmarks/phase-07-prod.md)).
- [ ] **Editor**: page 800×12.000 / 20.000px mở < 2s, cuộn ≥ 50fps (M1); Safari 18; reinpaint ≤ 15s với worker Mac thật;
      soi mắt parity chữ Konva ↔ render.py trên 5 trang.
- [ ] **Luồng dịch với worker LLM thật**: watermark trong danh sách bỏ qua không vào prompt và không có box; trang ẩn
      không bị dịch; xuất `original_slices` khi có trang ẩn (mở zip kiểm số file / thứ tự).
- [ ] **OCR local + LaMa manga + AI hiệu đính** (đã đo smoke trên 2 trang manga mẫu, xem
      `plans/reports/overnight-261024-0028-local-ocr-manga-lama-proofread-report.md`): CER MangaOCR / PaddleOCR trên
      golden set thật (KO strip cho PaddleOCR tiếng Hàn, JA trang cho MangaOCR); AI hiệu đính với LLM thật (chất lượng
      gợi ý, chi phí/chương Standard vs Premium, giá Premium trong bảng giá); LaMa manga vs Big LaMa trên nền
      screentone thật; tải lazy model trên Modal.
- [ ] **Đợt tính năng nhỏ (kiểm tay)**: soi ≥ 3 trang thật có chữ màu (màu chữ dịch khớp tông gốc, đọc rõ); parity
      chữ Konva ↔ render.py với font tuỳ chỉnh; đăng ký / đăng nhập thật qua `/login` với `SIGNUP_ENABLED=true` trên môi trường thử; kéo-thả sắp ảnh trên Safari; màn series hiện "Xuất lại" sau khi ẩn trang ở chương đã xuất.

### Phải làm

- [ ] **Deploy**: chạy migration mới (`0009_series_skip_images`, `0010_series_ignore_text`,
      `0011_pages_skip_changed_at`, `0012_workspace_fonts`, `0013_workspace_pipeline_settings`,
      `0014_proofread_suggestions`, `0015_single_user_guard_worker_kind`, `0016_drop_workspaces`,
      `0017_user_ownership`) — 0015 từ chối chạy nếu còn dữ liệu workspace nên **bắt buộc reset DB + MinIO và tạo lại
      token worker** theo "Checklist release single-user-accounts" ở `docs/deployment-guide.md`; worker Mac/Modal phải lên pipeline **0.6.0** (cài đặt pipeline, OCR local, AI hiệu
      đính) **trước** khi deploy API (`MIN_PIPELINE_VERSION`), không thì hàng đợi dừng; tải model optional mới
      (`fetch_models.py`) vào volume Modal; VPS cần dựng được addon `re2` — xem checklist ở
      `docs/deployment-guide.md` mục 4.
- [ ] **Rà giấy phép** trước khi thương mại hoá / công khai rộng: MVP được dùng code + model + font mở bất kể license
      (GPL/AGPL…); repo chưa có file `LICENSE`.
- [ ] **Phase 8 — trước khi mở đăng ký công khai ở production** (`SIGNUP_ENABLED` giữ `false` tới lúc này): xác thực
      email, hạn mức dung lượng lưu trữ mỗi người, BYOK, admin nền tảng, takedown, ToS. (Hạn mức chi phí AI mỗi người
      `USER_DAILY_USD` → 402 đã có.)
- [ ] **Phase 9 — Chrome extension** (phác thảo, sau MVP).

### Chức năng còn thiếu

- [ ] Đích CJK / Thái, chữ dọc khi typeset; dịch SFX + font SFX; phân loại thoại theo nghĩa (suy nghĩ, hét, khung dẫn).
- [ ] OCR local chưa nhận SFX (mọi vùng coi là chữ thường → bị xoá + dịch).
- [ ] Thumbnail do server sinh (thứ tự ảnh trước Bước 1 đã sắp tay được: kéo-thả / menu / Alt+↑↓).
- [ ] Glossary: chuyển / sao chép entry giữa các cặp ngôn ngữ, cột cặp ngôn ngữ trong CSV.
- [ ] Chống phát lại dispatch Modal triệt để (lưu `dispatch_id` đã nhận).
- [ ] _(Ưu tiên sau cùng)_ AI phân loại ảnh credit / quảng cáo (hiện chỉ học theo dHash + gợi ý theo khổ ảnh); credit
      cùng khổ đã bị ghép vào trang lớn sau Bước 1 chỉ ẩn được cả trang; logo watermark dạng hình.

### Giới hạn đã biết

- Watermark: watermark detector không bắt thì còn trên ảnh.
- Credit cùng mẫu nhưng đổi chữ (đổi tên người dịch) có thể không khớp ảnh đã học.
- Ảnh rất cao (> 16k px) có thể không tính được dấu nhận dạng trên Safari → ảnh đó không tự bỏ (upload vẫn chạy).
- Xem trước font trong danh sách thả xuống cần Chrome/Edge 135+ (`appearance: base-select`); Safari / Firefox chỉ hiện
  font ở ô đang chọn.
- PaddleOCR với chữ dọc (ja/zh) tách cột theo hình chiếu mực — cột sát nhau / chữ nhỏ trên nền art có thể đọc sai
  hoặc rỗng (→ "Cần soát"); manga tiếng Nhật nên dùng MangaOCR.
- Bóng thoại bán trong suốt / chữ có viền trắng dày: nới mask mặc định (2–6px) còn để vệt viền — tăng "Nới mask" ở
  Cài đặt chung → Pipeline → Nâng cao (VD 10–12px).
- Free-tier Gemini hết hạn mức → job tự thử lại tới ~4 giờ trước khi báo lỗi.
