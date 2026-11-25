---
phase: 5
title: "Docs + smoke LLM thật"
status: in-progress
priority: P2
effort: "2h"
dependencies: [2, 3, 4]
---

# Phase 5: Docs + smoke LLM thật

<!-- Updated: Red Team Session 1 - thêm docs export-and-batch-edit, đo token vào, đếm mục AI sai -->

## Goal

Tài liệu nói đúng hành vi mới; một lần chạy với LLM thật xác nhận không lỗi schema, tên giữ thống nhất qua chương, và
có số đo chi phí.

## Context

- `docs/project-roadmap.md` l.19-21: mục "Gợi ý và trí nhớ series".
- `docs/export-and-batch-edit.md` l.146-166: mô tả bảng `series_suggestions`, badge, route gợi ý.
- `docs/job-queue-worker.md`, `docs/deployment-guide.md`: nhắc worker 0.11.0 sinh gợi ý.
- Smoke cũ: `plans/261111-1925-series-memory-glossary-pronoun-suggestions/reports/smoke-real-llm-series-memory-report.md`
  (token ra hai lần chạy lệch +15,4% / +3,1%; tỉ lệ rác 50%; watermark lọt vào `new_terms`).
- Worker chạy với `--provider anthropic`.

## Files to Create / Modify

- Sửa: `docs/project-roadmap.md`, `docs/export-and-batch-edit.md`, `docs/job-queue-worker.md`,
  `docs/deployment-guide.md` (chỉ đoạn liên quan).
- Tạo: `plans/261124-1418-auto-apply-series-memory/reports/smoke-real-llm-auto-memory-report.md`.

## Tasks & Steps

1. Docs: thay "gợi ý chờ duyệt" bằng "AI tự ghi, nhãn AI, xoá thì không thêm lại, Giọng văn chỉ điền khi trống, gợi ý
   cũ không được áp". Ghi worker 0.13.0 là tuỳ chọn (0.12.0 vẫn chạy, chỉ không điền Giọng văn). Roadmap đổi chỉ số cần
   đo thành "tỉ lệ mục AI người dùng phải sửa/xoá".
2. Smoke (series mới 2 chương, Giọng văn trống, worker 0.13.0 + API mới), đo:
   - số lô lỗi `schema`;
   - token **vào** và **ra** mỗi lô, chương 2 so với chương 1, và so với số nền của smoke cũ;
   - số entry/cặp AI ghi sau chương 1, trong đó bao nhiêu sai (tên sai, từ thường, watermark);
   - chương 2 có dùng đúng các tên đó không; nội dung Giọng văn AI có hợp lý và là một dòng mô tả không.
3. Xoá dữ liệu smoke trong DB dev; ghi vào báo cáo.

## Verification

- Báo cáo có đủ số đo ở bước 2. Ngưỡng cứng: 0 lỗi `schema`; không có watermark trong glossary. Token ra chỉ ghi
  nhận (nhiễu giữa các lần chạy lớn hơn 10 điểm), không làm ngưỡng.
- Link trong docs đã sửa đều mở được.
