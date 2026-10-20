# Phase 7 — đo production (Modal + VPS)

> **Trạng thái: CHƯA ĐO.** Chưa deploy thật, chưa có key LLM/tài khoản Modal trong phiên triển khai (20/10/2026).
> Owner chạy theo [deployment-guide.md](../deployment-guide.md#việc-chờ-owner-đo-thủ-công) rồi điền bảng.

| Chỉ tiêu | Ngưỡng | Kết quả | Ghi chú |
|---|---|---|---|
| Cold start → trang đầu xong (Modal L4) | ≤ 40 s | chưa đo | từ lúc tạo dispatch tới `complete` đầu tiên |
| Ấm: giai đoạn 1 p50 | ≤ 10 s/trang | chưa đo | `jobs.claimed_at` → complete của `page.prepare` |
| Chi phí GPU lô 200 trang (gồm `gpu_idle_seconds`) | ≤ $1/1000 trang | chưa đo | `sum(cost_usd) where kind in ('gpu_seconds','gpu_idle_seconds')` |
| Cold start 90 s | chỉ 1 dispatch | đạt ở test tự động | `apps/api/test/dispatcher.test.ts` |
| Golden set qua Modal so Phase 1 | không kém Phase 1 | chưa đo | `mtl bench` |
| Chương KO thứ 2 | — | chưa đo | |

Truy vấn chi phí lô:

```sql
select kind, sum(quantity) q, sum(cost_usd) usd
from usage_ledger where created_at >= '<bắt đầu lô>' group by kind;
```
