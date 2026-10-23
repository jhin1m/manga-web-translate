# Manga Web Translate

Web app dịch manga/manhwa cho nhóm dịch (invite-only): thả ảnh hoặc ZIP một chương → hệ thống ghép/cắt trang, xoá chữ +
OCR (Bước 1), dịch theo ngữ cảnh cả chương + tự chèn chữ (Bước 2) → sửa tay trong editor → xuất ZIP/CBZ.

> Trạng thái: **MVP nội bộ** (Phase 1–7 xong). Chưa mở đăng ký công khai, chưa đo chất lượng/chi phí trên dữ liệu thật
> — xem [Việc còn lại](#việc-còn-lại).

## Tính năng hiện có

- **Upload**: thả ảnh lẻ / ZIP ở home hoặc màn series → tự đoán series + số chương, upload nền (song song, thử lại, tải
  tiếp sau khi đóng tab). Cột ảnh gốc hiện ngay khi đang tải; xoá / khôi phục và sắp lại thứ tự ảnh trước Bước 1
  (kéo-thả, menu chuột phải, Alt+↑/↓, có hoàn tác).
- **Pipeline 2 bước**: Bước 1 = ghép slice → cắt trang theo detector → xoá chữ (inpaint) + OCR bằng LLM, song song theo
  trang. Bước 2 = dịch tuần tự theo chương (ngữ cảnh cuộn), auto-typeset theo hợp đồng layout dùng chung web ↔ server;
  màu chữ / viền lấy theo chữ gốc (đỏ, vàng viền nâu…), không đủ tương phản thì về đen / trắng.
- **Editor** (react-konva): xem từng trang, sửa box chữ, undo/redo, autosave có version + khôi phục bản nháp, vẽ mask
  để xoá chữ lại, OCR lại vùng tự vẽ, Xem gốc / Chia đôi, bảng văn bản cả chương, khoá chương theo người sửa; rail
  công cụ + 1 panel theo công cụ, thanh nổi cạnh khối, cột thumbnail trang.
- **Bỏ rác**: ẩn trang sau Bước 1 (không dịch, không xuất, khôi phục được); học ảnh credit theo series ("Luôn bỏ ở
  series này" → chương sau tự bỏ ảnh giống, dHash); gợi ý "Có thể là credit" theo khổ ảnh; danh sách chữ watermark bỏ
  qua theo series (không gửi LLM, không chèn chữ; khớp bỏ qua dấu cách, mục `/regex/` chạy RE2 ở API); áp ngược danh
  sách cho chương đã dịch (xem trước → ẩn box → hoàn tác).
- **Series**: ngôn ngữ nguồn `ko | ja | zh | en` → đích `vi | en | id | es | pt | fr`, định dạng strip / từng trang,
  kính ngữ, quy tắc xưng hô, giọng văn, font mặc định theo loại chữ (dropdown xem trước bằng chính font đó),
  model Standard / Premium.
- **Nhóm**: invite-only, mời thành viên qua email SMTP (không cấu hình thì gửi link trên UI); font tuỳ chỉnh TTF/OTF
  upload ở Cài đặt nhóm hoặc ngay trong dropdown font mặc định của series, dùng trong editor, font mặc định series,
  auto-typeset và bản xuất.
- **Glossary**: chung theo cặp ngôn ngữ + riêng series, CSV, áp glossary hàng loạt; tìm & thay có hoàn tác.
- **Xuất**: ZIP PNG / CBZ, theo trang hoặc cắt lại đúng slice gốc; cảnh báo trước khi xuất; sửa / dịch lại / ẩn hay
  khôi phục trang sau lần xuất cuối → chương hiện "Xuất lại".
- **Vận hành**: hàng đợi job có fencing, worker Python pull-only (Mac local hoặc Modal GPU), kill-switch ngân sách,
  backup Postgres + MinIO, `/healthz` — xem [deployment-guide.md](./docs/deployment-guide.md).

## Kiến trúc

| Thư mục | Vai trò |
|---|---|
| `apps/api` | Hono (Node 24), better-auth, route `/api/w/:ws/*` (workspace trên URL), API worker `/worker/v1/*` |
| `apps/web` | Vite + React SPA, TanStack Router/Query, zustand, react-konva |
| `packages/db` | Drizzle schema + migration (có down viết tay), `scoped(db, wsId)` cô lập tenant |
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
OWNER_PASSWORD='...' pnpm create-workspace --name "Nhóm dịch" --slug nhom-dich --owner-email you@example.com
pnpm dev     # API :8787, web http://localhost:5180
pnpm jobs    # process nền: reaper, kill-switch ngân sách
```

Worker AI + token worker: [docs/job-queue-worker.md](./docs/job-queue-worker.md). Chi tiết setup, dev auto-login, quy
ước bắt buộc: [docs/development-setup.md](./docs/development-setup.md).

## Kiểm tra

```bash
pnpm typecheck && pnpm lint && pnpm test           # cần pnpm infra:up
pnpm --filter @mtl/web e2e                         # Playwright + worker giả lập (lần đầu: playwright install chromium)
cd worker && uv run pytest
```

Đổi schema zod → `pnpm schema:emit`; đổi schema DB → `pnpm db:generate` + viết file down ở
`packages/db/migrations-down/`. Route mới dưới `/api/w/:ws` phải có case trong `apps/api/test/tenant-isolation.test.ts`.

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
- [ ] **Đợt tính năng nhỏ (kiểm tay)**: soi ≥ 3 trang thật có chữ màu (màu chữ dịch khớp tông gốc, đọc rõ); parity
      chữ Konva ↔ render.py với font tuỳ chỉnh; gửi email lời mời qua SMTP thật (Gmail app password / Brevo) và bấm
      link đăng ký; kéo-thả sắp ảnh trên Safari; màn series hiện "Xuất lại" sau khi ẩn trang ở chương đã xuất.
- [ ] **Ngôn ngữ nguồn ngoài tiếng Hàn** (ja/zh/en) mới chỉ ghi chú "chưa kiểm định kỹ" — cần thử chương thật.

### Phải làm

- [ ] **Deploy**: chạy migration mới (`0009_series_skip_images`, `0010_series_ignore_text`,
      `0011_pages_skip_changed_at`, `0012_workspace_fonts`); worker Mac/Modal phải lên pipeline **0.5.1** (font tuỳ
      chỉnh) **trước** khi deploy API (`MIN_PIPELINE_VERSION`), không thì hàng đợi dừng; VPS cần dựng được
      addon `re2` — xem checklist ở `docs/deployment-guide.md` mục 4.
- [ ] **Rà giấy phép** trước khi thương mại hoá / công khai rộng: MVP được dùng code + model + font mở bất kể license
      (GPL/AGPL…); repo chưa có file `LICENSE`.
- [ ] **Phase 8 — trước khi mở đăng ký công khai**: quota theo workspace (402), BYOK, ma trận role chi tiết, admin nền
      tảng, takedown, ToS.
- [ ] **Phase 9 — Chrome extension** (phác thảo, sau MVP).

### Chức năng còn thiếu

- [ ] AI phân loại ảnh credit / quảng cáo (hiện chỉ học theo dHash + gợi ý theo khổ ảnh); credit cùng khổ đã bị ghép
      vào trang lớn sau Bước 1 chỉ ẩn được cả trang; logo watermark dạng hình.
- [ ] Đích CJK / Thái, chữ dọc khi typeset; dịch SFX + font SFX; phân loại thoại theo nghĩa (suy nghĩ, hét, khung dẫn).
- [ ] Tự nhận ngôn ngữ nguồn từ ảnh; OCR local (manga-ocr, RapidOCR) thay LLM.
- [ ] Thumbnail do server sinh (thứ tự ảnh trước Bước 1 đã sắp tay được: kéo-thả / menu / Alt+↑↓).
- [ ] Xem trước font trong dropdown Font của editor (mới có ở cài đặt series).
- [ ] Glossary: chuyển / sao chép entry giữa các cặp ngôn ngữ, cột cặp ngôn ngữ trong CSV.
- [ ] Chống phát lại dispatch Modal triệt để (lưu `dispatch_id` đã nhận).

### Giới hạn đã biết

- Watermark: watermark detector không bắt thì còn trên ảnh.
- Credit cùng mẫu nhưng đổi chữ (đổi tên người dịch) có thể không khớp ảnh đã học.
- Ảnh rất cao (> 16k px) có thể không tính được dấu nhận dạng trên Safari → ảnh đó không tự bỏ (upload vẫn chạy).
- Xem trước font trong danh sách thả xuống cần Chrome/Edge 135+ (`appearance: base-select`); Safari / Firefox chỉ hiện
  font ở ô đang chọn.
- Free-tier Gemini hết hạn mức → job tự thử lại tới ~4 giờ trước khi báo lỗi.
