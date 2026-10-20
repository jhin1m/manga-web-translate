# Cook — Phase 7: production deploy, kill-switch ngân sách, Modal (artifact, chưa deploy thật)

Branch `feat/p7-production-deploy`, chưa merge. Chỉ phase 7; `plan.md` không sửa, phase-07 chỉ đổi `status`.

## Đã làm
- **DB** `0003_dispatches_budget` (+ down tay): bảng `dispatches`, FK `jobs.dispatch_id`, `usage_ledger.dispatch_id`
  + unique một phần (dispatch_id, kind) → **khử trùng chi phí nền tảng** (việc P2 để lại), index `created_at`.
- **Kill-switch** `billing/budget.ts`: tổng cost_usd ngày/tháng UTC vs `GLOBAL_DAILY_USD/MONTHLY_USD` (bắt buộc ở
  production, 0 = chặn). Claim: lọc job tốn tiền + queued → `paused_budget` (Mac lẫn Modal). Heartbeat: `stop:
  "paused_budget"`, hoàn attempt, `provider_retries+1` (attempt trên dây không trùng ledger), page về trạng thái
  trước claim. `mtl-jobs` tự mở lại + cảnh báo 50/80/100% (1 lần/mốc/kỳ). `pnpm budget-resume [--force]`.
- **Dispatcher** `jobs/dispatcher.ts` (5s, `DISPATCHER_ENABLED`): theo `oldest_queued_age` workspace modal, không bắn
  khi còn pending (cold start 90s → 1 dispatch), scale-up khi > 60s, `no_claim` + backoff 1'→15' + cảnh báo, phiên
  rỗng → backoff (lỗi phát hiện khi chạy thật local), HMAC-SHA256 + ts; khoá advisory. `POST /worker/v1/sessions/end`
  (chỉ token nền tảng) → `gpu_idle_seconds = lifetime − busy + scaledown`; reaper ước lượng container bị kill.
- **Giám sát**: `/healthz` (DB, MinIO, runner heartbeat, oldest_queued_age_s), ntfy (`ALERT_NTFY_URL`), log JSON
  request ở production, better-auth lấy IP từ `X-Real-IP` (Caddy đặt từ Cloudflare).
- **Worker**: `--mode drain --dispatch-id`, sessions/end, dừng khi `paused_budget`, token từ env `MTL_TOKEN` (Modal
  secret), `dispatch_auth.py`, `modal_app.py` (L4, Volume weights, onnxruntime-gpu + CUDA/cuDNN pip, `MTL_ORT_STRICT`),
  `MTL_ORT_PROVIDERS`, guardrail token ra ≤ 2000/call (`OutputTokensExceeded`, không retry trong job).
- **infra/**: systemd (mtl-api, mtl-jobs tách; backup + alert timer), Caddyfile (Full strict, files domain nosniff +
  CSP sandbox), compose prod, `deploy.sh` (git archive, current/previous, smoke, tự quay về + xoá release hỏng),
  `backup.sh`/`restore.sh` (pg_dump + mc mirror, versioning 14 ngày, kiểm sha256 + object từng page),
  `minio-setup.sh` + `minio/lifecycle.json` (**export tự xoá 7 ngày** — việc P6 để lại), `alert.sh`, `smoke.sh`.
- **Docs**: `docs/deployment-guide.md` (runbook + kết quả kiểm local + **danh sách đo thủ công chờ owner**),
  `docs/benchmarks/phase-07-prod.md` (chưa đo), cập nhật job-queue-worker, development-setup, `.env.example`.
  `phase-01-results.md` đã ghi "chưa đo", gate GO tạm — giữ nguyên.

## Kiểm
- typecheck, biome, `pnpm test` (api 133, web 52, db 3, shared 8); worker ruff/format/mypy, pytest 132 pass, 2 skip
  (thiếu weights — không tải vì không cần cho phase này).
- Docker local (stack riêng, đã dọn): compose prod healthy; `caddy adapt` OK; deploy trong node:24 (~11s/2s), smoke
  hỏng → quay về đúng bản + `previous` giữ nguyên, rollback ≤ 23s; backup → restore sang stack khác (3 page, đủ
  object); healthz/sign-up 403 ở production mode; ntfy giả nhận cảnh báo hàng đợi cũ, healthz lỗi/hồi phục, ngân
  sách 80%; dispatcher → Modal giả (kiểm HMAC bằng code Python) → `mtl-worker --mode drain` thật → sessions/end.

## Review (code-reviewer 7/10) — đã xử lý
- H1 pause ngân sách → lần chạy lại trùng attempt, usage bị bỏ khỏi ledger: **sửa** + test.
- H2 Modal có thể âm thầm chạy CPU / thiếu PYTHONPATH: **sửa** (extras CUDA, strict, PYTHONPATH) — cần xác nhận trên
  Modal thật.
- M1 thiếu đuôi scaledown trong GPU rỗi: **sửa**. M4 backup `die` không cảnh báo: **sửa** (trap EXIT).
- M5 `.env` đọc bằng bash: ghi rõ trong runbook (nháy đơn). M3 slot active bị container chết chiếm ~1h: ghi runbook.
- Chưa xử lý (có chủ đích): M2 guard 2000 < TRANSLATE_MAX 4096 (giữ đúng spec, chỉnh qua
  `MTL_MAX_OUTPUT_TOKENS_PER_CALL`), M6 sum ledger mỗi claim (ổn ở MVP), các mục Low (xem report reviewer).
- Tester: suite API cũ fail khi xáo thứ tự file (rò trạng thái DB chung); test mới không gây ra, cấu hình mặc định
  chạy tuần tự nên xanh. Một số nhánh chưa test: `callModalDrain` thật, pause `chapter.translate`, guard Gemini,
  healthz DB/MinIO down (đã kiểm tay bằng alert.sh), `drain_web`.

## Câu hỏi mở / việc chờ owner
- Mọi phép đo thủ công ở `docs/deployment-guide.md#việc-chờ-owner-đo-thủ-công` (deploy thật, restore máy khác, Modal
  cold start/chi phí, editor 12k/20k + Safari, reinpaint ≤15s, kill -9 ≤150s, export 100 trang, CBZ
  YACReader/Komga, soi mắt 5 trang, golden set + mtl bench chốt gate P1).
- Guard 2000 token/call có thể làm hỏng lô dịch 4 trang dài → đo khi có key; nâng env nếu cần.
- `/drain` phát lại trong 5' sinh thêm container (giới hạn bởi max_containers) — chấp nhận ở MVP?
