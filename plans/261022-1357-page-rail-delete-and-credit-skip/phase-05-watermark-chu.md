---
phase: 5
title: "Watermark chữ: danh sách bỏ qua theo series"
status: done
priority: P2
effort: "0.5d"
dependencies: [1]
---

# Phase 5: Watermark chữ — danh sách bỏ qua theo series

## Overview
`series.ignore_text` (từ khoá/URL). Vùng OCR có chữ khớp → không gửi LLM, không tạo box, không hiện trong bảng. Ảnh
đã sạch vì Bước 1 inpaint mọi vùng không phải SFX → không đụng worker.

## Requirements
- Functional:
  - `series.ignore_text text[]` default `{}`; tối đa 50 mục, mỗi mục 3–100 ký tự sau trim (bỏ trùng không phân biệt hoa
    thường; ngắn hơn 3 → 400, form báo lỗi tại dòng). Nhận trong `SeriesPatch` + trả trong series view.
  - `isIgnoredText(text, list)`: NFC + lowercase, bỏ khoảng trắng thừa; khớp khi chuỗi đã chuẩn hoá **chứa** một mục.
  - Claim `chapter.translate` (`claim-inputs.ts:151`): với item OCR khớp → đặt `empty: true` trong `ocr_result` gửi
    worker (worker đã bỏ `empty` ở stage 2, `pipeline.py:200`) → không dịch, không box.
  - `neighborLines` / `pageLines` (`claim-inputs.ts:95`) bỏ dòng khớp (không đưa watermark vào ngữ cảnh).
  - Đổi `ignore_text` → tăng `glossary_rev` (chỉ ảnh hưởng giai đoạn dịch; **không** tăng `settings_rev` vì
    settings_rev nằm trong khoá prepare → thử lại trang lỗi sẽ chạy lại Bước 1). Comment ghi rõ lý do.
  - Web: bảng văn bản (`text-table/rows.ts` `pageRows`) bỏ region có `source_text` khớp; `series-settings-form.tsx`
    thêm ô "Chữ bỏ qua (watermark)" — textarea mỗi dòng 1 mục.
- Non-functional: chương đã dịch xong **không** bị sửa ngược (ngoài phạm vi); chỉ ẩn dòng ở bảng.

## Architecture
Hàm dùng chung ở `packages/shared/src/ignore-text.ts`. Lọc ở API lúc claim (một chỗ cho mọi lần dịch: Bước 2, dịch
lại, thử lại) thay vì sửa `ocr_result` trong DB → đổi danh sách có hiệu lực ngay lần dịch kế, xoá mục thì dịch lại
được.

## Related Code Files
- Create: `packages/shared/src/ignore-text.ts` (+ test), migration `0010_series_ignore_text.sql`
- Modify: `packages/db/src/schema/app.ts`, `apps/api/src/routes/series.ts` (Settings/SeriesPatch/view, bump
  glossary_rev), `apps/api/src/jobs/claim-inputs.ts`, `apps/web/src/features/series/series-settings-form.tsx`,
  `features/series/api.ts`, `features/chapter/text-table/rows.ts` (+ test), nơi truyền series vào rows
  (`text-table.tsx`/`chapter-workspace.tsx` đã có `series` query)
- Tests: `apps/api/test/series.test.ts`, `queue.test.ts` (claim translate), web `rows.test.ts`

## Implementation Steps
1. **Tests Before**: `rows.test.ts`, `series.test.ts` (PATCH settings bump settings_rev/glossary_rev hiện tại) xanh;
   thêm test claim `chapter.translate` hiện trả nguyên `ocr_result`.
2. `ignore-text.ts` + test (hoa/thường, NFC tiếng Việt, URL có `https://`, khoảng trắng).
3. Migration + schema + series route.
4. Claim translate + context lines dùng `isIgnoredText` (đọc `series.ignoreText` cùng truy vấn chương).
5. Web rows + form.
6. **Tests After**: claim với `ignore_text=["discord.gg"]` → item chứa "DISCORD.GG/abc" có `empty: true`, item khác
   giữ nguyên; PATCH ignore_text tăng glossary_rev, không tăng settings_rev; rows bỏ region khớp.
7. **Regression Gate**: `pnpm typecheck && pnpm lint && pnpm test` + e2e `series-manage`, `full-flow`.

## Success Criteria
- [x] Watermark khớp không xuất hiện trong prompt LLM (kiểm input claim) và không có box.
- [x] Bỏ mục khỏi danh sách → dịch lại trang → vùng đó được dịch bình thường.

## Ghi chú sau review (2026-10-22)
- Ngưỡng 3–100 ký tự tính trên dạng đã chuẩn hoá (`isValidIgnoreEntry`): "http://a", 1 chữ NFD → 400.
- Bảng văn bản: vùng khớp vẫn hiện dòng nếu còn box đang hiện có chữ (chương dịch trước khi thêm mục) để người dùng
  thấy và xoá chữ đã in; vùng không box → ẩn.
- Vùng người dùng tự vẽ (`page.ocr_region`) đè lên watermark vẫn dịch (thao tác chủ động); chỉ ngữ cảnh bỏ dòng khớp.
- URL bị OCR tách bằng dấu cách (`discord . gg`) không khớp — ghi docs.

## Risk Assessment
- Từ khoá quá ngắn (vd. "a") nuốt cả thoại → đã chặn bằng tối thiểu 3 ký tự; mục chung chung (vd. "the") vẫn có thể
  nuốt thoại → placeholder gợi ý dùng URL/tên nhóm cụ thể.
- Watermark detector không bắt (quá mờ/nhỏ) → vẫn còn trên ảnh; ghi docs.
