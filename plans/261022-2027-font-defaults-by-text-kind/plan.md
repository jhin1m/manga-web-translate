---
title: "Font mặc định theo loại chữ"
description: "Editor dùng font Thoại của series; text_free dùng font Dẫn truyện; ẩn ô SFX chưa dùng"
status: completed
priority: P1
effort: "4h"
tags: [fonts, typeset, editor, contract]
created: 2026-10-22
---

# Font mặc định theo loại chữ

## Overview

Series đã lưu 3 slot `default_fonts` (`dialogue` / `narration` / `sfx`) và form hiện đủ 3 ô, nhưng:
- API chỉ gửi `dialogue` cho worker (`apps/api/src/jobs/enqueue.ts:209`); worker dùng 1 font cho mọi vùng.
- Editor tạo box tay bằng `manifest.defaults[0]`, bỏ qua font series (`apps/web/src/features/chapter/chapter-workspace.tsx:416`) → lệch với box auto-typeset.
- SFX không được dịch/đặt chữ (`restore_sfx`) → ô SFX là cấu hình chết.

## Quyết định

- `text_bubble` → font Thoại; `text_free` → font Dẫn truyện.
- **Dẫn truyện chưa chọn → dùng font Thoại** (không thêm hằng mặc định riêng). Lý do: `text_free` là "chữ ngoài bóng" theo vị trí, không phải theo nghĩa — webtoon có nhiều thoại trôi ngoài bóng; series hiện có không đổi hành vi; bớt một điểm phải giữ khớp API↔worker.
- Ẩn ô SFX ở UI; giữ khoá `sfx` trong DB/API (không migration).
- Payload thêm trường **optional** `narration_font` (giữ `font`), không đổi `font` thành object → job cũ trong hàng đợi vẫn hợp lệ.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Editor font Thoại + ẩn SFX](./phase-01-editor-font-and-sfx-slot.md) | Completed |
| 2 | [Hợp đồng font Dẫn truyện API→worker](./phase-02-narration-font-contract.md) | Completed |

Hai phase độc lập về file; làm tuần tự cho gọn review. Phase 2 có ràng buộc thứ tự deploy (worker trước API).

## Success Criteria

- [x] Box vẽ tay / OCR vùng trong editor dùng font Thoại của series (fallback manifest default).
- [x] Auto-typeset: `text_free` ra font Dẫn truyện khi series đã chọn; chưa chọn → giống font Thoại.
- [x] Form + sidebar series không còn hiện SFX; hiện Dẫn truyện với gợi ý "chữ ngoài bóng".
- [x] Payload cũ (không có `narration_font`) vẫn chạy được ở worker mới.
- [x] Test API + worker + web xanh; `docs/typeset-layout-contract.md` cập nhật.

## Out of scope

- Font SFX / dịch SFX. Phân loại thoại theo nghĩa (thought, shout, narration box) — cần class detector mới.

<!-- slug: font-defaults-by-text-kind -->
