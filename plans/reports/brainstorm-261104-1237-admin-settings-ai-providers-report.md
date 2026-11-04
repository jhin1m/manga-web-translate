# Brainstorm — Trang cài đặt admin + cấu hình API AI

Ngày: 2026-11-04 · Trạng thái: thiết kế đã duyệt, chờ plan

## Vấn đề

`/settings` hiện là cài đặt cá nhân (tab Font + Pipeline, lưu `user_settings`), UI thô. Key AI chỉ nằm trong env worker
(`--provider gemini|anthropic`, model qua `MTL_*_MODEL`), chỉ 2 provider, bảng giá hardcode lặp ở
`apps/api/src/billing/prices.ts` + `worker/mtl_pipeline/providers/base.py`. Không có khái niệm admin (role bị xoá cùng
workspace, plan 261024-0954).

Yêu cầu: `/settings` admin-only, redesign, cấu hình API AI (Claude, Gemini, ChatGPT, …) trong UI.

## Quyết định đã chốt với user

| # | Quyết định |
|---|---|
| D1 | `/settings` thành **admin-only**; Pipeline → cài đặt **chung toàn hệ thống**; font cá nhân chuyển `/fonts` (menu avatar) |
| D2 | Admin xác định qua env **`ADMIN_EMAILS`** (không migration role) |
| D3 | Key AI lưu **DB mã hoá** (AES-256-GCM, master key env `SECRETS_KEY`), nhập từ UI |
| D4 | Provider: **Anthropic, Gemini, OpenAI, OpenAI-compatible** (base URL tuỳ chỉnh: OpenRouter, DeepSeek, Grok…) |
| D5 | Gán model **3 slot: OCR / Dịch / Hiệu đính**; bỏ tier Standard/Premium |
| D6 | Giá model **admin nhập** (đề xuất sẵn giá model đã biết); billing đọc từ DB |
| D7 | Phạm vi thêm: **hạn mức chi phí + bật/tắt đăng ký trên UI, danh sách user (khoá/mở), font hệ thống** |
| D8 | Giữ cả 6 giai đoạn trong 1 plan |

Tự quyết (user giao quyết định nhỏ):
- Migration copy pipeline settings của admin (hàng `user_settings` đầu tiên khớp `ADMIN_EMAILS`, không có → mặc định) sang `system_settings`; `user_settings.pipeline` ngừng dùng (drop ở migration sau khi ổn định).
- Worker vẫn fallback key env khi DB chưa có provider → không gãy lúc chuyển đổi.
- Dòng "Hạn mức AI hôm nay" chuyển vào menu avatar.
- User thường vào `/settings` → redirect `/`; link Cài đặt ẩn.

## Phương án giao key cho worker

| | Ưu | Nhược |
|---|---|---|
| **A. Key theo job lúc claim (chọn)** | worker chỉ nhận key provider job cần; không ghi key vào `jobs`; đổi key hiệu lực ngay | sửa payload claim + cache provider ở worker |
| B. Worker poll `/api/worker/ai-config` | worker đơn giản | mọi worker (Modal) giữ toàn bộ key; trễ khi đổi |
| C. Giữ env worker | an toàn nhất | trái D3 |

Chi tiết A: enqueue snapshot `{provider_id, model_id}` vào payload (idempotency key + giá ổn định); claim giải mã key,
trả `llm: {type, model, api_key, base_url}`; worker cache provider theo `(type, model, base_url, sha256(key)[:8])`.
Provider bị xoá giữa enqueue và claim → job fail lỗi cấu hình (không retry).

## Thiết kế

### UI `/settings`

Thanh bên trái (mục) + 1 panel phải, URL `?section=`:
- **AI › Nhà cung cấp**: list provider (tên, loại, `…last4`, số model, nút Kiểm tra, sửa/xoá icon); form thêm: loại, tên, base URL (chỉ compatible), key, danh sách model (id, giá in/out, vision).
- **AI › Model tác vụ**: 3 select OCR (chỉ model vision) / Dịch / Hiệu đính.
- **Pipeline**: form hiện tại (bỏ select tier).
- **Hạn mức & đăng ký**: `user_daily_usd`, `global_daily_usd`, toggle đăng ký (chỉ bật khi đủ 2 hạn mức), chi tiêu hôm nay.
- **Người dùng**: email, tên, ngày tạo, chi phí hôm nay / 30 ngày, khoá/mở.
- **Font hệ thống**: upload/xoá TTF/OTF dùng chung.

Bám `docs/design-guidelines.md`, tối giản (icon sửa/xoá, không nút thừa).

### Dữ liệu (Drizzle, `packages/db`)

- `system_settings` (singleton): `pipeline jsonb`, `ai_tasks jsonb {ocr, translate, proofread: ai_model.id}`, `user_daily_usd`, `global_daily_usd`, `signup_enabled`, `updated_at`. Null → env.
- `ai_providers`: `id, type, name, base_url?, api_key_enc, key_last4, created_at, updated_at`.
- `ai_models`: `id, provider_id FK cascade, model_id, price_in, price_out, vision bool`; unique `(provider_id, model_id)`.
- `user.disabled_at timestamptz null`.
- `system_fonts`: như `user_fonts` không user, id `sys-<8hex>`, storage `system/fonts/`.

### API (`apps/api`)

- `env`: `ADMIN_EMAILS` (csv), `SECRETS_KEY` (32 byte base64; bắt buộc khi có provider DB).
- `middleware/admin.ts` `requireAdmin` (403); `/api/me` thêm `is_admin`.
- Routes `/api/admin/*`: settings (pipeline, quota, signup), providers CRUD + `POST :id/test`, models CRUD, tasks, users list + disable/enable, system fonts.
- `lib/secrets.ts` encrypt/decrypt; key không bao giờ trả về web.
- `billing/prices.ts` → giá từ `ai_models` (cache ngắn, invalidate khi sửa); model lạ vẫn tính giá đắt nhất.
- Quota/budget đọc `system_settings` ưu tiên env.
- Signup: hook better-auth `databaseHooks.user.create.before` kiểm `signup_enabled` runtime (giữ `pnpm create-user` bypass).
- `requireUser`: user `disabled_at` → 403 + revoke session khi khoá.
- `jobs/enqueue.ts`: payload thêm `llm {provider_id, model_id}` theo slot; key idempotency gồm model; bỏ `proofread_tier`.
- Claim (`routes/worker.ts`): đính `llm.api_key` đã giải mã; `request-log.ts` redact.

### Worker (`worker/`)

- `providers/openai.py` (Chat Completions, vision `image_url` base64, `response_format json_schema`; compatible không hỗ trợ → `json_object` + validate pydantic).
- `make_provider` nhận config từ job; cache LRU; fallback env khi job không có `llm`.
- Bỏ `--provider` bắt buộc (giữ làm fallback); logging không in key.
- Bump pipeline version + `MIN_PIPELINE_VERSION`; deploy worker trước API.

### Web (`apps/web`)

- `routes/settings.tsx` → layout mới, `features/admin/*` (providers, tasks, pipeline, quota, users, system-fonts).
- `routes/fonts.tsx` dùng `FontSettings`; menu avatar thêm "Font của tôi" + hạn mức hôm nay; ẩn link Cài đặt khi `!is_admin`.
- Font picker editor gộp font hệ thống.

## Giai đoạn

1. Nền admin + layout + `/fonts` + pipeline global (`system_settings`).
2. Provider/model/key (API + UI), test connection, 3 slot, giá DB.
3. Worker: OpenAI + compatible, key qua claim, cache, version bump.
4. Hạn mức + đăng ký runtime.
5. Người dùng: list, chi phí, khoá/mở.
6. Font hệ thống.

Phụ thuộc: 2 → 3 (hợp đồng claim); 1 trước tất cả; 4/5/6 độc lập sau 1.

## Rủi ro

- Mất `SECRETS_KEY` → key không giải mã được, phải nhập lại; xoay master key chỉ qua script.
- Endpoint compatible không đồng nhất (vision, json_schema) → nút Kiểm tra + cờ vision; không đảm bảo mọi endpoint.
- Key trong payload claim → redact log API + worker; claim đã yêu cầu worker token + HTTPS.
- Đổi hợp đồng API↔worker → thứ tự deploy như các lần nâng pipeline (xem `docs/deployment-guide.md`).
- Pipeline từ cá nhân → chung: user khác mất cài đặt riêng (chấp nhận theo D1).
- Bỏ tier: job proofread đang chờ có `tier` → xử lý tương thích ngược 1 phiên bản.

## Tiêu chí nghiệm thu

- User thường: không thấy link Cài đặt, `GET /api/admin/*` → 403, `/settings` → redirect; `/fonts` dùng được.
- Admin thêm provider OpenAI + key → Kiểm tra OK → gán slot Dịch → chạy dịch chương dùng đúng model, ledger tính theo giá đã nhập.
- Đổi key trên UI → job kế tiếp dùng key mới, không restart worker.
- Không có provider DB → worker chạy như cũ bằng env.
- Key không xuất hiện trong response web, log API, log worker.
- Bật đăng ký khi thiếu hạn mức → bị chặn; tắt đăng ký → signup bị từ chối ngay, không restart.
- Khoá user → session hiện tại 401/403 ngay.
- Font hệ thống hiện trong editor của mọi user và render đúng ở worker.

## Câu hỏi mở

- Giá mặc định gợi ý cho model OpenAI (gpt-*) cần kiểm lại lúc implement (giá thay đổi).
- Có cần audit log thao tác admin (ai đổi key lúc nào)? — tạm YAGNI.
