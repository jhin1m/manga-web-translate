---
phase: 3
title: "Chuyển chuỗi editor, series, home, upload, glossary"
status: completed
priority: P1
effort: "1d"
dependencies: [2]
---

# Phase 3: Chuyển chuỗi editor, series, home, upload, glossary

## Goal

Chuyển `features/editor` (112 dòng / 18 file), `features/series` (140 / 14), `features/home` (61 / 5),
`features/upload` (29 / 6), `features/glossary` (51 / 2) sang `t()` + bản `en`; xoá 5 thư mục khỏi `ALLOWLIST`.

## Key Insights

- `features/series/lang-labels.ts` dùng `LANG_NAMES` (shared, tiếng Việt) và ví dụ xưng hô theo đích (`anh/em`,
  `Boss / kid`) → nhãn ngôn ngữ chuyển sang key `lang.<code>`; ví dụ xưng hô là dữ liệu theo ngôn ngữ đích, giữ nguyên.
- `natural-sort.ts` dùng `Intl` → dùng `collator()` theo locale nếu là thứ tự hiển thị.
- Dòng gợi ý series (`series-suggestions`) kiểm tra lại: nếu có chuỗi hiển thị thì chuyển.

## Tasks & Steps

- [x] Chuyển từng thư mục theo cách phase 2; nhãn `LANG_NAMES` → `t("lang.ko")`… (web thôi import `LANG_NAMES`).
- [x] Glossary CSV: tiêu đề cột CSV (`source_term`, `target_term`) là định dạng file, không dịch.
- [x] Xoá 5 thư mục khỏi `ALLOWLIST`.

## Files to Create / Modify

- Modify: `apps/web/src/features/{editor,series,home,upload,glossary}/**`, `apps/web/src/i18n/messages/{vi,en}.json`,
  guard allowlist.

## Verification

- `pnpm --filter @mtl/web typecheck && pnpm --filter @mtl/web test`
- E2E tuần tự: `editor`, `block-panel`, `draft-wheel-flip`, `typeset-parity`, `series-manage`, `series-auto-memory`,
  `list-sort-view`, `upload-chapter`, `signup`.

## Success Criteria

- Guard xanh cho 5 thư mục; parity xanh; e2e trên xanh không sửa selector.

## Risk Assessment

- Editor canvas (Konva) có thể vẽ chữ placeholder bằng tiếng Việt lên ảnh → chữ vẽ lên ảnh xuất là nội dung bản dịch,
  không phải UI; chỉ chuyển placeholder hiển thị trong ô nhập, không đụng chữ đã typeset.

## Implementation Notes

- 426 key mới: `editor.*` 116, `series.*` 151, `home.*` 69, `glossary.*` 44, `upload.*` 28, `lang.<code>` +
  `lang.short.<code>` 18. Báo cáo: `plans/reports/fullstack-developer-261125-2212-i18n-phase-03.md`.
- Tên ngôn ngữ: `features/series/lang-labels.ts` có `langName` / `langShort` và `LANG_NAMES` dạng getter (giữ shape cho
  `features/chapter/lang-pair-fields.tsx`); web không còn import `LANG_NAMES` từ shared ngoài `features/pipeline`.
- `PAGE_BUSY_SAVE_TEXT` giữ là string export, gán lại khi đổi ngôn ngữ (ESM live binding).
- Allowlist theo dòng: 2 dòng nhận dạng tên file trong `features/upload/parse-chapter-filename.ts`.
- E2E `block-panel` "double-clicking a block under the future panel…" đỏ cả khi `apps/web/src` ở HEAD → có từ trước.
