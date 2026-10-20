# Deploy production (MVP, nhóm được mời) — runbook

VPS chạy API + SPA tĩnh + Postgres + MinIO sau Cloudflare; worker GPU là Modal (serverless) hoặc Mac của nhóm.
Artifact trong repo: `infra/` (systemd, Caddy, compose prod, deploy/backup/restore/alert/smoke) và
`worker/modal_app.py`. **Chưa deploy thật** — mọi bước dưới đây đã kiểm bằng Docker local (xem
[Kết quả kiểm local](#kết-quả-kiểm-local-20102026)); phần cần owner làm trên hạ tầng thật ở
[Việc chờ owner](#việc-chờ-owner-đo-thủ-công).

```
Cloudflare (Full strict) ─> VPS: caddy ─┬─> mtl-api (systemd, :8787) ─> Postgres, MinIO (127.0.0.1, docker)
                                        ├─> SPA tĩnh (current/apps/web/dist)
                                        └─> files.<domain> ─> MinIO (nosniff, CORS chỉ app domain)
                         mtl-jobs (systemd): reaper 30s + kill-switch ngân sách + dispatcher 5s ─> POST Modal /drain (HMAC)
Modal container: mtl-worker --mode drain ── HTTPS ──> /worker/v1/claim|heartbeat|complete|fail|sessions/end
Mac worker:      mtl-worker --mode loop (token workspace, worker_mode='mac') ── cùng giao thức
```

## 1. Chuẩn bị VPS (1 lần)

Ubuntu/Debian, Node 24 + corepack (pnpm theo `packageManager`), Docker + Compose v2, Caddy 2, `postgresql-client-17`
(pg_dump/pg_restore cùng major với server), `mc` (MinIO client), `curl`, `git`.

```bash
sudo useradd -r -m -d /srv/mtl -s /bin/bash mtl
sudo -u mtl git clone <repo> /srv/mtl/repo
sudo -u mtl mkdir -p /srv/mtl/{releases,shared}
sudo -u mtl install -m 600 /dev/null /srv/mtl/shared/.env   # điền theo mục 2
docker compose -f /srv/mtl/repo/infra/docker-compose.prod.yml --env-file /srv/mtl/shared/.env -p mtl up -d --wait
```

`mtl` cần quyền `sudo systemctl restart mtl-api mtl-jobs` và `sudo systemctl reload caddy` (sudoers chỉ 2 lệnh này).

## 2. Biến môi trường (`/srv/mtl/shared/.env`, quyền 600)

Như `.env.example` + giá trị production. File được đọc bởi Node, systemd (`EnvironmentFile`) **và** bash
(`deploy.sh`, `alert.sh`): giá trị có ký tự đặc biệt (`$ & ; space #`) phải đặt trong nháy đơn.

| Biến | Ghi chú |
|---|---|
| `NODE_ENV=production` | bật log JSON, bắt buộc có ngưỡng ngân sách |
| `DATABASE_URL`, `PG_PASSWORD` | Postgres compose (127.0.0.1:5432) |
| `BETTER_AUTH_SECRET` (≥ 32), `BETTER_AUTH_URL=https://<app>`, `WEB_ORIGIN=https://<app>` | |
| `S3_ENDPOINT=http://127.0.0.1:9000`, `S3_ACCESS_KEY/SECRET_KEY`, `S3_BUCKET` | MinIO compose |
| `FILES_DOMAIN=files.<domain>`, `FILES_SCHEME=https` | presigned URL ký theo host này |
| `GLOBAL_DAILY_USD`, `GLOBAL_MONTHLY_USD` | kill-switch, xem mục 6 |
| `DISPATCHER_ENABLED`, `MODAL_DRAIN_URL`, `MODAL_DRAIN_SECRET` (≥ 32) | Modal, xem mục 5 |
| `MODAL_MAX_CONTAINERS=2`, `MODAL_SCALEDOWN_S=60`, `MODAL_MAX_LIFETIME_S=3600` | **khớp** `worker/modal_app.py` |
| `ALERT_NTFY_URL=https://ntfy.sh/<topic-ngẫu-nhiên>` | kênh cảnh báo duy nhất |
| `BACKUP_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY`, `BACKUP_BUCKET` | đích backup ở nhà cung cấp **khác** |
| Caddy: `APP_DOMAIN`, `FILES_DOMAIN`, `ORIGIN_CERT`, `ORIGIN_KEY`, `MTL_ROOT=/srv/mtl` | `systemctl edit caddy` → `EnvironmentFile=` |

## 3. Cloudflare + Caddy

- DNS: `<app>` và `files.<app>` → IP VPS, proxied. SSL/TLS = **Full (strict)**; tạo **Origin Certificate** (cả 2
  host) → `ORIGIN_CERT`/`ORIGIN_KEY` (quyền đọc cho user caddy). Firewall VPS chỉ mở 443 cho dải IP Cloudflare + SSH.
- `sudo ln -sf /srv/mtl/current/infra/caddy/Caddyfile /etc/caddy/Caddyfile` — Caddyfile đi theo release, deploy reload.
- Caddy giải IP client từ `CF-Connecting-IP` (trusted_proxies = dải Cloudflare) và gửi `X-Real-IP` cho API → rate
  limit better-auth theo IP thật. Dải IP Cloudflare đổi → cập nhật Caddyfile.
- Upload qua Cloudflare bị giới hạn 100 MB/request (gói Free) — trần upload hiện tại nhỏ hơn.

## 4. systemd + deploy / rollback

```bash
sudo ln -sf /srv/mtl/current/infra/systemd/mtl-*.{service,timer} /etc/systemd/system/   # sau deploy đầu tiên
sudo systemctl daemon-reload
sudo systemctl enable --now mtl-api mtl-jobs mtl-backup.timer mtl-alert.timer
```

- `mtl-api` (HTTP) và `mtl-jobs` (reaper + dispatcher + ngân sách) **tách unit**: restart API không làm job kẹt.
- `infra/deploy.sh <ref>`: `git archive` commit → `releases/<utc>-<sha12>` → `pnpm install --frozen-lockfile`, build
  SPA, `pnpm db:migrate` → `minio-setup.sh` (bucket private + lifecycle export 7 ngày) → đổi symlink `current`
  (nguyên tử) → restart → `smoke.sh` (healthz 200 + đăng ký không lời mời bị 403 *do cổng lời mời*). Smoke hỏng →
  tự quay về bản đang chạy, xoá release hỏng, cảnh báo.
- `infra/deploy.sh rollback`: đổi `current` ↔ `previous` + restart + smoke, không build/migrate.
- Migration chỉ thêm (additive) nên rollback app không cần down DB; down tay ở `packages/db/migrations-down/`.
- Mỗi lần dừng vì ngân sách tăng `provider_retries` (để số attempt trên dây không trùng ledger) → job bị dừng/mở lại
  > 20 lần sẽ `failed` ở lỗi provider kế tiếp.
- Container chết không báo chiếm slot `active` tới khi reaper ước lượng (~`MAX_LIFETIME + SCALEDOWN`); trong lúc đó
  dispatcher không scale-up quá `MODAL_MAX_CONTAINERS`.
- Khẩn cấp: `DISPATCHER_ENABLED=false` (chỉ worker Mac, đổi `worker_mode` workspace), hoặc kill-switch = đặt ngưỡng 0.

Log: `journalctl -u mtl-api -o cat` (JSON mỗi request: method, path, status, ms — không query/header/body),
`journalctl -u mtl-jobs`.

## 5. Modal worker

```bash
cd worker
uv run python scripts/fetch_models.py                     # tải + kiểm sha256 theo models.lock.json
modal volume create mtl-models && modal volume put mtl-models models/ /
pnpm worker-token create --name modal --platform --out ./modal.token   # token nền tảng, file 600
modal secret create mtl-worker MTL_TOKEN="$(cat modal.token)" MTL_API_URL=https://<app> \
  MODAL_DRAIN_SECRET=<trùng .env> GEMINI_API_KEY=<…>
rm modal.token
modal deploy modal_app.py                                 # URL app `mtl-drain` → MODAL_DRAIN_URL=<url>/drain
```

- `drain` (GPU L4, `MODAL_GPU=T4` để thử rẻ hơn): onnxruntime-gpu + CUDA/cuDNN qua pip, `MTL_ORT_STRICT=1` (thiếu
  CUDA → worker dừng, không âm thầm chạy CPU — kiểm log lần deploy đầu), weights từ Volume,
  `HF_HUB_OFFLINE=1`, chạy `mtl-worker --mode drain` tới khi hàng đợi rỗng 20s, báo
  `POST /worker/v1/sessions/end {dispatch_id, lifetime_s, busy_s}` → ledger `gpu_idle_seconds = lifetime − busy +
  MODAL_SCALEDOWN_S` (đuôi rỗi sau khi function trả về; workspace null = chi phí nền tảng, 1 dòng/dispatch). Bị kill không kịp báo → `mtl-jobs` ước lượng = `MODAL_SCALEDOWN_S` sau
  `MAX_LIFETIME + SCALEDOWN`.
- Endpoint `/drain` kiểm HMAC-SHA256 body `{dispatch_id, ts}` (`x-mtl-signature`), ts lệch > 5' → 401;
  hợp lệ → `drain.spawn()` trả 202. **Chấp nhận cho MVP (controller chốt 20/10/2026):** request hợp lệ bị gửi lại
  trong cửa sổ 5' sinh thêm container (cùng dispatch_id), luôn trong giới hạn `max_containers`; container thừa thấy
  hàng đợi rỗng sẽ thoát sau 20s. Chống phát lại triệt để (Modal Dict lưu dispatch_id đã nhận) để sau MVP.
- Dispatcher (5s) chỉ phục vụ workspace `worker_mode='modal'`: dispatch đầu khi có job đủ điều kiện và không có
  dispatch mở; thêm 1 khi job cũ > 60s, **không còn dispatch pending** và active < max; pending > 120s không claim →
  `no_claim` + backoff 1'→2'→4'→8'→15' + cảnh báo; container thoát mà không chạy job nào → cũng backoff (tránh vòng
  container rỗng); phiên có việc → hết backoff. Hết ngân sách → không dispatch.
- Worker Mac: token workspace (file 600 hoặc Keychain, xem [job-queue-worker.md](./job-queue-worker.md)), chỉ nhận
  job workspace `mac`; không chặn Modal phục vụ workspace `modal`.

## 6. Kill-switch ngân sách + guardrail token

- `GLOBAL_DAILY_USD` / `GLOBAL_MONTHLY_USD`: tổng `usage_ledger.cost_usd` (server tính, gồm GPU rỗi) theo ngày/tháng
  **UTC**. Vượt → claim (Mac lẫn Modal) không trả `page.prepare`/`chapter.translate`/`page.ocr_region`, job đó đang
  `queued` → `paused_budget`; heartbeat job đang chạy trả `stop:"paused_budget"` → worker dừng, job về
  `paused_budget` (không tính attempt, page về trạng thái trước claim, artifact đã ghi giữ nguyên); dispatcher dừng.
- Mở lại: hết vượt (sang ngày/tháng mới hoặc nâng ngưỡng + restart) → `mtl-jobs` tự `paused_budget → queued`;
  hoặc `pnpm budget-resume` (in trạng thái; `--force` mở lại kể cả khi còn vượt).
- Cảnh báo 50/80/100% mỗi mốc 1 lần/kỳ (ngày, tháng) qua ntfy.
> **⚠️ Bắt buộc sau khi đo có key LLM:** trần guardrail mặc định **2000 token ra/call** (đúng spec) thấp hơn
> `max_output_tokens` của lô dịch (tới **4096**, `TRANSLATE_MAX_OUTPUT_TOKENS`) → lô dịch 4 trang dài có thể bị
> loại (`schema`) dù hợp lệ. Chạy golden set/`mtl bench`, xem phân bố `output_tokens` mỗi call dịch rồi đặt
> `MTL_MAX_OUTPUT_TOKENS_PER_CALL` (env worker Mac + Modal secret) cho phù hợp, tối đa 4096.

- Worker: thinking tắt, `max_output_tokens` theo loại call, **assert token ra ≤ 2000/call**
  (`MTL_MAX_OUTPUT_TOKENS_PER_CALL`) → vượt = lỗi `schema`, không gọi lại trong job (hàng đợi tính attempt). Server
  vẫn clamp riêng (`apps/api/src/billing/prices.ts`).

## 7. Backup + restore

```bash
infra/backup.sh init        # 1 lần: bucket đích, versioning, lifecycle (dump 14 ngày, object bị xoá giữ 14 ngày)
systemctl start mtl-backup  # chạy tay lần đầu; timer 03:30 UTC hằng đêm
```

- `backup.sh`: `pg_dump -Fc` + `.sha256` → `<đích>/pg/`; `mc mirror --remove` bucket → `<đích>/objects/`. Lỗi →
  ntfy (urgent).
- `restore.sh [mtl-<stamp>.dump|latest]` trên máy **khác**, DB đích rỗng: kiểm sha256 → `pg_restore` →
  `minio-setup.sh` → mirror object → kiểm mọi `pages.original_key` có object. Biến: `RESTORE_DATABASE_URL`, `S3_*`
  (đích), `BACKUP_S3_*`.
- Ghi kết quả lần restore thử thật vào bảng dưới.

| Ngày | Nơi | Dump | Page / object | Mở chương trong editor | Ghi chú |
|---|---|---|---|---|---|
| 20/10/2026 | Docker local (2 stack + MinIO "offsite" riêng) | 56 KB | 3 / 3 khớp | chưa (không có UI ở bài thử) | thử kỹ thuật, không phải máy khác thật |
| _chờ owner_ | máy khác thật | | | | |

## 8. Giám sát

- `GET /healthz` (không auth): 200 khi DB + MinIO + runner (`runtime_flags.runner_heartbeat` < 90s) ổn, ngược lại
  503; kèm `oldest_queued_age_s`.
- `infra/alert.sh` (timer 1'): healthz lỗi 2 lần liên tiếp → urgent (báo lặp tối đa 1 lần/giờ, báo hồi phục);
  hàng đợi cũ > 15' → high. Ngân sách 50/80/100% và Modal `no_claim` do `mtl-jobs` báo — cùng 1 topic ntfy.

## 9. Pháp lý tối thiểu (nhóm được mời)

Đăng ký chỉ qua lời mời (smoke kiểm sau mỗi deploy); bucket private (`mc anonymous set none`), chỉ presigned URL
TTL ngắn, không link chia sẻ công khai; không train model trên dữ liệu người dùng. ToS/takedown → Phase 8.

## Kết quả kiểm local (20/10/2026)

| Hạng mục | Cách kiểm | Kết quả |
|---|---|---|
| Compose prod | 2 stack `docker-compose.prod.yml` (nguồn, đích) + MinIO offsite | healthy |
| Caddyfile | `caddy adapt` (image caddy:2) | hợp lệ |
| Deploy | `deploy.sh` trong `node:24-bookworm` (clone sạch, systemctl giả chờ process thoát như systemd) | lần đầu ~11s, lần sau ~2s; smoke qua |
| Smoke hỏng | release ném lỗi lúc start | quay về bản đang chạy, xoá release hỏng, `previous` giữ nguyên |
| Rollback | `deploy.sh rollback` | ~2–23s (≤ 2') |
| Backup/restore | `backup.sh init` + `backup.sh` → `restore.sh latest` sang stack đích | 3 page, mọi ảnh có object, 4 migration |
| Smoke prod mode | API `NODE_ENV=production` + runner | healthz 200, sign-up không lời mời → 403 (cổng lời mời) |
| Cảnh báo | ntfy giả (HTTP local) | hàng đợi cũ 20', healthz lỗi khi tắt Postgres (sau 2 lần), hồi phục, ngân sách ngày 80% |
| Dispatcher | Modal giả kiểm HMAC bằng `mtl_worker.dispatch_auth` → chạy `mtl-worker --mode drain` thật | dispatch → active → sessions/end → `gpu_idle_seconds`; container rỗng → backoff |

## Việc chờ owner (đo thủ công)

Không làm được trong phiên này (cần hạ tầng thật, key LLM, máy/thiết bị thật):

- [ ] Deploy thật lên VPS + Cloudflare; `deploy.sh` ≤ 10'; rollback ≤ 2'; restart `mtl-api` không làm job kẹt.
- [ ] Restore thử **trên máy khác** từ backup thật; mở 1 chương trong editor sau restore → ghi bảng mục 7.
- [ ] Modal: cold start → trang đầu ≤ 40s; ấm ≤ 10s/trang p50 giai đoạn 1; chi phí GPU (gồm `gpu_idle_seconds`)
      ≤ $1/1000 trang trên lô 200 trang; cold start 90s → chỉ 1 dispatch → ghi `docs/benchmarks/phase-07-prod.md`.
- [ ] Kill-switch thật: `GLOBAL_DAILY_USD` thấp → claim rỗng ≤ 1 chu kỳ ở cả Mac và Modal, job đang chạy về
      `paused_budget`, không mất artifact.
- [ ] Cảnh báo tới ntfy thật khi tắt Postgres và khi hàng đợi cũ > 15'.
- [ ] Đăng ký không lời mời ở production → 403 (smoke tự kiểm, xác nhận bằng trình duyệt).
- [ ] Hiệu năng editor với trang 12k/20k px + Safari.
- [ ] Re-inpaint ≤ 15s với worker thật; `kill -9` worker → job về hàng đợi ≤ 150s.
- [ ] Export 100 trang thật; mở CBZ bằng YACReader/Komga; soi mắt 5 trang.
- [ ] Golden set + `mtl bench` (có key LLM) để chốt gate Phase 1 (hiện GO tạm,
      [phase-01-results.md](./benchmarks/phase-01-results.md) ghi "chưa đo"); chạy lại qua Modal, đo chương KO thứ 2.
