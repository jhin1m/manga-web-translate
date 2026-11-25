---
title: "AI tự bổ sung glossary, xưng hô, giọng văn cho series"
description: "Bỏ luồng Nhận/Bỏ gợi ý: mỗi lô dịch xong, AI tự ghi thuật ngữ, cặp xưng hô mới và (khi còn trống) Giọng văn vào series, có nhãn AI."
status: in-progress
priority: P2
effort: 2.5d
branch: main
tags: [feature, translate, glossary, pronoun, worker, api, web, db]
blockedBy: []
blocks: []
created: 2026-11-24
---

# AI tự bổ sung trí nhớ series

## Overview

Hợp đồng đã chốt ở [brainstorm](../reports/brainstorm-261124-2039-auto-apply-series-memory.md). Plan này thay luồng gợi ý
của [261111-1925](../261111-1925-series-memory-glossary-pronoun-suggestions/plan.md) và đảo D4, D5 của plan đó.
Ghi chú ngữ cảnh (`carry`, `chapters.translate_memory`) đã tự động, giữ nguyên.

## Thiết kế

- `series_suggestions` thành **sổ khoá AI đã gặp**. Khoá gồm cặp ngôn ngữ: `"{src}>{tgt}|{termKey}"`. Khoá đã có trong
  sổ thì AI không ghi lại, nên mục AI mà người dùng xoá sẽ không quay lại. Migration thêm tiền tố ngôn ngữ cho khoá cũ.
  Mọi dòng cũ đều coi là đã gặp: gợi ý cũ chưa duyệt bị bỏ qua (người dùng chọn).
- Mọi việc ghi của AI chạy trong nhánh complete `chapter.translate` (chỉ một chương), không chạy ở `terminal` hay
  `advanceTranslateChain`: khoá chương → khoá dòng series (`FOR UPDATE`, lọc `user_id`) → thêm vào sổ → ghi entry
  glossary (`origin='ai'`), cặp xưng hô (`origin='ai'`), Giọng văn (khi trống và `style_origin` khác `'user'`) →
  `glossary_rev + 1`. **Không tăng `settings_rev`.**
- Chuỗi do AI viết được làm sạch (một dòng, bỏ ký tự điều khiển, cắt theo UTF-16) trước khi ghi.
- PATCH series: web mới luôn gửi `pronoun_keys_seen` và chỉ gửi trường đã đổi. Server giữ các cặp form chưa thấy, tự
  tính `origin`. Body kiểu cũ (tab chưa reload) chạy ở chế độ bảo vệ: không xoá cặp AI, không ghi rỗng đè Giọng văn AI.
- Web: bỏ danh sách gợi ý, nút Nhận/Bỏ, badge đếm. Thêm nhãn "AI" ở dòng glossary, dòng xưng hô và Giọng văn.

## Quyết định tự chốt

| # | Quyết định | Lý do |
|---|---|---|
| P1 | Gợi ý cũ không được áp; mọi dòng cũ thành khoá đã gặp | Người dùng chọn. Bản cũ không phân biệt được "chờ duyệt" với "đã Nhận rồi xoá" |
| P2 | AI chỉ khoá series trong nhánh complete; DELETE series khoá các chương (theo id) trước khi xoá series | Reaper và claim gọi `terminal` cho nhiều chương trong một transaction (`reaper.ts:15-27`); khoá series ở đó gây deadlock |
| P3 | Trần: tối đa 200 entry `origin='ai'` còn sống trong glossary series; `pronoun_rules` tổng ≤ 200; 5 thuật ngữ, 3 cặp mỗi lô | Trần trên mục còn sống thì series dài vẫn học tiếp; sổ tự nó không có trần |
| P4 | `origin` không vào prompt: `translateSettings` chỉ đưa `speaker/listener/address/note` | Giữ prompt như cũ |
| P5 | Giọng văn ghi ngay khi lô đầu có `style_note`, không chờ hết chương | Ghi ở complete tránh deadlock (P2); lô sau thấy ô đã có chữ nên không hỏi nữa |
| P6 | Worker 0.13.0, `MIN_PIPELINE_VERSION` giữ nguyên; không thêm cờ vào payload | Người dùng chấp nhận tốn ~50–80 token/lô khi cố ý để trống Giọng văn |
| P7 | Giữ `GET /series/:id/suggestions` trả danh sách rỗng trong một bản | Tab web cũ chưa reload không bị lỗi 404 |

## Phases

| # | Phase | File sở hữu | Phụ thuộc | Effort | Status |
|---|---|---|---|---|---|
| 1 | [Hợp đồng + DB](./phase-01-contract-and-db.md) | `packages/shared/**`, `packages/db/**` | — | 2h | Completed |
| 2 | [Worker: style_note](./phase-02-worker-style-note.md) | `worker/**` | 1 | 3h | Completed |
| 3 | [API: tự áp](./phase-03-api-auto-apply.md) | `apps/api/**` | 1 | 7h | Completed |
| 4 | [Web: nhãn AI, bỏ Nhận/Bỏ](./phase-04-web-auto-labels.md) | `apps/web/**` | 3 | 5h | Completed |
| 5 | [Docs + smoke LLM thật](./phase-05-docs-and-real-llm-smoke.md) | `docs/**`, `plans/…/reports/` | 2, 3, 4 | 2h | In progress (docs xong, smoke chờ ảnh nguồn) |

Phase 2 và 3 chạy song song được sau phase 1 (không chung file).

## Success Criteria

Bảy tiêu chí ở [brainstorm](../reports/brainstorm-261124-2039-auto-apply-series-memory.md#hợp-đồng), với tiêu chí 3 sửa
thành "điền Giọng văn ở lô đầu có `style_note`" (P5), cộng:

- [ ] Gợi ý cũ không được áp, và khoá của chúng không được AI ghi lại.
- [ ] Lưu form trong lúc AI vừa thêm cặp xưng hô hoặc điền Giọng văn không làm mất chúng, kể cả từ tab web cũ.
- [ ] Không deadlock khi complete chạy song song với reaper (2 job cùng series) hoặc với DELETE series.
- [ ] Smoke LLM thật: 0 lỗi `schema`; chương 2 dùng đúng tên AI ghi từ chương 1; có số đo token vào và ra.

## Rollback

Revert web → API → worker. DB chỉ thêm cột (nullable hoặc có default) và đổi khoá sổ, nên rollback app riêng vẫn chạy.
Hệ quả đã biết khi về API cũ:
- Chưa chạy file down: mọi dòng sổ chưa Bỏ hiện lại thành gợi ý chờ duyệt, kể cả mục AI đang có trong glossary
  (bấm Nhận ra 409), vì khoá có tiền tố ngôn ngữ không khớp khoá API cũ tính. Đã chạy file down: chỉ mục AI người dùng
  đã xoá hiện lại.
- API cũ đưa nguyên `pronoun_rules` vào prompt, nên `"origin"` của từng cặp lọt vào prompt cho tới khi chạy file down
  hoặc lưu lại form ở bản cũ (zod cũ bỏ `origin`, đồng thời mất nhãn AI).

Gỡ hẳn thì chạy `packages/db/migrations-down/0030_auto_apply_series_memory.down.sql`. File này bỏ cột và bỏ tiền tố khoá.

## Red Team Review

### Session — 2026-11-24
**Findings:** 20 (18 accepted, 2 rejected) · **Severity:** 0 Critical, 6 High, 14 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---|---|---|---|
| 1 | Reaper/claim khoá nhiều chương trong một tx; khoá series ở đóng lượt gây deadlock | High | Accept | P2, P5, Phase 3 |
| 2 | DELETE series khoá series rồi cascade chương | Medium | Accept | P2, Phase 3 |
| 3 | Trần 200 trên cả sổ làm AI ngừng học vĩnh viễn | High | Accept | P3, Phase 3 |
| 4 | Gợi ý cũ đã Nhận rồi xoá không phân biệt được với chờ duyệt | High | Accept (người dùng chọn bỏ qua) | P1, Phase 1, 3 |
| 5 | Tab web cũ xoá cặp AI và Giọng văn AI | Medium | Accept | Phase 3 bước 4, P7 |
| 6 | Form gửi diff rỗng → 400 | High | Accept | Phase 4 |
| 7 | Mốc diff bị làm mới 5 giây một lần | Medium | Accept | Phase 4 |
| 8 | Gộp xưng hô vượt 200; khoá chưa chuẩn hoá; sửa `note` vẫn giữ nhãn AI | Medium | Accept | Phase 3, 4 |
| 9 | Chỉ thị chèn từ OCR ghi bền vào chỗ ưu tiên tuyệt đối | High | Accept (làm sạch); Reject kênh ưu tiên riêng (ngoài phạm vi) | Phase 2, 3 |
| 10 | Cắt `style_note` theo ký tự, zod đếm UTF-16 | Medium | Accept | Phase 2 |
| 11 | Thiếu file provider, `pnpm schema:emit`, `strict_schema` | Medium | Accept | Phase 1, 2 |
| 12 | Khoá `PATCH` cần lọc `user_id`; insert cần `user_id` | Medium | Accept | Phase 3 |
| 13 | Sổ không có cặp ngôn ngữ | Medium | Accept | Phase 1, 3 |
| 14 | Sót `chapters.test.ts:659`, `docs/export-and-batch-edit.md`, POST `/series` | Medium | Accept | Phase 3, 5 |
| 15 | Không có invalidate glossary khi dịch xong | Medium | Accept | Phase 4 |
| 16 | Smoke chỉ đo token ra, một mẫu | Medium | Accept | Phase 5 |
| 17 | Mục Rollback mô tả sai API cũ | Medium | Accept | Rollback |
| 18 | `want_style` lệch điều kiện ghi, tốn token | Medium | Reject (người dùng chấp nhận chi phí) | P6, Phase 2 Risk |
| 19 | Đánh `dismissed_at` khi xoá mục AI để rollback sạch | Medium | Reject (chỉ có ích khi rollback; ghi vào Rollback) | Rollback |
| 20 | Token vào tăng theo glossary AI | High | Accept (đo + trần P3) | P3, Phase 5 |

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01 … phase-05
- Decision deltas checked: 9 (bỏ `applied_at`, khoá có tiền tố ngôn ngữ, Giọng văn ghi ở complete, không sửa
  `translate-chain.ts`, trần trên mục sống, chế độ bảo vệ PATCH, GET gợi ý rỗng, style_note luôn trong schema, đo token vào)
- Reconciled stale references: 7
- Unresolved contradictions: 0

## Validation Log

### Session 1 — 2026-11-24
- Q: Áp phát hiện red-team? → Áp hết.
- Q: Gợi ý cũ khi nâng cấp? → Bỏ qua (P1).
- Q: Giọng văn khi người dùng cố ý để trống? → Chấp nhận tốn token, không bắt nâng worker (P6).
