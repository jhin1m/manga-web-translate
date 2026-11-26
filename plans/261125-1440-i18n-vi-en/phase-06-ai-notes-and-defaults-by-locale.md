---
phase: 6
title: "Ghi chú AI + mặc định theo locale"
status: completed
priority: P1
effort: "0.75d"
dependencies: [5]
---

# Phase 6: Ghi chú AI + mặc định theo locale

## Goal

`style_note` và proofread `reason` do AI viết theo ngôn ngữ giao diện của người dùng; series mới mặc định đích =
ngôn ngữ giao diện khi nằm trong `TARGET_LANGS`.

## Key Insights

- `worker/mtl_pipeline/prompts/proofread_page.md:16` ép `reason` "bằng tiếng Việt"; `translate_batch.md:21`
  `style_note` không nói ngôn ngữ (prompt tiếng Việt → AI viết tiếng Việt).
- `style_note` được API ghi vào series (`apps/api/src/lib/series-memory.ts:213-297`) và hiện ở
  `features/series/series-settings-form.tsx:158-172`; `context_notes` chỉ LLM đọc, web không hiện → không cần đổi.
- Payload translate dựng ở `apps/api/src/jobs/enqueue.ts:316-331`; schema `packages/shared/src/job.ts` (~211-220)
  là `z.object` không strict → field chưa khai báo bị strip, phải khai báo + cập nhật `packages/shared/json-schema/`
  (`pnpm schema:emit`).
- Job có thể được enqueue không qua request người dùng (tự dịch sau bước 1) → locale phải lưu phía server.
- `better-auth` đã dùng `additionalFields` cho `user` (`apps/api/src/auth.ts:71`, `disabledAt`).
- Migration mới nhất `0032_drop_system_settings_limits.sql`.

<!-- Updated: Validation Session 1 - chốt lưu ui_locale trên user -->
## Design

- Lưu `ui_locale` trên `user` (additionalField + migration `0033`), web gọi cập nhật khi đổi ngôn ngữ và một lần lúc
  khởi động nếu khác server.
- `enqueueTranslate` / enqueue proofread đọc `ui_locale` của chủ series → payload `ui_lang`.
- Prompt: thêm chỉ dẫn "`style_note` và `reason` viết bằng `{ui_lang}`" (giữ prompt tiếng Việt, chỉ đổi ngôn ngữ đầu ra).
- `new-series-dialog.tsx:33` mặc định `tgt` = locale nếu thuộc `TARGET_LANGS`, else `vi`; cột DB `target_lang`
  default giữ `vi` (không đổi dữ liệu cũ).

## Tasks & Steps

- [x] Backup DB dev trước migration (`scripts`/`backups-dev` theo quy trình hiện có); migration `0033_user_ui_locale.sql`.
- [x] API: cập nhật locale người dùng; enqueue thêm `ui_lang`; schema shared + `schema:emit`.
- [x] Worker: đọc `ui_lang` (mặc định `vi` khi thiếu — job cũ trong hàng đợi), chèn vào prompt proofread + translate.
- [x] Web: đồng bộ locale lên server; mặc định đích series mới.
- [x] Test: enqueue mang `ui_lang`; worker dựng prompt có chỉ dẫn ngôn ngữ (unit, không gọi LLM); payload thiếu
      `ui_lang` vẫn chạy.

## Files to Create / Modify

- Create: `packages/db/migrations/0033_user_ui_locale.sql`
- Modify: `packages/db/src/schema/auth.ts`, `apps/api/src/auth.ts`, `apps/api/src/jobs/enqueue.ts`,
  `packages/shared/src/job.ts`, `packages/shared/json-schema/*`, `worker/mtl_pipeline/prompts/{proofread_page,
  translate_batch}.md`, loader prompt trong `worker/mtl_pipeline/`, `apps/web/src/i18n/i18n-store.ts`,
  `apps/web/src/features/series/new-series-dialog.tsx`

## Verification

- `pnpm db:migrate` trên DB dev đã backup; `pnpm --filter @mtl/api test`; `cd worker && nice uv run pytest -q`
- E2E: `series-auto-memory`, `proofread` (fake worker, locale vi) xanh.
- Smoke LLM thật (thủ công, tuỳ có key): locale en → proofread 1 trang → `reason` tiếng Anh.

## Risk Assessment

- Job đang chờ trong hàng đợi lúc nâng cấp không có `ui_lang` → worker mặc định `vi`, không fail.
- Image self-host chạy migration lúc boot (`local/schema-guard.ts`) → kiểm migration chạy được trên DB bản 0.6.0.

## Implementation Notes

- Backup DB dev: `backups-dev/mtl-dev-before-0033-ui-locale-261125-2314.dump` (`pg_dump -Fc` trong container
  `mtl-dev-postgres-1`). Migration `0033_user_ui_locale.sql` (cột nullable, sinh bằng drizzle-kit) + down tay
  `packages/db/migrations-down/0033_user_ui_locale.down.sql`. `local/schema-guard.ts` không cần đổi (so `when` của journal).
- Shared: `ui-locale.ts` (`UI_LOCALES`, `DEFAULT_UI_LOCALE`, `isUiLocale`, subpath `@mtl/shared/ui-locale`),
  `defaultTargetLang` trong `series-lang.ts`, payload `ui_lang` (optional) cho `chapter.translate` / `chapter.proofread`.
- API: `GET /api/me` trả `ui_locale` (đọc DB); `PUT /api/me/locale` `{ ui_locale }` (zod enum, sai → `invalid_body`);
  better-auth `additionalFields.uiLocale` (`input: false`). `uiLangOf()` trong `enqueue.ts` đọc locale chủ series lúc
  enqueue → mọi đường (route + chuỗi lô tự enqueue) đều có.
- Payload mới với schema strict → worker `PIPELINE_VERSION` 0.14.0, `MIN_PIPELINE_VERSION` mặc định 0.14.0 (ghi chú ở
  `docs/job-queue-worker.md`, `docs/deployment-guide.md`).
- Worker: `ui_lang` vào `SeriesSettings` / `TranslateRequest` / `ProofreadRequest` (mặc định `vi`) và JSON gửi LLM
  (`ui_lang: "en (tiếng Anh)"`); prompt giữ tiếng Việt, chỉ chỉ dẫn `style_note` / `reason` viết bằng `ui_lang`.
- Web: `syncLocaleToServer` (i18n-store) chạy trong `AuthGate` (`LocaleSync`) — so với `/api/me` một lần, rồi gửi mỗi
  lần đổi; `new-series-dialog` mặc định đích theo locale.
- Chưa làm: smoke LLM thật (locale en → hiệu đính 1 trang → `reason` tiếng Anh) — không gọi LLM thật trong phase này.
