# Đo câu claim: FIFO hiện tại và câu chia lượt dự kiến

Ngày đo: 2026-11-11. Postgres 17.11 (container `mtl-dev-postgres-1`, arm64). DB tạm `mtl_claim_bench` tạo từ template
DB test của API, đã xoá sau khi đo. Không đụng DB dev, không sửa code.

## Dữ liệu

| Bảng | Số dòng |
|---|---|
| `jobs` queued, priority 100, `page.prepare` | 6.000 (150 chương × 40 trang, mỗi chương một `created_at`) |
| `jobs` running (lease còn hạn) | 2 (thuộc 2 chương cũ nhất đang chờ) |
| `jobs` succeeded (lịch sử) | 30.000 (750 chương cũ) |
| `pages` | 96.000 (6.000 của chương đang chờ + 90.000 của chương cũ) |
| `user` | 20 |

Bộ lọc dùng đúng dạng của `claim()`: `status`, `run_after`, `type in (caps)`, `claimableSql('mac')` (hạn mức + tài khoản
bị khoá). `limit 1`, `for update of j skip locked`, chạy trong transaction rồi rollback.

## Kết quả `EXPLAIN (ANALYZE, BUFFERS)`

| Câu | Hàng đợi | Execution | Buffers | Plan chính |
|---|---|---|---|---|
| Hiện tại (FIFO) | 6.000 queued | **0,10 ms** | 170 | Index Scan `jobs_claim_idx` + Incremental Sort, dừng sau 41 dòng |
| Chia lượt, join bảng dẫn xuất `busy` (chọn) | 6.000 queued, `pages` 6.000 dòng | 4,1 ms | 371 | Bitmap scan `jobs_claim_idx` → sort cả 6.000 dòng |
| Chia lượt, join `busy` (chọn) | 6.000 queued, `pages` 96.000 dòng | **10,0 ms** | 2.007 | Như trên + Seq Scan `pages` để hash join |
| Chia lượt, subquery tương quan trong `ORDER BY` | 6.000 queued, `pages` 6.000 dòng | 6,1 ms | 12.372 | Chạy subquery 6.000 lần |
| Chia lượt, join `busy` (chọn) | 80 queued (2 chương, cỡ self-host) | **0,35 ms** | 581 | Index Scan `jobs_claim_idx` + nested loop `pages_pkey` |

Bảng dẫn xuất `busy` ở đây đọc qua `jobs_running_lease_idx` (2 buffer, 0,01 ms): số job đang chạy ≤ số worker. Trên
DB nhỏ planner có thể chọn index khác.

**Giới hạn của lần đo này:** chỉ đo token `mac`, không đặt hạn mức người dùng, breaker tắt. Reviewer đo thêm token
`modal` có hạn mức: câu mới lên 370 ms vì bộ lọc hạn mức chạy cho từng dòng (xem
[report phản biện](./from-code-reviewer-to-planner-red-team-fair-share-claim-plan-report.md), mục H1). `EXPLAIN ANALYZE`
cũng cộng thêm chi phí đo; thời gian thật của câu chọn ở 6.000 job là 5–8 ms.

## Nhận xét

- Câu mới phải xếp toàn bộ job đang chờ (không dừng sớm theo index được nữa), nên thời gian tăng tuyến tính theo số job
  queued: khoảng 1,7 ms cho mỗi 1.000 job khi bảng `pages` lớn.
- Không cần index mới: phần queued đã có `jobs_claim_idx` (partial), phần running có `jobs_running_lease_idx`.
- Postgres 17 chấp nhận `FOR UPDATE OF j SKIP LOCKED` khi `GROUP BY` nằm trong bảng dẫn xuất ở `FROM` (đã chạy thật).

## Mô phỏng thứ tự (SQL, cùng câu chọn)

Chương A 20 trang (tạo trước), B 5 trang, C 3 trang. Hai worker luân phiên: xong job đang giữ rồi claim tiếp.

```
toàn hệ : A0 B0 A1 B1 A2 B2 A3 B3 A4 B4 A5 C0 A6 C1 A7 C2 A8 A9 … A19
worker 1: A0 A1 A2 A3 A4 A5 A6 A7 A8 A10 A12 …
worker 2: B0 B1 B2 B3 B4 C0 C1 C2 A9 A11 A13 …
```

B bắt đầu ngay ở lượt claim thứ 2. C bắt đầu khi B hết trang chờ. Thứ tự trang trong từng chương giữ nguyên.

## Cách đo lại sau khi sửa code

Tạo DB tạm từ template DB test, nạp dữ liệu theo bảng trên bằng `generate_series`, lấy câu SQL thật từ
`.toSQL()` của query builder trong `claim()` rồi chạy `EXPLAIN (ANALYZE, BUFFERS)` trong transaction + rollback. Xoá DB tạm.
