---
phase: 4
title: "Web: upload chương, cài đặt series, tiến độ job, danh sách trang"
status: completed
priority: P1
effort: "4d"
dependencies: [2, 3]
---
# Phase 4: Web — upload, cài đặt series, tiến độ, danh sách trang

## Overview
Các màn hình ngoài editor: danh sách series, cài đặt series (ngôn ngữ, glossary, quy tắc xưng hô/kính ngữ, font mặc định, tier model), upload chương (ảnh rời / ZIP), theo dõi tiến độ bằng polling, lưới trang của chương, khoá chương. Thiết lập router, layout, design tokens mà Phase 5 dùng lại.

## Requirements
- **Upload (red team #12):** client xin presigned **POST** (`content-length-range` ≤ 30MB, Content-Type cố định theo đuôi), song song 4 file, retry từng file; ZIP giải nén **ở client** (fflate) → không có endpoint nhận file lớn; sắp xếp tên tự nhiên (`2.png` < `10.png`); chỉ png/jpg/webp, ≤ 400 file/chương. Kiểm ở trình duyệt chỉ để UX — server kiểm lại khi commit.
- **Commit (red team #3, #12):** `POST /api/w/:ws/chapters/:id/commit` → với từng file: `HEAD` (dung lượng ≤ 30MB) + đọc 16 byte đầu kiểm magic bytes PNG/JPEG/WEBP khớp `mime`; sai → loại file, báo lỗi. Hợp lệ → chapter `ingesting` + enqueue **chỉ** `chapter.ingest` (pages và `page.prepare` do ingest complete tạo, Phase 3). Chương đã có chỉnh sửa → commit lại bị chặn 409 (red team #4).
- Series settings: `source_lang` (MVP chỉ bật `ko`; enum giữ ja/zh/en cho sau MVP) (red team #10), `target_lang` (mặc định vi), `honorific_policy` (giữ -nim/-ssi… | chuyển sang xưng hô VI), `pronoun_rules` (cặp nhân vật → xưng hô, VD "Minh→Lan: anh/em"), `style_prompt` ngắn, font mặc định, `llm_tier` (standard/premium). Đổi trường ảnh hưởng dịch → `settings_rev+1` (red team #3).
- Glossary CRUD + import/export CSV; cấp workspace và cấp series (series ghi đè); mọi thay đổi → `glossary_rev+1` cùng transaction (red team #3).
- **Tiến độ:** polling TanStack Query 2–3s trên `/progress` (không SSE) (red team #13); trạng thái từng trang theo 2 giai đoạn; chapter `partial_failed` hiện nút **"chạy lại trang lỗi"** cấp chương (red team #7); huỷ chương.
- **Khoá chương (red team #6):** mở editor → `locked_by`, hết hạn 15 phút không hoạt động; người khác thấy "đang được X sửa". Server ép khoá cho mọi ghi nội dung chương qua `chapter-lock.ts` (Phase 3).
- **UI:** không AI slop — cấm chữ gradient, glassmorphism, blob nền, pastel/cute, emoji trang trí. Hướng: công cụ làm việc (dày thông tin, trung tính, 1 màu nhấn, font UI Be Vietnam Pro/Inter). Đưa 2–3 hướng thiết kế với ảnh chụp dữ liệu thật để owner chọn trước khi làm hết.

## Architecture
Routes SPA (TanStack Router hoặc React Router — chọn 1, type-safe params):
```
/w/:ws/series                               danh sách
/w/:ws/series/:id/settings                  cài đặt + glossary
/w/:ws/series/:id/chapters/:ch              lưới trang + tiến độ
/w/:ws/series/:id/chapters/:ch/edit/:page   editor (Phase 5)
```
Data: TanStack Query + Hono RPC client (`hc<AppType>`) cho type end-to-end.
API (mọi route dưới `/api/w/:ws`, red team #13):
```
POST   /chapters                 tạo chapter + danh sách file → presigned POST từng file
POST   /chapters/:id/commit      HEAD + magic bytes → enqueue chapter.ingest
GET    /chapters/:id/progress    trạng thái chapter + từng page (polling)
GET    /chapters/:id/pages
POST   /chapters/:id/retry-failed   page.prepare cho page lỗi giai đoạn 1 + chapter.translate cho page lỗi
POST   /chapters/:id/translate      chạy lại dịch cả chương (body: page_ids? → 1 trang với ngữ cảnh lân cận)
POST   /chapters/:id/cancel
POST|DELETE /chapters/:id/lock      (+ heartbeat khoá từ editor)
CRUD   /series, /series/:id/glossary (+ CSV)
```
Snapshot glossary + `glossary_rev` vào payload job lúc enqueue (job tái lập được).

## Related Code Files
Create (Phase 4 sở hữu):
- `apps/web/src/app/{router.tsx,layout.tsx}`, `apps/web/src/styles/tokens.css`
- `apps/web/src/features/series/*`, `apps/web/src/features/glossary/*`, `apps/web/src/features/upload/*`, `apps/web/src/features/chapter/*`
- `apps/api/src/routes/{series.ts,chapters.ts,glossary.ts,pages.ts}`
- `apps/api/test/{chapters.test.ts,glossary.test.ts,upload-validation.test.ts}`
- `docs/design-guidelines.md`
Modify: `apps/api/src/index.ts` (mount routes), `apps/api/test/tenant-isolation.test.ts`

## Implementation Steps
1. Router + layout + tokens (2–3 phương án trình bày cho owner, chốt 1); `docs/design-guidelines.md` có danh sách cấm.
2. Series list/settings + glossary CRUD/CSV, tăng `settings_rev`/`glossary_rev`.
3. Upload: chọn file/ZIP → giải nén client → presign POST → upload song song → commit (server HEAD + magic bytes).
4. Chapter view: lưới thumbnail (ảnh clean rev hiện tại khi có, fallback original), trạng thái từng trang qua polling.
5. Retry-failed / translate lại / cancel; khoá chương.
6. Test API (gồm file giả mạo đuôi .png chứa HTML → bị loại) + test cô lập tenant kiểu id cho route mới + e2e Playwright 1 luồng: upload ZIP 10 trang → thấy 10 trang "ready" (worker giả lập chỉ trong môi trường test, gọi đúng protocol có fencing).

## Success Criteria
- [ ] Upload ZIP 200MB/150 ảnh hoàn tất, thứ tự trang đúng tên tự nhiên; mất mạng giữa chừng → retry tiếp file lỗi, không upload lại tất cả.
- [ ] Upload trực tiếp (bỏ qua UI) file 50MB → MinIO từ chối; file HTML đổi đuôi .png → commit loại file.
- [ ] Đổi glossary rồi chạy lại 1 trang → bản dịch dùng term mới, có ngữ cảnh trang lân cận.
- [ ] Tiến độ cập nhật ≤ 3s sau khi worker heartbeat.
- [ ] Chapter `partial_failed` → "chạy lại trang lỗi" đưa về `review` khi provider đã hồi.
- [ ] 2 người cùng mở chương: người thứ 2 thấy trạng thái khoá; gọi thẳng API ghi khi không giữ khoá → 423.
- [ ] Owner duyệt hướng UI; không có pattern trong danh sách cấm.

## Risk Assessment
| Rủi ro | K×A | Giảm thiểu |
|---|---|---|
| ZIP lớn làm treo tab | TB × TB | fflate streaming trong Web Worker |
| Thứ tự trang sai | TB × Cao | natural sort + cho kéo thả sắp xếp trước commit |
| File giả mạo/độc qua upload | TB × Cao | Presigned POST giới hạn, HEAD + magic bytes khi commit, MinIO domain riêng + nosniff |
| Lộ URL ảnh | Thấp × TB | presigned TTL ngắn, bucket private |
| Polling tốn tài nguyên | Thấp × Thấp | Chỉ poll khi chapter chưa terminal; 1 query gộp trạng thái |
| UI "AI slop" | TB × TB | Danh sách cấm trong `docs/design-guidelines.md`, owner duyệt |

Rollback: chỉ thêm route/feature folder; tắt route là đủ.
