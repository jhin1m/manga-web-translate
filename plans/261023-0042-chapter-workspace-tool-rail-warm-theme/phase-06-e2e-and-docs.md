---
phase: 6
title: "E2E theo bố cục mới + cập nhật docs"
status: pending
priority: P1
effort: "5h"
dependencies: [1, 2, 3, 4, 5]
---

# Phase 6: E2E theo bố cục mới + docs

## Overview
Sửa e2e đang kiểm tra bố cục 4 vùng cũ sang bố cục mới (đổi selector, **không xoá/nới** assertion về hành vi), thêm vài
kiểm tra cho hành vi mới, rồi cập nhật docs cho khớp. Chạy đủ bộ kiểm tra cuối.

## Requirements
- Mỗi assertion cũ còn kiểm tra cùng hành vi (vị trí đổi, ý nghĩa giữ). Test chỉ được bỏ khi hành vi đã bị bỏ theo brief
  (bộ lọc "Đã xoá", tab "Khối chữ/Xoá chữ") — thay bằng assertion tương đương của bố cục mới.
- Không đặt mã plan/phase trong tên test, comment, commit.

## Bảng đổi selector (đã rà `apps/web/e2e/*.spec.ts`)

| Spec | Cũ | Mới |
|---|---|---|
| `full-flow.spec.ts:61-66` | `rail.locator(".status", { hasText: "Chờ dịch" })` (3) / "Xong" (3) | `rail.getByRole("button", { name: /· Chờ dịch$/ })` (3) / `/· Xong$/` (3) theo `aria-label` thumbnail |
| `full-flow.spec.ts:79`, `editor.spec.ts:87-88`, `chapter-tools.spec.ts:89` | `getByRole("tab", { name: /^Bản dịch/ })` | rail `getByRole("button", { name: "Bản dịch cả chương" })` (+ `aria-pressed="true"`) |
| `chapter-tools.spec.ts:77,83-84,142` | tab "Tìm / Thay"/"Áp glossary" + `tabpanel` | rail "Tìm / Thay · Glossary (Ctrl+F)" → segmented "Tìm / Thay"/"Glossary" (`aria-pressed`); vùng = `getByRole("complementary", { name: "Tìm / Thay · Glossary" })` |
| `chapter-tools.spec.ts:141`, `editor.spec.ts:332,418` | `complementary "Bảng thuộc tính"` chứa "Khối 1 · Thoại" | mở panel Chọn (rail "Chọn (V)") → `complementary "Chọn & sửa"` chứa "Khối 1 / " + "Thoại"; khi đang ở Bản dịch thì kiểm `[data-row=…]` `.on` + canvas pager |
| `chapter-tools.spec.ts:267-286` | "Xoá trang 2", "Tất cả 2", "Đã xoá 1", "Khôi phục trang 2" | chuột phải thumbnail "Trang 2" → menuitem "Ẩn trang 2"; còn 2 thumbnail hiện + 1 "Đã ẩn"; toast "Hoàn tác"; chuột phải → "Khôi phục trang 2" |
| `editor.spec.ts:108` | `button /Chữ/` | rail `button "Chữ (T)"` |
| `editor.spec.ts:124-151` | group "Chế độ xem" Gốc/Dịch/Chia đôi | nút "Xem gốc" `aria-pressed`; menu "Thêm thao tác" → `menuitemcheckbox "Chia đôi gốc / dịch"` |
| `editor.spec.ts:213,225,230,237,331,338` | `heading "Trang n"` (inspector) | pager canvas "Trang n / M" + thumbnail `aria-current="page"` |
| `editor.spec.ts:216-224` | `.cw-canvas-foot` "Trang trước/sau" | `.cw-pager` nút "Trang trước (←)" / "Trang sau (→)" |
| `editor.spec.ts:410` | rail "Trang 1" chứa "tràn khung" | thumbnail `name: /Trang 1 · Cần xem: .*tràn khung/` + nhãn "Cần xem" |
| `upload-chapter.spec.ts:84-91` | `sources` "Xoá ảnh 2"/"Khôi phục ảnh 2" | chuột phải thumbnail "Ảnh 2" → menuitem; hoặc chọn ảnh 2 → panel "Xoá ảnh này" (dùng cả 2 ở 2 bước để phủ cả 2 lối) |
| `upload-chapter.spec.ts:195` | `last` chứa "Có thể là credit" | giữ (nhãn dưới thumbnail) — kiểm locator `last` còn đúng phần tử |

`click-budget.spec.ts`, `routes-redirect`, `series-manage`, `glossary-language-pair`, `typeset-parity`: chạy lại, chỉ
sửa nếu đụng selector trên.

## E2E thêm (đặt trong spec có sẵn phù hợp)
- `editor.spec.ts`: bấm "Chọn (V)" khi panel đang mở → panel thu (`complementary "Chọn & sửa"` biến mất) và bề rộng
  `.ed-canvas` tăng; bấm lại → mở.
- `editor.spec.ts`: chọn khối → `toolbar "Thao tác khối"` hiện; "Nhân đôi khối" → bảng thêm 1 dòng "Tự thêm"; Ctrl+Z →
  dòng mất; "Xoá khối" → khối mất.
- `editor.spec.ts`: "Xem gốc" `aria-pressed` false → true → false; giữ `O` → true, nhả → false.
- `series-manage.spec.ts`: series tên 120 ký tự → `.row-name` có `title` đủ tên, `boundingBox` không giao với ô trạng
  thái cùng hàng.

## Docs
- `docs/design-guidelines.md`: bảng hướng A (màu nhấn cam đất `#c2501b`, nền giấy ấm thay trắng + xanh `#1f4fd1`);
  mục **Token** (giá trị mới, `--c-canvas`, `--c-warn-weak`, `--c-danger-weak`, quy tắc chữ màu nhấn dùng
  `--c-accent-hover`, `--c-fg-subtle` đạt 4.5:1); mục **Màn chương** thay bảng 4 vùng bằng: thanh trên 52px · rail công
  cụ 64px · panel ngữ cảnh 288/560px · canvas · cột thumbnail 112px (+ thanh nổi, Xem gốc, menu ⋯, Vừa khung/100%);
  **Việc còn mở** ghi quyết định 23/10/2026 + link brief/mockup.
- `docs/editor.md`: đoạn đầu (bố cục), "Chế độ xem" (nút Xem gốc + Chia đôi trong ⋯, hàng công cụ → rail), "Ảnh gốc
  trước Bước 1, xoá ảnh / trang" (menu chuột phải + nút panel, "Ẩn trang"), bảng phím (Ctrl+F → panel Tìm), thanh nổi
  + Nhân đôi.
- `docs/export-and-batch-edit.md:5,41`: Tìm / Thay + Áp glossary là panel "Tìm" (segmented) thay tab bảng dưới; "Xem các
  khối này" mở panel Bản dịch.
- `docs/development-setup.md:59,79`: lý do viewport 1920×1080 (bỏ "đủ 4 vùng"), tab bảng dưới → panel.
- `README.md:16`: "chế độ Gốc / Dịch / Chia đôi" → "Xem gốc / Chia đôi"; giữ ngắn.
- `apps/web/playwright.config.ts`: comment viewport nếu có nhắc 4 vùng.

## Related Code Files
- Modify: `apps/web/e2e/full-flow.spec.ts`, `editor.spec.ts`, `chapter-tools.spec.ts`, `upload-chapter.spec.ts`,
  `series-manage.spec.ts`, có thể `helpers.ts` (helper `openPanel(page, name)`, `pageThumb(page, n)`).
- Modify: docs liệt kê ở trên.

## Implementation Steps
1. `pnpm infra:up`; chạy `pnpm --filter @mtl/web e2e` 1 lần ghi danh sách fail.
2. Thêm helper vào `helpers.ts`; sửa từng spec theo bảng; chạy riêng từng spec (`pnpm --filter @mtl/web e2e editor`).
3. Thêm 4 kiểm tra mới.
4. `pnpm --filter @mtl/web e2e typeset-parity` (gate parity) phải xanh.
5. Cập nhật docs (đọc file trước khi sửa; giữ giọng văn ngắn, có dấu).
6. Chạy đủ: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @mtl/web e2e`.

## Success Criteria
- [ ] Cả 4 lệnh kiểm tra xanh; không test nào bị `skip`/`fixme` mới, không assertion hành vi nào bị xoá không thay thế.
- [ ] `grep -rn "Bảng thuộc tính\|Chế độ xem\|bảng dưới" apps/web/src apps/web/e2e docs` chỉ còn chỗ có chủ ý.
- [ ] Docs mô tả đúng bố cục, token, phím tắt hiện tại.

## Risk Assessment
- Chuột phải trong Playwright: `locator.click({ button: "right" })` — chạy ổn trên Chromium.
- DB e2e dùng chung mọi checkout → không chạy e2e song song worktree khác.
- E2E flake do thanh nổi đè vùng click canvas `position {x:5,y:5}` → thanh nổi chỉ hiện khi có chọn; các click nền giữ
  góc trên trái.
