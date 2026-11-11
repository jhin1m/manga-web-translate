# Phase 4 report: web UI gợi ý AI

## Files
- sửa: `apps/web/src/features/series/{api.ts,settings-summary.ts,settings-summary.test.ts,series-page.tsx,series-settings-form.tsx}`, `apps/web/src/features/home/home.css`, `apps/web/e2e/fake-worker.ts`
- mới: `series/suggestions.ts` + `.test.ts`, `series/pronoun-suggestions.tsx`, `glossary/glossary-suggestions.tsx`, `e2e/series-suggestions.spec.ts`

## Commands
- `pnpm --filter @mtl/web test`: 54 files / 460 tests pass
- `pnpm typecheck`: pass; `pnpm lint`: pass (442 files)
- `pnpm --filter @mtl/web e2e series-suggestions`: 1 pass
- Full e2e: 98 pass, 3 fail:
  - `upload-chapter.spec.ts` x2: KHÔNG phải flaky: spec gợi ý để lại series "Gợi ý AI e2e"; thả file ở home chọn series của chương mới nhất nên 2 test của upload-chapter vỡ khi chạy sau nó, lặp lại được (đã sửa, xem "Sửa theo review").
  - `block-panel.spec.ts:317` (double-click block with panel collapsed): fails also in isolation. Chapter editor panel behaviour; my diff touches nothing under `features/chapter/**` (which has other uncommitted edits). Not caused by this phase; not verified against a clean tree (no stash allowed).

## Deviations
- Spec dùng series riêng + helper cục bộ (copy `apiReadyChapter`), vì helper dùng chung hardcode `state.seriesId` và `helpers.ts` ngoài danh sách file được sửa; tránh làm bẩn series seed dùng chung.
- Badge có `data-testid` (`glossary-hint-badge`, `settings-hint-badge`) để e2e bắt; tên accessible link Glossary vẫn bắt đầu bằng "Glossary".
- Badge icon Cài đặt: `.series-head .icon-btn` thêm `position: relative` (cả nút Về trang chủ, không ảnh hưởng hiển thị).
- `PronounSuggestions` nhận thêm prop `seriesId` (cần cho invalidate sau Bỏ).
- Chưa có e2e cho nhánh 409 duplicate_term (chỉ code path); không chụp screenshot.

## Sửa theo review
- H1: spec tạo series trong test và xoá bằng API trong `finally`. `e2e/series-suggestions.spec.ts`
- M1: Nhận / Bỏ `await` invalidate trong `onSuccess` (glossary + `["series"]`, gộp trong `Promise.all`) nên mutation còn pending, nút khoá tới khi danh sách tươi. Lưu ý: await luôn `["series"]` (đã bao key gợi ý) thay vì bắn không chờ, để khỏi refetch đôi do cancelRefetch. `glossary-suggestions.tsx`, `pronoun-suggestions.tsx`
- M2: `focusAfterRemoval` + `neighborId` (`suggestions.ts`): sau khi hàng biến mất focus sang cùng nút của hàng kế/trước. Hết hàng: glossary về ô nhập đầu trong modal, xưng hô về `summary` của Fold. Nhận xưng hô: focus ô "Xưng / gọi" của hàng mới (không đụng form). Nhánh 409 cũng trả focus.
- L1: badge `aria-hidden`; link Glossary thêm `sr-only` " · N gợi ý từ AI"; icon Cài đặt `aria-label="Cài đặt dịch · N gợi ý xưng hô"` (selector substring cũ vẫn khớp). `series-page.tsx`
- L2: lời nhắc dẫn xuất từ `hasAcceptedRule(accepted, rules)` (prop `rules` từ form), tắt khi xoá hàng vừa Nhận. `pronoun-suggestions.tsx`, `series-settings-form.tsx`, `suggestions.ts` (+test)
- L3: lỗi dùng `small error`; 409 "đã có trong glossary" giữ `small muted`. `glossary-suggestions.tsx`, `pronoun-suggestions.tsx`
- L5: bỏ `TermKind` cục bộ, import từ `@mtl/shared`. `api.ts`, `suggestions.ts`
- L6: ô từ gốc `.ai-src { white-space: nowrap }` (`home.css`); nhãn "Ch.N".
- L7: `apiReadyChapter(page, number, opts, seriesId = state.seriesId)`; spec dùng nó, bỏ ~40 dòng chép. `e2e/helpers.ts`
- Test thêm: unit `hasAcceptedRule`, `neighborId`; e2e assert focus sau Nhận/Bỏ glossary, focus ô "Xưng / gọi", lời nhắc tắt sau khi xoá hàng.
- Kết quả: web test 462 pass, typecheck + lint sạch; `series-suggestions` + `upload-chapter`: 6/6 pass (hết phụ thuộc thứ tự); full e2e: 100 pass, 1 fail (`block-panel.spec.ts:317`, chương editor, ngoài phạm vi).
