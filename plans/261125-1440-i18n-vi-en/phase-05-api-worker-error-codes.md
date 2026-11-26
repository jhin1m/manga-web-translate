---
phase: 5
title: "Mã lỗi API + worker theo locale"
status: completed
priority: P1
effort: "1d"
dependencies: [4]
---

# Phase 5: Mã lỗi API + worker theo locale

## Goal

Mọi lỗi API người dùng nhìn thấy có `error` (mã ổn định) + `params`; web dịch theo mã, `message` tiếng Việt chỉ còn là
fallback. Lỗi job hiện nhãn theo locale.

## Key Insights

- 3 kiểu trả lỗi: `Response.json({ error, message })` (~27 chỗ, vd `routes/chapters.ts:329`), `HTTPException(status,
  { message })` (vd `middleware/user.ts:47`, `billing/user-quota.ts:89`, `routes/glossary.ts:219-220`), helper
  `httpError` (`lib/batch-edit.ts:28`), `lib/chapter-lock.ts:25,68`, `conflict(code, message)` (`jobs/enqueue.ts:74`).
- `app.ts:78-88` `onError`: HTTPException không có `res` → `{ error: err.message }` → web hiện chuỗi tiếng Việt như mã.
- Web: `lib/api.ts:77` ưu tiên `data.message`; `errorMessage` (`:135`) được gọi ~57 chỗ → sửa 1 chỗ là đủ.
- Zod `invalid_body`/`invalid_query` trả `issues` không có câu cho người dùng → nhãn chung `errors.invalid_body`.
- Worker `JobFailure(error_class, message)` (`worker/mtl_worker/runner.py:42-52`): web đã dịch `error_class`
  (`features/chapter/job-error.ts`, phase 2); `message` chỉ vào "Chi tiết kỹ thuật".
- Glossary import trả `errors: [{ line, message }]` theo dòng CSV → cần mã + params cho từng lỗi dòng.

## Design

- `packages/shared/src/api-errors.ts`: `API_ERROR_CODES` (const tuple) + kiểu params theo mã; một helper API
  `apiError(status, code, params?)` trả `Response.json({ error: code, message: <vi>, params })` — câu vi sinh từ
  cùng template trong shared để `message` cũ không đổi nội dung.
- Web `ApiError` giữ `code` + `params`; `errorMessage(e)` = `t("errors." + code, params)` nếu key có, else `e.message`
  (vi) khi locale vi, else `t("errors.generic")` + mã trong ngoặc.
- Test: mọi mã trong `API_ERROR_CODES` có key `errors.<code>` ở `vi.json` (parity lo `en`).

## Tasks & Steps

- [x] Liệt kê lỗi người dùng thấy trong `apps/api/src/**` (grep 3 kiểu trên), gom thành mã; chuyển sang `apiError`.
- [x] `onError`: HTTPException không `res` trả `{ error: "http_<status>", message }` thay vì đẩy message vào `error`.
- [x] Web `lib/api.ts`: đọc `params`, sửa `errorMessage`; test `lib/api.test.ts` thêm ca locale en.
- [x] Worker: chuyển `message` của `JobFailure` sang tiếng Anh kỹ thuật (log/chi tiết, không phải UI) <!-- Updated: Validation Session 1 - chốt tiếng Anh -->; nhãn chính vẫn từ `error_class`.
- [x] Test API hiện có assert `message` tiếng Việt vẫn xanh (giữ nội dung).

## Files to Create / Modify

- Create: `packages/shared/src/api-errors.ts`, `apps/api/src/lib/api-error.ts`
- Modify: `apps/api/src/routes/*.ts`, `apps/api/src/{app.ts,middleware/*,billing/user-quota.ts,lib/batch-edit.ts,
  lib/chapter-lock.ts,jobs/enqueue.ts}`, `apps/web/src/lib/api.ts`, messages, `worker/mtl_worker/*.py`

## Verification

- `pnpm --filter @mtl/api test && pnpm --filter @mtl/web test && pnpm typecheck`
- Worker: `cd worker && nice uv run pytest -q` (1 tiến trình)
- E2E tuần tự: `upload-chapter`, `admin-settings`, `fonts` (các ca lỗi font đang dùng).

## Success Criteria

- Không còn route trả câu tiếng Việt mà thiếu mã; ở locale en lỗi API hiện tiếng Anh; test cũ giữ nguyên.

## Risk Assessment

- Client cũ (tab mở trước khi cập nhật) đọc `message` → vẫn chạy vì `message` giữ nguyên.

## Implementation Notes

- Hợp đồng: `packages/shared/src/api-errors.ts` (77 mã, câu vi `{param}`), body `{ error, variant?, message, params }`.
  Một `error` mang nhiều câu → mã đầy đủ `<error>.<variant>` (VD `chapter_busy.export`), `error` cũ giữ nguyên cho
  client so sánh. `ignore-text-vi.ts` gộp vào đây (mã = `IGNORE_ISSUE_CODES`). Báo cáo:
  `plans/reports/fullstack-developer-261125-2241-i18n-phase-05.md`.
- API: `lib/api-error.ts` (`apiError`, `apiErrorResponse`, `codeError`); 404 chữ tiếng Anh → `NotFoundError`; lời
  nhắn zod refine đổi sang tiếng Anh. Lỗi job lưu ở `jobs.error` (có `error_class` / tiền tố mã), log, alert, lỗi giao
  thức worker giữ nguyên (ngoài phạm vi; test khoá nội dung `quota_exceeded: …`, `Cấu hình AI lỗi`).
- Web: `errorMessage` / `apiErrorText` dịch theo `errors.<error>[.<variant>]`; `ApiError.message` đã theo ngôn ngữ lúc
  ném; lỗi dòng CSV glossary và issue `invalid_body` có mã cũng dịch. `series.ignoreTextInput.issue.*` bỏ, dùng
  `errors.<mã>`. Test giữ câu `errors.<mã>` của `vi.json` trùng câu API.
- Worker: `JobFailure.message` tiếng Anh; ca "không thấy chữ trong khung" gửi `no_text_in_box: …`, editor hiện câu
  theo ngôn ngữ (`editor.eraseQueue.noTextInBox`).
