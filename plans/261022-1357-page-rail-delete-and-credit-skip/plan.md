---
title: "Rail ảnh gốc, xoá ảnh/trang, tự bỏ credit + watermark"
description: "Rail trái hiện ảnh gốc ngay khi upload; xoá (bỏ qua, hoàn tác được) ảnh trước Bước 1 và trang sau Bước 1/2; tự bỏ ảnh credit học theo series + gợi ý kích thước; bỏ dịch watermark chữ theo danh sách series."
status: completed
priority: P1
effort: "5-6d"
tags: [web, api, db, worker, upload, export, ux]
created: 2026-10-22
---

# Rail ảnh gốc, xoá ảnh/trang, tự bỏ credit + watermark

## Overview
Nguồn: [brainstorm report](../reports/brainstorm-261022-2049-page-rail-delete-and-credit-skip-report.md) (user đã duyệt).
Một khái niệm **"bỏ qua"** (soft, hoàn tác được) cho cả xoá tay lẫn tự loại:
`source_files.skip` (trước Bước 1) và `pages.skipped` (sau Bước 1). Không xoá cứng hàng/object nào.

## Quyết định đã chốt (user, 2026-10-22)
1. Trước Bước 1 rail hiện **ảnh gốc** ("Ảnh n") + bấm xem lớn ở canvas; bỏ lưới `SourcePreview`.
2. Xoá sau xử lý = **ẩn, khôi phục được**; Bước 2/dịch lại/xuất bỏ trang ẩn.
3. Rác cần bỏ: ảnh credit nguyên tấm + watermark chữ trong trang.
4. Nhận diện: hash học theo series + gợi ý theo kích thước + danh sách chữ bỏ qua. **AI phân loại: đợt sau.**
5. Watermark khớp: xoá sạch (Bước 1 đã inpaint), không dịch, không box.
6. Ảnh tự loại trước Bước 1: mờ + nhãn "Credit · tự bỏ" + icon khôi phục.
7. Học credit: toast sau khi xoá "Đã xoá … · Hoàn tác · Luôn bỏ ở series này"; quản lý ở cài đặt series.
8. UI tối giản: icon Xoá/Khôi phục trên mục rail, không nút "bước tiếp theo".

## Phases
| # | Phase | Phụ thuộc | Status |
|---|-------|-----------|--------|
| 1 | [API + DB: bỏ qua ảnh gốc trước Bước 1](./phase-01-start.md) | — | Done |
| 2 | [Web: rail ảnh gốc, xem lớn, xoá/hoàn tác](./phase-02-web-rail-anh-goc.md) | 1 | Done |
| 3 | [Ẩn trang sau Bước 1/2 (API, export, web)](./phase-03-an-trang-sau-xu-ly.md) | 2 | Done |
| 4 | [Tự bỏ ảnh credit (hash series + gợi ý kích thước)](./phase-04-tu-bo-anh-credit.md) | 3 | Done |
| 5 | [Watermark chữ: danh sách bỏ qua theo series](./phase-05-watermark-chu.md) | 1 | Done |
| 6 | [Docs + hồi quy toàn luồng](./phase-06-docs-va-hoi-quy.md) | 1–5 | Done |

Chạy **tuần tự** 1→6: mỗi phase có migration (journal drizzle tuần tự) và e2e dùng chung DB/cổng. File chung:
`chapter-workspace.tsx` (P2, P3), `page-rail.tsx` (P2, P3, P4), `chapters.ts` route (P1, P4), `series.ts` route (P4, P5),
`series-settings-form.tsx` (P4, P5), `claim-inputs.ts` (P1, P3, P5).

## Quy tắc mỗi phase (TDD)
- Tests Before (khoá hành vi cũ) → Refactor/Implement → Tests After (hành vi mới) → Regression Gate.
- Branch `feat/skip-pN-*` từ `main` mới nhất; commit conventional, không nhắc AI/plan/phase trong code/test/commit.
- Gate chung: `pnpm typecheck && pnpm lint && pnpm test` (cần `pnpm infra:up`) + spec e2e bị chạm
  (`pnpm --filter @mtl/web e2e <spec>`); phase chạm worker thêm `cd worker && uv run pytest`.
- Migration: `pnpm db:generate` → sửa tên file mô tả hành vi (không số phase) → `pnpm db:migrate`.
- Đổi schema payload/inputs job → `pnpm schema:emit` + `worker/tests/test_contract_schema.py` xanh.

## Success Criteria
- [x] Thả 96 ảnh → rail hiện 96 "Ảnh n" ngay khi đang tải; bấm → canvas hiện ảnh lớn; ←/→ chuyển ảnh.
- [x] Xoá ảnh trước Bước 1 → Bước 1 không ghép ảnh đó; Hoàn tác khôi phục; tải tiếp (resume) vẫn khớp bộ file.
- [x] Ẩn trang sau Bước 1 → Bước 2 không dịch trang đó; xuất `pages` và `original_slices` đều thành công.
- [x] "Luôn bỏ ở series" ở chương N → chương N+1 có credit giống hiện "Credit · tự bỏ" trước Bước 1.
- [x] Ảnh đầu/cuối lệch width > 10% trung vị có nhãn "Có thể là credit".
- [x] Từ khoá "discord.gg" trong series → vùng chứa không có trong bảng, không box, không gửi LLM.
- [x] Gate chung xanh trên `main` sau P6.

## Kết quả hồi quy (2026-10-22, `main` sau P5)
- Gate: typecheck + lint + test xanh (API 176, web 165, shared 17, db 3); e2e toàn bộ 26/26; worker pytest 160/160.
- Kiểm tay tự động bằng chương mẫu thật 96 ảnh (`atsu…Chapter_58`, fake worker, spec tạm không commit):
  1. Thả 96 ảnh ở màn series → màn chương sau ~0.35s (gồm tính hash), rail 96 "Ảnh n" khi đang tải; Ảnh 5 → canvas,
     → sang Ảnh 6. Ảnh cuối 4036px rộng có nhãn "Có thể là credit" (1 gợi ý duy nhất).
  2. Xoá Ảnh 96 → "Luôn bỏ ở series này" → "Đã học 1 ảnh".
  3. Thả lại cùng bộ → đúng 1 ảnh "Credit · tự bỏ" (Ảnh 96); Bước 1 → 95 trang (credit không ghép).
  4–6. Ẩn/khôi phục trang, Bước 2 bỏ trang ẩn, xuất `pages`/`original_slices` có trang ẩn, watermark không gửi LLM:
     phủ bằng e2e `chapter-tools` + API `chapters.test.ts` + worker `test_export` (không chạy worker LLM thật).

## Ngoài phạm vi
AI phân loại credit; regex; áp watermark ngược cho chương đã dịch; logo watermark dạng hình; đổi thứ tự ảnh;
tự xử lý credit cùng width đã dính vào page lớn sau Bước 1.

## Câu hỏi còn mở
- ~~Ngưỡng dHash~~ — đã chốt ở P4 (Hamming ≤ 6, tỉ lệ khung ≤ 5%; 0 khớp nhầm trên chương mẫu 96 ảnh).

## Validation Log

### Session 1 — 2026-10-22
**Trigger:** `/ak:plan validate` sau khi tạo plan.
**Questions asked:** 3

#### Verification Results
- **Tier:** Full (6 phase) · **Claims checked:** 46 · **Verified:** 43 | **Failed:** 3 | **Unverified:** 0
- Đã kiểm: mọi đường dẫn file/test/e2e/docs; `assertChapterLock` (`lib/chapter-lock.ts:57`); điều kiện commit
  `ingestFailed` (`chapters.ts:233`); ingest claim (`claim-inputs.ts:122`); `translatePrepared` so `rows.length`
  (`enqueue.ts:420`); `refreshChapter` (`enqueue.ts:435`); `pageLines` lọc `empty` (`claim-inputs.ts:95`) + stage 2
  worker lọc `empty` (`pipeline.py:200`); `translationChanged` bump `settings_rev` (`series.ts:298`); worker ingest bỏ qua
  width/height input (`mtl_worker/ingest.py`) → kích thước client gửi không ảnh hưởng cắt trang.
- Failures (đã sửa, user đồng ý):
  1. [Fact Checker] `no_pages` khi xuất ở `jobs/enqueue.ts:369` (`enqueueExport`), không phải `routes/export.ts`.
  2. [Fact Checker] Áp glossary ở `routes/find-replace.ts:293-301` (`glossary-apply/*`), không phải `routes/glossary.ts`.
  3. [Contract Verifier] Thiếu `neighborLines` (`claim-inputs.ts:100`) và route `/translate` (`chapters.ts:322`) khi
     lọc page skipped.

#### Questions & Answers
1. **[Verification]** Sửa 3 lỗi ở Phase 3 (đường dẫn `enqueue.ts:369`, `find-replace.ts`; lọc `neighborLines`;
   `/translate` no_pages)?
   - Options: Đồng ý sửa | Để nguyên
   - **Answer:** Đồng ý sửa
   - **Rationale:** Không có `neighborLines` thì trang đã ẩn (vd. credit) lọt vào ngữ cảnh dịch trang bên cạnh.
2. **[Architecture/UX]** Sau khi ẩn trang 3, các trang còn lại đánh số thế nào trên UI?
   - Options: Giữ số gốc 1,2,4… | Đánh số lại 1,2,3…
   - **Answer:** Giữ số gốc 1,2,4…
   - **Rationale:** Nhất quán với bảng văn bản, Tìm/Thay, thông báo (đều dùng `ord + 1`); không phải sửa mọi chỗ hiển
     thị. Thay cho dòng "đánh số lại theo trang còn hiện" trong brainstorm report.
3. **[Tradeoff]** Tính dHash lúc thả ảnh cho bao nhiêu ảnh?
   - Options: Mọi ảnh, đo rồi mới giảm | Chỉ 5 đầu + 5 cuối | Mọi ảnh, chạy nền
   - **Answer:** Mọi ảnh, đo rồi mới giảm
   - **Rationale:** Bắt cả quảng cáo giữa chương; > 1.5s/96 ảnh mới rút về 5 đầu + 5 cuối.

#### Confirmed Decisions
- Số trang UI: giữ số gốc; chỉ bộ đếm và "Trang i/n" đếm trang không skipped; xuất `pages` đánh số liên tục.
- Hash: mọi ảnh mặc định, ngưỡng thời gian 1.5s.
- `ignore_text` đổi → tăng `glossary_rev`, không tăng `settings_rev` (đã kiểm: `settings_rev` nằm trong khoá prepare,
  tăng sẽ làm thử lại trang lỗi chạy lại Bước 1).

#### Impact on Phases
- Phase 3: Related Code Files, Requirements (neighborLines, `/translate`, `enqueueExport`, find-replace, số trang gốc),
  Tests After (context neighbors, preview find/glossary, nhãn rail).
- Phase 4: Requirements (hash mọi ảnh), chỗ dọn prefix khi xoá series (`routes/series.ts:307`).

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01-start.md, phase-02-web-rail-anh-goc.md, phase-03-an-trang-sau-xu-ly.md,
  phase-04-tu-bo-anh-credit.md, phase-05-watermark-chu.md, phase-06-docs-va-hoi-quy.md
- Decision deltas checked: 5 (đường dẫn no_pages, glossary-apply, neighborLines, số trang gốc, phạm vi hash)
- Reconciled stale references: 4 (`routes/export.ts`, `routes/glossary.ts`, "Nhãn Trang n = thứ tự trang hiện",
  `lib/chapter-removal.ts` cho dọn series)
- Unresolved contradictions: 0

<!-- slug: page-rail-delete-and-credit-skip -->
