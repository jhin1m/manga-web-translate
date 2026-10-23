---
title: "Đợt tính năng nhỏ: xuất lại, màu chữ, email mời, sắp ảnh, chữ bỏ qua, font tuỳ chỉnh"
description: "6 tính năng từ README 'Chức năng còn thiếu' / 'Phải làm', làm theo thứ tự ưu tiên, mỗi phase độc lập"
status: completed
priority: P1
effort: "5-6d"
tags: [web, api, worker, editor, typeset]
created: 2026-10-23
---

# Đợt tính năng nhỏ

## Overview

6 tính năng độc lập, mỗi phase ship + commit riêng được. Thứ tự = ưu tiên (1 & 2 trước). Quyết định user (2026-10-23):
- Màu chữ: **màu thật tương phản** (lấy màu chữ/viền gốc lúc Bước 1), không chỉ đen/trắng.
- Email: **SMTP qua nodemailer**, không cấu hình → giữ hành vi cũ (link trên UI + log).
- Chữ bỏ qua: **so khớp bỏ dấu cách + entry `/regex/`**; áp ngược = **ẩn box** (hidden), có hoàn tác.
- Font: **upload theo workspace** (owner/admin), mọi series trong workspace dùng được.

## Phases

| # | Phase | Ưu tiên | Effort | Status |
|---|-------|---------|--------|--------|
| 1 | [Ẩn/khôi phục trang sau khi xuất → cần xuất lại](./phase-01-danh-dau-xuat-lai.md) | P1 | 2h | Completed (còn kiểm tay) |
| 2 | [Màu chữ theo màu gốc khi typeset](./phase-02-chu-theo-mau-goc.md) | P1 | 1.5d | Completed (còn kiểm tay) |
| 3 | [Gửi email lời mời qua SMTP](./phase-03-email-loi-moi.md) | P2 | 3h | Completed (còn kiểm tay) |
| 4 | [Sắp xếp tay thứ tự ảnh trước Bước 1](./phase-04-sap-xep-anh-truoc-buoc-1.md) | P2 | 4h | Completed (còn kiểm tay) |
| 5 | [Chữ bỏ qua: bỏ dấu cách, regex, áp ngược](./phase-05-chu-bo-qua-regex-va-ap-nguoc.md) | P2 | 1d | Completed |
| 6 | [Font tuỳ chỉnh theo workspace](./phase-06-font-tuy-chinh-workspace.md) | P3 | 2d | Completed (còn kiểm tay) |

## Phụ thuộc / điểm chạm chung

- Không phase nào chặn phase nào. Không có plan dở dang khác chồng phạm vi.
- **Worker release**: phase 2 và 6 đều đổi worker → gộp vào 1 lần tăng `PIPELINE_VERSION` (0.5.0) nếu ship cùng đợt;
  phase 6 cần tăng `MIN_PIPELINE_VERSION` (worker cũ không hiểu font tuỳ chỉnh).
- **Migration**: phase 1 (`0011`), phase 6 (`0012`) — đánh số theo thứ tự merge thực tế, mỗi file có down viết tay.
- `series-settings-form.tsx`: phase 5 (nút áp ngược) và phase 6 (select font động) cùng sửa → làm tuần tự.
- Phase 5 ẩn box = ghi `page_states` → `exportStatus` tự bắt "cần xuất lại" (không cần thêm gì từ phase 1).
- Route mới dưới `/api/w/:ws` (phase 4, 5, 6) **phải** có case trong `apps/api/test/tenant-isolation.test.ts`.
- Đổi zod shared (phase 2, 5, 6) → `pnpm schema:emit`.

## Success Criteria

- [x] Mỗi phase: `pnpm typecheck && pnpm lint && pnpm test` xanh; worker `uv run pytest` xanh khi đụng worker; e2e
      liên quan xanh.
- [x] README mục "Việc còn lại" gạch các mục đã xong; docs liên quan (`editor.md`, `job-queue-worker.md`,
      `typeset-layout-contract.md`, `development-setup.md`, `deployment-guide.md`) cập nhật theo phase.
- [x] Không phá hành vi cũ: trang đã chuẩn bị trước phase 2 vẫn typeset theo polarity; không cấu hình SMTP vẫn mời được.

## Câu hỏi còn mở

- Áp ngược chữ bỏ qua làm ở cấp series (một lần cho mọi chương đã dịch, bỏ qua chương người khác đang sửa). Nếu muốn
  thêm nút ở cấp chương (bảng công cụ) → bổ sung sau, dùng chung engine.

<!-- slug: small-features-batch -->

## Kết quả (2026-10-23)

- 6 phase xong trên nhánh `feat/small-features-batch` (chưa commit). Review 2 lượt + sửa: ReDoS regex → API khớp bằng
  `re2` (quyết định user), resume upload sau đổi thứ tự, font 4xx fallback, chặn `font_family` dạng đường dẫn, copy font
  sang key riêng khi commit, `mail_sent` thật. Báo cáo: `reports/`.
- Version: worker `PIPELINE_VERSION` 0.5.1, API `MIN_PIPELINE_VERSION` 0.5.1 (deploy worker trước). Migration 0011, 0012.
- Còn kiểm tay: UI "Xuất lại" sau ẩn trang; soi ≥3 trang thật có chữ màu; SMTP thật; kéo-thả Safari; parity font tuỳ
  chỉnh Konva ↔ render.py.
