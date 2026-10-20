# Cook report — Phase 4: web upload, series settings, progress, pages

Branch `feat/p4-web-upload-series-progress` (chưa merge). Plan: `plans/261019-1847-manga-translate-editor-mvp/phase-04-web-upload-series-progress.md` (status → completed; plan.md không sửa).

## Kết quả
| Hạng mục | Trạng thái |
|---|---|
| typecheck (4 package) | xanh |
| lint (Biome, 117 file) | xanh |
| test | 93 xanh: api 76 (12 file), web 6, shared 8, db 3 |
| e2e Playwright | 1/1 xanh: upload ZIP 10 trang (tên xáo) → thứ tự tự nhiên → commit → worker giả → 10 trang "Sẵn sàng" |
| build web | xanh |
| flakiness | 3 lượt liền 4 file test API mới: 28/28 mỗi lượt |

## Đã làm
**API** (`apps/api/src/routes/`; mount ở `app.ts` — `index.ts` chỉ serve):
- `series.ts`: list/create/get (+ chương)/patch. `source_lang` enum ko/ja/zh/en nhưng MVP chỉ nhận ko; `llm_tier` standard/premium; đổi trường dịch → `settings_rev+1` (tăng trong SQL, chỉ khi giá trị thực đổi).
- `chapters.ts`: `POST /chapters` (chapter draft + source_files + presigned POST ≤30MB, Content-Type cố định, ≤400 file), `POST /:id/presign` (ký lại, chỉ draft), `POST /:id/commit` (HEAD + 16 byte magic PNG/JPEG/WEBP; loại file sai + enqueue chỉ `chapter.ingest` cùng 1 transaction; chỉ draft hoặc ingest lỗi; khoá người khác → 423), `GET /:id` (khoá + tên người giữ), `retry-failed`, `translate` (page_ids → neighbors), `cancel` (lặp tới khi hết job active), `POST|DELETE /:id/lock`.
- `pages.ts`: thumbnail = clean rev hiện tại, fallback ảnh gốc; presigned GET 15'.
- `glossary.ts`: CRUD cấp workspace + series, CSV import (merge/replace) / export (BOM, chống CSV injection); `glossary_rev` tăng cùng transaction.
- `lib/member-names.ts`: tên người giữ khoá (chỉ thành viên workspace).
- Test: `chapters.test.ts`, `glossary.test.ts`, `upload-validation.test.ts`; `tenant-isolation.test.ts` thêm case cho mọi route mới.

**Web** (`apps/web/src/`):
- `app/router.tsx` (TanStack Router, params type-safe), `app/layout.tsx` (AuthGate + WorkspaceLayout). Route editor `/w/$ws/series/$seriesId/chapters/$chapterId/edit/$pageId` đã có placeholder, nằm ngoài layout workspace — P5 chỉ thay `component` của `editorRoute`.
- `styles/tokens.css`, font Be Vietnam Pro tự host.
- `features/series` (list, detail, settings + quy tắc xưng hô), `features/glossary` (bảng sửa tại chỗ, CSV), `features/upload` (ZIP giải nén trong Web Worker bằng fflate, natural sort + kéo thả, 4 song song, retry 3 lần/ file có ký lại, commit + báo file bị loại), `features/chapter` (polling 2,5s tới khi ổn định, lưới thumbnail, chạy lại trang lỗi / dịch lại / huỷ, banner khoá, hook `useChapterLock` cho P5).
- `e2e/` + `playwright.config.ts` (API :8797, Vite :5180, DB `mtl_test_e2e`, worker giả chỉ trong test).

**Docs**: `docs/design-guidelines.md` (3 hướng, chọn A, danh sách cấm, token), `docs/development-setup.md` (e2e, quy ước web).

## Review
code-reviewer 7/10, 0 critical (`plans/reports/code-reviewer-261020-1713-p4-web-upload-series-progress-report.md`). Đã sửa:
- H1 commit xoá source_files trước khi check 409 → gộp vào transaction với enqueueIngest + chỉ cho draft/ingest lỗi.
- H2 thumbnail tải lại liên tục khi polling → giữ URL theo (page, clean_rev) tới 10'.
- M1 lost update `settings_rev` → tăng trong SQL.
- M4 race lock/unlock trong `useChapterLock` → tuần tự hoá + bỏ response muộn.
- M5 import "thay toàn bộ" không hỏi → xác nhận ở UI; server từ chối CSV rỗng.
- Low: CSV injection, polling khi lỗi, marker merge cũ trong `.gitignore`.

Tester: `plans/reports/tester-261020-1713-p4-web-upload-series-progress-report.md`.

## Lệch so với plan
- Client API viết tay có type thay vì Hono `hc<AppType>` (route hiện có không viết dạng chain, kéo type API vào web cần tsconfig chung) — đổi sau nếu cần.
- Mount route ở `apps/api/src/app.ts` (plan ghi `index.ts`, nhưng mount thực tế nằm ở `app.ts`).
- Sửa file P2 cho router mới: `apps/web/src/{main.tsx,lib/api.ts,routes/*.tsx}`, `index.html` (bỏ style inline).
- Thêm route ngoài plan: `GET/PATCH /series/:id`, `POST /chapters/:id/presign`, `GET /chapters/:id`.

## Còn mở / concerns
- **Owner chưa duyệt hướng UI** (A/B/C trong design-guidelines). Auto mode → chọn A.
- M2: policy POST còn hiệu lực ≤15' sau commit — có thể ghi đè object đã kiểm magic bytes; worker decode ảnh chặn hậu quả. Không thu hồi được presigned policy; giảm TTL hoặc copy sang key bất biến khi commit nếu cần.
- M3: glossary trùng `source_term` khi tạo đồng thời — cần unique index (partial, theo scope) ở `packages/db` (không thuộc P4).
- Chưa có test tự động: tiến độ ≤3s sau heartbeat (chỉ có hằng poll 2,5s), ZIP 200MB/150 ảnh, mất mạng thật giữa upload.
- Retry/dịch lại/huỷ không chặn khi người khác giữ khoá (job AI không ghi đè state khi chương bị khoá — P3); đổi thành 423 nếu owner muốn.
- Test DB dùng chung giữa các worktree (`mtl_test_api`) → chạy test song song ở worktree khác có thể làm fail giả.
- Không chạy `/ak:journal` và sync plan.md theo yêu cầu (chỉ sửa status phase-04).

## Câu hỏi
1. Owner chọn hướng UI nào (A/B/C)?
2. Retry/dịch lại/huỷ có cần trả 423 khi người khác giữ khoá không?
3. Thêm unique index glossary (`workspace_id, coalesce(series_id), source_term`) ở phase nào?
