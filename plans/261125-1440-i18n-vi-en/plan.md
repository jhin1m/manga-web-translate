---
title: "i18n giao diện vi + en"
description: "Đưa toàn bộ chữ giao diện, lỗi API/worker và ghi chú AI về từ điển theo locale (vi gốc, en thêm mới) để quảng bá quốc tế."
status: in-progress
priority: P1
effort: 6.5d
branch: main
tags: [feature, frontend, api, i18n]
blockedBy: []
blocks: []
created: 2026-11-25
---

# i18n giao diện vi + en

## Overview

Đưa toàn bộ chữ giao diện, lỗi API/worker và ghi chú AI về từ điển theo locale (vi gốc, en thêm mới) để quảng bá quốc tế.
Hôm nay chữ tiếng Việt viết thẳng trong ~1.310 dòng / 112 file web, ~370 dòng route API; chưa có thư viện i18n.
Thêm locale sau này = 1 file JSON + 1 dòng registry.

## Contract

- **Outcome:** README tiếng Anh; app tự chọn English khi trình duyệt không phải tiếng Việt, đổi được ở `/settings`;
  UI, lỗi API/worker, ghi chú/lý do AI viết (`style_note`, proofread `reason`) theo ngôn ngữ giao diện; series mới
  mặc định đích = ngôn ngữ giao diện khi nó nằm trong `TARGET_LANGS`.
- **Constraints:** vi là bản gốc + fallback; e2e cũ (~750 selector chữ Việt) xanh ở locale vi, không sửa selector; API
  giữ field `message`, thêm mã + params; không thêm dependency; test/build tuần tự, nhẹ CPU.
- **Non-goals:** dịch `docs/`, locale thứ ba, log server/worker, RTL, prompt LLM (giữ tiếng Việt, chỉ thêm chỉ dẫn
  ngôn ngữ đầu ra).
- **Scope mode:** HOLD SCOPE (không `--yagni`).

## Approach

Từ điển tự viết trong `apps/web/src/i18n/`: `messages/{locale}.json` phẳng, placeholder `{name}`, chỉ `vi` đóng gói
sẵn, locale khác `import()` khi cần; store zustand vanilla + `t()` ngoài React + `useT()` trong React;
`Intl.PluralRules` / `Intl.NumberFormat` / `Intl.Collator` theo locale. Mỗi phase chuyển chuỗi ghi luôn bản `en`
nên test parity luôn xanh. Định dạng JSON `{param}` chuyển sang Paraglide/i18next được khi cần công cụ người dịch.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Nền tảng i18n web + guard](./phase-01-i18n-foundation.md) | Completed |
| 2 | [Chuyển chuỗi features/chapter](./phase-02-migrate-chapter-strings.md) | Completed |
| 3 | [Chuyển chuỗi editor, series, home, upload, glossary](./phase-03-migrate-editor-series-home-strings.md) | Completed |
| 4 | [Chuyển chuỗi admin, fonts, update, pipeline, app, shared](./phase-04-migrate-admin-shared-strings.md) | Completed |
| 5 | [Mã lỗi API + worker theo locale](./phase-05-api-worker-error-codes.md) | Completed |
| 6 | [Ghi chú AI + mặc định theo locale](./phase-06-ai-notes-and-defaults-by-locale.md) | Completed |
| 7 | [README, docs, smoke English](./phase-07-readme-docs-and-en-smoke.md) | Completed |

Thứ tự tuần tự: 1 → 2 → 3 → 4 → 5 → 6 → 7 (2–5 cùng chạm `job-error.ts`, `lib/api.ts`, JSON message nên không song song).

## Success Criteria

- [x] Test parity: `en.json` đủ key và đủ placeholder so với `vi.json`. (`messages-parity.test.ts` xanh, 26/11)
- [x] Guard test: ngoài `vi.json` và allowlist có lý do, `apps/web/src` không còn chuỗi tiếng Việt (bỏ comment, bỏ `*.test.*`). (`no-hardcoded-vietnamese.test.ts` xanh)
- [ ] E2E cũ xanh ở locale `vi-VN`, không sửa selector. (Toàn bộ 1 worker 26/11: 122/125 xanh; 3 đỏ có từ trước i18n: `full-flow`, `block-panel:317`, `click-budget:43` — xem báo cáo phase 2–4, 7)
- [x] E2E smoke locale `en-US`: tạo series → upload → dịch (fake worker) → editor → xuất, không thấy chữ Việt. (`i18n-en-smoke.spec.ts`)
- [x] Lỗi API (mã + params) và nhãn lỗi job hiện đúng locale. (`api-error-keys.test.ts`, `lib/api.test.ts`, test `job-error` / `export-options` / `erase-queue` / `ocr-wait`)
- [ ] `style_note` và proofread `reason` viết theo ngôn ngữ giao diện của người dùng.
- [x] `README.md` tiếng Anh, `README.vi.md` tiếng Việt, link qua lại.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` xanh. (26/11: shared 140, web 625, db 10, api 766 + 1 skip)

## Risks

- Playwright chưa ghim `locale` → tự nhận English làm hỏng toàn bộ e2e cũ; phase 1 ghim `vi-VN` trước khi bật tự nhận.
- Chuỗi bị ghép/JSX lồng (`"Bấm " + <b>…</b>`) dịch sai thứ tự từ; dùng `tNode()` với placeholder là node.
- English dài hơn → tràn nút/rail; phase 7 soát ảnh chụp màn hình chính ở 1920 px và 1280 px.

## Validation Log

### Session 1 — 2026-11-25

Đối chiếu claim với mã nguồn qua báo cáo scout (file:line trong phase 1–6). Failed: 0. Câu hỏi: 3.

| Quyết định | Chọn | Ảnh hưởng |
|---|---|---|
| Lưu locale phía server cho job AI | Cột `ui_locale` trên `user` (better-auth `additionalFields`, migration 0033) | Phase 6 |
| README trên GitHub | `README.md` tiếng Anh + `README.vi.md`, link qua lại | Phase 7 |
| Câu lỗi chi tiết của worker | Chuyển sang tiếng Anh (chi tiết kỹ thuật); nhãn chính vẫn dịch theo `error_class` | Phase 5 |

Sweep: link phase hợp lệ (`ak plan validate` OK), effort tổng 6.5d khớp tổng phase, phụ thuộc tuần tự 1→7.
