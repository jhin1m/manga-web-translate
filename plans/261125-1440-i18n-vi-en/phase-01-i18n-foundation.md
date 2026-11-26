---
phase: 1
title: "Nền tảng i18n web + guard"
status: completed
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: Nền tảng i18n web + guard

## Goal

Có hạ tầng `t()`/`useT()`, registry locale, tự nhận + lưu locale, mục chọn ngôn ngữ trong `/settings`, test parity
và guard; e2e cũ được ghim `vi-VN`. Chưa chuyển chuỗi feature nào.

## Key Insights

- Vitest web chạy môi trường node, không render component (`apps/web/vitest.config.ts`) → `t()` phải chạy không cần
  React/`navigator`; khi thiếu `navigator` locale = `vi` nên test cũ assert tiếng Việt vẫn xanh.
- Playwright (`apps/web/playwright.config.ts`) không đặt `locale` → Chromium báo en-US. Phải ghim `locale: "vi-VN"`
  trong `use` trước khi bật tự nhận.
- `tsconfig.base.json` đã bật `resolveJsonModule` → kiểu key lấy từ `vi.json` (`keyof typeof vi`).
- Prefs hiện lưu localStorage bằng tay (`features/home/list-prefs.ts`, `features/chapter/layout-prefs.ts`); store dùng
  `zustand/vanilla` + `useStore` (`features/editor/store.ts`). Theo cùng mẫu.
- Mục cài đặt: `features/admin/admin-sections.ts` `SETTINGS_SECTIONS`, `features/admin/admin-layout.tsx` `PANELS`/`ICONS`.

## Design

- `apps/web/src/i18n/locales.ts`: `LOCALES = [{ code: "vi", native: "Tiếng Việt" }, { code: "en", native: "English" }]`,
  `type Locale`, `loadMessages(code)` (`vi` tĩnh, khác `import("./messages/en.json")`). Tên bản địa là dữ liệu → allowlist.
- `apps/web/src/i18n/i18n-store.ts`: store `{ locale, messages }`; `detectLocale()` = localStorage `mtl.locale` →
  `navigator.languages` khớp registry theo tiền tố (`vi-VN` → `vi`) → không khớp thì `en` → không có `navigator` thì
  `vi`; `setLocale()` tải JSON, lưu localStorage, đặt `document.documentElement.lang`.
- `apps/web/src/i18n/t.ts`: `t(key, params?)` thay `{name}`; key thiếu ở locale hiện tại → lấy `vi`; `tp(key, count,
  params?)` chọn `key.one`/`key.other` qua `Intl.PluralRules`; `tNode(key, nodes)` trả `ReactNode[]` cho placeholder là
  phần tử JSX; `useT()` subscribe store để re-render khi đổi locale.
- `apps/web/src/i18n/format.ts` (hoặc mở rộng `lib/format.ts` nếu đã có hàm số/ngày): `fmtNumber`, `fmtDate`,
  `collator()` theo locale.
- `main.tsx`: `await initI18n()` trước `createRoot` để không nháy chữ Việt khi locale là `en`.
- Key phẳng có namespace theo feature: `chapter.upload.dropHint`, `common.save`, `errors.<code>`.

## Files to Create / Modify

- Create: `apps/web/src/i18n/{locales.ts,i18n-store.ts,t.ts,format.ts}`, `apps/web/src/i18n/messages/{vi.json,en.json}`
- Create: `apps/web/src/i18n/i18n.test.ts` (interpolate, plural, fallback, detect)
- Create: `apps/web/src/i18n/messages-parity.test.ts` (cùng key, cùng tập placeholder, không chuỗi rỗng)
- Create: `apps/web/src/i18n/no-hardcoded-vietnamese.test.ts` (guard + `ALLOWLIST` có lý do từng dòng)
- Create: `apps/web/src/features/admin/language-settings.tsx` (radio/select theo `LOCALES`, áp ngay)
- Modify: `apps/web/src/main.tsx`, `apps/web/playwright.config.ts`, `features/admin/admin-sections.ts`,
  `features/admin/admin-layout.tsx`, `features/home/list-prefs.ts` (collator theo locale)

## Tasks & Steps

- [x] Ghim `locale: "vi-VN"` trong `playwright.config.ts`; chạy 1 spec cũ (`routes.spec.ts`) xác nhận xanh.
- [x] Viết `locales.ts`, `i18n-store.ts`, `t.ts`, `format.ts` theo Design; `vi.json` khởi đầu với `common.*` + mục
      ngôn ngữ, `en.json` bản dịch tương ứng.
- [x] Guard: đọc mọi `*.ts/*.tsx/*.css` dưới `apps/web/src` trừ `*.test.*` và `i18n/messages/`; bỏ comment
      (`//`, `/* */`, `{/* */}`); báo file:dòng còn ký tự có dấu tiếng Việt. `ALLOWLIST` ban đầu = các thư mục chưa
      chuyển (`features/*`, `app`, `routes`, `lib`, `styles`) — mỗi phase sau xoá dòng của mình.
- [x] Mục "Ngôn ngữ giao diện" trong nhóm Chung của `/settings`, mọi người dùng thấy; đổi là áp ngay không reload.
- [x] `initI18n()` trong `main.tsx`; `Intl.Collator("vi")` ở `list-prefs.ts` → `collator()`.
- [x] Unit test `i18n.test.ts`: interpolate, thiếu param giữ nguyên `{name}`, plural vi/en, fallback về vi, detect
      (`vi-VN`→vi, `fr-FR`→en, không navigator→vi, localStorage thắng).

## Verification

- `pnpm --filter @mtl/web typecheck && pnpm --filter @mtl/web test`
- `pnpm --filter @mtl/web e2e -- routes.spec.ts admin-settings.spec.ts` (ghim vi-VN)
- Thủ công: đổi English ở `/settings` → nhãn mục ngôn ngữ đổi ngay, reload giữ English, `<html lang="en">`.

## Success Criteria

- Guard và parity xanh; test cũ không sửa; e2e cũ không sửa selector vẫn xanh.
- Thêm locale giả lập trong test (registry tạm) không cần sửa `t.ts`.

## Risk Assessment

- Top-level `await` trong `main.tsx` không hợp với target build → dùng `initI18n().then(render)`.
- Guard bắt nhầm chuỗi dữ liệu hợp lệ (tên bản địa, mẫu glyph font) → allowlist theo dòng có lý do, không theo cả file.

## Implementation Notes

- Ô chọn ngôn ngữ nằm dưới thanh mục ở cột trái `/settings` (`LanguageSettings` trong `admin-layout.tsx`), không phải
  mục mới trong `SETTINGS_SECTIONS`: unit test `admin-sections.test.ts` và e2e `admin-settings.spec.ts` khoá đúng danh
  sách mục (`["fonts"]` cho người thường) nên thêm mục sẽ buộc sửa test cũ. `admin-sections.ts` không đổi.
- Node 24 có `navigator` (en-US) → tự nhận chỉ đọc trình duyệt khi có `document`; store mặc định `vi` tới khi
  `initI18n()` chạy (unit test không gọi).
- Guard bỏ cả `__tests__/` (fixture test); `styles` không cần allowlist (chữ Việt ở đó chỉ nằm trong comment) — guard
  báo mục allowlist không còn khớp.
- Thêm e2e `apps/web/e2e/settings-language.spec.ts` (đổi English áp ngay, reload giữ, `<html lang>`, trình duyệt en-US).
