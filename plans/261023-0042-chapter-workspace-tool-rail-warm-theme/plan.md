---
title: "Màn chương: rail công cụ + 1 panel, bảng màu Giấy ấm"
description: "Thay bố cục 4 vùng của màn chương bằng rail công cụ 64px + panel ngữ cảnh + canvas vừa khung + cột thumbnail 112px; đổi token màu toàn app sang Giấy ấm; sửa tên series dài đè cột trạng thái."
status: in-progress
priority: P1
effort: 26h
branch: feat/chapter-workspace-tool-rail
tags: [web, ux, chapter-workspace, design-tokens]
created: 2026-10-23
blockedBy: []
blocks: []
---

# Màn chương: rail công cụ + 1 panel, bảng màu "Giấy ấm"

Nguồn: [brief.md](./brief.md) (owner duyệt 23/10/2026) · mockup [design/chapter-workspace-mockup.dc.html](./design/chapter-workspace-mockup.dc.html).
Chỉ frontend `apps/web` + docs. Không đổi backend, schema, API. Chế độ lập plan: auto → nhanh (UI refactor, không công
nghệ mới; đã rà code thực tế thay cho researcher).

## Phases

| # | Phase | Effort | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | [Token Giấy ấm + lỗi tên series dài](./phase-01-warm-tokens-and-series-name-overflow.md) | 2h | — | completed |
| 2 | [Rail công cụ + panel ngữ cảnh (khung)](./phase-02-tool-rail-and-context-panel-shell.md) | 5h | 1 | completed |
| 3 | [Cột thumbnail 112px + menu chuột phải](./phase-03-thumbnail-column-and-page-menu.md) | 4h | 2 | completed |
| 4 | [Nội dung panel: Chọn, công cụ, Bản dịch, Tìm](./phase-04-panel-content-select-tools-table-find.md) | 5h | 2, 3 | completed |
| 5 | [Thanh nổi cạnh khối, Xem gốc, menu ⋯, Vừa khung/100%](./phase-05-block-toolbar-view-original-more-menu.md) | 5h | 4 | completed |
| 6 | [E2E theo bố cục mới + docs](./phase-06-e2e-and-docs.md) | 5h | 1–5 | pending |

Làm tuần tự (cùng chạm `chapter-workspace.tsx` / `.css` → không chia song song). Mỗi phase: kiểm tra hẹp ghi trong
phase + `pnpm typecheck && pnpm lint`, commit riêng (conventional commit, không nhắc plan/phase/AI). E2E bố cục cũ đỏ từ
phase 2 tới phase 6 — sửa ở phase 6, không nới test.

## Bố cục đích

```
┌ thanh trên 52px: ‹ series · Chương N · chip · Đã lưu ····· ↶ ↷ | Xem gốc · Hoạt động · ⋯ · [Huỷ][Xuất] [nút chính] ┐
├ (băng cảnh báo — chỉ khi có)                                                                                    ┤
├ rail công cụ 64px ┬ panel 288px (560: Bản dịch, Tìm) ┬ canvas (vừa khung, ‹ Trang n/M ›, Vừa khung|100%) ┬ thumbnail 112px ┤
```

## Tính năng cũ → chỗ mới (≤ 1 cú bấm, phím tắt giữ nguyên)

| Tính năng | Trước | Sau |
|---|---|---|
| Công cụ V/T/B/E/R | hàng công cụ trên canvas | rail công cụ trái |
| Hoàn tác / Làm lại | hàng công cụ | icon thanh trên |
| Thuộc tính khối, Gốc/Bản dịch, OCR lại, Áp kiểu cùng loại, Xoá khung | inspector phải | panel Chọn (OCR lại = "Dịch lại khối"; Áp kiểu + kiểu chi tiết trong "Kiểu chữ nâng cao") + thanh nổi |
| Thông tin trang, Dịch lại trang này, Bỏ chỉnh sửa tay, AI có bản mới, xung đột | inspector | panel Chọn (chưa chọn khối) |
| Mask / xoá chữ vùng đã tô | tab "Xoá chữ" | panel Mask / Tẩy |
| Bảng văn bản cả chương + lọc | bảng dưới | panel Bản dịch 560px |
| Tìm / Thay, Áp glossary | tab bảng dưới | panel Tìm, segmented |
| Gốc / Dịch / Chia đôi | segmented thanh trên | nút "Xem gốc" + "Chia đôi" trong ⋯ |
| Dịch lại cả chương, Chạy lại trang lỗi, Phím tắt | "Dịch lại ▾", `?` | menu ⋯ |
| Danh sách trang, lọc cần xem, ẩn/khôi phục trang | rail trái 196px + icon mỗi hàng | cột thumbnail phải + nút "Cần xem k" + menu chuột phải / nút panel |
| Ảnh gốc trước Bước 1, xoá/khôi phục ảnh, credit | rail ảnh gốc | cột thumbnail + menu chuột phải / nút panel |
| Trang trước/sau, mức zoom | chân canvas | pager nổi góc dưới trái; Vừa khung / 100% góc dưới phải |
| Chip, băng cảnh báo, nút chính, drawer Xuất / Hoạt động | — | giữ nguyên |
| Nhân đôi khối | (chưa có) | thanh nổi (mới, chỉ client) |

## Tiêu chí nghiệm thu

- [ ] Màn chương đúng bố cục đích; mỗi lúc chỉ 1 panel; bấm lại icon đang mở thu panel, canvas rộng ra.
- [ ] Mọi dòng bảng trên làm được ≤ 1 cú bấm; mọi phím trong `docs/editor.md` chạy như cũ.
- [ ] Token Giấy ấm áp toàn app; chữ ≥ 4.5:1, icon/viền thông tin ≥ 3:1; không gradient/glass/emoji, 1 màu nhấn, bo góc
  ≤ 8px; icon-only có `aria-label`, tooltip có phím tắt, vùng bấm ≥ 32px.
- [ ] Tên series dài cắt "…" + `title` ở home, trang series, thanh trên màn chương.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @mtl/web e2e` xanh; e2e sửa theo bố cục mới, không
  xoá hành vi đang kiểm.
- [ ] `docs/design-guidelines.md`, `docs/editor.md`, `docs/export-and-batch-edit.md`, `docs/development-setup.md`,
  `README.md` khớp bố cục mới.

## Câu hỏi mở (đã tự quyết tạm, owner xem lại)

1. **Panel Tìm rộng 560px** (brief: 288px, chỉ Bản dịch 560px). Lý do: bảng Áp glossary có 5 cột kèm ô nhập "Cụm cũ",
   bảng xem trước Tìm/Thay 5 cột — 288px không vừa nếu giữ đủ tính năng. Muốn 288px thì phải đổi 2 bảng sang dạng
   danh sách xếp chồng.
2. **"Loại" chỉ đọc** (mockup là select Thoại/Suy nghĩ/Chữ nền/SFX). `RegionKind` trong schema chỉ có
   `bubble/text_bubble/text_free`, không có "Suy nghĩ"; cho sửa loại là đổi ngữ nghĩa dữ liệu (ngoài phạm vi "không đổi
   schema").
3. **"Dịch lại khối" = luồng "OCR lại" hiện có** (nhận dạng + dịch lại vùng qua `ocr-region`). Khối tự thêm (không có
   vùng OCR) bị tắt nút. Chưa có API dịch lại riêng bản dịch mà giữ chữ gốc.
4. **Panel Chữ không có chọn font/cỡ mặc định** như mockup — chỉ hiện font thoại của series (đổi ở Cài đặt series).
   Thêm lựa chọn riêng cho công cụ = state mới, chưa có yêu cầu.
5. **Đoạn Glossary không có ô "Thêm" thuật ngữ** như mockup — giữ đúng "Áp glossary" hiện có; thêm thuật ngữ vẫn ở tab
   Glossary của series.
6. **Tẩy (E) giữ nghĩa hiện tại = tẩy nét mask**, không phải "tẩy trực tiếp lên ảnh (không gọi AI)" như chữ trong mockup.
7. **Chọn khối trên canvas khi panel đang thu → tự mở panel Chọn**; panel đang là Bản dịch/Tìm → giữ nguyên. Phím
   V/T/B/E/R khi panel thu → giữ thu.
8. **Nhân đôi khối**: bản sao lệch +16px, `region_id = null` (thành dòng "Tự thêm" trong bảng, không gắn vùng OCR).
9. **Trang bình thường không có chữ dưới thumbnail** (kể cả "Chờ dịch", "Đang xử lý"); trạng thái nằm trong
   `aria-label`/`title`. Thêm nhãn "Chờ AI" (viền cam) cho trang chờ AI tự thử lại — brief không nhắc.
10. **Thumbnail 72×100 theo mockup → ở màn 1568×724 chỉ thấy ~5–6 trang** (brief phàn nàn rail cũ thấy ~9). Nếu cần
    thấy nhiều hơn: thu thumbnail ~56×78.
11. **Đổi chữ "Xoá trang" → "Ẩn trang"/"Đã ẩn"** theo mockup; ảnh gốc trước Bước 1 giữ "Xoá ảnh".
12. **Chữ màu nhấn dùng `--c-accent-hover` (#a8430f)** vì `#c2501b` trên nền chỉ 4.48:1 (trên surface 4.11:1);
    `--c-fg-subtle` chọn `#7a7264` (4.52:1). Highlight tìm & thay (`mark.hit` vàng/xanh) giữ nguyên.
13. **Nhớ panel theo trình duyệt** (`localStorage mtl.layout = { panel }`); khoá cũ của bảng dưới bị bỏ qua.
14. Ngoài phạm vi (theo brief): bỏ cột phải "Cài đặt dịch" + "Glossary" ở trang series; dark mode / chọn theme; thay đổi
    backend, schema, API.
