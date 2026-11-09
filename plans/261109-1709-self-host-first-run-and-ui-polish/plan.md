---
title: "Self-host first run and UI polish"
description: "Cài Docker xong dịch được ngay, giữ bóng chỉ có dấu câu, dọn các chỗ khó hiểu trên giao diện"
status: in-progress
priority: P1
effort: "2-3d"
tags: [self-host, providers, worker, ui]
created: 2026-11-09
branch: feat/self-host-first-run-and-ui-polish
---

# Self-host first run and UI polish

## Overview

Sửa các điểm vướng khi cài bản Docker lần đầu, trước khi phát hành `v0.1.0`. Thiết kế đã duyệt: [báo cáo brainstorm](../reports/brainstorm-261110-0002-selfhost-first-run-and-ui-polish-report.md).

Mỗi phase một commit, gate xanh rồi mới sang phase sau. Phase độc lập nhau về code, làm theo thứ tự để ưu tiên phần chặn người dùng.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Thêm provider đầu tiên là dịch được, không phải vào Model tác vụ | P1 |
| 2 | Không nhập được model mà worker chắc chắn lỗi; có gợi ý model đúng | P1 |
| 3 | Bóng chỉ có dấu câu giữ nguyên hình gốc | P1 |
| 4 | Series mới mặc định nguồn tiếng Anh, font thoại dễ đọc | P2 |
| 5 | Giao diện ít chữ, báo lỗi đúng nguyên nhân | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Self-host first run](./phase-01-start.md) | Done |
| 2 | [Phase 2: Keep regions without text](./phase-02-keep-regions-without-text.md) | Done |
| 3 | [Phase 3: Interface polish](./phase-03-interface-polish.md) | Done |

## Gate mỗi phase

- `pnpm --filter @mtl/api test:unit` và test API liên quan
- `uv run --frozen pytest -q` trong `worker/` (phase 2)
- Test web, typecheck, lint của package bị đụng
- Không đưa mã plan/phase vào comment, tên test, commit

## Quyết định đã kiểm chứng

- Không bump `PIPELINE_VERSION`: hợp đồng job và schema không đổi; worker mới vẫn đọc được dữ liệu cũ.
- `manifest.json` sinh từ `PREFERRED_DEFAULTS` trong `worker/scripts/font_glyph_check.py`, rồi `apps/web/scripts/sync-fonts.ts` chép sang web; không sửa tay.
- Không có plan đang dở chặn plan này. `261106-1519-ui-simplify-wireframe` ghi "chưa làm" nhưng git đã merge.

## Success Criteria

- [ ] Máy sạch: `docker compose up -d`, thêm provider Anthropic dùng gợi ý, tải chương, dịch thành công mà không mở Model tác vụ
- [x] Nhập `claude-sonnet-5-5` cho Anthropic bị từ chối với thông báo rõ, ở cả form và API
- [x] Bóng `...!` giữ nguyên hình gốc, không có text box chồng lên, không tốn token dịch
- [x] Trên VPS (không local mode), thêm provider không đổi slot
- [ ] Tất cả gate xanh, sau đó mới push tag `v0.1.0`

Còn lại trước khi đóng plan: chạy thử Docker trên máy sạch; `block-panel.spec.ts:317` đang lỗi từ trước đợt này (lỗi y hệt ở `7e0ed9e`).

<!-- slug: self-host-first-run-and-ui-polish -->
