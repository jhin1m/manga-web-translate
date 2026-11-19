---
phase: 2
title: "Phase 2: Queue waiting state API"
status: pending
priority: P1
effort: "3h"
dependencies: []
---

# Phase 2: Queue waiting state API

## Overview

API trả cho mỗi chương bận biết nó đang chạy hay đang chờ worker, và (self-host) có worker nào sống không.

## Requirements

- Định nghĩa (tính tại `now`, chỉ cho chương `ingesting` | `processing`):
  - `has_running` = có job của chương `status='running'` và lease còn hạn (job hết lease không tính, như `pickClaimable`).
  - `has_ready` = có job `status='queued'` và `run_after <= now` (job đang backoff chờ AI thử lại không tính — UI đã có "Chờ AI").
  - `waiting` = `!has_running && has_ready`.
  - `no_worker` = `waiting` && `env.MTL_LOCAL_MODE` && không token worker nào chưa thu hồi có `last_seen_at > now - 180s`
    (worker idle claim tối đa 30s/lần, `last_seen_at` ghi ≤ 1 lần/phút → 180s an toàn). Bản hosted (Modal theo nhu
    cầu) không bao giờ trả `no_worker`.
  - `running_chapters` = số chương **khác** có job `running` còn lease (mọi người dùng, chỉ con số).
- Response:
  - `GET /api/chapters/:id/progress` → `chapter.queue: { state: "waiting" | "no_worker", running_chapters: number } | null`.
  - Hàng chương ở series detail / recent / latest (`series.ts`, `chapters.ts` — nơi đã có `page_counts`) → `queue_state: "waiting" | "no_worker" | null`.
- Non-functional: 1 câu gom theo danh sách chapter id bận (không N+1), đi `jobs_chapter_idx`; chương không bận bỏ qua.

## Architecture

Helper mới `apps/api/src/jobs/queue-state.ts`:

```ts
// Chỉ tính cho chương bận; trả Map rỗng nếu ids rỗng.
export async function chapterQueueStates(db, chapterIds: string[], now = new Date()):
  Promise<{ byChapter: Map<string, "waiting" | "no_worker">; runningChapters: Set<string> }>
```

SQL phác (xác nhận tên cột `lease_expires_at`, `run_after` trong schema trước khi viết):

```sql
select chapter_id,
       bool_or(status = 'running' and lease_expires_at > now()) as has_running,
       bool_or(status = 'queued'  and run_after <= now())      as has_ready
from jobs where chapter_id = any($ids) and status in ('queued','running')
group by chapter_id;
```

`runningChapters`: `select distinct chapter_id from jobs where status='running' and lease_expires_at > now()`.
Worker sống: `exists (select 1 from worker_tokens where revoked_at is null and last_seen_at > now() - interval '180 seconds')`.

## Related Code Files

- Create: `apps/api/src/jobs/queue-state.ts`
- Modify: `apps/api/src/routes/progress.ts` (thêm `chapter.queue`)
- Modify: `apps/api/src/routes/series.ts`, `apps/api/src/routes/chapters.ts` (thêm `queue_state` cạnh `page_counts`)
- Create/Modify test: `apps/api/test/` integration cho queue-state (theo mẫu test jobs hiện có)

## Implementation Steps

1. Đọc schema `jobs`, `worker_tokens` (drizzle) xác nhận cột + trạng thái active (`ACTIVE_JOB_STATUSES`).
2. Viết `queue-state.ts` + chú thích định nghĩa (không ghi mã plan/phase trong comment).
3. Gắn vào progress: gọi khi `ch.status` bận; `running_chapters` = size set trừ chính chương.
4. Gắn vào series/chapters rows: gom id các chương bận của trang kết quả → 1 lần gọi.
5. Test: (a) queued sẵn sàng, không running → `waiting`; (b) có running còn lease → null; (c) running hết lease + queued → `waiting`;
   (d) chỉ queued `run_after` tương lai → null; (e) local mode + không token sống → `no_worker`; hosted → `waiting`;
   (f) chương không bận → null.

## Success Criteria

- [x] Progress + rows trả đúng trường theo 6 ca test
- [x] Không thêm query per-chapter trong list

## Risk Assessment

- Lease hết hạn do worker chết: coi là không chạy → `waiting` (đúng: reaper sẽ requeue).
- Hai worker claim sát nhau: nhãn có thể lệch 1 nhịp poll (2–3s) — chấp nhận.
- Lộ thông tin: chỉ con số chương đang chạy, không id/tên → chấp nhận cho bản nhiều người dùng.
