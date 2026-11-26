# Sửa finding review i18n (vi + en) — 26/11/2026

Nguồn: `plans/reports/code-reviewer-261126-0105-i18n-review.md`. Đã sửa đủ 5 mục được giao. Không đụng vào mục 5 (chi tiết lỗi job do API sinh) và mục 7 (hai PUT đổi locale liên tiếp), đúng như đã chốt.

## Thay đổi

1. **`ui_lang` không còn là enum.**
   - `packages/shared/src/job.ts`: `UiLang` giờ là chuỗi tối đa 35 ký tự, khớp `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$`. Đã bỏ import `UI_LOCALES` không còn dùng.
   - Đã chạy `pnpm schema:emit`. Kết quả chỉ đổi `job-payload.schema.json` và `claim-response.schema.json` (từ `enum` sang `pattern` + `maxLength`). Test drift của shared xanh.
   - Worker chỉ đổi test. `lang_label()` vẫn giữ nguyên mã lạ, payload thiếu `ui_lang` thì dùng `vi`.
   - `PUT /api/me/locale` vẫn chỉ nhận `z.enum(UI_LOCALES)`.
   - Test mới:
     - shared: nhận `ja`, `fil`, `zh-Hant`, `pt-BR`; từ chối `""`, `e`, `EN`, `english`, `en_US`, `en-`, `vi; drop` và chuỗi quá dài.
     - worker: hợp đồng nhận `ja` / `zh-Hant`, từ chối dạng sai. Job hiệu đính với `ui_lang: "ja"` chạy qua `run_job` (có kiểm hợp đồng) và prompt mang `ja (tiếng Nhật)`. Mã chưa có tên như `th` được giữ nguyên.
   - Đã sửa comment registry trong `apps/web/src/i18n/locales.ts` và mục "Thêm locale" trong `docs/design-guidelines.md`: thêm locale cần JSON + một dòng `LOCALES` + mã trong `UI_LOCALES`, không cần nâng worker.
2. **`apiErrorText` / `errorMessage`** (`apps/web/src/lib/api.ts`):
   - Nếu key `errors.*` cần tham số mà server không gửi, dùng `message` của server. Không có `message` thì dùng `errors.unknown` (câu chung kèm mã).
   - Cách kiểm: so tên placeholder của câu gốc với `params`. Vì vậy giá trị tham số tự chứa `{…}` không bị coi là thiếu.
   - Có test trong `lib/api.test.ts`.
3. **Down migration 0033:** trước khi drop cột, chạy `UPDATE jobs SET payload = payload - 'ui_lang'` cho job `chapter.translate` / `chapter.proofread` ở trạng thái `queued`, `running` hoặc `paused_budget`. Đây đúng là các trạng thái trong `ACTIVE_JOB_STATUSES`; job `running` hết lease sẽ được xếp lại nên cũng gỡ.
4. **`invalid_mask_source` / `invalid_mask_key`:**
   - Đã thêm vào `API_ERROR_MESSAGES_VI`. Câu tiếng Việt lấy lại từ câu cũ trước i18n.
   - Thêm `errors.invalid_mask_*` vào `vi.json` / `en.json`.
   - `enqueue.ts` chuyển sang `apiError` và bỏ import `codeError`.
   - Test `cancel-and-recovery` giờ kiểm cả body `{error, message, params}` cho cả hai mã.
5. **`initI18n(timeoutMs = I18N_INIT_TIMEOUT_MS = 5000)`:**
   - Quá hạn thì áp `vi`, không lưu, ghi cảnh báo, rồi vẽ app. Bảng chuỗi tải xong muộn bị bỏ qua.
   - Dọn timer trong `finally`. Đã cập nhật comment trong `main.tsx`.
   - Hai test dùng fake timers: nhánh hết giờ (chưa xong ở 4999 ms, xong ở 5000 ms, bỏ bảng chuỗi đến muộn) và nhánh tải kịp (không còn timer treo).

## Kiểm thật (tuần tự, `nice`)

- `pnpm --filter @mtl/shared test`: 149 test xanh.
- `pnpm --filter @mtl/web test`: 66 file, 628 test xanh.
- `pnpm --filter @mtl/api test`: 72 file, 766 test xanh, 1 skip.
- `pnpm typecheck`, `pnpm lint` (biome, 526 file): xanh.
- `cd worker && uv run pytest -q`: 456 test xanh.
- E2E `settings-language` + `i18n-en-smoke`, `--workers=1`: 4/4 xanh. Server của Playwright đã tắt, cổng 8797/5181 trống.
- Down → up trên `mtl_test_e2e` (:5442), không đụng DB dev:
  - Chuẩn bị: chuyển tạm 3 job dịch có `ui_lang` sang `queued` / `paused_budget` / `succeeded`.
  - Chạy down: `UPDATE 2` (chỉ gỡ ở hai job đang chờ, job `succeeded` vẫn giữ). Cột `ui_locale` mất, journal còn 33.
  - Chạy migrate lại: journal 34, có cột. Đã trả 2 job về `succeeded`.

## Ghi chú

- Route `POST /pages/:id/reinpaint` (`routes/page-state.ts:311`) cũng tự ném `invalid_mask_key` qua `httpError` mà không có `message`. Tôi không sửa vì nằm ngoài phạm vi. Web giờ đã có key `errors.invalid_mask_key` nên vẫn hiện câu đúng ở cả hai ngôn ngữ.
- `docs/job-queue-worker.md` không ghi `ui_lang` là enum nên không phải sửa.

Status: DONE
Summary: Đã sửa đủ 5 finding (ui_lang chỉ kiểm dạng mã, không lộ placeholder, down 0033 gỡ ui_lang của job chưa xong, thêm hai mã lỗi mask vào hợp đồng, initI18n tự bỏ chờ sau 5 giây). Mọi gate unit / typecheck / lint / pytest / 2 spec E2E đều xanh, đã thử down → up trên DB e2e.
Concerns/Blockers: Không có.
