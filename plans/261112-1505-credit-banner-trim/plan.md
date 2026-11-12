---
title: "Cắt credit banner ở mép ảnh gốc"
description: "Cắt tay dải credit dính ở mép trên/dưới ảnh gốc trước Bước 1; học dải theo series và tự cắt ở chương sau."
status: in-review
priority: P1
effort: "5d"
tags: [web, api, db, worker, upload, export]
created: 2026-11-12
---

# Cắt credit banner ở mép ảnh gốc

## Overview
Banner credit/quảng cáo thường dính ở **đầu ảnh đầu / cuối ảnh cuối** chương, chung một file với trang truyện. Hiện chỉ
xoá được cả ảnh (`source_files.skip`) hoặc ẩn cả trang (`pages.skipped`) → mất luôn phần truyện.
Giải pháp: cắt mép trên/dưới ảnh gốc **trước Bước 1** (chương nháp, sau khi thả ảnh, trước "Dịch chương"); file gốc giữ
nguyên, cắt là dữ liệu kèm ảnh nên hoàn tác được. Đợt 2: "Luôn cắt ở series này" → chương sau tự cắt.

## Quyết định đã chốt (user, 2026-11-12)
1. Cắt ở màn chương ngay sau khi thả ảnh (canvas xem ảnh gốc), không cắt trong editor sau Bước 1.
2. Chỉ cắt mép trên + mép dưới mỗi ảnh. Banner vắt qua 2 ảnh = cắt đáy ảnh N + đỉnh ảnh N+1.
3. Làm cả đợt 1 (cắt tay) và đợt 2 (học + tự cắt).
4. Không làm: cắt sau Bước 1, cắt dải giữa ảnh, AI phát hiện banner.

## Phát hiện từ code (quyết định kỹ thuật)
- **Export `original_slices` không đọc file gốc**: `SliceAssembler` (`worker/mtl_pipeline/render.py:275`) dựng buffer
  slice cao `max(src_y + h)` từ ảnh page đã render. ⇒ worker cắt slice **trước** `build_pages`, `source_map.src_y` tính
  theo ảnh **đã cắt** (bắt đầu 0) → bản xuất tự không còn banner, `render.py` không đổi. (Đảo lại ý "toạ độ ảnh gốc"
  ở buổi tư vấn — toạ độ gốc sẽ để dải đen ở đầu slice xuất ra.)
- `src_y` không được dùng ở chỗ khác (API chỉ dùng `source_file_id` của `source_map`).
- Schema worker strict (`additionalProperties: false`) → thêm `sources[].trim` làm worker cũ fail job ⇒ tăng worker
  `PIPELINE_VERSION` + API `MIN_PIPELINE_VERSION` lên `0.12.0`. API `PIPELINE_VERSION` (muối) giữ nguyên.
- `ingestKey` (`apps/api/src/jobs/idempotency.ts:21`) chỉ băm id ảnh → thêm trim vào chuỗi băm (ảnh không cắt giữ
  nguyên chuỗi cũ).

## Phases
| # | Phase | Phụ thuộc | Effort | Status |
|---|-------|-----------|--------|--------|
| 1 | [API + DB + worker: `source_files.trim`](./phase-01-api-worker-trim.md) | — | 1d | Completed |
| 2 | [Web: cắt mép ảnh gốc](./phase-02-web-trim-ui.md) | 1 | 1.5d | Completed |
| 3 | [Học dải banner theo series](./phase-03-learn-series-banner.md) | 2 | 1d | Completed |
| 4 | [Tự cắt khi thả ảnh](./phase-04-auto-trim-on-drop.md) | 3 | 1d | Completed |
| 5 | [Docs + hồi quy](./phase-05-docs-regression.md) | 1–4 | 0.5d | Completed (còn kiểm tay) |

Chạy **tuần tự**: P1, P3 có migration (journal drizzle tuần tự); file chung `source-rail.tsx`, `source-viewer.tsx`
(P2, P4), `series-skip-images.ts` (P1, P3), `chapters.ts` route (P1, P4), `upload-manager.ts` (P4).
Không chồng plan đang mở (đã quét `plans/` 2026-11-12).

## Quy tắc mỗi phase
- Tests trước khi đổi hành vi; branch `feat/trim-*` từ `main`; commit conventional, không nhắc plan/phase/AI.
- Gate: `pnpm typecheck && pnpm lint && pnpm test` (cần `pnpm infra:up`) + e2e bị chạm
  (`pnpm --filter @mtl/web e2e <spec>`); phase chạm worker: `cd worker && uv run pytest`.
- Migration: `pnpm db:generate` → đổi tên file mô tả hành vi → `pnpm db:migrate`.
- Đổi inputs job → `pnpm schema:emit` + `worker/tests/test_contract_schema.py` xanh.

## Success Criteria
- [x] Thả chương có banner cuối ảnh cuối → "Cắt mép" kéo thanh dưới → "Dịch chương" → trang cuối không còn banner.
- [x] Xuất "Giống lúc tải lên" và "Theo trang đã cắt" đều không có banner; slice đã cắt cao đúng `H − top − bottom`.
- [x] "Bỏ cắt" / "Hoàn tác" trả ảnh về nguyên vẹn trước Bước 1.
- [x] "Luôn cắt ở series này" ở chương N → chương N+1 cùng banner hiện "Credit · tự cắt", cắt đúng mép.
- [x] Worker < 0.12.0 nhận 426 khi claim (không có job fail im lặng).
- [ ] Gate chung xanh trên `main` sau P5. _(branch xanh trừ `block-panel.spec.ts:317` — đỏ sẵn trên `main` d6c6ebb, 3/3)_

## Rủi ro chính
- Phải lên worker Mac / Modal / self-host cùng lúc deploy API (MIN 0.12.0) — theo quy trình rc → smoke → tag.
- Tính hash dải ở trình duyệt từ URL ký: self-host phục vụ `/files/…` cùng origin (`disk-driver.ts`) nên không cần
  CORS; bản hosted cần CORS GET của MinIO cho domain app (đã bật `MINIO_API_CORS_ALLOW_ORIGIN`) — kiểm ở P3.
- Banner cùng mẫu nhưng chiều cao lệch (thêm lề trắng) → không khớp tự cắt; người dùng vẫn cắt tay được.

## Phát hành
Làm xong cả 5 phase rồi phát hành **một lần** (user chốt 2026-11-12): một lần nâng worker lên 0.12.0, theo quy trình
rc → smoke → tag cùng commit → GitHub Release. Không phát hành riêng đợt 1.

## Câu hỏi còn mở
- Không có.

## Validation Log

### Session 1 — 2026-11-12
**Trigger:** `/ak:plan validate` sau khi tạo plan.
**Questions asked:** 3

#### Verification Results
- Claims checked: 25 (file, symbol, test, spec, schema)
- Verified: 25 | Failed: 0 | Unverified: 0
- Tier: Full (5 phase)
- Đã xác nhận: `SliceAssembler` dựng slice từ page (`render.py:275`); `src_y` chỉ dùng ở export; worker kiểm
  inputs strict (`runner.py:328` + `inputs-chapter-ingest.schema.json` `additionalProperties: false`);
  `assertSourcesEditable`, `sourceFileView`, `SourceSkipBody` ở `chapters.ts`; GET source-files ở `pages.ts:62`;
  self-host phục vụ file cùng origin (`storage-drivers/disk-driver.ts`).
- Sửa 1 rủi ro: CORS chỉ còn liên quan bản hosted (đã cập nhật mục Rủi ro + phase 3).

#### Questions & Answers
1. **Khớp banner đã học khi thả ảnh** → **Tự cắt luôn** (cờ "Credit · tự cắt", bỏ được trước Bước 1). Giữ P4 như viết.
2. **Worker cũ** → **Bắt buộc 0.12.0** (426 cho worker cũ). Giữ P1 như viết.
3. **Phát hành** → **Làm xong cả 2 đợt rồi phát hành một lần**. Thêm mục "Phát hành"; P5 ghi lưu ý phát hành.

#### Whole-Plan Consistency Sweep
- Đã đọc lại `plan.md` + 5 phase: không còn chỗ nói "toạ độ ảnh gốc" cho `src_y`; trim `by` chỉ lưu DB, không gửi
  worker (P1) khớp P4 (`by: "credit"`); `MIN_TRIM_KEEP_PX` dùng thống nhất ở P1/P2/P4; `edge` (P3) khớp lọc ở P4.
- Unresolved: 0.

## Kết quả hồi quy (2026-11-12, branch `feat/trim-credit-banner`)
- typecheck + lint (481 file) xanh. Unit: shared 124, db 8, web 515, api 727 (1 skip môi trường pg_dump, có sẵn),
  worker 421 — xanh.
- e2e 118/119: lỗi duy nhất `block-panel.spec.ts:317` — cũng đỏ 3/3 trên `main` (d6c6ebb), không liên quan branch;
  chưa điều tra nguyên nhân.
- Tiêu chí 1–5 được phủ bằng test tự động (worker export slice, API 426, e2e `trim-source`, `trim-learn-band`,
  `trim-auto-drop` gồm học ở chương này → khớp chương khác, khác hình phía trên, bề rộng 720↔800 Hamming 0).
- Review từng phase: P1 8.5, P2 8, P3 7.5, P4 5 → đã sửa H1 (dấu dải lẫn pixel ngoài dải); mọi Medium đã sửa.
  Chi tiết: `reports/code-review-phase-0*-report.md` (mục "Fixes applied"), `reports/tester-261112-trim-regression-gate-report.md`.
- **Còn kiểm tay trước khi phát hành:** Safari/Firefox (kéo thanh, dấu dải), màn cảm ứng thật, ảnh webtoon 720×15000,
  chương mẫu thật có banner (cắt → Luôn cắt → chương sau tự cắt → xuất 2 kiểu, mở file), CORS MinIO bản hosted (prod).
- Dải học trước `af4bf70` (dev/QA) phải học lại (đổi cách tính dấu dải); chưa phát hành nên không ảnh hưởng người dùng.
- Ghi chú phát hành: `docs/deployment-guide.md` mục 0.12.0; `docs/releases/` thêm khi chốt số phiên bản rc.
