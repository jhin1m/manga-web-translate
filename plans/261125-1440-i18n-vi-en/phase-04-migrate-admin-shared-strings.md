---
phase: 4
title: "Chuyển chuỗi admin, fonts, update, pipeline, app, shared"
status: completed
priority: P1
effort: "1d"
dependencies: [3]
---

# Phase 4: Chuyển chuỗi admin, fonts, update, pipeline, app, shared

## Goal

Chuyển phần còn lại của web — `features/admin` (107 / 10), `features/fonts` (65 / 5), `features/update` (46 / 3),
`features/pipeline` (39 / 1), `app/` (26 / 5), `routes/` (12), `lib/` (7), `styles/` (1) — và chữ UI trong
`packages/shared`; `ALLOWLIST` chỉ còn dòng dữ liệu có lý do.

## Key Insights

- `packages/shared/src/ai-providers.ts:25` `MODEL_UNSUPPORTED_MESSAGE` và chuỗi đi kèm hằng ở `job.ts:57-59` là thông
  điệp cho người dùng → shared giữ mã, web dịch qua key; API dùng chung mã ở phase 5.
- `LANG_NAMES` trong shared: sau phase 3 web không dùng; nếu API/worker không dùng thì xoá, nếu dùng làm nhãn prompt
  LLM thì giữ (prompt là non-goal).
- `lib/api.ts:137` fallback "Có lỗi xảy ra" → `t("errors.generic")`.
- `styles/` có 1 dòng CSS (`content: "…"`) → chuyển sang thuộc tính `data-*`/aria lấy từ `t()` hoặc allowlist có lý do.
- Mẫu chữ xem trước font (kiểm glyph tiếng Việt) là dữ liệu → allowlist theo dòng.

## Tasks & Steps

- [x] Chuyển các thư mục còn lại; thông điệp cập nhật (`features/update`) giữ nguyên ý nghĩa lệnh PowerShell/`curl.exe`.
- [x] Shared: thay chuỗi hiển thị bằng mã; web map `t("errors.modelUnsupported")`…
- [x] `ALLOWLIST` còn lại: chỉ dòng dữ liệu (tên bản địa locale, mẫu glyph), mỗi dòng ghi lý do.
- [x] Mở rộng guard sang `packages/shared/src` (bỏ comment) với allowlist dữ liệu (`vietnamese-chars.ts`).

## Files to Create / Modify

- Modify: `apps/web/src/features/{admin,fonts,update,pipeline}/**`, `apps/web/src/{app,routes,lib,styles}/**`,
  `packages/shared/src/{ai-providers,job,series-lang}.ts`, messages, guard.

## Verification

- `pnpm typecheck && pnpm --filter @mtl/web test && pnpm --filter @mtl/shared test`
- E2E tuần tự: `admin-settings`, `pipeline-settings`, `fonts`, `update-notice`, `routes`, `click-budget`.

## Success Criteria

- Guard xanh trên toàn `apps/web/src` và `packages/shared/src`; parity xanh; e2e trên xanh.

## Implementation Notes

- Key mới: `admin.*` 119, `fonts.*` + `update.*` 116, `pipeline.*` 44, `app.*` 21, `routes.*` 12, `lib.*` 6,
  `errors.*` 4, `series.ignoreTextInput.issue.*` 8. Báo cáo: `plans/reports/fullstack-developer-261125-2229-i18n-phase-04.md`.
- Shared: bỏ `MODEL_UNSUPPORTED_MESSAGE` (web dùng `errors.modelUnsupported` + `{model}`); `ignoreEntryIssue()` trả
  mã + params (`IGNORE_ISSUE_CODES`), web dịch; `ignoreEntryError()` giữ câu tiếng Việt cho `issues[].message` của
  API, câu nằm trong `ignore-text-vi.ts`. Lời nhắn zod / RangeError kỹ thuật khác đổi sang tiếng Anh.
- `LANG_NAMES` giữ trong shared: API `honorificText` chèn vào prompt LLM (non-goal); web không còn import.
- Guard quét thêm `packages/shared/src`; allowlist chỉ còn dữ liệu (tên bản địa, mẫu glyph font, bảng chữ Việt, tên
  ngôn ngữ trong prompt) và file câu API `ignore-text-vi.ts`.
- E2E `click-budget` "drop 5 images…" đỏ từ trước: chip "Đang chờ lượt" (queue_state của API, sau lần sửa spec cuối),
  cùng nguyên nhân với `full-flow`.
