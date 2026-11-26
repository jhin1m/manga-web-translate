---
phase: 7
title: "README, docs, smoke English"
status: completed
priority: P1
effort: "0.75d"
dependencies: [6]
---

# Phase 7: README, docs, smoke English

## Goal

Người nước ngoài đọc README tiếng Anh và cài được; e2e smoke chứng minh luồng chính sạch tiếng Việt ở locale en;
docs ghi cách thêm chuỗi và thêm locale.

## Tasks & Steps

- [x] README (95 dòng): bản tiếng Anh + bản tiếng Việt, link chuyển ngôn ngữ ở đầu mỗi file (`README.md` tiếng Anh,
      `README.vi.md` tiếng Việt) <!-- Updated: Validation Session 1 - chốt tên file README -->. Không có docs nào link anchor README nên đổi tên an toàn.
- [x] E2E `i18n-en-smoke.spec.ts` với `test.use({ locale: "en-US" })`: tạo series → upload → dịch (fake worker) →
      editor → xuất; assert `document.documentElement.lang === "en"` và `body.innerText` không chứa ký tự có dấu
      tiếng Việt ngoài dữ liệu người dùng (tên series đặt ASCII). Thêm ca đổi ngôn ngữ ở `/settings` → reload giữ.
- [x] Soát ảnh chụp màn hình chính ở locale en (home, chapter workspace, editor, settings) tại 1920 px và 1280 px;
      sửa tràn chữ bằng CSS (không cắt chữ).
- [x] Docs: thêm mục i18n vào `docs/design-guidelines.md` (quy tắc: chuỗi mới vào `vi.json` + `en.json`, key theo
      feature, `tp`/`tNode`), cách thêm locale (1 JSON + 1 dòng `LOCALES`); `docs/self-host.md` một dòng về chọn
      ngôn ngữ giao diện.
- [x] Ghi chú phát hành vào `docs/releases/` của bản kế tiếp.

## Files to Create / Modify

- Create: `README.vi.md`, `apps/web/e2e/i18n-en-smoke.spec.ts`
- Modify: `README.md`, `docs/design-guidelines.md`, `docs/self-host.md`, CSS các màn bị tràn

## Verification

- `pnpm lint && pnpm typecheck && pnpm test` tuần tự
- `pnpm --filter @mtl/web e2e` toàn bộ (1 worker) — cũ ở vi-VN + smoke en
- Image/smoke Docker theo quy trình release vì có migration (phase 6).

## Success Criteria

- Mọi tiêu chí trong `plan.md` đạt; ảnh chụp en không tràn chữ.

## Implementation Notes

- Ca "đổi ngôn ngữ ở `/settings` → reload giữ" đã có trong `settings-language.spec.ts` (đổi, không reload, reload giữ,
  `<html lang>`, lưu `PUT /api/me/locale`), nên smoke không lặp; smoke chỉ kiểm `/settings` mở bằng English, sạch chữ Việt.
- Soát ảnh 1920 / 1280 / 900 px (kèm bộ dò phần tử tràn chữ): sửa CSS trạng thái thẻ home/series (xuống dòng thay
  vì "…"), cột Vị trí bảng Script (44 → 64 px), thanh công cụ nổi trên canvas (`width: max-content`, trước đó xuống
  dòng ở nửa canvas), ô ngôn ngữ ở màn ≤ 900 px (nhãn + ô gọn một hàng). Tiêu đề mục Font viết thẳng "Font" → `t()`.
- Thuật ngữ en: công cụ Tẩy chữ "Erase" → "Clean", Tô / Tẩy nét "Paint" / "Erase strokes" → "Brush" / "Eraser",
  Xưng / gọi "Self / address" → "I / you"; giữ "Script".
- Chưa làm: image/smoke Docker theo quy trình release (bước phát hành), smoke LLM thật cho `style_note` / `reason`.
