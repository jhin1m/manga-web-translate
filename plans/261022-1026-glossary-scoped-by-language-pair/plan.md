---
title: "Glossary scoped by language pair"
description: "Glossary chung (cấp workspace) tách theo cặp nguồn→đích; series chỉ nhận entry chung đúng cặp. Glossary riêng series vẫn áp, form cài đặt cảnh báo khi đổi ngôn ngữ."
status: completed
priority: P1
effort: "1d"
tags: [api, db, web, glossary, i18n]
created: 2026-10-22
---

# Glossary scoped by language pair

## Overview

Sửa M3 trong `../261022-0918-series-language-and-page-format/reports/code-review-series-language-report.md`:
`translateSettings` (`apps/api/src/jobs/enqueue.ts`) và `glossaryRules` (`apps/api/src/routes/find-replace.ts`)
gộp **mọi** entry workspace (`series_id IS NULL`) vào mọi series. Từ khi series chọn được đích ≠ vi, series ko→en
nhận `회장 → chủ tịch` và prompt ghi "bắt buộc dùng đúng" → ép chữ Việt vào bản dịch Anh.

## Quyết định đã chốt (user, 2026-10-22)

1. **Entry chung chia theo cặp ngôn ngữ.** Entry workspace có `source_lang` + `target_lang` bắt buộc; series chỉ
   nhận entry chung có đúng cặp `(series.source_lang, series.target_lang)`. Không có khái niệm "áp mọi cặp".
   Trang Glossary chung có bộ chọn cặp. Backfill entry chung cũ = `ko→vi` (trước 0.4.0 API chỉ cho ko→vi).
2. **Entry riêng series không gắn ngôn ngữ**, vẫn áp khi series đổi ngôn ngữ. Form Cài đặt series cảnh báo
   (không chặn) khi đổi nguồn/đích mà glossary riêng của series không trống.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Schema + migration](./phase-01-start.md) | Done |
| 2 | [Phase 2: API glossary, translate, apply](./phase-02-api-and-db.md) | Done |
| 3 | [Phase 3: Web bộ chọn cặp + cảnh báo](./phase-03-web-glossary-pair-and-warnings.md) | Done |
| 4 | [Phase 4: Docs + hồi quy](./phase-04-docs-and-regression.md) | Done |

Phụ thuộc tuần tự 1 → 2 → 3 → 4 (web cần contract API mới).

## Success Criteria

- [x] Series ko→en không nhận entry chung ko→vi trong `chapter.translate` (payload `settings.glossary`) và trong
      `glossary-apply` (term khác cặp → 400 `unknown_terms`).
- [x] Cùng `source_term` tồn tại được ở hai cặp khác nhau; trùng trong một cặp → 409 `duplicate_term`.
- [x] Sửa entry chung vẫn tăng `glossary_rev` mọi series của workspace (giữ hành vi cũ, tránh race — red team #1);
      migration tăng `glossary_rev` cho series khác ko→vi để "Dịch lại" không dùng lại job cũ.
- [x] Migration 0006 chỉ thêm (không CHECK) → rollback app không cần down DB như `docs/deployment-guide.md`.
- [x] Route glossary workspace thiếu/sai cặp → 400; CSV import `replace` chỉ xoá entry của cặp đang chọn.
- [x] Series ko→vi hiện có: payload dịch giống hệt trước (entry chung cũ đã backfill ko→vi).
- [x] Trang Glossary chung đổi cặp được (giữ trong URL); form Cài đặt hiện cảnh báo khi đổi ngôn ngữ + có glossary riêng.
- [x] `pnpm --filter @mtl/db test`, `pnpm --filter @mtl/api test`, `pnpm --filter @mtl/web test`,
      `pnpm --filter @mtl/web e2e`, `pnpm typecheck`, `pnpm lint` xanh.
- [x] Docs cập nhật; M3 trong plan trước đánh dấu đã xử lý.

## Ngoài phạm vi

- Chuyển entry giữa các cặp, sao chép glossary sang cặp khác.
- Cột cặp ngôn ngữ trong CSV (CSV vẫn 4 cột; cặp lấy từ phạm vi đang import/export).
- L2 (`page.ocr_region` bỏ qua glossary series) — giữ nguyên.

## Red Team Review

### Session — 2026-10-22
**Findings:** 11 (10 accepted, 1 rejected) · **Severity:** 3 High, 8 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Tăng `glossary_rev` theo cặp race với PATCH đổi ngôn ngữ → job trùng key dùng glossary cũ | High | Accept | Phase 2, plan |
| 2 | CHECK `pair_chk` không additive → API cũ (cửa sổ deploy / smoke rollback) 500 | High | Accept (bỏ mọi CHECK, API đảm bảo) | Phase 1, 4 |
| 3 | `generate -- --name` bị drizzle-kit từ chối | High | Accept | Phase 1 |
| 4 | File down thiếu xoá dòng `drizzle.__drizzle_migrations` → kiểm down+up giả | Medium | Accept | Phase 1 |
| 5 | Lưu cặp mới không invalidate glossary series → kế thừa cũ dưới nhãn mới | Medium | Accept | Phase 3 |
| 6 | Helper lọc thiếu `workspace_id`, `translateSettings` đọc DB thô → nguy cơ lộ chéo tenant | Medium | Accept | Phase 2 |
| 7 | Deploy thu hẹp glossary series khác ko→vi mà không tăng rev | Medium | Accept | Phase 1 |
| 8 | CHECK ngôn ngữ ở DB lệch khi shared thêm ngôn ngữ | Medium | Accept (gộp #2) | Phase 1 |
| 9 | Ràng buộc DB không có test | Medium | Accept (test API cho unique theo cặp) | Phase 2 |
| 10 | Danh sách test sai (thiếu `find-replace.test.ts:228`, tenant-isolation route table không cần sửa, test 400 pass sai lý do) | Medium | Accept | Phase 2 |
| 11 | Mọi member sửa/replace được glossary chung | Medium | Reject — có từ trước, ngoài phạm vi (ma trận quyền sau) | — |

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01-start.md, phase-02-api-and-db.md, phase-03-web-glossary-pair-and-warnings.md, phase-04-docs-and-regression.md
- Decision deltas checked: 6 (không CHECK DB; rev bump giữ toàn workspace; helper kèm workspace; migration bump rev; lệnh generate; invalidate glossary web)
- Reconciled stale references: 4 (tiêu chí rev trong plan.md; CHECK/inList ở Phase 1; "packages/db/test nếu có"; bảng route tenant-isolation + worker-helpers ở Phase 2)
- Unresolved contradictions: 0

<!-- slug: glossary-scoped-by-language-pair -->

## Kết quả (2026-10-22)

- Hoàn thành 4 phase; db 3, api 160, web unit 148, e2e 24 test xanh; `pnpm typecheck`, `pnpm lint` sạch.
- Review: `reports/code-review-glossary-lang-pair-report.md` — 0 Critical/High. Đã xử lý M1 (docs cảnh báo CSV
  "thay toàn bộ" khi rollback app qua 0006) và L1 (file down ưu tiên giữ bản ko→vi). Bỏ qua L2 (hành vi đúng nhờ
  unique DB), L3 (ngoài phạm vi: `chapters.ts` tự parse query).
- Smoke Phase 4 bước 3 thay bằng test API: series ko→vi nhận đúng glossary như trước (`glossary.test.ts`,
  `chapters.test.ts` dịch lại sau đổi glossary).
