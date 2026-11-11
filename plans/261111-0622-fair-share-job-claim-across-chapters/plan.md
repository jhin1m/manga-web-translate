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


**Không còn việc chờ duyệt.** Diễn biến ngày 2026-11-11:

1. Bản đầu (commit `38e4f38`) xếp theo "số job đang chạy của chương" trong một câu duy nhất. Đo ra 8–19 ms ở 6.000 job
   chờ, vượt ngưỡng ở hai nhóm ô; việc thực thi dừng ở đó.
2. Người điều phối quyết định chấp nhận số đo và nới ngưỡng. **Quyết định này đã bị rút lại** trong cùng ngày: câu
   chọn job chậm hơn câu cũ 30–50 lần và tăng tuyến tính theo độ dài hàng đợi, tức tiêu chí "câu claim không chậm đi rõ
   rệt" không đạt. Nới ngưỡng chỉ che việc đó.
3. Sửa tận gốc (commit `0ba6998`, `8256523`), không migration, không index, không đổi contract: chọn ứng viên theo hai nhánh có
   LIMIT (chương rảnh đi theo `jobs_claim_idx` và dừng sớm; chương bận là tập nhỏ), rồi xếp và khoá ở tầng ngoài. Thứ
   tự claim giữ nguyên.

4. Người điều phối đo độc lập trên dữ liệu self-host thật (1 user, bảng `user` chưa analyze) và thấy bản ở bước 3
   **chưa đạt**: nhánh chương rảnh chạy Seq Scan + xếp cả hàng đợi, 4,5–12,6 ms ở 6.000–20.000 job chờ. Lượt đo ở bước
   3 chỉ đúng với DB 20 user đã `VACUUM ANALYZE` toàn bộ.
5. Sửa ở commit `547ac28`: bộ lọc tài khoản bị khoá thành tập không tương quan; trong hai nhánh planner chỉ thấy
   `status = 'queued'`, mọi bộ lọc khác nằm sau một biểu thức `CASE` nên ước lượng không còn phụ thuộc bộ lọc hay thống
   kê bảng `user`; thêm test đọc plan.

6. Review commit `547ac28` tìm ra trạng thái thống kê cũ: bảng `jobs` analyze lúc hàng đợi trống rồi một lô job vào →
   nhánh chương bận và tầng khoá quét cả `jobs_claim_idx` (tái hiện: 22,7 ms ở 6.000 job chờ). Lượt đo 3 chỉ đo với
   thống kê mới nên bỏ sót.
7. Sửa ở commit `1ea755e` và `3734f37`: `status = 'queued'` chỉ còn lộ cho planner ở nhánh chương rảnh; nhánh đó xếp đúng theo hai
   cột của index và lấy trọn nhóm hoà (`with ties`) nên không còn bước xếp; thêm test đọc plan ở cả hai trạng thái
   thống kê.

Kết quả lượt đo 4 (quyết định 5): đạt ở cả 192 ô, chênh nhiều nhất +0,45 ms, số dòng `jobs` đọc không đổi theo độ dài
hàng đợi. Số đo: [reports/measure-claim-order-after-report.md](./reports/measure-claim-order-after-report.md).

| Dạng dữ liệu (78 / 1.998 / 5.998 / 19.998 job chờ, thống kê mới và cũ) | Không hạn mức: cũ → mới | Có hạn mức: cũ → mới |
|---|---|---|
| A: 1 user, không lịch sử | 0,12–0,19 → 0,29–0,61 ms | 0,13–4,75 → 0,31–0,72 ms |
| B: 1 user, 30.000 job cũ | 0,12–0,18 → 0,33–0,52 ms | 0,14–3,86 → 0,34–0,58 ms |
| 20 user | 0,13–0,21 → 0,32–0,56 ms | 3,87–4,01 → 2,19–2,46 ms |

Điều cần biết, không cần duyệt:

- Khi cả bảng `jobs` còn nhỏ (vài nghìn dòng), planner có thể đọc cả bảng ở tầng khoá: ô tệ nhất +0,45 ms.
- Khi đầu hàng là các chương đang bận với backlog lớn (đo: 2 chương × 999 job chờ), câu mới mất 1,5–3,4 ms so với
  0,6–1,5 ms của câu cũ (không hạn mức), chênh +1,2 đến +1,9 ms: **vượt mức + 1 ms**. Chi phí theo số job chờ của các
  chương đang chạy, không theo độ dài hàng đợi. Trường hợp này nằm ngoài ma trận mục tiêu của quyết định 5.
- Bảng `jobs` chưa từng analyze (phút đầu sau cài mới / restore): câu mới lẫn câu FIFO cũ đều đọc cả hàng đợi
  (reviewer đo ở 20.000 job chờ: 6,6–8,8 ms so với 14–16 ms của FIFO).

Hướng mở nếu sau này cần nhanh hơn nữa ở trường hợp đó: index `(chapter_id, priority, created_at)` cho job chờ hoặc
bảng đếm theo chương. Cần migration, lập plan riêng.

**Chủ dự án đã chốt ngày 2026-11-11:** chấp nhận hiện trạng, không migration. Câu chọn job chậm hơn câu FIFO cũ
0,1–0,3 ms mỗi lần claim ở trường hợp thường gặp và chậm hơn vài ms khi chương đang chạy còn ~1.000 trang chờ; cả hai
được coi là đạt tiêu chí "không chậm đi rõ rệt". Chỉ mở lại hướng index khi hàng đợi thật có dạng đó.

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
5. **Mục tiêu tốc độ:** ở mọi ô của ma trận, thời gian thật trung vị của câu chọn job mới ≤ câu cũ (commit `ef1e70c`)
   + 1 ms, đo liền nhau trong cùng phiên bằng `\timing`; không tăng theo độ dài hàng đợi; ô nào câu cũ tự nó đã xếp cả
   hàng đợi thì câu mới phải nhanh hơn câu cũ. Ma trận: token `mac` / `modal` × có / không hạn mức × breaker tắt / bật ×
   ~80 / 2.000 / 6.000 / 20.000 job chờ, trên ba dạng dữ liệu (20 user; 1 user với bảng `user` chưa analyze, không
   lịch sử job; như vậy thêm 30.000 job `succeeded`) và hai trạng thái thống kê của bảng `jobs` (mới; cũ = analyze lúc
   hàng đợi trống). Mỗi ô ghi nhánh chương rảnh đọc `jobs` bằng index nào. Không đạt
   thì dừng và báo số đo, không nới ngưỡng, không tự thêm index, không dùng GUC ép planner.
   Lịch sử: ngưỡng đầu tiên là 15 ms / 1 ms tuyệt đối; từng được nới sau lượt đo 1 rồi bị rút lại; lượt đo 2 chỉ có
   dạng 20 user nên bỏ sót lỗi trên dữ liệu self-host thật; lượt đo 3 chỉ có thống kê mới nên bỏ sót lỗi thống kê cũ (xem mục "Cần người dùng duyệt").
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
- [x] Số đo đạt mục tiêu của quyết định 5 ở cả 192 ô của lượt đo 4 (ba dạng dữ liệu, hai trạng thái thống kê, tới 20.000 job chờ), ghi vào report kèm nút đọc `jobs` và số dòng đọc.
- [x] Bộ lọc hạn mức giữ nguyên ngữ nghĩa: các test hạn mức và dispatcher xanh, không sửa kỳ vọng.
- [x] Không có file migration mới, `packages/shared/src/worker-protocol.ts` không đổi.
- [x] Docs + memory đã cập nhật, `status: completed`.

## Kết quả

- Commit:
  - `6c29f78 perf(api): compute the over-quota user set once per statement`
  - `38e4f38 feat(api): share claim turns between chapters with queued jobs`
  - `6e34e1c docs(api): state the not-null requirement of the over-quota filter column`
  - `838c1a2 docs: describe per-chapter claim sharing and its trade-off`
  - `0ba6998 perf(api): pick claim candidates from the head of the queue instead of sorting it`
  - `8256523 perf(api): materialize claim candidates so a row recheck does not rerun both branches`
  - `b5436fd docs: record the two-branch claim query, its measurements and smoke runs`
  - `547ac28 perf(api): keep the claim on the index walk whatever the planner statistics say`
  - `1ea755e perf(api): keep the claim reading only the head of the queue under stale statistics`
  - `3734f37 perf(api): cut the idle-chapter candidates again after the index walk`
  - commit docs cuối (lượt đo 4, plan này).
- Số đo: [reports/measure-claim-order-after-report.md](./reports/measure-claim-order-after-report.md). Câu chọn job:
  0,3–0,6 ms trên self-host một tài khoản; 0,3–0,6 ms (không hạn mức) và 2,2–2,5 ms (có hạn mức) trên dạng 20 user;
  không tăng theo hàng đợi (78 tới 20.000 job chờ), với thống kê `jobs` mới lẫn cũ.
- Test: 14 ca mới (11 ca thứ tự claim, 2 ca đọc plan, 1 ca ledger `user_id` NULL). Không phải sửa kỳ vọng của test nào.
- Smoke: xem report đo (2 worker native ở bản đầu; image Docker ở HEAD).

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
