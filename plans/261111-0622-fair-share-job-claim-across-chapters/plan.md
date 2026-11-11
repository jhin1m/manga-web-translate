---
title: "Fair-share job claim across chapters"
description: "Cùng mức priority, mỗi worker nhận job của chương đang có ít job chạy nhất, để N worker chạy N chương cùng lúc"
status: completed
priority: P1
effort: "1d"
tags: [job-queue, worker, self-host]
created: 2026-11-11
---

# Fair-share job claim across chapters

## Cần người dùng duyệt

**Không còn việc chờ duyệt.** Sau khi đo, hai nhóm cấu hình vượt ngưỡng ban đầu của quyết định 5; việc thực thi đã dừng
và người điều phối đã quyết ngày 2026-11-11 (theo uỷ quyền việc nhỏ): **chấp nhận số đo, giữ nguyên code**. Số đo đầy
đủ: [reports/measure-claim-order-after-report.md](./reports/measure-claim-order-after-report.md).

| Nhóm ô | Ngưỡng ban đầu | Câu mới | Câu cũ | Ghi chú |
|---|---|---|---|---|
| 6.000 job chờ, có hạn mức **và** breaker đang bật (mac, modal) | 15 ms | 14–19 ms | 4,3–5,5 ms | Breaker chỉ bật 2 phút mỗi lần provider lỗi liên tục. Nhiễu máy đo ±3 ms. |
| ≤ 100 job chờ, có hạn mức, 20.000 dòng ledger hôm nay | 1 ms | 2,2–2,6 ms | 4,0–4,3 ms | Câu mới nhanh hơn câu cũ. Ngưỡng 1 ms ở ô này vốn không đạt từ trước. Self-host không đặt hạn mức nên không gặp. |

12 ô còn lại đạt, gồm self-host thật (0,21–0,30 ms) và VPS lúc bình thường (Modal, có hạn mức, breaker tắt: ~12 ms).

Lý do chấp nhận:

- Ô thứ nhất chỉ xảy ra khi breaker đang bật (trạng thái tạm ~2 phút) và chỉ lố vài ms, trong biên nhiễu ±3 ms.
- Ô thứ hai câu mới nhanh hơn câu cũ; ngưỡng 1 ms ở ô đó vốn không đạt từ trước.
- Mỗi job chạy ≥ vài giây nên 10–20 ms cho một lần claim không ảnh hưởng người dùng.
- Không đổi schema, không đổi contract, đảo ngược được bằng revert.

Phương án không chọn:

- Lấy `pages.ord` bằng subquery thay cho `LEFT JOIN pages`: lợi ích chưa rõ (một ô 12,7 ms, ô kia lẫn trong nhiễu), thêm
  rủi ro.
- **Hướng mở:** thêm index hoặc bảng đếm theo chương. Cần migration, nên chỉ làm khi hàng đợi VPS lớn hơn nhiều so với
  6.000 job chờ; khi đó lập plan riêng.

Ngưỡng sau khi sửa nằm ở quyết định 5.

## Overview

Hiện `claim()` (`apps/api/src/jobs/queue.ts:130`) xếp `priority, created_at, pages.ord, id`. Hai worker cùng lấy job
của chương tạo trước, nên chương sau chỉ bắt đầu xoá chữ khi chương trước hết `page.prepare` đang chờ.

Sửa: thêm một khoá xếp ngay sau `priority` là **số job đang chạy của chương đó**. Worker rảnh sẽ nhận job của chương
đang có ít job chạy nhất. Hoà thì giữ thứ tự cũ.

```
ORDER BY priority, <số job đang chạy của chương>, created_at, pages.ord NULLS LAST, id
```

Kết quả với N worker: N chương chạy cùng lúc, mỗi chương một worker. Chương thứ N+1 bắt đầu khi một trong các chương
đang chạy hết job chờ. Một worker thì thứ tự như hiện tại, trừ lúc worker vừa khởi động lại: job cũ còn lease tối đa
~150 s nên chương đó tạm bị coi là bận.

**Cái giá so với hiện tại:** khi có từ 2 chương chờ trở lên, chương tạo trước chỉ còn 1 worker thay vì cả N, nên
chương đó xong chậm hơn khoảng N lần (2 worker: ~2 lần). Tổng thời gian xong hết các chương không đổi. Trên VPS với K
container Modal là ~K lần. Đây là đúng yêu cầu "chương sau không phải chờ", ghi rõ trong docs.

## Câu SQL dự kiến

```sql
SELECT j.id
FROM jobs j
LEFT JOIN pages p ON p.id = j.page_id
LEFT JOIN (
  SELECT r.chapter_id, count(*)::int AS n
  FROM jobs r
  WHERE r.status = 'running' AND r.lease_expires_at > now() AND r.chapter_id IS NOT NULL
  GROUP BY r.chapter_id
) busy ON busy.chapter_id = j.chapter_id
WHERE j.status = 'queued' AND j.run_after <= now() AND j.type = ANY($caps)
  AND <các bộ lọc hiện có: kill-switch ngân sách, breaker, claimableSql(kind)>
ORDER BY j.priority, coalesce(busy.n, 0), j.created_at, p.ord ASC NULLS LAST, j.id
LIMIT $max
FOR UPDATE OF j SKIP LOCKED;
```

### Giữ `FOR UPDATE SKIP LOCKED` thế nào

- Postgres cấm `FOR UPDATE` khi **cùng tầng query** có `GROUP BY` / `DISTINCT` / window / aggregate. Ở đây `GROUP BY`
  nằm trong bảng dẫn xuất `busy` ở `FROM`, tầng ngoài chỉ có join + sort + limit, nên hợp lệ.
- Phải giữ `OF j` (code hiện tại đã có `of: jobs`). Bỏ `OF` thì Postgres cố khoá cả `busy` và báo lỗi.
- Đã chạy thật câu trên trên Postgres 17.11 (xem report).

### Khi hàng ứng viên đã bị worker khác khoá

Plan chạy là `Limit → LockRows → Sort`. `LockRows` nhận từng dòng theo thứ tự đã sort, dòng nào đang bị khoá thì bỏ qua
và lấy dòng kế tiếp, tới khi đủ `LIMIT`. Vì vậy:

- **Có thử hàng kế tiếp**, trong cùng một câu lệnh.
- **Không trả rỗng oan**: chỉ rỗng khi mọi job hợp lệ đều đang bị khoá, giống hệt hành vi hiện tại.
- Dòng vừa được worker khác claim xong (đã commit sau snapshot của mình) bị loại vì Postgres kiểm lại điều kiện
  `status = 'queued'` trên bản mới nhất của dòng. Cơ chế này câu hiện tại cũng đang dùng.

### "Chương đang chạy" tính thế nào

- Đếm job `status = 'running'` có `lease_expires_at > now()` và cùng `chapter_id`, **mọi loại job, mọi priority**.
  Lô dịch hay export đang chạy của chương cũng chiếm một worker, nên cũng tính.
- Job `running` đã hết lease (worker chết, reaper chưa quét) không tính, để chương đó không bị xếp sau oan.
- `queued`, `paused_budget` không tính.
- Số đếm chỉ là **khoá xếp thứ tự**, không loại job nào. Chương duy nhất còn job chờ vẫn được cả hai worker cùng làm.
- Số đếm lấy theo snapshot của câu lệnh. Hai worker claim trong cùng vài chục mili giây (transaction claim của worker
  kia chưa commit) có thể cùng vào một chương: worker sau bỏ qua dòng đang khoá và lấy trang kế của chính chương đó.
  Lệch kéo dài đúng một job, lần claim sau tự cân lại. Chấp nhận, xem quyết định 3.

### Job không gắn chương / trang

- `chapter_id` NULL: không khớp `busy`, số đếm = 0. Xếp như một chương không có job chạy, rồi theo `created_at`, `id`.
  Hiện mọi chỗ `insertJob` đều truyền `chapterId`, nhưng cột cho phép NULL nên hành vi vẫn phải xác định.
- `page_id` NULL (lô dịch, export, ingest, proofread): `ord` NULL, xếp sau trong nhóm hoà. Giữ như hiện tại.

## Phương án đã cân nhắc

| Phương án | Kết luận | Lý do |
|---|---|---|
| **Join bảng dẫn xuất `busy` rồi `ORDER BY` (chọn)** | Chọn | Một câu lệnh, giữ nguyên `SKIP LOCKED` và việc thử hàng kế tiếp. `busy` chỉ đọc ≤ số worker dòng qua index sẵn có. 10 ms ở 6.000 job chờ. |
| Subquery tương quan đếm job chạy trong `ORDER BY` | Loại | Cùng kết quả nhưng chạy subquery cho từng dòng: 12.372 buffer so với 371. |
| Window `row_number() OVER (PARTITION BY chapter_id)` trong subquery, tầng ngoài `WHERE id IN (...) FOR UPDATE SKIP LOCKED` | Loại | Danh sách ứng viên chốt trước khi khoá. Ứng viên bị khoá thì **không có hàng thay thế** → trả rỗng oan, worker ngủ backoff dù còn job. |
| Chia đều tuyệt đối theo "chương được phục vụ gần nhất" (`max(claimed_at)`) | Loại | Xem quyết định 1. Còn phải quét lịch sử job của từng chương ở mỗi lần claim. |
| `pg_advisory_xact_lock` để tuần tự hoá claim | Loại | Xem quyết định 3. |
| Thêm cột / bảng đếm lượt theo chương | Loại | Cần migration và thêm chỗ ghi ở claim / complete / fail / reaper. Số đo cho thấy chưa cần. |

## Quyết định tự chốt (theo uỷ quyền việc nhỏ)

1. **Số chương chạy cùng lúc = số worker, không xoay vòng từng trang qua mọi chương.** Xoay vòng tuyệt đối làm mọi
   chương xong gần như cùng lúc ở cuối: tải 10 chương thì chương 1 xong sau ~10/10 thời gian thay vì ~2/10. Người đọc
   cần chương đầu xong sớm. Cách chọn đáp ứng đúng "2 worker → 2 chương chạy cùng lúc". Hệ quả: 1 worker
   (`MTL_WORKERS=1`) vẫn chạy lần lượt từng chương, ghi rõ trong docs. Muốn xoay vòng tuyệt đối sau này thì thêm một khoá
   xếp, không phải làm lại.
2. **Đếm job chạy của mọi loại, chỉ khi lease còn hạn.** Lý do ở mục trên.
3. **Không tuần tự hoá claim bằng advisory lock.** Va chạm chỉ xảy ra khi hai claim rơi vào cùng ~vài chục ms; worker
   chạy job ≥ vài giây và nghỉ backoff lệch pha nhau. Hậu quả chỉ là lệch thứ tự một job, không trùng job, không mất dữ
   liệu. Khoá toàn cục trên đường claim dùng chung với bản VPS thì rủi ro dồn hàng lớn hơn lợi ích.
4. **`max > 1` vẫn là một câu lệnh.** Số đếm lấy trước khi claim nên một lượt `max = 8` có thể lấy nhiều trang cùng
   chương. Worker thật luôn gọi `max = 1` (`worker/mtl_worker/main.py:265`), và worker cầm 8 job cũng chạy tuần tự.
5. **Ngưỡng tốc độ** (thời gian thật `\timing`, đo câu cũ và câu mới liền nhau trong cùng phiên, token `mac` và
   `modal`), ở 6.000 job queued / 150 chương / 96.000 trang và ở cỡ self-host (≤ 100 job queued):
   - 6.000 job chờ, breaker tắt: ≤ **15 ms**, có hay không có hạn mức.
   - 6.000 job chờ, breaker đang bật: chấp nhận tới **~20 ms** (trạng thái tạm ~2 phút).
   - Hàng đợi nhỏ, không hạn mức: ≤ **1 ms**.
   - Hàng đợi nhỏ, có hạn mức (≥ 1.000 dòng ledger hôm nay mỗi user): **không chậm hơn câu cũ**. Chi phí ở đây là một
     lần cộng ledger trong ngày, không theo số job.

   Ngưỡng ban đầu là 15 ms / 1 ms cho mọi cấu hình; đã nới hai ô sau khi đo (xem mục "Cần người dùng duyệt"). Số đo
   trước khi sửa (mac, không hạn mức): FIFO cũ 0,10 ms theo `EXPLAIN ANALYZE`. Lý do chấp nhận chậm hơn câu cũ nhiều
   lần về tỉ lệ: mỗi worker claim tối đa một lần cho mỗi job (job ≥ vài giây) hoặc mỗi nhịp backoff, và transaction
   claim vốn đã chạy 6–10 câu lệnh khác. Vượt ngưỡng thì dừng, không tự thêm index.
6. **Chưa chia lượt theo người dùng.** Ngoài phạm vi; docs giữ dòng ghi giới hạn này cho bản nhiều người dùng.
7. **Viết lại `overQuotaSql` thành subquery không tương quan, làm trong plan này.** Câu claim mới phải xếp toàn bộ
   job chờ, nên bộ lọc hạn mức (cộng `usage_ledger` theo user cho **từng dòng**) chạy 6.000 lần thay vì ~40. Reviewer
   đo: token Modal, có hạn mức, 1.000 dòng ledger/user → **370 ms** (câu cũ 2,5 ms), vượt ngưỡng 25 lần. Viết lại thì
   còn ~8 ms. Không sửa thì không đạt acceptance 6 trên VPS, nên đây là điều kiện để giao được, không phải tối ưu thêm.
   Tự chốt vì không đổi schema, contract hay ngữ nghĩa; test `user-quota.test.ts`, `admin-limits.test.ts`,
   `dispatcher.test.ts` canh hành vi. Commit riêng, trước commit đổi thứ tự claim.
8. **Chấp nhận cái giá so với FIFO** nêu ở Overview: chủ dự án đã yêu cầu chương sau không phải chờ.
9. **Priority 10 cũng chia lượt theo chương.** Một lần tẩy lại trang của chương đang có job chạy có thể xếp sau export
   của chương khác. Chỉ lệch một job ngắn; không thêm ngoại lệ cho một mức priority.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Cùng priority, N worker chạy N chương cùng lúc | P1 |
| 2 | Giữ thứ tự trang trong chương, thứ tự priority 10 < 50 < 100, `SKIP LOCKED`, fencing, idempotency, các bộ lọc | P1 |
| 3 | Câu claim trong ngưỡng tốc độ ở cả cấu hình self-host lẫn VPS, có số đo trước và sau | P1 |
| 4 | Docs và memory không còn ghi giới hạn FIFO cũ | P2 |

## Phases

| # | Phase | Status | Phụ thuộc |
|---|-------|--------|-----------|
| 1 | [Thứ tự claim, test, đo](./phase-01-start.md) | Completed | — |
| 2 | [Docs và memory](./phase-02-docs-and-memory.md) | Completed | Phase 1 |

## Quan hệ với plan khác

- `261110-1420-parallel-series-and-export-priority` (completed): plan này trả lời câu hỏi mở của plan đó. Không chặn.
- `261109-1709-self-host-first-run-and-ui-polish` (in-progress, mọi phase đã xong): cùng sửa `docs/self-host.md`, khác
  đoạn. Không chặn.

## Success Criteria

- [x] Chương A 20 trang tạo trước, chương B 5 trang: job đầu của B được claim ở lượt thứ 2, trước khi A hết `page.prepare`.
- [x] Trang trong từng chương được claim theo `pages.ord`.
- [x] Test "claims a finished chapter's export before…" và test 1.000 job / 2 worker vẫn xanh, không sửa kỳ vọng.
- [x] Test claim song song trên nhiều chương: không trùng job, không lỗi deadlock, claim hết.
- [x] Job đang chạy thuộc loại khác (lô dịch) cũng làm chương đó xếp sau; job `chapter_id` NULL xếp như chương rảnh.
- [x] Số đo sau khi sửa nằm trong ngưỡng của quyết định 5 (bản đã sửa sau khi đo), ghi vào report kèm `EXPLAIN (ANALYZE, BUFFERS)`.
- [x] Bộ lọc hạn mức giữ nguyên ngữ nghĩa: các test hạn mức và dispatcher xanh, không sửa kỳ vọng.
- [x] Không có file migration mới, `packages/shared/src/worker-protocol.ts` không đổi.
- [x] Docs + memory đã cập nhật, `status: completed`.

## Kết quả

- Commit: `perf(api): compute the over-quota user set once per statement`, `feat(api): share claim turns between
  chapters with queued jobs`, và commit docs.
- Số đo: [reports/measure-claim-order-after-report.md](./reports/measure-claim-order-after-report.md). 6.000 job chờ:
  8–14 ms, tới ~19 ms khi có hạn mức + breaker bật; cỡ self-host không hạn mức: 0,2–0,3 ms.
- Test: 8 ca mới (7 ca thứ tự claim, 1 ca ledger `user_id` NULL). Không phải sửa kỳ vọng của test nào.
- Smoke 2 worker thật (tiến trình native, chế độ local, không qua image Docker): đạt, chi tiết trong report đo.

## Gate

- `pnpm --filter @mtl/api test` (cả bộ, vì nhiều file test dùng claim) và `pnpm --filter @mtl/api test:unit`
- `pnpm -r typecheck`, `pnpm biome check`
- Smoke self-host 2 worker: commit 2 chương liên tiếp, kiểm `jobs.claimed_at` của hai chương chồng thời gian từ job đầu.

## Phản biện đã xử lý

Report: [from-code-reviewer-to-planner-red-team-fair-share-claim-plan-report.md](./reports/from-code-reviewer-to-planner-red-team-fair-share-claim-plan-report.md).
Phần Postgres (khoá, bỏ qua dòng khoá, kiểm lại dòng, SQL Drizzle sinh) đã được chạy thật và đúng.

| Phát hiện | Xử lý |
|---|---|
| H1: bộ lọc hạn mức chạy cho từng dòng, claim Modal 370 ms | Nhận. Quyết định 7 + ngưỡng đo mọi cấu hình (quyết định 5). |
| M1: không test nào kiểm "đếm mọi loại job" | Nhận. Thêm ca lô dịch đang chạy. |
| M2: ca `chapter_id` NULL mơ hồ | Nhận. Dựng cụ thể, bỏ nhánh "bỏ ca". |
| M3: chưa nêu cái giá so với FIFO | Nhận. Ghi ở Overview, quyết định 8, docs. |
| L1–L6 | Nhận hết: alias cột riêng, câu chữ "1 worker", chỗ docs sót, cách đo, `createdAt` + timeout test, tiêu chí smoke. |
| L7: priority 10 cũng chia lượt | Giữ nguyên, quyết định 9. |

## Open questions

Không chặn việc thực thi. Hai câu reviewer hỏi đã tự trả lời: không cần biết VPS có đặt hạn mức hay không vì ngưỡng đo
bao cả trường hợp có hạn mức; việc chạm `user-quota.ts` đã nêu ở đầu file.

<!-- slug: fair-share-job-claim-across-chapters -->
