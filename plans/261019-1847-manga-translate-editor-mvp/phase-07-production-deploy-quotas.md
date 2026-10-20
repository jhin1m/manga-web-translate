---
phase: 7
title: "Production MVP: VPS, systemd, backup, kill-switch ngân sách, Modal worker"
status: completed
priority: P1
effort: "4d"
dependencies: [3, 4, 5, 6]
---
# Phase 7: Production MVP — deploy, backup, kill-switch ngân sách, giám sát tối thiểu, Modal

## Overview
Đưa lên VPS sau Cloudflare với systemd cho **một nhóm được mời**; Modal làm GPU worker serverless (cùng giao thức pull, có bảng `dispatches`); backup Postgres **và** MinIO + 1 lần thử restore; kill-switch ngân sách toàn cục kiểm cả lúc claim; healthz + 1 kênh cảnh báo; xác nhận đăng ký chỉ qua lời mời ở production.

Control plane SaaS (quota theo workspace, BYOK, role chi tiết, admin nền tảng, audit, takedown, ToS, đối soát billing) **tách sang** [Phase 8 — Trước khi mở đăng ký công khai](./phase-08-pre-public-signup-saas.md) (red team #8). Không có RunPod (red team #9). Effort 6d → 4d.

## Requirements
- **Deploy:** VPS (API + SPA tĩnh + Postgres + MinIO), Caddy sau Cloudflare (Full strict). MinIO trên **domain riêng** (`files.<domain>`), header `nosniff`, CORS chỉ cho domain app (red team #12).
- **systemd:** `mtl-api.service` (HTTP) và `mtl-jobs.service` (reaper + dispatcher, `apps/api/src/jobs/runner.ts`) **tách unit** — API restart không làm ngừng reaper và ngược lại (red team, gộp kèm).
- **Backup (red team #8):** `pg_dump` hằng đêm + `mc mirror` bucket MinIO → đích ngoài VPS (bucket khác/nhà cung cấp khác), giữ 14 ngày; **1 lần restore thử** toàn bộ (DB + object) trên máy khác, ghi kết quả vào `docs/deployment-guide.md`.
- **Kill-switch ngân sách toàn cục (red team #14):** `GLOBAL_DAILY_USD`, `GLOBAL_MONTHLY_USD`; tổng `usage_ledger.cost_usd` (server tính) so ngưỡng:
  - kiểm **tại claim** (mọi worker, cả Mac lẫn Modal) cho loại job tốn tiền (`page.prepare`, `chapter.translate`, `page.ocr_region`): vượt → chuyển các job đó đang `queued` sang **`paused_budget`**, claim không trả job;
  - heartbeat của job đang chạy trả `stop:"paused_budget"` → worker dừng, job về `paused_budget` (không tính attempt);
  - dispatcher ngừng gọi Modal; cảnh báo ở 50/80/100%;
  - mở lại: sang ngày/tháng mới tự `paused_budget → queued`, hoặc `scripts/budget-resume.ts` (owner).
- **Guardrail token:** thinking tắt; assert `output_tokens` ≤ 2000/call, vượt → `fail(schema)` không retry; `max_output_tokens`.
- **Modal worker (red team #9, #14):** function `mtl-worker` GPU L4/T4, weights trên Modal Volume theo `models.lock.json`, `HF_HUB_OFFLINE=1`; token platform đọc từ Modal secret; chạy vòng lặp claim (`--mode drain`) tới khi queue rỗng 20s rồi thoát; `max_containers` giới hạn; `scaledown_window` 60s.
  - Mỗi container báo `POST /worker/v1/sessions/end {dispatch_id, lifetime_s, busy_s}` lúc thoát → ledger `gpu_idle_seconds = lifetime − busy` (workspace_id null = chi phí nền tảng); không báo (bị kill) → reaper ước lượng theo `scaledown_window` + `max_lifetime`.
- **Dispatcher (red team #9):** chỉ phục vụ workspace có `worker_mode='modal'` (Mac phục vụ workspace `worker_mode='mac'`; không quy tắc ưu tiên chéo). Bảng `dispatches` (id, status `pending`/`active`/`ended`/`no_claim`, created_at, first_claim_at, ended_at). Mỗi 5s:
  ```
  age = oldest_queued_age(worker_mode='modal', loại job hợp lệ, không breaker)
  open = dispatches pending (< 120s) + active
  nếu age > 0 và open = 0 và budget_ok → tạo dispatch + POST modal /drain (HMAC, kèm dispatch_id)
  nếu age > 60s và open < max_containers và budget_ok → thêm 1 dispatch
  dispatch pending > 120s không có claim → no_claim, cảnh báo, backoff 1'→2'→…→15'
  ```
- **Đăng ký chỉ qua lời mời** ở production (đã làm ở Phase 2) — kiểm lại bằng smoke test sau deploy (red team #8).
- **Giám sát tối thiểu:** log JSON (pino) → journald; `/healthz` (DB, MinIO, runner heartbeat trong `runtime_flags`); **1 kênh cảnh báo** (kênh: câu hỏi mở) với 3 điều kiện: healthz fail 2 lần liên tiếp, `oldest_queued_age` > 15 phút, ngân sách ≥ 80%.
- **Pháp lý tối thiểu cho nhóm được mời:** storage private-by-default, không link chia sẻ công khai, không train model trên dữ liệu người dùng. ToS/takedown/báo cáo vi phạm → Phase 8.

## Architecture
```
Cloudflare ─> VPS: caddy ─> mtl-api (systemd) ─> Postgres, MinIO (files.<domain>)
                         └─ SPA tĩnh
              mtl-jobs (systemd): reaper 30s + dispatcher 5s ─> dispatches ─> POST modal /drain (HMAC)
Modal container: mtl_worker.main --mode drain ── HTTPS ──> /worker/v1/claim|heartbeat|complete|fail|sessions/end
Mac worker:     mtl_worker.main --mode loop (token workspace, worker_mode='mac') ── cùng giao thức
```

## Related Code Files
Create:
- `infra/systemd/{mtl-api.service,mtl-jobs.service,mtl-backup.service,mtl-backup.timer}`, `infra/caddy/Caddyfile`, `infra/deploy.sh`, `infra/backup.sh`, `infra/alert.sh`
- `worker/modal_app.py`
- `packages/db/src/schema/dispatches.ts` + migration
- `apps/api/src/jobs/dispatcher.ts`, `apps/api/src/billing/budget.ts`, `apps/api/src/routes/health.ts`
- `apps/api/test/{dispatcher.test.ts,budget.test.ts}`
- `scripts/budget-resume.ts`
- `docs/deployment-guide.md`
Modify: `apps/api/src/jobs/{queue.ts,runner.ts}` (kiểm ngân sách ở claim, `paused_budget`), `apps/api/src/routes/worker.ts` (`sessions/end`, `stop` trong heartbeat), `worker/mtl_worker/main.py` (mode drain, báo sessions/end)

## Implementation Steps
1. Hạ tầng VPS + 2 unit systemd + Caddy + Cloudflare + MinIO domain riêng; migrate.
2. Backup Postgres + MinIO; restore thử trên máy khác.
3. `budget.ts` + kiểm tại claim + `paused_budget` + resume.
4. Worker mode `drain`; `modal_app.py` (Volume weights, GPU L4); đo cold start, thời gian/trang.
5. `dispatches` + dispatcher theo `oldest_queued_age` + HMAC + backoff `no_claim`; `sessions/end` → `gpu_idle_seconds`.
6. `/healthz` + `alert.sh` (1 kênh, 3 điều kiện).
7. Smoke test production: đăng ký không lời mời bị từ chối.
8. Chạy lại golden set qua Modal, so với Phase 1; đo chương KO thứ 2; ghi `docs/benchmarks/phase-07-prod.md`.

## Success Criteria
- [ ] Deploy từ commit sạch bằng `infra/deploy.sh` ≤ 10 phút; rollback về release trước ≤ 2 phút (symlink release + restart).
- [ ] Restart `mtl-api` không làm job kẹt: reaper vẫn chạy ở `mtl-jobs`.
- [ ] Backup DB + MinIO restore thành công trên máy khác; ảnh của 1 chương mở được trong editor sau restore.
- [ ] Modal: cold start → trang đầu xong ≤ 40s; ấm ≤ 10s/trang p50 giai đoạn 1; chi phí GPU (gồm `gpu_idle_seconds`) ≤ $1/1000 trang trên lô 200 trang.
- [ ] Cold start kéo dài 90s → chỉ 1 dispatch, không bắn lại; 1 worker Mac giữ lease ở workspace `mac` không chặn Modal phục vụ workspace `modal`.
- [ ] Đặt `GLOBAL_DAILY_USD` thấp → claim trả rỗng cho job tốn tiền ở cả Mac và Modal trong ≤ 1 chu kỳ, job đang chạy dừng về `paused_budget`, không mất artifact.
- [ ] Cảnh báo tới kênh đã chọn khi tắt Postgres (healthz) và khi queue cũ > 15 phút.
- [ ] Đăng ký không có lời mời ở production → bị từ chối.

## Risk Assessment
| Rủi ro | K×A | Giảm thiểu |
|---|---|---|
| Cold start/idle tail đội chi phí | Cao × TB | Volume weights, drain gộp nhiều trang/container, scaledown 60s, max_containers, ghi `gpu_idle_seconds` |
| Dispatcher bắn trùng → nhiều GPU | TB × TB | Bảng `dispatches`, không bắn khi có dispatch mở, backoff `no_claim` (red team #9) |
| Thinking/token bùng | TB × Cao | Assert token/call, kill-switch kiểm ở claim, cảnh báo 50/80/100% |
| Lock-in Modal | TB × TB | Worker giống nhau mọi nơi, Dockerfile chung khi cần chuyển nhà cung cấp (không viết trước) |
| Mất ảnh dù còn DB | Thấp × Cao | Backup MinIO + restore thử (red team #8) |
| Bản quyền nội dung khi host cho nhóm mời | TB × TB | Private-by-default, invite-only; takedown đầy đủ ở Phase 8 trước khi mở công khai |

Rollback: release theo thư mục + symlink; tắt dispatcher (env `DISPATCHER_ENABLED=false`) → chỉ worker Mac (đổi `worker_mode`); kill-switch ngân sách = đặt ngưỡng 0.
