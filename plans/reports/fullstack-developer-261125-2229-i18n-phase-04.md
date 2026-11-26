# Báo cáo: chuyển chuỗi admin, fonts, update, pipeline, app, shared sang i18n (vi + en)

Trạng thái: hoàn thành, có một lưu ý về e2e. Typecheck toàn repo, unit test web và shared (có guard và parity), Biome
đều xanh. Trong 28 test e2e, 27 xanh. `click-budget` đỏ do một lỗi có từ trước, cùng nguyên nhân với `full-flow` (xem
mục E2E). Chưa commit gì.

## Phạm vi

- Web: chuyển hết chữ giao diện trong `features/{admin,fonts,update,pipeline}`, `app/`, `routes/login.tsx`,
  `lib/{api,format}.ts`. `styles/` không còn dòng nào cần chuyển: chữ Việt trong đó chỉ nằm ở comment. Thêm 330 key:
  `admin.*` 119, `fonts.*` + `update.*` 116, `pipeline.*` 44, `app.*` 21, `routes.*` 12, `lib.format.*` 6,
  `errors.*` 4, `series.ignoreTextInput.issue.*` 8. Tổng cộng 1.437 key.
- `features/series/ignore-text-input.ts`: đọc mã lý do từ shared rồi dịch. File này nằm ngoài danh sách phase, nhưng
  phải sửa để bỏ được lý do lỗi tiếng Việt do shared trả về.
- Việc của task khác đang để trong `pipeline-settings.tsx` và `ai-providers.ts` (`autoSlotModel`, "Tự động", `autoHint`)
  vẫn còn nguyên. Tôi chỉ sửa chồng lên.
- Không sửa test cũ, không sửa selector e2e, không sửa `apps/api`.
- Chia việc: admin giao cho một helper, fonts + update giao cho một helper khác. Hai helper sửa file không chồng nhau.
  Key được gộp vào JSON qua script có khoá, script từ chối ghi đè khi giá trị khác.

## Mã shared mới

| Export | Ý nghĩa |
|---|---|
| `IGNORE_ISSUE_CODES`, `IgnoreIssueCode`, `IgnoreIssue = { code, params }` | Mã lý do một mục chữ bỏ qua không hợp lệ: `text_length` {min,max}, `regex_too_long` {max}, `regex_too_short` {min}, `regex_nested_quantifier`, `regex_unsupported_syntax`, `regex_too_many_quantifiers` {max}, `regex_invalid`, `regex_matches_empty` |
| `ignoreEntryIssue(entry, opts)` | Trả mã kèm params, hoặc null. Web dùng hàm này và dịch qua `series.ignoreTextInput.issue.<code>` |
| `ignoreEntryError(entry, opts)` | Không đổi chữ ký. Vẫn trả câu tiếng Việt cũ, ghép từ mã trong `ignore-text-vi.ts`. API (`ignoreEntryErrorRe2`) đặt câu này vào `issues[].message`, nên test cũ của shared và API vẫn xanh |
| `IgnoreEntry` lỗi | Đổi từ `{ kind: "invalid", error }` thành `{ kind: "invalid", issue }`. Không chỗ nào khác đọc `.error` |
| bỏ `MODEL_UNSUPPORTED_MESSAGE` | Web dùng `t("errors.modelUnsupported", { model: RECOMMENDED_ANTHROPIC_MODEL })`. Lời nhắn zod nội bộ đổi sang tiếng Anh, vẫn chứa tên model mà test cũ kiểm |

Các lời nhắn kỹ thuật khác đổi sang tiếng Anh vì giao diện không hiện chúng: zod `base_url` / trùng model
(`ai-providers.ts`), `page.reinpaint` (`job.ts`), engine OCR không đọc được ngôn ngữ (`pipeline-settings.ts`),
`RangeError` (`dhash.ts`). API trả các câu zod này trong `issues` của `invalid_body`, và web không đọc `issues`. Đã grep:
không test nào kiểm nội dung các câu này. `job.ts:57-59` (`QUOTA_EXCEEDED`, `LLM_NOT_CONFIGURED`) vốn đã là mã, nên giữ
nguyên.

## `LANG_NAMES`

Giữ trong shared. API `jobs/enqueue.ts` (`honorificText`) chèn tên ngôn ngữ vào câu chỉ dẫn gửi LLM. Prompt là
non-goal và phải giữ tiếng Việt. Worker có bảng Python riêng (`worker/mtl_pipeline/langs.py`). Web không còn import
`LANG_NAMES` từ shared: pipeline đã chuyển sang `langName()` trong `features/series/lang-labels.ts`. Đã thêm comment ghi
rõ mục đích trên hằng này.

## Allowlist còn lại (guard quét `apps/web/src` và `packages/shared/src`)

| Mục | Lý do |
|---|---|
| `i18n/locales.ts` `"Tiếng Việt"` | Tên bản địa của ngôn ngữ, giữ nguyên ở mọi giao diện |
| `features/upload/parse-chapter-filename.ts` (2 dòng) | Regex nhận dạng tên file (dữ liệu) |
| `features/fonts/font-settings.tsx`, `local-font-picker.tsx` `Xin chào! Tiếng Việt` | Mẫu chữ xem trước, vẽ bằng chính font đó để kiểm glyph tiếng Việt |
| `@mtl/shared/series-lang.ts` `: "Tiếng ` | `LANG_NAMES` dùng cho prompt LLM |
| `@mtl/shared/vietnamese-chars.ts` (3 dòng) | Bảng chữ cái và dấu tiếng Việt để kiểm font đủ glyph, khớp với worker |
| `@mtl/shared/ignore-text-vi.ts` (cả file) | Câu tiếng Việt API đặt vào `issues[].message`, giữ nguyên cho client cũ và test API |

Đã bỏ hằng `NOT_MIGRATED`. Mục không có `line` giờ chỉ dùng cho file chứa toàn câu tiếng Việt cố ý; header của guard đã
ghi rõ điều này. `ignore-text-vi.ts` không hẳn là "dữ liệu". Tôi giữ nó vì test cũ của shared và API kiểm
`ignoreEntryError` trả câu tiếng Việt. Thiết kế phase 5 cũng giữ câu `message` tiếng Việt trong shared.

## Chỗ API bị chạm

Không sửa file nào trong `apps/api`. API chịu ảnh hưởng gián tiếp qua shared ở hai chỗ:

- `issues[].message` của zod ở `ai-providers` và `pipeline-settings` giờ là tiếng Anh.
- `ignoreEntryErrorRe2` vẫn trả đúng câu tiếng Việt cũ.

Đã chạy các test API liên quan (xem bảng dưới), tất cả xanh.

## Lệnh kiểm (tuần tự, `nice`)

| Lệnh | Kết quả |
|---|---|
| `nice pnpm typecheck` (shared, db, web, api) | xanh |
| `nice pnpm --filter @mtl/shared test` | 9 file, 128 test xanh |
| `nice pnpm --filter @mtl/web test` | 64 file, 606 test xanh (có guard mở rộng sang shared và parity) |
| `nice pnpm exec vitest run test/ignore-text-re2 test/admin-providers test/pipeline-settings test/series test/series-ignore-apply test/auto-slot-model` (api) | 6 file, 67 test xanh |
| `nice pnpm exec biome check` trên các thư mục/file đã đổi và `packages/shared/src` | 72 file, sạch |
| `nice pnpm exec playwright test admin-settings pipeline-settings fonts update-notice routes click-budget settings-language --workers=1` | 27/28 xanh, `click-budget` đỏ |

Playwright tự bật rồi tắt API :8797 và Vite :5181. Sau khi chạy, `lsof` không còn process nào nghe ở hai cổng này.
Postgres :5442 để nguyên. Không chạy toàn bộ test API vì không sửa mã API.

## E2E `click-budget.spec.ts:43`: đỏ từ trước, không do i18n

Test chờ chip hiện "Đang cắt trang" nhưng nhận "Đang chờ lượt". Spec này không bật worker giả, nên API báo
`queue_state = waiting`, và `queueChip` hiện "Đang chờ lượt". Tôi đã đối chiếu `git show HEAD:…/chapter/status.ts`:
ở HEAD, `ingesting` có `queue` cũng trả "Đang chờ lượt". Spec sửa lần cuối ngày 16/11 (`4418dd9`), còn `queue_state`
có từ ngày 19/11 (`e87c652`). Đây là cùng nguyên nhân mà báo cáo phase 2 đã ghi cho `full-flow`. Chữ vi vẫn đúng như cũ.

## Câu hỏi chưa giải quyết

- Có sửa `click-budget.spec.ts` (chấp nhận "Đang chờ lượt" hoặc bật worker giả) cùng lúc với `full-flow` trong một việc
  riêng không?
- Phase 5 có đưa `ignore-text-vi.ts` vào `api-errors.ts` dùng chung không? Nếu có thì sửa mục allowlist theo.
- Ghi chú "Kiểm tra bản mới" (`checkNote`) và các lỗi đã ghi vào state vẫn giữ ngôn ngữ cũ tới lần cập nhật sau khi
  người dùng đổi ngôn ngữ. Đây là trạng thái tạm thời, giống điều phase 3 đã ghi.
