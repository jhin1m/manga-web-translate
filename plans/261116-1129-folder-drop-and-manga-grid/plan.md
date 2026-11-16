---
title: "Thả folder + lưới kiểu manga (series, chương)"
description: "Thả folder = 1 chương (tên chương từ folder); trang chủ lưới series có ảnh bìa (tự động / tự tải); trang series lưới chương có ảnh đầu; thumbnail tạo phía API bằng sharp"
status: pending
priority: P1
effort: "16h"
tags: [web, api, upload, ui]
created: 2026-11-16
---

# Thả folder + lưới kiểu manga

## Overview

Ba tính năng UI từ brainstorm `../reports/brainstorm-261116-1823-folder-drop-and-manga-grid-report.md`
(user duyệt 2026-11-16). Hosting nhiều người dùng tách brainstorm riêng — ngoài phạm vi.

Quyết định đã chốt (user): folder = 1 chương, folder chứa folder con → mỗi con 1 chương; ảnh bìa tự động + đổi được;
lưới thay hẳn danh sách (cả trang chủ lẫn trang series). Tự chốt: thumbnail on-demand phía API bằng `sharp`, cache vào
storage; tên chương lấy từ tên folder/ZIP đã bỏ tên series + cụm số.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Thả / chọn folder tạo chương, số + tên chương lấy từ tên folder | P1 |
| 2 | Trang chủ hiện lưới series có ảnh bìa, dữ liệu cũ cũng có ảnh | P1 |
| 3 | Trang series hiện lưới chương có ảnh đầu (bỏ trang credit) | P1 |
| 4 | Ảnh bìa series tải lên / về tự động được | P2 |

## Phases

| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 1 | [Phase 1: Folder drop + tên chương](./phase-01-start.md) | Pending | — |
| 2 | [Phase 2: API thumbnail + ảnh bìa series](./phase-02-api-thumbnails-and-series-cover.md) | Pending | — |
| 3 | [Phase 3: Lưới series + lưới chương (web)](./phase-03-web-manga-grid.md) | Pending | 2 |
| 4 | [Phase 4: Kiểm tra + phát hành](./phase-04-verify-and-release-check.md) | Pending | 1, 2, 3 |

Phase 1 và 2 độc lập về code (web upload vs API), làm song song được. Mỗi phase một commit, gate xanh mới sang phase sau.

## Cross-plan

- `261106-1519-ui-simplify-wireframe` (phase-01 home/series): bố cục danh sách một dòng bị thay bằng lưới. Không chặn
  (plan đó đã làm xong phần UI); quy tắc giữ lại: icon Sửa/Xoá hiện sẵn, xác nhận xoá tại chỗ, không giấu sau chuột phải.
- Không plan dở nào khác đụng `drop-zone.tsx`, `drop-to-translate.ts`, `home-page.tsx`, `series-page.tsx`.

## Success Criteria

- [ ] Thả folder `Ch 12/` (40 ảnh) → 1 chương số 12; folder chứa 3 folder con → 3 chương đúng thứ tự tự nhiên.
- [ ] `Chapter 105 - The Return/` → Ch.105, tên "The Return"; `Solo Leveling ch 105/` (series Solo Leveling) → tên rỗng.
- [ ] Folder rỗng / file sai định dạng / > 400 file → dòng xác nhận, không crash.
- [ ] Trang chủ + trang series hiện lưới ảnh, kể cả series/chương tạo trước bản này; chưa có ảnh → placeholder.
- [ ] Ảnh đầu bỏ trang `skip` và áp `trim`; tải ảnh bìa / "Dùng ảnh tự động" có hiệu lực ngay.
- [ ] Chrome, Edge, Firefox (Windows) thả + chọn folder được.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` xanh; image app build được amd64 + arm64; selfhost smoke qua.

## Out of scope

Hosting nhiều người / BYOK, bộ cài Windows, toggle lưới/danh sách, folder 2 cấp tự tạo series, chọn trang bất kỳ làm bìa.

## Open questions

None (endpoint thumb chốt 302 tới URL ký — xem phase 2).
