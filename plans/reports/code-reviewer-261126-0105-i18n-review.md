# Review i18n vi + en (thay đổi chưa commit) — 26/11/2026

## Phạm vi
- Plan: `plans/261125-1440-i18n-vi-en/plan.md` (Contract: API giữ `message`, thêm mã + params; vi là bản gốc + fallback; prompt LLM giữ tiếng Việt).
- Đọc kỹ: `packages/shared/src/{api-errors,ui-locale,job,ignore-text}.ts`, `apps/api/src/lib/api-error.ts`, `app.ts` onError, mọi route/lib đã chuyển sang `apiError`/`codeError`, `auth.ts`, `routes/me.ts`, migration 0033 + down, `jobs/enqueue.ts`, json-schema, worker (`handlers.py`, `schema.py`, `providers/base.py`, prompts, `runner.py`), `apps/web/src/i18n/**`, `main.tsx`, `app/layout.tsx`, `lib/api.ts`, `job-error.ts`, `export-options.ts`, `erase-queue.ts`, `ocr-wait.ts`, `routes/export.ts`.
- Bỏ qua các file thuộc task chọn model tự động, đúng như được giao.
- Kiểm chứng:
  - Quét AST (babel) tìm `t()` / `tp()` / `tNode()` gọi ở cấp module: chỉ có `editor/save.ts:50`, và chỗ này đã gán lại qua `i18nStore.subscribe`.
  - Quét `useMemo` / `useCallback` dùng `t` mà deps thiếu `locale`: chỉ thấy callback xử lý sự kiện, `t` được gọi lúc chạy nên không giữ chữ cũ.
  - Đọc `better-auth/dist/db/schema.mjs:74`: field có `input: false` mà client gửi lên thì bị từ chối.
  - So payload với `git show HEAD:packages/shared/json-schema/job-payload.schema.json`: mọi nhánh đều có `additionalProperties: false`, nên phải nâng MIN.
- Chạy (tuần tự, `nice`):
  - web: `src/i18n`, `lib/api.test`, `job-error`, `erase-queue` (8 file, 71 test) xanh.
  - api: `test/unit/api-error.test.ts` (5 test) và `test/ui-locale.test.ts` (6 test) xanh.
  - worker: `tests/test_ui_lang.py` (10 test) xanh.
  - `pnpm typecheck` xanh.
  - Không chạy e2e.

## Đánh giá chung
Hợp đồng lỗi giữ tương thích ngược tốt: `error` cũ không đổi ở mọi chỗ web/test đang so (`translate_running`, `page_not_prepared`, `chapter_busy`, `in_use`, `not_uploaded`, `trim_too_large`, `page_busy`…), `message` tiếng Việt vẫn còn, `extra` không ghi đè được `error`/`message`. `PUT /api/me/locale` validate chặt (`z.enum(UI_LOCALES).strict()`), có `requireUser`, và chỉ ghi user của phiên. Không có lỗi critical. Có một rủi ro tiềm ẩn đáng sửa trước khi thêm locale thứ ba, và vài lỗi nhỏ về tương thích khi rollback / hiển thị.

## Critical
Không có.

## Important

### 1. Mã locale bị đóng cứng thành `enum` trong schema job của worker → thêm locale thứ ba sẽ làm hỏng mọi job dịch / hiệu đính
- `packages/shared/src/job.ts:202` (`UiLang = z.enum(UI_LOCALES)`), `:229`, `:283`; `packages/shared/src/ui-locale.ts:6`; `apps/web/src/i18n/locales.ts:2` ("Thêm locale = 1 file … + 1 dòng registry").
- `server-locale-sync.test.ts:20` bắt `LOCALE_CODES` (web) phải khớp `UI_LOCALES` (shared), nên thêm locale web thì cũng phải thêm vào `UI_LOCALES`. Danh sách đó lại được xuất thành `"enum": ["vi","en"]` trong `job-payload.schema.json`, mà worker kiểm bằng `validate_contract("job-payload", …)` ở `runner.py:328`.
- Kịch bản: thêm `ja` vào registry, deploy API/web nhưng không nâng `PIPELINE_VERSION` / `MIN_PIPELINE_VERSION` (registry nói chỉ cần 1 JSON + 1 dòng). Người dùng giao diện `ja` → `uiLangOf()` trả `ja` → worker 0.14.0 gặp `ContractError` → `JobFailure("internal", "contract: …")` → mọi lượt dịch và hiệu đính của người đó hỏng, nhãn hiện "lỗi hệ thống".
- Hôm nay chưa hỏng (chỉ có vi/en), nhưng hướng dẫn trong code dẫn thẳng tới lỗi này. Độ tin cậy: cao.
- Hướng sửa (chọn 1):
  - (a) Payload dùng `ui_lang: z.string().regex(/^[a-z]{2,3}$/).optional()`; `lang_label()` của worker vốn đã giữ nguyên mã lạ.
  - (b) Giữ enum nhưng tách `WORKER_UI_LANGS`; API ánh xạ locale ngoài danh sách về `en`, và sửa comment registry để nói rõ việc phải nâng worker + MIN.

## Nit / thấp

### 2. Web dịch lỗi theo mã nhưng thiếu `params` → lộ placeholder `{number}`
- `apps/web/src/lib/api.ts:161-167` (`codedText`): có key `errors.<mã>` là dùng ngay, không kiểm đã đủ tham số. `interpolate()` giữ nguyên `{name}` khi thiếu.
- Kịch bản: tab đang chạy web mới trong khi API bị rollback về bản cũ (body cũ chỉ có `{error, message}`). Khi đó `chapter_number_taken` hiện "series đã có chương {number}", và tương tự với `duplicate_term`, `trim_too_large`, `skip_images_full`, `unknown_font`, `band_too_small`, `csv_too_many_rows`.
- Cùng nhóm: `ExportView.error_class` không có ở API cũ, nên `exportFailureText` luôn ra "lỗi hệ thống".
- Hiện API mới luôn gửi đủ params (kiểu `ApiErrorParamsArg` ép), nên chỉ lộ khi lệch phiên bản. Độ tin cậy: cao.
- Hướng sửa: nếu chuỗi sau khi thay vẫn còn `{\w+}` thì trả `null` để dùng `message`.

### 3. Rollback thủ công để lại job có `ui_lang` → worker cũ làm hỏng job
- `packages/db/migrations-down/0033_user_ui_locale.down.sql`; `docs/deployment-guide.md:280-282`.
- Lùi image self-host (cả app lẫn worker về 0.13) theo tài liệu: job dịch / hiệu đính đang `queued` hoặc `paused_budget` vẫn mang `ui_lang`. API cũ (MIN 0.12) cho worker 0.13 nhận job, worker gặp lỗi `additionalProperties` và job fail.
- Không mất dữ liệu, người dùng bấm chạy lại là được. Rollback tự động của updater thì khôi phục bản backup DB nên không bị.
- Hướng sửa: thêm vào file down câu `UPDATE jobs SET payload = payload - 'ui_lang' WHERE type IN ('chapter.translate','chapter.proofread') AND status IN ('queued','running','paused_budget');`.

### 4. Hai lỗi 400 của reinpaint mất câu tiếng Việt
- `apps/api/src/jobs/enqueue.ts:362,365`: `codeError(400, "invalid_mask_source" | "invalid_mask_key")`. Trước đây body là `{error: "<câu tiếng Việt>"}`; nay `invalid_mask_*` không có `message` và web không có key `errors.invalid_mask_*`.
- Ở giao diện vi, người dùng thấy chuỗi thô `invalid_mask_key`. Chỉ xảy ra khi client gửi sai (bug), nên mức nit.

### 5. Chi tiết lỗi job do API sinh ra vẫn là tiếng Việt
- `apps/api/src/jobs/queue.ts:513` ("AI trả sai định dạng ở N trang…") và `:541` (phần sau `clean_rev_changed:`).
- Nhãn chính đã dịch theo `error_class` / tiền tố, nhưng tooltip / "Chi tiết kỹ thuật" ở giao diện en hiện tiếng Việt. Chuỗi của worker thì đã chuyển sang tiếng Anh.

### 6. `initI18n` không có thời hạn
- `apps/web/src/main.tsx:23`: render chờ `import("./messages/en.json")`. Nếu chunk bị treo (mạng chập chờn, không reject), người dùng giao diện en thấy trang trắng tới khi tải xong.
- Có thể đua `Promise.race` với khoảng 3 giây rồi render bằng vi.

### 7. Đổi ngôn ngữ nhanh: thứ tự PUT không đảm bảo
- `i18n-store.ts` `syncLocaleToServer`: en→vi liên tiếp gửi 2 PUT độc lập. Nếu server commit ngược thứ tự thì DB giữ `en` trong khi client tin là `vi` và không gửi lại. Ghi chú AI sẽ sai ngôn ngữ tới lần đổi sau. Xác suất rất thấp.

## Đã kiểm, không phải lỗi
- `app.ts` onError đổi `HTTPException` không có `res` thành `{error: "http_<status>", message}`. Còn 2 chỗ dùng dạng này là `claim-inputs.ts:66` và `routes/worker.ts:28` (401 token sai), đều do worker gọi. Worker không đọc `error` của body, và web không so các chuỗi cũ (grep).
- `uiLocale` trong better-auth có `input: false`: `update-user` / sign-up tự đặt sẽ bị từ chối (xác minh trong source better-auth 1.7.11). Không có quyền ghi field khác qua `/api/me/locale`.
- Nâng MIN 0.14.0 là đúng (schema HEAD strict). Job cũ trong hàng đợi không có `ui_lang` thì worker dùng `vi`. `PIPELINE_VERSION` của API (muối `input_rev`) không đổi, nên không có hàng loạt trang phải prepare lại. `fake-worker` / `worker-helpers` đã lên 0.14.0.
- Migration 0033 chỉ thêm cột nullable. File down cùng quy ước với 0031/0032. `_journal.json` và snapshot đều có.
- `ImageError.code` tách từ `apiCode`: status 422/400 ở `series.ts:484` vẫn đúng.
- Lỗi CSV từng dòng mang `{line, error, message, params}` và web dịch bằng `apiErrorText(r)`. Issue của chữ bỏ qua mang `params: {error, params}` (test API xác nhận).
- `natural-sort.ts` vẫn ghim `Intl.Collator("en")`, nên thứ tự trang khi upload không phụ thuộc locale.
- `PAGE_BUSY_SAVE_TEXT` được gán lại qua subscribe. Không có `useState(t(...))` hay `dangerouslySetInnerHTML`.

## Theo dõi plan
- Phase 1–7 có mã tương ứng. Success criteria còn mở, giữ nguyên trạng thái chưa xong:
  - "`style_note` / `reason` theo ngôn ngữ giao diện": mới kiểm bằng prompt + unit test, chưa chạy LLM thật.
  - E2E 122/125: 3 test đỏ được ghi là có từ trước i18n; tôi không chạy lại.
- Nên làm trước khi phát hành 0.7.0: sửa #1 (hoặc ít nhất sửa comment registry + `docs/job-queue-worker.md`), cân nhắc #2 và #3.

## Câu hỏi còn mở
- Có muốn thêm locale thứ ba mà không phải nâng worker không? Câu trả lời quyết định chọn hướng (a) hay (b) cho #1.

Status: DONE_WITH_CONCERNS
Summary: Không có lỗi critical. Hợp đồng lỗi API, migration 0033, `PUT /api/me/locale` và việc nâng MIN 0.14.0 đều đúng và tương thích ngược. Còn một rủi ro tiềm ẩn quan trọng: mã locale nằm trong enum schema worker, nên thêm locale thứ ba sẽ làm hỏng mọi job dịch / hiệu đính. Ngoài ra có vài lỗi nhỏ khi rollback / hiển thị.
Concerns/Blockers: Tiêu chí "ghi chú AI theo ngôn ngữ giao diện" chưa được kiểm bằng LLM thật.
