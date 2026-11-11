# Đo câu chọn job sau khi sửa: chia lượt theo chương + bộ lọc hạn mức mới

Ngày đo: 2026-11-11. Postgres 17.11 (container `mtl-dev-postgres-1`, arm64). DB tạm `mtl_claim_bench` tạo từ template
DB test của API, **đã xoá sau khi đo**. Không đụng DB dev.

## Kết luận

**Đạt ngưỡng đã sửa của quyết định 5.** So với ngưỡng ban đầu (15 ms / 1 ms cho mọi cấu hình) có hai nhóm ô vượt; việc
thực thi đã dừng ở đó và người điều phối quyết định chấp nhận số đo, giữ nguyên code (xem mục "Cần người dùng duyệt"
trong `plan.md`). Các bảng dưới đây ghi "Đạt" theo ngưỡng ban đầu để thấy rõ ô nào đã được nới.

- 12/16 ô đạt ngưỡng ban đầu. Cấu hình self-host thật (không hạn mức): 0,21–0,30 ms (ngưỡng 1 ms). Cấu hình VPS
  thường gặp (Modal, có hạn mức, breaker tắt) ở 6.000 job: 12,0–12,3 ms (ngưỡng 15 ms).
- Ô nới 1: 6.000 job chờ, có hạn mức **và** breaker đang bật: 14,2–18,7 ms (ngưỡng mới ~20 ms; câu cũ 4,3–5,5 ms).
- Ô nới 2: ≤ 100 job chờ, có hạn mức + 20.000 dòng ledger hôm nay: 2,2–2,6 ms (ngưỡng mới: không chậm hơn câu cũ; câu
  cũ 4,0–4,3 ms).
- Viết lại bộ lọc hạn mức là bắt buộc: thứ tự mới + bộ lọc cũ ra 135–716 ms.

## Dữ liệu

| Bảng | Số dòng |
|---|---|
| `jobs` queued, priority 100, `page.prepare` gọi LLM, payload có 2 slot `llm` | 5.998 (150 chương × 40 trang, mỗi chương một `created_at`) |
| `jobs` running, lease còn hạn | 2 (2 chương cũ nhất đang chờ) |
| `jobs` succeeded | 30.000 (750 chương cũ) |
| `pages` | 96.000 |
| `user` | 20 |
| `usage_ledger` hôm nay | 20.000 (1.000 dòng / user, tổng $10 / user) + 50 dòng nền tảng `user_id` NULL |

Cỡ self-host: cùng DB, huỷ job chờ của 148 chương → còn 78 queued + 2 running (2 chương).

Cấu hình:
- Hạn mức: `system_settings.user_daily_usd` = NULL (không hạn mức) hoặc 1000 (có hạn mức, chưa ai vượt → bộ lọc phải
  xét mọi job).
- Breaker bật: một provider đang pause, khác provider của các job → `jsonb_each` chạy cho từng job, không loại job nào.
- Token `mac` và `modal`.

## Cách đo

- SQL lấy từ `.toSQL()` của Drizzle, tham số thay bằng hằng. "Sau" là `pickClaimable()` trong
  `apps/api/src/jobs/queue.ts`. "Trước" là câu ở commit `ef1e70c` (thứ tự FIFO + bộ lọc hạn mức tương quan).
  "Giữa" = thứ tự mới + bộ lọc hạn mức cũ.
- Mỗi ô: làm nóng 1 lần, rồi 5 vòng xen kẽ trước / giữa / sau trong cùng một phiên `psql`, `\timing`, mỗi câu trong
  `BEGIN … ROLLBACK`, `LIMIT 1`. Số ghi là trung vị thời gian thật.
- Nhiễu của máy đo khoảng ±3 ms ở cỡ 6.000 job. Đo lại 15 vòng (cột "lần 2") để xem độ ổn định.

## Kết quả, 6.000 job chờ (ngưỡng 15 ms)

Thời gian thật, ms, trung vị.

| Hạn mức | Token | Breaker | Trước | Giữa | Sau (5 vòng) | Sau (lần 2, 15 vòng: trung vị, min–max) | Đạt |
|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,30 | 137 | 10,5 | 8,5 (8,0–11,0) | có |
| không | mac | bật | 0,37 | 155 | 13,8 | 11,9 (11,4–12,7) | có |
| không | modal | tắt | 0,25 | 135 | 9,9 | 7,8 (7,5–9,2) | có |
| không | modal | bật | 0,35 | 153 | 13,3 | 10,8 (10,6–11,6) | có |
| có | mac | tắt | 4,28 | 672 | 12,9 | 10,9 (10,1–12,8) | có |
| có | mac | bật | 4,37 | 690 | **16,1** | **18,7** (16,5–37,5) | **không** |
| có | modal | tắt | 4,30 | 656 | 12,3 | 12,0 (11,2–14,4) | có |
| có | modal | bật | 4,39 | 716 | **15,9** | 14,2 (13,1–16,0) | **sát / không** |

Cột "Giữa" lớn cả khi không đặt hạn mức: Postgres không bỏ qua subquery tương quan dù hạn mức là NULL, nên với ledger
có dữ liệu nó vẫn cộng lại cho từng job.

## Kết quả, 78 job chờ (ngưỡng 1 ms)

| Hạn mức | Token | Breaker | Trước | Giữa | Sau | Đạt |
|---|---|---|---|---|---|---|
| không | mac | tắt | 0,15 | 0,22 | 0,22 | có |
| không | mac | bật | 0,20 | 0,28 | 0,30 | có |
| không | modal | tắt | 0,14 | 0,21 | 0,21 | có |
| không | modal | bật | 0,19 | 0,28 | 0,27 | có |
| có | mac | tắt | 4,03 | 7,93 | **2,25** | **không** (nhanh hơn câu cũ) |
| có | mac | bật | 4,32 | 8,26 | **2,56** | **không** (nhanh hơn câu cũ) |
| có | modal | tắt | 4,02 | 7,80 | **2,24** | **không** (nhanh hơn câu cũ) |
| có | modal | bật | 4,10 | 7,99 | **2,31** | **không** (nhanh hơn câu cũ) |

## Ô vượt ngưỡng ban đầu

### 1. 6.000 job chờ, có hạn mức và breaker bật: 14–19 ms

`EXPLAIN (ANALYZE, BUFFERS)` của ô modal (19,5 ms khi có đo đạc, 3.645 buffer), các bước chính:

```
Limit → LockRows → Sort (quicksort 618kB, 5.998 dòng)                       ~1,5 ms
  Nested Loop Left Join busy (2 dòng, đọc qua jobs_running_lease_idx)        ~0,9 ms
    Nested Loop Anti Join "user" (tài khoản bị khoá)                         ~0,4 ms
      Hash Right Join pages.id = jobs.page_id                                ~10 ms
        Seq Scan on pages (96.000 dòng, 2.910 buffer)                        7,2 ms
        Bitmap Heap Scan on jobs qua jobs_claim_idx (5.998 dòng)             6,5 ms
          SubPlan hạn mức: HashAggregate usage_ledger (20.000 dòng, 1 lần)   2,4 ms
          SubPlan breaker: jsonb_each, loops=5998
```

- Phần nặng nhất là ghép `pages` để lấy `ord` (quét cả bảng `pages`), rồi mới tới hai bộ lọc.
- Không có bước nào chạy lại theo từng dòng ngoài `jsonb_each` của breaker.
- Breaker chỉ bật 2 phút mỗi lần một provider lỗi liên tục, nên ô này là trạng thái tạm thời, không phải thường trực.

### 2. ≤ 100 job chờ, có hạn mức: 2,2–2,6 ms

Toàn bộ thời gian là một lần cộng ledger hôm nay của mọi user (`HashAggregate`, 20.000 dòng, 2,4 ms). Chi phí này cố
định theo số dòng ledger trong ngày, không theo số job. Câu cũ ở cùng ô mất 4,0–4,3 ms. Self-host không đặt hạn mức
nên không gặp ô này; chỉ bản nhiều người dùng gặp.

## Thử nhanh một dạng câu khác (chỉ để tham khảo, không đưa vào code)

Thay `LEFT JOIN pages` bằng subquery vô hướng trong `ORDER BY` (`(select ord from pages where id = jobs.page_id)`):
ô modal + hạn mức + breaker còn 12,7 ms (so với 16,0 ms cùng phiên), ô mac không rõ khác biệt vì nhiễu
(18,0 so với 18,8 ms). Chưa đủ số liệu để kết luận.

## Kiểm validator hạn mức

Hạn mức âm không vào được hệ thống: env `USER_DAILY_USD` qua `z.coerce.number().nonnegative()` (`apps/api/src/env.ts:10`),
admin qua `z.number().finite().min(0)` (`apps/api/src/routes/admin-settings.ts:56`). Nhánh `limit <= 0` của bộ lọc mới
vì vậy chỉ gặp giá trị 0, và vẫn giữ nghĩa cũ nếu có số âm ghi thẳng vào DB.

## Test

- `pnpm --filter @mtl/api test` trước khi sửa: 57 file, 529 qua, 1 bỏ qua (có từ trước).
- Sau khi sửa: 57 file, 537 qua, 1 bỏ qua. 8 ca mới: 7 ca thứ tự claim trong `queue.test.ts`, 1 ca ledger `user_id`
  NULL trong `user-quota.test.ts`.
- **Không phải sửa kỳ vọng của test nào.** Test export-trước-backlog và test 1.000 job giữ nguyên.
- Đã thử làm hỏng code để xem test có bắt được không:
  - bỏ khoá xếp "số job đang chạy" → 4 ca đỏ (chia lượt, hai worker, job loại khác, job không gắn chương);
  - bỏ điều kiện lease còn hạn → ca lease hết hạn đỏ;
  - chỉ đếm job `page.prepare` → ca job loại khác đỏ;
  - bỏ `user_id is not null` trong bộ lọc hạn mức → ca ledger NULL đỏ (và 1 ca heartbeat).

## Smoke 2 worker

**Đã chạy, đạt.** Không dùng image Docker: API + jobs runner chạy native ở chế độ local (`MTL_LOCAL_MODE=1`, storage
disk) trên cổng riêng, DB riêng `mtl_smoke_fairshare` và thư mục dữ liệu tạm; 2 tiến trình `mtl-worker` thật
(`MTL_PROVIDER=anthropic`, `MTL_WORKERS=2`, cùng token) claim qua HTTP thật. Series tiếng Nhật nên xoá chữ + OCR chạy
local: 0 lần gọi LLM, chi phí $0 (`usage_ledger` không có dòng LLM). DB, thư mục dữ liệu và tiến trình smoke đã dọn.

Hai chương cùng series, commit liền nhau, dừng ở bước xoá chữ: chương 1 có 12 trang, chương 2 có 3 trang. Job
`page.prepare` của chương 2 được tạo trước chương 1 khoảng 0,1 s (ingest chương 2 xong trước). Mọi job `attempts = 1`.

| Lượt claim | Chương | Trang | Worker | `claimed_at` (UTC) |
|---|---|---|---|---|
| 1 | 2 | 0 | smoke-w2 | 07:01:21.338 |
| 2 | 1 | 0 | smoke-w1 | 07:01:21.466 |
| 3 | 2 | 1 | smoke-w2 | 07:01:24.329 |
| 4 | 1 | 1 | smoke-w1 | 07:01:24.699 |
| 5 | 2 | 2 | smoke-w2 | 07:01:26.867 |
| 6 | 1 | 2 | smoke-w1 | 07:01:27.220 |
| 7–15 | 1 | 3–11 | hai worker xen kẽ | 07:01:29.362 … 07:01:39.555 |

- Hai chương chồng thời gian ngay từ job đầu: chương 1 bắt đầu ở lượt 2 khi chương 2 (tạo job trước) còn 2 trang chờ.
  Với thứ tự cũ, cả hai worker sẽ làm hết 3 trang của chương 2 rồi mới tới chương 1.
- Mỗi worker giữ một chương cho tới khi chương ngắn hết trang, rồi cả hai cùng làm chương dài. Trang trong từng chương
  đúng thứ tự.
- Tiêu chí của plan (`claimed_at` đầu của chương ngắn sớm hơn trang thứ 3 từ cuối của chương dài): 07:01:21.338 <
  07:01:36.804. Tiêu chí này ở lần chạy này không tự nó phân biệt được code cũ và mới vì chương ngắn lại là chương có
  job tạo trước; bằng chứng phân biệt là lượt 2 ở trên.
- Giới hạn: không chạy bằng image Docker / compose, nên không kiểm phần đóng gói (đã có `infra/selfhost-smoke.sh`).
  Lần chạy đầu, log của jobs runner có 26 dòng chứa "error" mà tôi xoá mất trước khi đọc; chạy lại runner trên DB mới
  (khởi động sau khi API migrate xong, theo dõi 2 nhịp reaper) thì không có dòng lỗi nào. Nhiều khả năng lần đầu runner
  khởi động trước khi migrate xong, nhưng đó là suy đoán.

## Review code

Reviewer đọc hai commit, chạy bảng chân trị của bộ lọc hạn mức, thử EPQ trên PG17 và chạy test lặp có xáo thứ tự trên
DB tạm: không có phát hiện mức cao hay trung bình. Hai điểm thấp đã xử lý bằng chú thích trong `user-quota.ts`: cột
user truyền vào phải NOT NULL (hiện chỉ dùng `jobs.user_id`), và nói đúng phạm vi ảnh hưởng khi thiếu
`user_id is not null`.
