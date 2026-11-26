# Báo cáo: mã lỗi API + worker theo locale

Trạng thái: hoàn thành. Test API, web, shared, pytest worker, typecheck toàn repo và Biome trên file đã đổi đều xanh.
E2E `upload-chapter`, `admin-settings`, `fonts` (thêm `series-manage`) chạy tuần tự 1 worker, tất cả xanh. Chưa commit.

## Hợp đồng lỗi API

Body: `{ error, variant?, message, params }`.

- `error`: mã ổn định cũ. Client vẫn so sánh theo trường này nên giá trị không đổi.
- `variant`: chỉ có khi một `error` mang nhiều câu khác nhau. Mã đầy đủ là `<error>.<variant>`.
- `message`: câu tiếng Việt cũ, giữ nguyên nội dung cho client cũ.
- `params`: luôn có (có thể `{}`).

Nguồn: `packages/shared/src/api-errors.ts` (`API_ERROR_CODES`, `API_ERROR_MESSAGES_VI`, `ApiErrorParams<C>`,
`apiErrorBody`, `apiErrorMessageVi`, `splitApiErrorCode`, `isApiErrorCode`). `ignore-text-vi.ts` đã gộp vào file này,
mã lý do chữ bỏ qua dùng lại `IGNORE_ISSUE_CODES`.

77 mã:

| Nhóm | Mã |
|---|---|
| Glossary | `duplicate_term` {term}, `duplicate_term.unnamed`, `csv_empty`, `csv_too_many_rows` {max}, `csv_unclosed_quote`, `csv_missing_columns`, `csv_invalid_fields` {fields} |
| Chương / ảnh gốc | `chapter_number_taken` {number}, `chapter_not_draft.committed/.processed`, `no_source_files`, `no_valid_files.all_skipped`, `sources_changed`, `no_size`, `trim_too_large` {min}, `source_set_mismatch`, `no_pages.translate/.export`, `last_page` |
| Dịch / quét lại / xuất | `translate_running`, `chapter_busy.translate/.rescan/.ingest/.export/.batch_edit/.page_skip`, `chapter_has_user_edits`, `page_skipped.translate/.rescan`, `page_not_prepared.count` {count}, `.none_waiting`, `.rescan`, `chapter_not_prepared`, `page_busy.rescan`, `page_has_manual_cleanup`, `chapter_not_translated`, `no_translated_pages`, `export_not_ready`, `export_expired`, `size_mismatch` |
| Ảnh tự bỏ / dải cắt | `no_whole_image`, `no_hash.image/.band`, `plain_image.image/.band`, `skip_images_full` {count,max}, `not_uploaded.skip_image`, `no_trim`, `trim_changed`, `band_too_small` {min} |
| Ảnh / bìa | `not_uploaded.thumb`, `invalid_image`, `invalid_image.no_size`, `image_too_large`, `unsupported_format`, `too_large.cover` {max_mb}, `bad_multipart`, `missing_file`, `no_cover`, `unknown_font` {fonts} |
| Font | `invalid_key.user_font/.system_font`, `limit.user_fonts` {max}, `limit.system_fonts` {max,max_mb}, `in_use.font`, `not_uploaded.font`, `too_large.font` {max_mb}, `not_font`, `corrupt_font` |
| Chữ bỏ qua | 8 mã của `IGNORE_ISSUE_CODES` |

## Cách dùng phía API (`apps/api/src/lib/api-error.ts`)

```ts
throw apiError(409, "chapter_number_taken", { number });          // tham số bắt buộc theo câu (typecheck)
throw apiError(409, "in_use.font", {}, { series: titles });       // trường dữ liệu thêm ở đối số thứ 4
return apiErrorResponse(413, "too_large.cover", { max_mb: 10 });  // nơi cần Response (onError của bodyLimit)
throw codeError(403, "forbidden");                                // lỗi chỉ có mã, giữ body `{ error }` như cũ
```

- Thiếu tham số, sai tên tham số hoặc mã lạ đều là lỗi typecheck.
- `onError`: `HTTPException` không có `res` trả `{ error: "http_<status>", message }`. Sau phase này đường đó chỉ
  còn dùng cho lỗi giao thức worker (`invalid worker token`) và lỗi của Hono.
- 404 có chữ tiếng Anh (`series not found`…) đổi sang `NotFoundError`, body giữ y như cũ:
  `{ error: "not_found", message }`.
- `forbidden`, `unauthenticated`, `user_disabled`, `quota_exceeded`, `invalid_csv` giữ body chỉ có mã. Test
  `toEqual` khoá các body này.
- Lời nhắn zod refine của route đổi sang tiếng Anh. Chúng nằm trong `issues` của `invalid_body` và giao diện không
  hiện.
- Chữ bỏ qua bị RE2 từ chối: issue của `invalid_body` giữ câu tiếng Việt cũ ở `message` và có thêm
  `params: { error, params }`.

## Web

- `errorMessage(e)` và `apiErrorText(body, fallback)` (`lib/api.ts`) chọn câu theo thứ tự:
  1. Mã `errors.<error>[.<variant>]` có trong từ điển → câu theo ngôn ngữ giao diện, thay `params`.
  2. Locale `vi` → `message` server gửi (hoặc `fallback`).
  3. Ngôn ngữ khác → `errors.unknown`: "Something went wrong (<mã>)".
- `ApiError.message` được dịch ngay lúc ném, nên các chỗ đọc thẳng `e.message` cũng có chữ đúng ngôn ngữ.
- `invalid_body` có issue mang mã thì dịch theo mã của issue.
- Lỗi từng dòng khi import CSV glossary dịch theo mã (`glossary-editor.tsx`). Dòng kiểu cũ chỉ có `message` vẫn
  đọc được.
- Thêm key web cho lỗi chỉ có mã: `errors.unknown`, `errors.invalid_body`, `errors.invalid_query`,
  `errors.not_found`, `errors.internal`.
- Bỏ 8 key `series.ignoreTextInput.issue.*`. `ignore-text-input.ts` chuyển sang dùng `errors.<mã>`; đã kiểm câu
  vi/en cũ trùng câu mới trước khi xoá.
- Test mới `i18n/api-error-keys.test.ts`: mỗi mã trong `API_ERROR_CODES` phải có `errors.<mã>` trong `vi.json`, và
  câu trùng đúng câu API. Nhờ vậy locale vi hiện y câu cũ và selector e2e không đổi.
- Guard: mục allowlist `@mtl/shared/ignore-text-vi.ts` đổi thành `@mtl/shared/api-errors.ts`, lý do "câu fallback
  `message` của hợp đồng API".

## Worker

`JobFailure.message` trong `worker/mtl_worker/{runner,handlers,export,main}.py` đổi sang tiếng Anh kỹ thuật. Tiền tố
`LLM_NOT_CONFIGURED:` giữ nguyên.

Riêng ca "không thấy chữ trong khung để xoá" là câu hướng dẫn người dùng tự xử lý, nên worker gửi
`no_text_in_box: …`. `features/editor/erase-queue.ts` nhận tiền tố này và hiện `editor.eraseQueue.noTextInBox`; câu vi
giữ nguyên câu cũ. Test python `test_provider_config.py:218` sửa chuỗi kiểm sang câu tiếng Anh mới.

## Ngoài phạm vi, giữ tiếng Việt (grep xác nhận)

Grep `apps/api/src` các dòng không phải comment có chữ Việt, chỉ còn các loại sau:

- Log, `sendAlert`, lỗi khởi động / CLI (`env.ts`, `local/*`, `create-user.ts`, `update-check.ts`).
- Prompt LLM (`honorificText`).
- Lỗi giao thức worker (`JobHttpError` trong `queue.ts`).
- Chi tiết lỗi job lưu ở `jobs.error`, đã có `error_class` hoặc tiền tố mã: `quota_exceeded: …`,
  `Cấu hình AI lỗi …`, `clean_rev_changed: …`, `AI trả sai định dạng…`. Test API khoá nội dung các câu này.

Không còn route nào trả câu tiếng Việt cho người dùng mà thiếu mã.

## Lệnh kiểm (tuần tự, `nice`)

| Lệnh | Kết quả |
|---|---|
| `nice pnpm --filter @mtl/api test` | 71 file, 760 xanh, 1 skip |
| `nice pnpm --filter @mtl/web test` | 65 file, 614 xanh (có guard, parity, test khoá mã mới) |
| `nice pnpm --filter @mtl/shared test` | 10 file, 132 xanh |
| `nice pnpm typecheck` | shared, db, web, api xanh |
| `cd worker && nice uv run pytest -q` | 445 xanh; `ruff check` / `ruff format --check` sạch trên file đổi |
| `nice pnpm exec biome check` (file đổi) | sạch |
| `playwright test upload-chapter admin-settings fonts --workers=1` | 14/14 xanh |
| `playwright test series-manage --workers=1` | 10/10 xanh |

Playwright tự bật rồi tắt API :8797 và Vite :5181; sau khi chạy, `lsof` không còn process nào nghe ở hai cổng này.
Postgres :5442 để nguyên. Không cần worktree để so lỗi có sẵn từ trước vì không có test nào đỏ.

## Thay đổi của task khác

Không sửa file nào của task khác. `admin-providers.ts` và `admin-settings.ts` vốn chỉ trả lỗi chỉ có mã, không có câu
tiếng Việt.

## Câu hỏi chưa giải quyết

- Một số chỗ web vẫn hiện thẳng `job.error`: lỗi xuất (`export-options.ts`, test khoá giá trị thô), lỗi cắt trang
  (`chapter-workspace.tsx`), OCR vùng, xoá chữ bằng mask. Sau phase này, chi tiết lỗi do worker gửi ở các chỗ đó là
  tiếng Anh, kể cả khi giao diện tiếng Việt. Có muốn ghép nhãn theo `error_class` vào các chỗ này trong một việc riêng
  không?
- Lỗi ảnh do `mtl_pipeline` ném (`ImageRejected`, câu tiếng Việt) vẫn đi vào `jobs.error` nguyên văn. Thư mục này
  nằm ngoài danh sách file của phase.
