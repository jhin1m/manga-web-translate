---
phase: 4
title: "Web: nhãn AI, bỏ Nhận/Bỏ"
status: completed
priority: P2
effort: "5h"
dependencies: [3]
---

# Phase 4: Web – nhãn AI, bỏ Nhận/Bỏ

<!-- Updated: Red Team Session 1 - diff rỗng, mốc useRef, pronounKey chung, invalidate theo glossary_rev, e2e gộp -->

## Goal

Người dùng thấy mục AI tự ghi (nhãn "AI") trong Glossary, Xưng hô và Giọng văn; không còn danh sách gợi ý, nút Nhận/Bỏ
hay badge đếm. Lưu form không đè mất mục AI mới.

## Context

- `apps/web/src/features/glossary/glossary-editor.tsx` (bảng entry, dùng chung glossary chung/series; invalidate l.47).
- Gợi ý: `glossary/glossary-suggestions.tsx`, `series/pronoun-suggestions.tsx`, `series/suggestions.ts` (+ test).
- `series/series-page.tsx`: poll detail series `refetchInterval 5000` khi có chương chạy (l.44-48); glossary query
  l.79 (không poll); badge gợi ý l.82-126.
- `series/series-settings-form.tsx`: `useState(() => toForm(series))` (l.152); Lưu ở l.189 gửi cả form; nút Lưu l.314
  không khoá khi chưa đổi; Giọng văn l.414-429; dùng gợi ý ở l.31, 52, 55, 166-170, 450, 537-541.
- API từ chối body PATCH rỗng (`apps/api/src/routes/series.ts:70-73`).
- `series/api.ts` (`patchSeries` l.92, hàm gợi ý l.~170-185), `series/settings-summary.test.ts:28-34`.
- Consumer khác của `patchSeries`: `chapter/chapter-meta-popover.tsx:197` (gửi một phần body, không đổi).
- E2E: `e2e/series-suggestions.spec.ts`, `e2e/fake-worker.ts:83-86`.

## Files to Create / Modify

| Thao tác | File |
|---|---|
| Xoá | `glossary-suggestions.tsx`, `pronoun-suggestions.tsx`, `suggestions.ts`, `suggestions.test.ts` |
| Sửa | `series-page.tsx`, `series-settings-form.tsx`, `series/api.ts`, `settings-summary.ts` (+ test) |
| Tạo | `apps/web/src/features/series/settings-diff.ts` (+ `settings-diff.test.ts`): hàm thuần tính body PATCH |
| Sửa | `glossary-editor.tsx`, `glossary/api.ts` (kiểu entry có `origin`) |
| Sửa | `apps/web/src/features/home/home.css`: bỏ `.ai-suggestions` (l.~662), thêm `.ai-tag` |
| Thay | `e2e/series-suggestions.spec.ts` → `e2e/series-auto-memory.spec.ts`; `fake-worker.ts` trả `style_note` |

## Tasks & Steps

1. Xoá UI và API client gợi ý; bỏ badge ở `series-page.tsx`.
2. Nhãn `AI` (chip chữ nhỏ, `title="AI tự thêm khi dịch — sửa để xác nhận"`): cạnh từ gốc ở dòng glossary
   `origin === 'ai'`, ở dòng xưng hô `origin === 'ai'`, cạnh nhãn Giọng văn khi `style_origin === 'ai'`. Không thêm nút.
3. `settings-diff.ts`: `buildPatch(base, form)` trả các trường khác `base` (so sâu), cộng `pronoun_keys_seen` = khoá
   (`pronounKey` từ `@mtl/shared`) của các cặp trong `base`. Không có trường nào đổi → trả `null`.
   - `base` chụp bằng `useRef(toForm(series))` lúc mount; không đổi khi prop `series` được poll lại.
   - `null` → đóng form, không gọi API.
   - Dòng xưng hô người dùng sửa thì bỏ nhãn AI ngay trên UI (server tính lại `origin`).
4. Ở `series-page.tsx`: khi `glossary_rev` của detail series (đang poll) đổi thì invalidate `glossaryKey(scope)`.

## Verification

- `pnpm --filter @mtl/web test`, `pnpm lint`, `pnpm typecheck`.
- Unit `settings-diff.test.ts`: không đổi gì → `null`; prop `style_prompt` đổi sau mount và người dùng sửa trường khác
  → body không có `style_prompt`; luôn có `pronoun_keys_seen` khi có trường đổi.
- E2E `series-auto-memory.spec.ts` (fake worker trả `new_terms`, `pronoun_pairs`, `style_note`):
  1. Đứng ở màn series lúc chương dịch xong → Glossary có entry nhãn AI (chờ theo `glossary_rev`); Xưng hô và Giọng
     văn có nhãn AI.
  2. Sửa entry AI → nhãn mất. Xoá entry AI → dịch lại → không quay lại.
  3. Không còn chữ "Gợi ý từ AI", nút Nhận/Bỏ.
  4. Mở form, fake worker thêm cặp mới, người dùng **sửa một hàng xưng hô** rồi Lưu → cặp mới vẫn còn.
  5. Mở form khi Giọng văn trống, AI điền Giọng văn, người dùng đổi Kính ngữ rồi Lưu → Giọng văn AI vẫn còn.
  6. Mở form, bấm Lưu ngay → form đóng, không lỗi.
- Chạy lại `series-manage.spec.ts` và spec glossary đang có.
