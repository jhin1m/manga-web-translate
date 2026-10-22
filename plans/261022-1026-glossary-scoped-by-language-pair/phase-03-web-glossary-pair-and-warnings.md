---
phase: 3
title: "Phase 3: Web bộ chọn cặp + cảnh báo"
status: done
priority: P1
effort: "3h"
dependencies: [2]
---

# Phase 3: Web bộ chọn cặp + cảnh báo

## Overview
Trang Glossary chung có bộ chọn cặp nguồn→đích (giữ trong URL); nhãn thêm nhanh và mục kế thừa ghi đúng ngôn ngữ
series; form Cài đặt cảnh báo khi đổi ngôn ngữ mà series có glossary riêng, và làm mới glossary sau khi lưu.

## Requirements
- `/w/$ws/glossary?src=ko&tgt=vi` — mặc định ko→vi khi thiếu/sai; đổi select cập nhật URL (replace, không thêm history).
- Text trang: "Áp cho series dịch {Nguồn} → {Đích}; entry trùng ở series sẽ ghi đè."
- Tab Glossary của series: mục kế thừa ghi "Từ glossary chung ({Nguồn} → {Đích})".
- Sidebar thêm nhanh: placeholder theo series (`Từ gốc (JA)`, `Dịch (EN)`); giữ `aria-label` "Từ gốc"/"Bản dịch"
  (e2e `upload-chapter.spec.ts:137-138` dùng).
- Form Cài đặt: khi `source_lang` hoặc `target_lang` khác giá trị đã lưu **và** glossary riêng series có ≥1 từ →
  `role="status"` "Glossary riêng của series có N từ viết cho {cặp cũ} — kiểm lại sau khi đổi ngôn ngữ. Glossary
  chung sẽ chuyển sang cặp {cặp mới}." Không chặn lưu.
- Lưu thành công mà cặp đổi → `invalidateQueries({ queryKey: ["glossary", ws] })` cùng với `["series", ws]` (red team
  #5): query glossary series (`series-page.tsx:102`) luôn mounted, key không chứa cặp, nên không tự làm mới →
  mục kế thừa / ApplyGlossary giữ entry cặp cũ dưới nhãn cặp mới, chọn term cũ → 400 `unknown_terms`.
- Theo memory UX: không thêm nút/bước mới ngoài 2 select.

## Architecture
- `features/glossary/api.ts`:
  ```ts
  export type LangPair = { source_lang: SourceLang; target_lang: TargetLang };
  export type GlossaryScope = { seriesId: string } | { pair: LangPair };
  ```
  `scopePath(ws, scope, path)` thêm query cặp cho workspace; `glossaryKey(ws, scope)` →
  `["glossary", ws, seriesId]` hoặc `["glossary", ws, "ws", src, tgt]` (prefix `["glossary", ws]` vẫn dùng để
  invalidate). `GlossaryEntry` thêm `source_lang`, `target_lang: string | null`. Các hàm fetch/create/import/export
  nhận `scope` thay `seriesId: string | null`.
- Caller cần đổi (đã liệt kê đủ): `series-sidebar.tsx:47-53`, `series-page.tsx:71,102`, `ApplyGlossary.tsx:22`,
  `glossary-editor.tsx:24-73,152,324`.
- `glossary-editor.tsx`: prop `scope: GlossaryScope` (+ `inheritedLabel?: string` cho series). `WorkspaceGlossaryPage`
  nhận `pair` + `onPairChange` từ route; 2 select dùng `SOURCE_LANGS`/`TARGET_LANGS`/`LANG_NAMES` (`lang-labels.ts`).
  Tái dùng `SourceLangSelect` (`source-lang-select.tsx:4`, aria-label "Ngôn ngữ gốc"); select đích mới aria-label
  "Ngôn ngữ đích".
- `router.tsx` `glossaryRoute` (`:164`): `validateSearch` cho `src`/`tgt` (theo cách `:118` đang validate `tab`).
- `series-settings-form.tsx`: `useQuery(glossaryKey(ws, { seriesId }))` lấy số entry riêng; logic hiển thị tách hàm
  thuần (VD `langChangeWarning(saved, form, count)` trong `lang-labels.ts`) để unit test; `onSuccess` (`:56-64`) thêm
  invalidate glossary khi cặp đổi.

## Related Code Files
- Modify: `apps/web/src/features/glossary/api.ts`, `glossary-editor.tsx`, `ApplyGlossary.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/features/series/series-sidebar.tsx`, `series-page.tsx`, `series-settings-form.tsx`, `lang-labels.ts`
- Tests: `apps/web/src/features/series/lang-labels.test.ts` (hàm cảnh báo), test cho `scopePath`/`glossaryKey` nếu
  tách được thuần; e2e `apps/web/e2e/series-manage.spec.ts` (hoặc spec glossary mới)

## Implementation Steps
1. Đổi `api.ts` sang `GlossaryScope`; sửa mọi caller ở trên cho typecheck xanh.
2. Route search + bộ chọn cặp ở `WorkspaceGlossaryPage`.
3. Nhãn kế thừa + placeholder sidebar theo ngôn ngữ series.
4. Hàm cảnh báo + hiển thị trong form Cài đặt + invalidate glossary khi lưu đổi cặp.
5. Unit test: hàm cảnh báo (không đổi / đổi mà 0 từ / đổi mà N từ); `scopePath` có query đúng.
6. e2e:
   - Glossary chung: thêm term ở Hàn → Anh; chuyển select sang Hàn → Việt → không thấy term; quay lại → thấy; URL có `src`/`tgt`.
   - Series ko→vi có 1 từ riêng + glossary chung có term ở ko→vi và ko→en: đổi đích sang Anh → thấy cảnh báo → lưu →
     tab Glossary: mục kế thừa ghi "(Hàn → Anh)" và chỉ có term ko→en (không reload trang).
7. `pnpm --filter @mtl/web test`, `pnpm --filter @mtl/web e2e`, `pnpm typecheck`, `pnpm lint`.

## Success Criteria
- [x] Toàn bộ unit + e2e web xanh, gồm `chapter-tools.spec.ts` (áp glossary) và `upload-chapter.spec.ts` (thêm nhanh).
- [x] Không còn chuỗi cứng "KO"/"VI" trong UI glossary.

## Risk Assessment
- Cache cũ key `["glossary", ws, "ws"]` không còn dùng — vô hại.
- Cảnh báo dựa trên số từ đã tải; query chưa xong thì không hiện (chấp nhận, không chặn lưu).
