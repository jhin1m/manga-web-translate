# Đo câu chọn job sau khi sửa: chia lượt theo chương + bộ lọc hạn mức mới

Ngày đo: 2026-11-11. Postgres 17.11 (container `mtl-dev-postgres-1`, arm64). DB tạm `mtl_claim_bench` tạo từ template
DB test của API, **đã xoá sau khi đo**. Không đụng DB dev.

## Kết luận

**Đạt mục tiêu đo: ở cả 24 ô, câu mới ≤ câu cũ + 1 ms và không tăng theo độ dài hàng đợi.**

- Bản đầu của thay đổi này (commit `38e4f38`) xếp theo "số job đang chạy của chương" trong một câu duy nhất. Khoá xếp đó
  không có trong index nên Postgres phải xếp mọi job đang chờ: 8–19 ms ở 6.000 job chờ, 17–34 ms ở 20.000, chậm hơn câu
  cũ từ vài chục tới hơn trăm lần khi không hạn mức. Quyết định "chấp nhận số đo, nới ngưỡng" đã bị rút lại; số đo của
  bản đó giữ ở cuối file làm lịch sử.
- Bản hiện tại (commit `0ba6998` + `8256523`) chọn ứng viên theo hai nhánh có LIMIT rồi mới xếp và khoá. Thứ tự claim
  không đổi.
  - Không hạn mức: 0,43–1,04 ms ở mọi cỡ hàng đợi (câu cũ 0,14–0,26 ms), chênh nhiều nhất +0,78 ms.
  - Có hạn mức: 2,35–3,33 ms (câu cũ 4,0–4,8 ms), nhanh hơn câu cũ 1,3–1,8 ms.
  - 6.000 → 20.000 job chờ: không tăng (0,66–1,04 ms so với 0,63–0,83 ms).
- Ngoài ma trận: khi đầu hàng là 2 chương đang bận, mỗi chương còn 999 job chờ, câu mới mất 2,8–4,2 ms không hạn mức
  (câu cũ 0,9–1,6 ms), tức chênh +1,9 đến +2,6 ms. Chi phí này theo số job chờ của các chương đang chạy (tối đa số
  worker × 1.000 trang), không theo độ dài hàng đợi. Có hạn mức thì câu cũ ở trường hợp này mất 96–105 ms, câu mới
  4,5–5,9 ms.

## Lượt đo 2 (bản hai nhánh, commit `8256523`)

Cùng máy, cùng cách đo với lượt 1, DB tạm `mtl_claim_bench` đã xoá sau khi đo.

- Dữ liệu như lượt 1 (20 user, 30.000 job lịch sử, 20.000 dòng ledger hôm nay + 50 dòng `user_id` NULL, 2 job đang
  chạy thuộc 2 chương cũ nhất đang chờ, payload `page.prepare` gọi LLM có 2 slot). Hàng đợi 19.998 job = 500 chương ×
  40 trang (110.000 trang); 5.998 và 78 job là cùng DB sau khi huỷ bớt job chờ rồi `VACUUM ANALYZE`.
- Ba câu đo xen kẽ trong cùng phiên `psql`, 9 vòng sau 1 vòng làm nóng, `\timing`, trung vị. Thời gian gồm cả lập kế
  hoạch (câu gửi dạng văn bản, `LIMIT 1`).
  - "Câu cũ": commit `ef1e70c` (FIFO + bộ lọc hạn mức tương quan).
  - "Xếp cả hàng đợi": commit `38e4f38`.
  - "Câu mới": `pickClaimableSql()` ở `8256523` (đã có `cand as materialized`), SQL lấy từ `PgDialect.sqlToQuery()`.
    Bảng dưới là lượt đo sau khi thêm `materialized`; lượt đo ngay trước đó (chưa có) cho kết quả tương đương
    (chênh nhiều nhất +0,68 ms).
- Cột "EXPLAIN" là `Execution Time` của `EXPLAIN (ANALYZE, BUFFERS)`, không gồm lập kế hoạch.
- Đơn vị ms.

### 5.998 job chờ

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | EXPLAIN cũ / mới |
|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,18 | 10,72 | 0,72 (0,92) | +0,54 | 0,178 / 0,731 |
| không | mac | bật | 0,22 | 12,32 | 0,81 (0,99) | +0,59 | 0,205 / 0,874 |
| không | modal | tắt | 0,16 | 10,08 | 0,66 (1,15) | +0,5 | 0,162 / 0,663 |
| không | modal | bật | 0,26 | 14,88 | 1,04 (1,53) | +0,78 | 0,221 / 0,85 |
| có | mac | tắt | 4,36 | 13,03 | 2,85 (3,06) | -1,51 | 5,013 / 3,202 |
| có | mac | bật | 4,26 | 16,54 | 3,0 (3,34) | -1,26 | 6,011 / 3,398 |
| có | modal | tắt | 4,35 | 13,22 | 2,86 (3,11) | -1,49 | 5,162 / 3,111 |
| có | modal | bật | 4,81 | 17,9 | 3,33 (4,16) | -1,48 | 5,959 / 3,266 |

### 19.998 job chờ

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | EXPLAIN cũ / mới |
|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,17 | 18,09 | 0,63 (0,83) | +0,46 | 0,171 / 0,612 |
| không | mac | bật | 0,21 | 28,95 | 0,73 (0,82) | +0,52 | 0,203 / 0,649 |
| không | modal | tắt | 0,16 | 17,44 | 0,65 (0,8) | +0,49 | 0,156 / 0,589 |
| không | modal | bật | 0,21 | 29,79 | 0,83 (1,06) | +0,62 | 0,229 / 0,727 |
| có | mac | tắt | 4,31 | 22,6 | 2,77 (2,89) | -1,54 | 4,88 / 2,884 |
| có | mac | bật | 4,3 | 33,94 | 2,81 (3,05) | -1,49 | 5,477 / 3,83 |
| có | modal | tắt | 4,33 | 21,2 | 2,72 (3,2) | -1,61 | 5,258 / 3,21 |
| có | modal | bật | 4,35 | 31,89 | 2,86 (3,47) | -1,49 | 4,885 / 2,934 |

### 78 job chờ

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | EXPLAIN cũ / mới |
|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,18 | 0,27 | 0,5 (0,66) | +0,32 | 0,215 / 0,603 |
| không | mac | bật | 0,21 | 0,31 | 0,62 (0,72) | +0,41 | 0,204 / 0,551 |
| không | modal | tắt | 0,14 | 0,2 | 0,43 (0,54) | +0,29 | 0,16 / 0,464 |
| không | modal | bật | 0,19 | 0,27 | 0,52 (0,58) | +0,33 | 0,186 / 0,579 |
| có | mac | tắt | 4,05 | 2,12 | 2,38 (2,72) | -1,67 | 4,738 / 2,849 |
| có | mac | bật | 4,16 | 2,26 | 2,51 (2,65) | -1,65 | 4,888 / 2,816 |
| có | modal | tắt | 4,0 | 2,1 | 2,35 (2,51) | -1,65 | 4,694 / 2,962 |
| có | modal | bật | 4,27 | 2,32 | 2,51 (2,69) | -1,76 | 4,764 / 3,007 |

### 21.918 job chờ, đầu hàng là 2 chương bận × 999 job chờ (ngoài ma trận)

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | EXPLAIN cũ / mới |
|---|---|---|---|---|---|---|---|
| không | mac | tắt | 1,08 | 23,43 | 3,43 (4,03) | +2,35 | 1,949 / 3,426 |
| không | mac | bật | 1,62 | 35,99 | 4,19 (10,35) | +2,57 | 3,542 / 5,548 |
| không | modal | tắt | 0,87 | 20,01 | 2,75 (3,44) | +1,88 | 1,723 / 3,397 |
| không | modal | bật | 1,41 | 30,48 | 3,56 (3,7) | +2,15 | 2,168 / 4,815 |
| có | mac | tắt | 96,3 | 23,22 | 4,48 (5,53) | -91,82 | 109,411 / 5,273 |
| có | mac | bật | 95,57 | 34,13 | 5,65 (6,51) | -89,92 | 115,202 / 6,641 |
| có | modal | tắt | 104,95 | 22,83 | 5,06 (5,62) | -99,89 | 113,677 / 5,328 |
| có | modal | bật | 101,42 | 34,11 | 5,93 (7,39) | -95,49 | 116,175 / 6,746 |

### Vì sao câu mới không còn theo độ dài hàng đợi

`EXPLAIN (ANALYZE, BUFFERS)` ô 5.998 job, modal, có hạn mức, breaker bật.

Câu cũ (4,83 ms, 11.988 buffer): đi theo index và dừng sau 40 dòng, nhưng cộng lại ledger cho từng dòng.

```
Limit → LockRows → Incremental Sort (priority, created_at | ord, id)
  Index Scan jobs_claim_idx on jobs            rows=40
    SubPlan hạn mức: Bitmap Heap Scan usage_ledger rows=1000 loops=40     ← 11.801 buffer
  Index Scan pages_pkey                        loops=40
```

Câu mới (khoảng 3 ms khi có đo đạc, ~1.200 buffer; plan chụp ở bản chưa `materialized`, bản cuối chỉ khác ở chỗ `cand`
được đọc một lần vào bộ nhớ rồi mới ghép với `jobs`):

```
CTE busy:       Index Scan jobs_running_lease_idx        rows=2
CTE over_quota: HashAggregate usage_ledger rows=20000, 1 lần    2,34 ms   (không hạn mức: never executed)
Limit → LockRows → Incremental Sort → Merge Append
  nhánh chương rảnh: Limit 33 ← Incremental Sort (priority, created_at | ord, id)
      Index Scan jobs_claim_idx on jobs        rows=41, bỏ 78 dòng của chương bận ở đầu hàng
      Index Scan pages_pkey                    loops=41
  nhánh chương bận:  Limit 33 ← Sort
      Bitmap Heap Scan jobs qua jobs_chapter_idx, 2 chương, 78 dòng
  Index Scan jobs_pkey (khoá)                  ≤ 66 dòng
```

- Nhánh chương rảnh đi theo `jobs_claim_idx` đúng thứ tự và dừng sớm ở mọi ô, kể cả ô ngoài ma trận (bỏ qua 1.998 dòng
  của chương bận ở đầu hàng rồi dừng).
- Không hạn mức thì CTE `over_quota` không được tính (`never executed`).
- Phần chênh +0,5 ms so với câu cũ khi không hạn mức: khoảng một nửa là lập kế hoạch (0,8–1,3 ms so với 0,5 ms của câu
  cũ, câu dài hơn), còn lại là nhánh chương bận và bước khoá.

### Đánh đổi của cách hai nhánh

Mỗi nhánh đọc trước `max + 32` dòng (`CLAIM_LOOKAHEAD`). Nếu chừng đó dòng đầu của cả hai nhánh đều đang bị transaction
khác khoá thì lượt claim trả rỗng dù phía sau còn job; worker nghỉ một nhịp backoff rồi claim lại. Với worker thật
(`max = 1`) cần hơn 33 lượt claim đang mở cùng lúc.

## Lượt đo 1 (bản xếp cả hàng đợi, commit `38e4f38`): dữ liệu

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

## Lượt đo 1: cách đo

- SQL lấy từ `.toSQL()` của Drizzle, tham số thay bằng hằng. "Sau" là `pickClaimable()` trong
  `apps/api/src/jobs/queue.ts`. "Trước" là câu ở commit `ef1e70c` (thứ tự FIFO + bộ lọc hạn mức tương quan).
  "Giữa" = thứ tự mới + bộ lọc hạn mức cũ.
- Mỗi ô: làm nóng 1 lần, rồi 5 vòng xen kẽ trước / giữa / sau trong cùng một phiên `psql`, `\timing`, mỗi câu trong
  `BEGIN … ROLLBACK`, `LIMIT 1`. Số ghi là trung vị thời gian thật.
- Nhiễu của máy đo khoảng ±3 ms ở cỡ 6.000 job. Đo lại 15 vòng (cột "lần 2") để xem độ ổn định.

## Lượt đo 1: kết quả, 6.000 job chờ (ngưỡng cũ 15 ms)

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

## Lượt đo 1: kết quả, 78 job chờ (ngưỡng cũ 1 ms)

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

## Lượt đo 1: ô vượt ngưỡng

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

## Lượt đo 1: thử nhanh một dạng câu khác (không đưa vào code)

Thay `LEFT JOIN pages` bằng subquery vô hướng trong `ORDER BY` (`(select ord from pages where id = jobs.page_id)`):
ô modal + hạn mức + breaker còn 12,7 ms (so với 16,0 ms cùng phiên), ô mac không rõ khác biệt vì nhiễu
(18,0 so với 18,8 ms). Chưa đủ số liệu để kết luận.

## Kiểm validator hạn mức

Hạn mức âm không vào được hệ thống: env `USER_DAILY_USD` qua `z.coerce.number().nonnegative()` (`apps/api/src/env.ts:10`),
admin qua `z.number().finite().min(0)` (`apps/api/src/routes/admin-settings.ts:56`). Nhánh `limit <= 0` của bộ lọc mới
vì vậy chỉ gặp giá trị 0, và vẫn giữ nghĩa cũ nếu có số âm ghi thẳng vào DB.

## Test

- `pnpm --filter @mtl/api test` trước mọi thay đổi: 57 file, 529 qua, 1 bỏ qua (có từ trước). Ở HEAD: 540 qua, 1 bỏ qua.
- 11 ca mới: 10 ca thứ tự claim trong `queue.test.ts`, 1 ca ledger `user_id` NULL trong `user-quota.test.ts`.
- **Không phải sửa kỳ vọng của test nào**, kể cả khi đổi sang câu hai nhánh. Test export-trước-backlog và test 1.000
  job giữ nguyên.
- Ba ca thêm cho câu hai nhánh: (a) kết nối thứ hai giữ khoá 3 dòng đầu hàng → claim trả dòng kế, cả khi chương rảnh
  lẫn khi chương đã bận; (b) chương bận có nhiều job chờ hơn số dòng đọc trước đứng đầu hàng → chương rảnh phía sau
  vẫn được chọn trước; (c) mọi chương chờ đều bận → chương ít job chạy hơn đi trước, dù chương kia tạo trước và có
  nhiều job chờ hơn số dòng đọc trước.
- Đã thử làm hỏng code để xem test có bắt được không:
  - bản xếp cả hàng đợi: bỏ khoá xếp "số job đang chạy" → 4 ca đỏ; bỏ điều kiện lease còn hạn → 1 ca đỏ; chỉ đếm job
    `page.prepare` → 1 ca đỏ; bỏ `user_id is not null` trong bộ lọc hạn mức → ca ledger NULL đỏ;
  - bản hai nhánh: số dòng đọc trước = 0 → ca (a) đỏ; bỏ `chapter_id is null or` → ca job không gắn chương đỏ; nhánh
    chương rảnh không lọc chương bận → 6 ca đỏ; tắt nhánh chương bận → 12 ca đỏ; nhánh chương bận không xếp theo số
    job chạy → ca (c) đỏ; tầng ngoài không kiểm lại `status` → ca 4 luồng claim trên 6 chương đỏ (trùng job), 2/2 lần.

## Smoke 2 worker, tiến trình native (ở commit `38e4f38`, trước khi đổi sang câu hai nhánh)

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

- Commit `6c29f78`, `38e4f38`: không có phát hiện mức cao hay trung bình. Hai điểm thấp đã xử lý bằng chú thích trong
  `user-quota.ts` (cột user truyền vào phải NOT NULL; nói đúng phạm vi ảnh hưởng khi thiếu `user_id is not null`).
- Commit `0ba6998`: không có lỗi đúng / sai. Reviewer so thứ tự với bản một câu trên 1.800 lượt dữ liệu ngẫu nhiên (0
  lần lệch), kiểm khoá dòng bằng `pgrowlocks` (chỉ khoá đúng các dòng trả về), thử tranh chấp bằng 2 phiên. Một phát
  hiện mức trung bình có số đo: `cand` không `materialized` nên mỗi lần Postgres kiểm lại một dòng vừa bị transaction
  khác sửa, cả hai nhánh chạy lại (≈ 3,5 ms mỗi lần đụng nhau trên dữ liệu 2 chương bận × 1.000 job). Đã sửa ở
  `8256523` và đo lại cả ma trận.

## Smoke bằng image Docker (câu hai nhánh)

**Đã chạy trên code cuối (commit `8256523`), đạt.** `infra/selfhost-smoke.sh` (`SMOKE_KEEP=1`, cổng 18090, model nạp
từ `worker/models`): `SMOKE OK` sau 66 s; image app có `cand as materialized`. Trên chính stack đó, 2 worker trong
container, commit 2 chương dừng ở bước xoá chữ (chương 1: 12 trang; chương 2: 3 trang, job tạo trước 0,15 s). 15/15 job
xong, mọi job `attempts = 1`, chi phí $0, log app / jobs / worker không có dòng lỗi. Stack và thư mục tạm đã dọn.

| Lượt claim | Chương | Trang | Worker | `claimed_at` (UTC) |
|---|---|---|---|---|
| 1 | 2 | 0 | 1ded… | 07:44:39.542 |
| 2 | 1 | 0 | d61a… | 07:44:39.705 |
| 3 | 2 | 1 | 1ded… | 07:44:42.858 |
| 4 | 1 | 1 | d61a… | 07:44:43.316 |
| 5 | 2 | 2 | 1ded… | 07:44:45.469 |
| 6 | 1 | 2 | d61a… | 07:44:45.794 |
| 7–15 | 1 | 3–11 | hai worker xen kẽ | 07:44:47.918 … 07:44:57.613 |

Mỗi worker giữ một chương cho tới khi chương ngắn hết trang; chương 1 bắt đầu ở lượt 2 khi chương 2 (tạo job trước)
còn 2 trang chờ. Với thứ tự FIFO cũ, lượt 2 sẽ là trang 1 của chương 2.

Lần chạy đầu, ở commit `0ba6998`: **đạt.** `infra/selfhost-smoke.sh` trên working tree ở commit `0ba6998` (`SMOKE_KEEP=1`, cổng 18090, model
nạp từ `worker/models`): build 2 image, `docker compose` với project `mtl-smoke` trong thư mục tạm, kết thúc bằng
`SMOKE OK` sau 71 s (SPA, upload, `page.prepare`, export, OCR thật, down/up giữ dữ liệu, backup khi khởi động lại, cổng
+ quyền file). Image app có code mới (`CLAIM_LOOKAHEAD` trong `src/jobs/queue.ts` của container). Không gọi LLM, chi phí
$0, không cần API key. Stack, thư mục tạm và dữ liệu đã dọn; không đụng dữ liệu dev.

Trên chính stack đó (2 worker trong container, `threads=6` mỗi worker), commit thêm 2 chương dừng ở bước xoá chữ:
chương 1 có 12 trang, chương 2 có 3 trang. Job của chương 2 được tạo trước 0,17 s. Mọi job `attempts = 1`, 15/15 xong.

| Lượt claim | Chương | Trang | Worker | `claimed_at` (UTC) |
|---|---|---|---|---|
| 1 | 2 | 0 | cb9c… | 07:27:13.826 |
| 2 | 1 | 0 | 68ca… | 07:27:13.998 |
| 3 | 2 | 1 | cb9c… | 07:27:18.195 |
| 4 | 2 | 2 | 68ca… | 07:27:18.202 |
| 5–15 | 1 | 1–11 | hai worker xen kẽ | 07:27:20.976 … 07:27:34.439 |

- Hai chương chồng thời gian từ job đầu: chương 1 bắt đầu ở lượt 2 khi chương 2 (tạo job trước) còn 2 trang chờ. Với
  thứ tự FIFO cũ, lượt 2 sẽ là trang 1 của chương 2.
- Lượt 3 và 4 cách nhau 7 ms và cùng vào chương 2: đây là trường hợp hai claim trùng thời điểm đã nêu ở quyết định 3
  (transaction claim của worker kia chưa commit nên chưa được đếm). Worker thứ hai bỏ qua dòng đang khoá và lấy trang kế
  của chương 2; không trùng job, lệch đúng một lượt, sau đó chỉ còn chương 1.
- Log của app, jobs và worker không có dòng lỗi nào.
- Giới hạn: lượt chạy này không phân biệt được bản xếp cả hàng đợi với bản hai nhánh (cùng thứ tự); nó xác nhận image
  build từ HEAD chạy đúng thứ tự chia lượt với 2 worker trong container.
