---
phase: 4
title: "Web: Nhận/Bỏ gợi ý ở series"
status: completed
priority: P2
effort: "5h"
dependencies: [3]
---

# Phase 4: Web – Nhận/Bỏ gợi ý ở series

## Overview

- Badge số gợi ý đặt trên nút Glossary và icon Cài đặt dịch ở màn series.
- Danh sách "Gợi ý từ AI · N" đặt đầu modal Glossary series và trong nhóm Xưng hô của Cài đặt dịch.
- Mỗi dòng có Nhận và Bỏ. Không có "Nhận tất cả" (D4), không thêm gì vào editor chương.

## Context

- `apps/web/src/features/series/series-page.tsx`:
  - l.59-62: modal Glossary `<Drawer variant="modal" title="Glossary của series"><GlossaryEditor …/></Drawer>`.
  - l.69-95: `SeriesHead`, có nút `Glossary · N` và icon Cài đặt dịch.
- `apps/web/src/features/glossary/glossary-editor.tsx` dùng chung cho glossary chung và glossary series. Phase này
  **không sửa** file này: gợi ý chỉ có ở series, nên render ở `series-page.tsx`. Hàm `done()` (l.45-49) invalidate
  `["glossary"]` và `["series"]`.
- `apps/web/src/features/glossary/api.ts:40-41` có sẵn `createEntry(scope, body)`. Server trả 409 `duplicate_term`
  khi từ đã có trong glossary.
- `apps/web/src/features/series/series-settings-form.tsx`:
  - Form cục bộ `f.pronoun_rules`. Nút Lưu gọi `patchSeries` (l.183-195).
  - Nhóm Xưng hô ở l.437-525; summary dùng `rulesSummary` (l.439).
  - Lưu xong thì invalidate `["series"]`.
- `apps/web/src/features/series/api.ts:65-70` là `seriesKeys` (prefix `["series", id]`).
- `apps/web/src/features/series/settings-summary.ts:9` là `rulesSummary`, có test ở `settings-summary.test.ts`.
- CSS: `.count-badge` có sẵn (`apps/web/src/app/drawer.css:116-127`). Style của series, glossary và form nằm ở
  `apps/web/src/features/home/home.css` (`.series-head` l.318+).
- E2E: `apps/web/e2e/fake-worker.ts:77` có `FakeWorkerOptions`, nhánh translate ở l.116-122.
  `series-manage.spec.ts:97-100` bắt nút Glossary bằng regex `/^Glossary/`, nên thêm badge phía sau không làm vỡ test.

## Files

| Thao tác | File |
|---|---|
| Sửa | `apps/web/src/features/series/api.ts` |
| Tạo | `apps/web/src/features/series/suggestions.ts` (thuần) |
| Tạo | `apps/web/src/features/series/suggestions.test.ts` |
| Sửa | `apps/web/src/features/series/settings-summary.ts` (+ `settings-summary.test.ts`) |
| Tạo | `apps/web/src/features/glossary/glossary-suggestions.tsx` |
| Tạo | `apps/web/src/features/series/pronoun-suggestions.tsx` |
| Sửa | `apps/web/src/features/series/series-page.tsx` |
| Sửa | `apps/web/src/features/series/series-settings-form.tsx` |
| Sửa | `apps/web/src/features/home/home.css` |
| Sửa | `apps/web/e2e/fake-worker.ts` |
| Tạo | `apps/web/e2e/series-suggestions.spec.ts` |

## Implementation steps

1. **`series/api.ts`**: thêm các kiểu `TermSuggestion`, `PronounSuggestion`, `SeriesSuggestions` (khớp response ở
   phase 3), `seriesKeys.suggestions(id) = ["series", id, "suggestions"]`, `fetchSuggestions(id)` và
   `dismissSuggestion(id, dismissed = true)`. Prefix `["series"]` sẵn có đảm bảo badge tự làm mới sau mỗi lần Nhận
   (glossary editor và form Lưu đều invalidate `["series"]`).
2. **`suggestions.ts`** (thuần, dùng `pronounKey` của `@mtl/shared`):
   - `pendingPronouns(list, rules)` bỏ gợi ý có cặp đã có trong bảng của form (gồm cả hàng chưa Lưu).
   - `ruleFromSuggestion(s)` trả `{ speaker, listener, address, note: "" }`.
   - `TERM_KIND_LABEL`: `person` là "Tên người", `place` là "Địa danh", `term` là "Thuật ngữ".
3. **`settings-summary.ts`**: `rulesSummary(rules, pending = 0)` trả "2 quy tắc · 1 gợi ý". Khi chưa có quy tắc thì
   trả "Chưa có · 1 gợi ý". Khi `pending = 0` thì giữ chuỗi như cũ.
4. **`glossary-suggestions.tsx`**: component `GlossarySuggestions({ seriesId })`.
   - `useQuery(seriesKeys.suggestions)`. Không có thuật ngữ nào thì không render gì.
   - Tiêu đề "Gợi ý từ AI · N" kèm `InfoTip`: "AI ghi lại tên riêng / thuật ngữ mới gặp khi dịch. Nhận = thêm vào
     glossary series, lần dịch sau dùng. Bỏ = không gợi ý lại."
   - Bảng `table.data`, mỗi dòng gồm: từ gốc, bản dịch, nhãn loại và "Ch. X" (chữ mờ), rồi nút `Nhận` và `Bỏ`
     (`btn-ghost`).
   - Nhận: `createEntry({ seriesId }, { source_term, target_term, note: "", case_sensitive: false })`. Xong thì
     invalidate `["glossary"]` và `["series"]`. Gặp 409 `duplicate_term` thì cũng invalidate (dòng tự biến mất) và
     hiện câu "đã có trong glossary". Lỗi khác hiện qua `errorMessage`.
   - Bỏ: `dismissSuggestion(id)` rồi invalidate `seriesKeys.suggestions`.
   - Nút của dòng đang xử lý bị disable.
5. **`pronoun-suggestions.tsx`**: component trình bày `PronounSuggestions({ items, onAccept })`.
   - Danh sách "Gợi ý từ AI · N", mỗi dòng dạng "Minjun → Seoyeon: anh/em", nút `Nhận` và `Bỏ`.
   - Bỏ dùng mutation và invalidate như bước 4.
   - Sau Nhận hiện một dòng chữ mờ: "Đã thêm vào bảng — bấm Lưu để áp dụng."
6. **`series-page.tsx`**:
   - Modal Glossary: `<GlossarySuggestions seriesId={seriesId} />` đặt trước `<GlossaryEditor …/>`.
   - `SeriesHead`: thêm `useQuery(seriesKeys.suggestions)`. Trong link Glossary, sau text, thêm
     `<span className="count-badge" title="N gợi ý từ AI">N</span>` khi số thuật ngữ > 0. Icon Cài đặt dịch thêm badge
     tương tự khi số cặp xưng hô > 0 (CSS định vị badge góc trên icon).
7. **`series-settings-form.tsx`**:
   - `useQuery(seriesKeys.suggestions)`, tính `pending = pendingPronouns(data?.pronouns ?? [], f.pronoun_rules)`.
   - Summary của Fold Xưng hô dùng `rulesSummary(f.pronoun_rules, pending.length)`.
   - Trong Fold, sau `.add-rule` (l.517-525): `<PronounSuggestions items={pending} onAccept={(s) => set("pronoun_rules", [...f.pronoun_rules, ruleFromSuggestion(s)])} />`.
   - Không gọi server khi Nhận: Lưu → PATCH như cũ → server ẩn gợi ý (D3). Nhờ vậy không có race với hàng đang sửa.
8. **`home.css`**: `.ai-suggestions` gồm tiêu đề nhỏ, khoảng cách và nhãn mờ. Định vị `.series-head .icon-btn .count-badge`.
   Dùng biến màu và khoảng cách có sẵn (`--c-accent`, `--sp-*`, `--fs-xs`).
9. **`fake-worker.ts`**: thêm option `learned?: { new_terms?: …; pronoun_pairs?: … }` vào `FakeWorkerOptions`. Nhánh
   translate chỉ spread vào result khi option được truyền, nên các spec cũ không đổi.

## Tests

- Vitest web (`pnpm --filter @mtl/web test`):
  - `suggestions.test.ts`: `pendingPronouns` bỏ cặp đã có (khác hoa thường hoặc khoảng trắng), giữ cặp đảo chiều; `ruleFromSuggestion`.
  - `settings-summary.test.ts`: chuỗi có và không có gợi ý.
- E2E mới `series-suggestions.spec.ts`. Fake worker trả `new_terms: [{민준 → Minjun, person}, {검성 → Kiếm Thánh, term}]`
  và `pronoun_pairs: [{Minjun → Seoyeon: anh/em}]`:
  1. Dịch xong chương thì nút Glossary có badge 2 và icon Cài đặt có badge 1.
  2. Mở Glossary, Nhận "민준": dòng xuất hiện trong bảng glossary, badge còn 1. Bỏ "검성": danh sách gợi ý biến mất.
  3. Mở Cài đặt dịch: summary Xưng hô có "1 gợi ý". Mở nhóm, Nhận thì hàng xuất hiện trong bảng và gợi ý biến mất. Lưu,
     mở lại thì quy tắc vẫn còn và không còn gợi ý.
  4. Reload: không còn badge.
- Hồi quy: `pnpm --filter @mtl/web e2e` toàn bộ, chú ý `series-manage`, `glossary-language-pair`, `click-budget`.
- `pnpm lint` (Biome) và `pnpm typecheck`.

## Risks

| Rủi ro | K×T | Giảm thiểu |
|---|---|---|
| Nhận xưng hô rồi đóng modal không Lưu, người dùng tưởng đã nhận | TB×Thấp | Dòng nhắc "bấm Lưu để áp dụng". Gợi ý vẫn còn khi mở lại, không mất dữ liệu |
| Badge làm đổi accessible name của link Glossary, làm vỡ e2e khác | Thấp×Thấp | Spec hiện có dùng regex `/^Glossary/`. Chạy toàn bộ e2e |
| Sửa tên người nói của hàng vừa Nhận làm gợi ý hiện lại | Thấp×Thấp | Chấp nhận (D3). Bấm Bỏ |
| Màn series không tự cập nhật badge khi dịch xong mà người dùng vẫn ở màn đó | TB×Thấp | Query refetch khi focus hoặc mount (mặc định của TanStack). Không thêm polling (YAGNI) |

## Rollback

Revert phase này thì UI quay về như cũ. API và dữ liệu không bị ảnh hưởng.
