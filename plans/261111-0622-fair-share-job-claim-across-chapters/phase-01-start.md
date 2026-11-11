---
phase: 1
title: "Thứ tự claim, test, đo"
status: completed
priority: P1
effort: "5h"
dependencies: []
---

# Phase 1: Thứ tự claim, test, đo

## Overview

Viết lại bộ lọc hạn mức để không tính theo từng dòng, thêm khoá xếp "số job đang chạy của chương" vào câu chọn job
trong `claim()`, thêm test chia lượt và test song song, đo lại bằng câu SQL thật.

## Requirements

- Functional
  - Cùng priority: job của chương có ít job đang chạy (lease còn hạn) được claim trước. Hoà: `created_at`, `pages.ord`
    (NULL sau), `id` như cũ.
  - Priority vẫn là khoá xếp đầu tiên.
  - `chapter_id` NULL: số đếm = 0.
- Non-functional
  - Không migration, không đổi `ClaimRequest` / response, không thêm env.
  - Vẫn một câu `SELECT … FOR UPDATE OF jobs SKIP LOCKED`; phần sau câu chọn (khoá chương, cấp rev, fencing, dựng
    input) không đổi.
  - Ngưỡng (thời gian thật, token mac / modal; đã sửa sau khi đo, xem quyết định 5 trong `plan.md`): 6.000 job queued
    ≤ 15 ms khi breaker tắt, tới ~20 ms khi breaker bật; ≤ 100 job queued ≤ 1 ms khi không có hạn mức, có hạn mức thì
    không chậm hơn câu cũ.
  - `overQuotaSql` giữ nguyên ngữ nghĩa: hạn mức NULL = không giới hạn; ≤ 0 = chặn hết; user chưa có ledger hôm nay
    không bị chặn khi hạn mức > 0.

## Architecture

### Bộ lọc hạn mức (`apps/api/src/billing/user-quota.ts:28-31`)

Hiện là subquery tương quan, Postgres chạy lại cho từng job:

```sql
(limit is not null and (limit = 0 or coalesce((select sum(cost_usd) from usage_ledger
   where user_id = <cột> and created_at >= dayStart), 0) >= limit))
```

Viết lại để Postgres băm một lần cho cả câu lệnh:

```sql
(limit is not null and (limit <= 0 or <cột> in (
   select l.user_id from usage_ledger l
   where l.user_id is not null and l.created_at >= dayStart
   group by l.user_id having sum(l.cost_usd) >= limit)))
```

- **Bắt buộc `l.user_id is not null`**: ledger có dòng không gắn user (`apps/api/src/billing/ledger.ts:109`). Một NULL
  trong tập làm `NOT (x IN (...))` thành NULL và chặn mọi claim.
- `limit <= 0` thay cho `limit = 0`: bản cũ với hạn mức âm cũng chặn hết (tổng ≥ số âm luôn đúng), giữ đúng như vậy.
- User không có dòng ledger: bản cũ so `0 >= limit`, chỉ đúng khi `limit <= 0`. Nhánh `limit <= 0` bao trường hợp này.
- Hàm dùng ở `claimableSql` (claim, dispatcher) và `lockQueuedOverQuotaLlmJobs`. Cả ba cùng nhanh lên, không đổi chữ ký.

### Câu chọn job

Sửa đoạn `picked` trong `claim()` (`apps/api/src/jobs/queue.ts:114-132`). Phác thảo:

```ts
import { alias } from "drizzle-orm/pg-core";

const running = alias(jobs, "running_jobs");
// Chương đang được worker nào đó làm (lease còn hạn). Tối đa bằng số worker → đọc qua jobs_running_lease_idx.
const busy = t
  .select({ chapterId: running.chapterId, n: sql<number>`count(*)::int`.as("busy_n") })
  .from(running)
  .where(and(eq(running.status, "running"), gt(running.leaseExpiresAt, sql`now()`), isNotNull(running.chapterId)))
  .groupBy(running.chapterId)
  .as("busy");

const picked = await t
  .select({ id: jobs.id })
  .from(jobs)
  .leftJoin(pages, eq(pages.id, jobs.pageId))
  .leftJoin(busy, eq(busy.chapterId, jobs.chapterId))
  .where(/* giữ nguyên */)
  .orderBy(
    asc(jobs.priority),
    sql`coalesce(${busy.n}, 0)`,
    asc(jobs.createdAt),
    sql`${pages.ord} asc nulls last`,
    asc(jobs.id),
  )
  .limit(req.max)
  .for("update", { of: jobs, skipLocked: true });
```

Lưu ý khi viết:
- Bảng ngoài phải giữ tên `jobs` không alias: `llmJobSql`, `breakerBlockedSql`, `claimableSql` nhúng `${jobs.x}`.
- Drizzle sinh `coalesce("busy_n", 0)` không có tiền tố bảng (đã kiểm bằng `.toSQL()`). Vì vậy alias phải là tên
  riêng (`busy_n`), không trùng cột nào của `jobs` / `pages`; trùng thì Postgres báo cột mơ hồ và mọi claim lỗi 500.
- SQL sinh ra chỉ cần khớp **ngữ nghĩa** với câu trong `plan.md` (Drizzle sinh `in (...)` thay `= ANY`, không có alias `j`).
- Bắt buộc giữ `of: jobs`.

## Related Code Files

- Modify: `apps/api/src/billing/user-quota.ts` (`overQuotaSql`)
- Modify: `apps/api/src/jobs/queue.ts` (câu chọn job + chú thích đầu file và chú thích tại chỗ)
- Modify: `apps/api/test/queue.test.ts` (test mới)
- Modify nếu cần: file test khác đang ngầm dựa vào thứ tự FIFO giữa các chương
- Create: `plans/261111-0622-fair-share-job-claim-across-chapters/reports/measure-claim-order-after-report.md`

## Implementation Steps

1. Chạy `pnpm --filter @mtl/api test` trước khi sửa, lưu danh sách test xanh làm mốc.
2. Viết lại `overQuotaSql` như trên. Kiểm validator hạn mức (admin limits + env) xem có cho số âm không, ghi kết quả
   vào report. Chạy `user-quota.test.ts`, `admin-limits.test.ts`, `admin-users.test.ts`, `dispatcher.test.ts`,
   `budget.test.ts`: phải xanh, không sửa kỳ vọng. Thêm một ca: có dòng ledger `user_id` NULL vượt hạn mức, user thường
   chưa vượt vẫn claim được. Commit riêng.
3. Sửa câu chọn job như phác thảo. Chú thích tại chỗ nói rõ: đếm job chạy còn lease, mọi loại; chỉ là khoá xếp; vì sao
   `GROUP BY` nằm trong bảng dẫn xuất (để còn dùng được `FOR UPDATE`).
4. Thêm helper trong `queue.test.ts` tạo chương có N trang + N job `page.prepare` cùng `created_at` (dựa theo đoạn
   insert trong test thứ tự trang sẵn có). `createdAt` đặt tường minh, A sớm hơn B ít nhất vài giây: chèn cùng
   transaction thì `now()` trùng nhau và thứ tự rơi xuống `id`. Kết thúc job bằng `db.update(jobs).set({ status: "succeeded" })`, không cần
   output thật.
5. Thêm test trong `describe("claim")`:
   - **Hai chương chia lượt.** A 20 trang (`created_at` trước), B 5 trang. Claim `max: 1` liên tiếp, không kết thúc job:
     thứ tự là A0, B0, A1, B1, … A4, B4, A5 … A19. Assert: job thứ 2 thuộc B; dãy trang của từng chương tăng dần theo
     `ord`; đủ 25 job.
   - **Hai worker, có kết thúc job.** Hai token. Mỗi vòng: worker đánh dấu job đang giữ là xong rồi claim tiếp. Assert:
     worker 1 chỉ nhận trang của A cho tới khi B hết job; worker 2 nhận B0..B4 rồi mới nhận trang của A.
   - **Priority vẫn thắng.** A có 1 job đang chạy và một job priority 50 đang chờ; B không có job chạy, có job priority
     100. Claim tiếp theo là job priority 50 của A.
   - **Lease hết hạn không tính.** A có job `running` đã `expireLease`; A tạo trước B. Claim tiếp theo là trang của A.
   - **Job loại khác đang chạy cũng tính.** A có một job `chapter.translate` priority 50 ở trạng thái `running` (lease
     còn hạn, chèn thẳng vào DB) và `page.prepare` chờ, tạo trước; B có `page.prepare` chờ, tạo sau. Claim
     `page.prepare` kế tiếp là của B. Ca này đỏ nếu code chỉ đếm job cùng loại hoặc cùng priority.
   - **Job `chapter_id` NULL.** A có 1 job `running` còn lease và 1 job chờ tạo trước. Một job `chapter.export` có cột
     `chapter_id` NULL (payload vẫn trỏ chương có trang), tạo sau. Claim kế tiếp là job NULL. Dựng được với helper sẵn
     có: FK `(user_id, chapter_id)` không kiểm khi NULL, input export đọc `payload.chapter_id`, `claim()` bỏ
     `lockChapter` khi `chapterId` null.
   - **Song song nhiều chương.** 6 chương × 20 trang, 4 vòng drain đồng thời trên 2 token, `max: 1`, `timeout` 120 s.
     Assert: 120 job, không trùng, không request nào lỗi. Không assert phân bố chương vì claim trùng thời điểm được
     phép lệch một job.
6. Chạy `test/queue.test.ts`, rồi cả bộ API. Test nào đỏ vì mã hoá thứ tự FIFO giữa các chương thì sửa kỳ vọng theo quy
   tắc mới và ghi tên test vào report. Không nới lỏng assert, không sửa hai test đã nêu ở acceptance.
7. Đo: làm theo mục "Cách đo lại" trong
   [research-claim-order-explain-baseline-report.md](./reports/research-claim-order-explain-baseline-report.md), dùng SQL
   lấy từ `.toSQL()`. Ma trận: {mac, modal} × {không hạn mức, có hạn mức + 1.000 dòng ledger hôm nay mỗi user} ×
   {breaker tắt, bật một provider}, ở 6.000 và 80 job queued. Mỗi ô đo câu cũ và câu mới liền nhau trong cùng phiên
   bằng `\timing` (lấy trung vị 5 lần), kèm một `EXPLAIN (ANALYZE, BUFFERS)` để xem plan. Ghi vào
   `measure-claim-order-after-report.md`. Không đặt điều kiện về tên index: planner được tự chọn.
8. Smoke self-host 2 worker với image build local: commit chương dài rồi chương ngắn, chụp
   `select chapter_id, min(claimed_at), max(claimed_at), count(*) from jobs where type = 'page.prepare' and attempts = 1 group by 1`.
9. Typecheck + biome.

## Success Criteria

- [x] 7 ca test thứ tự mới xanh, cộng 1 ca ledger `user_id` NULL.
- [x] Test export-trước-backlog và test 1.000 job xanh, không sửa.
- [x] Cả bộ API xanh; mọi kỳ vọng phải sửa đều có trong report kèm lý do.
- [x] Mọi ô trong ma trận đo nằm trong ngưỡng đã sửa của quyết định 5.
- [x] Smoke (chỉ tính job `attempts = 1`): `claimed_at` đầu tiên của chương ngắn sớm hơn `claimed_at` của trang thứ 3
      từ cuối của chương dài.
- [x] `git diff --stat` không có file trong `packages/db/migrations/` hay `packages/shared/`.

## Risk Assessment

| Rủi ro | Xử lý |
|---|---|
| Bộ lọc tính theo từng dòng chạy trên cả hàng đợi (hạn mức: 370 ms nếu không sửa) | Viết lại `overQuotaSql` (bước 2). `breakerBlockedSql` (`jsonb_each` từng dòng) có trong ma trận đo. |
| Viết lại bộ lọc hạn mức làm đổi ai bị chặn | Giữ ba trường hợp biên nêu ở Architecture; test hạn mức sẵn có không sửa kỳ vọng; thêm ca ledger NULL. |
| Vẫn vượt ngưỡng 15 ms ở một ô nào đó | Đã xảy ra ở ô có hạn mức + breaker bật (14–19 ms): đã dừng, người điều phối chấp nhận và nới ngưỡng ô đó tới ~20 ms. Không thêm index. |
| Hai claim cùng lúc dồn vào một chương | Đã chấp nhận (lệch một job, tự cân). Test song song không assert phân bố. |
| Test file khác đỏ vì thứ tự giữa các chương đổi | Sửa kỳ vọng có lý do; nếu test đỏ vì lý do khác thì đó là lỗi của thay đổi, phải tìm nguyên nhân. |
| Postgres kiểm lại dòng sau khi chờ khoá với join bảng dẫn xuất cho kết quả lạ | Test 1.000 job / 4 vòng drain đồng thời là bằng chứng; nếu trùng job hoặc thiếu job thì dừng và báo. |
| Job đang chạy lâu của một chương (hiệu đính) làm chương đó xếp sau | Đúng ý: chương đó đang giữ một worker. Không loại job, chỉ xếp sau khi chương khác rảnh hơn. |

Rollback: revert hai commit (thứ tự claim, rồi bộ lọc hạn mức), không có dữ liệu hay schema cần hoàn tác.
