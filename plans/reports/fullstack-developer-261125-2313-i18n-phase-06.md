# Báo cáo: ghi chú AI + mặc định theo locale

Trạng thái: hoàn thành, chưa commit. Mọi bộ test và typecheck đều xanh, e2e yêu cầu xanh. Phần còn lại là smoke LLM
thật (chạy thủ công).

## Migration và backup

- Backup DB dev trước khi migrate: `backups-dev/mtl-dev-before-0033-ui-locale-261125-2314.dump`. Lệnh dùng là
  `pg_dump -Fc` chạy trong container `mtl-dev-postgres-1`, cùng quy trình với các dump 0031/0032 trước đó.
- `packages/db/migrations/0033_user_ui_locale.sql`: `ALTER TABLE "user" ADD COLUMN "ui_locale" text` (nullable, sinh
  bằng drizzle-kit, snapshot + journal đi kèm). DB dev đã lên 34 migration.
- Down tay: `packages/db/migrations-down/0033_user_ui_locale.down.sql`. Đã thử trên `mtl_test_e2e`: chạy down rồi
  migrate lại, cả hai chiều đều đúng.
- `local/schema-guard.ts` không cần sửa, vì nó so `when` của journal và `when` mới lớn hơn bản trước. Migration chỉ
  thêm một cột nullable nên chạy được trên DB của bản 0.6.0. DB test của API và e2e chạy lại toàn chuỗi migration từ
  đầu mỗi lượt.

## Luồng ui_locale → ui_lang → prompt

1. Web: `syncLocaleToServer` nằm trong `i18n/i18n-store.ts`, component `LocaleSync` gắn trong `AuthGate`
   (`app/layout.tsx`), nên trang editor nằm ngoài shell cũng được đồng bộ. Khi `/api/me` tải xong, nó so sánh một lần
   và gửi `PUT /api/me/locale` nếu locale khác server. Sau đó, mỗi lần người dùng đổi ngôn ngữ, nó gửi lại. Nếu gửi
   lỗi thì chỉ ghi `console.warn`, lần đổi sau sẽ gửi lại.
2. API: `GET /api/me` trả thêm `ui_locale`, đọc thẳng từ DB vì chế độ local giữ user trong bộ nhớ. `PUT /api/me/locale`
   validate bằng `z.enum(UI_LOCALES)` strict, sai thì trả `invalid_body`, là mã web đã có. Trong better-auth,
   `additionalFields.uiLocale` đặt `input: false`, nên client không ghi được cột này qua `update-user`.
3. Enqueue: `uiLangOf(tx, s.userId)` trong `jobs/enqueue.ts` được gọi bên trong `enqueueTranslate` và
   `enqueueProofread`. Mọi đường đều có `ui_lang`, kể cả lô dịch do `translate-chain` tự enqueue. Nếu chưa đồng bộ
   hoặc mã lạ thì dùng `vi`. Khoá idempotency giữ nguyên vì chỉ dedupe với job đang chạy.
4. Shared: thêm `packages/shared/src/ui-locale.ts` (subpath `@mtl/shared/ui-locale`) và payload `ui_lang` optional.
   Đã chạy `pnpm schema:emit`, thay đổi nằm ở `job-payload` và `claim-response`.
5. Worker: `ui_lang` được truyền qua `SeriesSettings`, `TranslateRequest` và `ProofreadRequest`, mặc định `vi`, rồi vào
   JSON gửi LLM dưới dạng `"ui_lang": "en (tiếng Anh)"`. Prompt vẫn viết tiếng Việt và chỉ đổi phần chỉ dẫn:
   `style_note` / `reason` "viết bằng ngôn ngữ `ui_lang` — kể cả khi khác `target_lang`". Đã bỏ câu ép "lý do bằng
   tiếng Việt". System prompt không đổi theo người dùng, nên vẫn cache được.
6. Series mới: `defaultTargetLang(locale)` trả locale nếu nó nằm trong `TARGET_LANGS`, ngược lại trả `vi`. Default của
   cột DB không đổi.

## Ngoài danh sách file của phase (cần để đúng)

- Payload thêm trường mới, trong khi schema worker đặt `additionalProperties: false`, nên worker cũ sẽ fail job dịch /
  hiệu đính. Vì vậy đã nâng worker `PIPELINE_VERSION` lên 0.14.0 và `MIN_PIPELINE_VERSION` mặc định lên 0.14.0, theo
  đúng lệ của repo. Kèm theo đó đã cập nhật `VERSION` trong `apps/api/test/worker-helpers.ts` và
  `apps/web/e2e/fake-worker.ts`, thêm ca 426 cho worker 0.13.0 vào `queue.test.ts`, và ghi chú ở
  `docs/job-queue-worker.md` + `docs/deployment-guide.md`.
- `routes/me.ts`, `lib/api.ts` (`Me.ui_locale`, `putUiLocale`), `app/layout.tsx`, `features/series/lang-labels.ts`
  (re-export).

## Kết quả kiểm (tuần tự, `nice`)

| Lệnh | Kết quả |
|---|---|
| `pnpm --filter @mtl/shared test` | 11 file, 140 xanh (có test lệch schema) |
| `pnpm --filter @mtl/db test` | 5 file, 10 xanh |
| `pnpm --filter @mtl/api test` | 72 file, 766 xanh, 1 skip |
| `pnpm --filter @mtl/web test` | 66 file, 625 xanh (guard i18n + parity xanh) |
| `pnpm typecheck` | shared, db, web, api xanh |
| `cd worker && uv run pytest -q` | 455 xanh; `ruff check` + `ruff format --check` sạch trên file đổi |
| `biome check` (file đổi) | sạch |
| `playwright test series-auto-memory proofread settings-language series-manage --workers=1` | 16/16 xanh |
| `playwright test update-notice routes admin-settings signup editor --workers=1` | 44/44 xanh (kiểm hồi quy cổng đăng nhập) |

Test mới:

- `apps/api/test/ui-locale.test.ts`: GET/PUT locale, 400, 401; lô dịch tự enqueue mang `ui_lang` của chủ series;
  chưa đồng bộ hoặc mã lạ → `vi`; hiệu đính mang `ui_lang`.
- `worker/tests/test_ui_lang.py`: prompt có chỉ dẫn; JSON gửi LLM có `ui_lang`; schema nhận payload có và không có
  `ui_lang`; handler dịch / hiệu đính truyền đúng giá trị; payload thiếu → `vi`.
- `packages/shared/test/ui-locale.test.ts`.
- `apps/web/src/i18n/server-locale-sync.test.ts`: lúc mở app, khi đổi, khi gửi lỗi, khi ngừng theo dõi; và kiểm
  registry web khớp `UI_LOCALES`.
- `settings-language.spec.ts`: thêm bước chờ `PUT /api/me/locale` khi đổi ngôn ngữ; series mới ở trình duyệt en mặc
  định đích `en`.

Playwright tự bật rồi tắt :8797 và :5181; đã kiểm bằng `lsof`, không còn process nào. Postgres :5442 để nguyên.

## Còn lại

- Smoke LLM thật (thủ công, cần key): đặt locale en → hiệu đính 1 trang → `reason` phải là tiếng Anh; series chưa có
  Giọng văn → `style_note` phải là tiếng Anh. Chưa chạy.
- Deploy VPS: worker Mac + image Modal phải lên 0.14.0 trước hoặc cùng lúc API. Bản self-host không cần làm gì thêm.

## Câu hỏi chưa giải quyết

- Đồng bộ chỉ đi một chiều (trình duyệt → server). Người dùng mở hai trình duyệt khác ngôn ngữ thì trình duyệt mở sau
  thắng. Đây là chủ ý theo thiết kế; nếu muốn trình duyệt mới lấy ngôn ngữ từ server thì cần quyết định riêng.
