# Deploy production (MVP, tài khoản tạo tay) — runbook

VPS chạy API + SPA tĩnh + Postgres + MinIO sau Cloudflare; worker GPU là Modal (serverless) hoặc Mac của người vận hành.
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
Mac worker:      mtl-worker --mode loop (token kind=mac, chỉ người vận hành) ── cùng giao thức
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

API phụ thuộc `re2` (addon native, khớp regex chữ bỏ qua). `pnpm install` tải binary dựng sẵn từ GitHub Releases
(`uhop/node-re2`, có linux x64/arm64 và macOS arm64 cho Node 24) — VPS cần ra được `github.com`; không tải được thì
rơi về `node-gyp` và cần `python3`, `make`, `g++` (`build-essential`). `re2` đã nằm trong `allowBuilds` của
`pnpm-workspace.yaml` (pnpm mặc định chặn script cài đặt). Nâng major Node: kiểm binary tương ứng (ABI) có sẵn trước.

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
| `SIGNUP_ENABLED=false` | **Production giữ `false` tới Phase 8** (xác thực email + hạn mức dung lượng). `true` = ai cũng đăng ký được ở `/login` (rate limit 5/giờ/IP) và API từ chối khởi động nếu thiếu `GLOBAL_DAILY_USD` hoặc `USER_DAILY_USD`. Tắt → tạo tài khoản bằng `pnpm create-user --email …` (`OWNER_PASSWORD=…` hoặc nhập trên terminal) |
| `USER_DAILY_USD` | hạn mức chi phí AI mỗi người mỗi ngày UTC (LLM + GPU); `0` = chặn mọi job LLM; không đặt = không giới hạn. Hành vi: [job-queue-worker.md](./job-queue-worker.md#hạn-mức-mỗi-người-user_daily_usd) |
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
  (nguyên tử) → restart → `smoke.sh` (healthz 200 + đăng ký công khai bị chặn: 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`). Smoke hỏng →
  tự quay về bản đang chạy, xoá release hỏng, cảnh báo.
- `infra/deploy.sh rollback`: đổi `current` ↔ `previous` + restart + smoke, không build/migrate.
- Migration chỉ thêm (additive) nên rollback app không cần down DB; down tay ở `packages/db/migrations-down/`.
  Rollback app qua 0006 (glossary theo cặp): không nhập CSV "thay toàn bộ" ở glossary chung — bản cũ xoá entry mọi
  cặp (xem [export-and-batch-edit.md](./export-and-batch-edit.md#glossary)).
- **Thứ tự khi nâng lên pipeline 0.5.1 (font tuỳ chỉnh)**: (1) cập nhật worker Mac + image Modal lên 0.5.1 trước —
  worker mới vẫn nhận job cũ vì `inputs.fonts` là optional; (2) rồi deploy API với `MIN_PIPELINE_VERSION=0.5.1`
  (mặc định trong `env.ts`; nếu `.env` có ghi đè thì sửa). Đảo thứ tự (hoặc để worker cũ chạy) → worker < 0.5.1 nhận
  426 và hàng đợi dừng; worker cũ nhận input có `fonts` sẽ lỗi hợp đồng schema nên API mới không được cấp cho nó.
  Rollback API về bản không biết font tuỳ chỉnh vẫn chạy với worker 0.5.1 (không gửi `fonts` → chỉ font gói sẵn).
  Worker cache font tại `~/.cache/mtl-worker/fonts` (đổi bằng `MTL_FONT_CACHE_DIR`), tên file = sha256 nên xoá thư mục
  này là an toàn.
- **Không rollback worker xuống < 0.5.0 một chiều**: trang đã prepare bằng worker ≥ 0.5.0 lưu `text_color`/`outline_color`
  trong region; schema input của worker cũ có `additionalProperties: false` nên chúng từ chối cả dịch lẫn thử lại prepare
  (partial) của các trang đó, kể cả khi hạ `MIN_PIPELINE_VERSION`. Muốn quay lại phải chạy lại Bước 1 trên worker mới
  hoặc xoá kết quả prepare của các trang.
- Mỗi lần dừng vì ngân sách tăng `provider_retries` (để số attempt trên dây không trùng ledger) → job bị dừng/mở lại
  > 20 lần sẽ `failed` ở lỗi provider kế tiếp.
- Container chết không báo chiếm slot `active` tới khi reaper ước lượng (~`MAX_LIFETIME + SCALEDOWN`); trong lúc đó
  dispatcher không scale-up quá `MODAL_MAX_CONTAINERS`.
- Khẩn cấp: `DISPATCHER_ENABLED=false` (chỉ worker Mac), hoặc kill-switch = đặt ngưỡng 0.

**Checklist release "small-features-batch"** (migration 0011 `pages_skip_changed_at` + 0012 `workspace_fonts` (tên lịch sử, nay là font theo người dùng), pipeline 0.5.1):

1. Worker trước: cập nhật worker Mac + deploy lại image Modal (`PIPELINE_VERSION` 0.5.1); thử `uv run mtl-worker --once`.
2. VPS: `re2` dựng được (mục 1: ra được `github.com` hoặc có `build-essential` + `python3`); (`SMTP_URL` / `MAIL_FROM` từng nằm ở bước này đã bỏ — xoá khỏi `.env` nếu còn.)
3. `.env` không ghi đè `MIN_PIPELINE_VERSION` thấp hơn 0.5.1 (mặc định trong `env.ts` đã là 0.5.1; `PIPELINE_VERSION` giữ 0.4.0).
4. `infra/deploy.sh <ref>`: `pnpm db:migrate` tự chạy 0011 + 0012 (additive; down tay `0011_*.down.sql`, `0012_*.down.sql`).
5. Smoke tay: `/settings` upload 1 font TTF; dịch + xuất 1 chương dùng font đó.
6. Rollback: API/web quay về được (migration additive); worker **không** hạ xuống < 0.5.0 (xem bullet trên).

**Checklist release "pipeline-settings-local-ocr-proofread"** (migration 0013 `workspace_pipeline_settings` (tên lịch sử) + 0014
`proofread_suggestions`, pipeline 0.6.0):

1. Worker trước: `cd worker && uv sync && uv run python scripts/fetch_models.py` (tải thêm model *optional*: LaMa manga
   ~207MB, MangaOCR ~460MB, PaddleOCR ~45MB — sha256 theo `models.lock.json`; `--required` để bỏ qua) → cập nhật worker
   Mac (`PIPELINE_VERSION` 0.6.0) → Modal: `modal volume put mtl-models models/ /` rồi `modal deploy modal_app.py`.
   Thiếu model optional thì worker tự tải lần đầu job cần (lazy, kiểm sha256) — trên Modal mỗi container tải lại, nên
   nạp sẵn vào volume. Không thêm dependency Python (chỉ onnxruntime + opencv có sẵn).
2. Biến môi trường worker (tuỳ chọn): `MTL_GEMINI_PREMIUM_MODEL` (mặc định `gemini-2.5-pro`) /
   `MTL_ANTHROPIC_PREMIUM_MODEL` (mặc định `claude-sonnet-5-5`) cho AI hiệu đính Premium. Giá Premium trong
   `apps/api/src/billing/prices.ts` + `worker/mtl_pipeline/providers/base.py` là giá niêm yết — kiểm lại trước khi bật.
   Lưu ý: model lạ (không có trong bảng, VD đổi `MTL_GEMINI_MODEL`) bị tính theo giá **đắt nhất** bảng — giờ là giá
   Sonnet ($3 / $15 / 1M token), cao hơn trước ~6×, kill-switch ngân sách sẽ chạm sớm hơn tương ứng.
3. `.env` API không ghi đè `MIN_PIPELINE_VERSION` thấp hơn 0.6.0 (mặc định `env.ts` = 0.6.0; `PIPELINE_VERSION` giữ
   0.4.0 nên job đã chạy không bị chạy lại). Worker < 0.6.0 nhận 426 ngay khi API mới lên — vì payload có field mới
   (`pipeline`, `inpaint`, `ocr_engine`, job `chapter.proofread`) mà schema worker cũ `additionalProperties: false`.
4. `infra/deploy.sh <ref>`: `pnpm db:migrate` chạy 0013 (cột `pipeline` của bảng cài đặt, mặc định `{}` = hành vi cũ)
   + 0014 (bảng `proofread_suggestions`, nới `jobs_type_chk` thêm `chapter.proofread`). Down tay: `0013_*.down.sql`,
   `0014_*.down.sql` (0014 xoá job `chapter.proofread` trước khi khôi phục check cũ).
5. Smoke tay: Cài đặt chung → Pipeline lưu được; chương tiếng Nhật với OCR = MangaOCR chạy Bước 1 không
   tốn token (Hoạt động/ledger không có `llm_tokens_*` của `page.prepare`); "Hiệu đính" trên rail chạy và Nhận được 1
   gợi ý; người dùng chưa cấu hình → Bước 1 cho kết quả như trước.
6. Token worker tạo với danh sách capability tường minh (không có `chapter.proofread`): worker 0.6.0 mặc định khai mọi
   loại job → claim 400 `capability_not_allowed`. Chạy worker với `--capabilities` khớp token, hoặc cấp lại token.
7. Rollback: API/web quay về được (migration additive) **miễn worker giữ 0.6.0** (worker mới đọc được payload cũ);
   job đang xếp hàng có field mới không chạy được trên worker cũ. Gợi ý hiệu đính còn trong DB không ảnh hưởng bản cũ.

**Checklist release "single-user-accounts"** (migration 0015 `single_user_guard_worker_kind` + 0016 `drop_workspaces` +
0017 `user_ownership`) — **bắt buộc, không phải gợi ý**: bỏ workspace / thành viên / lời mời, mỗi người một tài khoản,
dữ liệu gắn `user_id`. Release này không có đường lên mượt từ dữ liệu cũ và không rollback bằng down DB.

1. Chuẩn bị: dừng `mtl-api` + `mtl-jobs`; backup nếu cần giữ gì đó (không có công cụ chuyển workspace → user).
2. **Reset DB + MinIO**: `0015` raise lỗi nếu còn bất kỳ dòng `organization` nào; `0016`/`0017` có down chỉ báo lỗi ("không
   rollback được — reset DB + checkout bản cũ"; 0015 down chỉ bỏ cột `kind`). Tạo lại Postgres rỗng và xoá object bucket
   (key cũ `ws/{ws}/…`, key mới `u/{userId}/…`) — `infra/minio-setup.sh` dựng lại bucket private + lifecycle export.
   Chạy `infra/deploy.sh <ref>` hoặc `pnpm db:migrate` để áp 0015–0017 trên DB rỗng.
3. **Token worker**: DB mới nên token cũ mất; nếu vì lý do nào còn bảng cũ thì `pnpm worker-token revoke --id …` mọi token.
   Tạo lại: Mac `pnpm worker-token create --name mac-<tên> --kind mac --out ~/.config/mtl/worker.token` (**chỉ người vận
   hành** — token Mac claim được job và URL ảnh của mọi người dùng); Modal `… --kind modal --out ./modal.token` rồi cập nhật
   secret Modal `MTL_TOKEN` (mục 5: `modal secret create mtl-worker …`) và `modal deploy modal_app.py`. Cờ `--workspace` /
   `--platform` không còn.
4. **Env** (`/srv/mtl/shared/.env`): `SIGNUP_ENABLED=false` (**bắt buộc ở production tới Phase 8**; bật mà thiếu
   `GLOBAL_DAILY_USD`/`USER_DAILY_USD` thì API không khởi động); đặt `USER_DAILY_USD`; xoá `SMTP_URL` / `MAIL_FROM`
   (mailer đã xoá, không còn email mời).
5. **Smoke**: (a) healthz 200; (b) đăng ký bị chặn khi tắt — cả email mới lẫn email đã tồn tại đều bị từ chối trước khi tra
   email (HTTP 400, `code: EMAIL_PASSWORD_SIGN_UP_DISABLED`):
   `curl -s -X POST https://<app>/api/auth/sign-up/email -H 'content-type: application/json' -H 'origin: https://<app>' -d '{"email":"x@example.invalid","password":"smoke-test-password-1","name":"smoke"}'`;
   (c) `OWNER_PASSWORD=… pnpm create-user --email <bạn>` → đăng nhập ở `/login` (không còn `/workspaces`, `/w/…`,
   `/accept-invite`; không redirect) → dịch 1 chương, xuất; (d) `GET /api/me` có `quota` đúng `USER_DAILY_USD`.
   `infra/smoke.sh` (gọi bởi `deploy.sh`) tự kiểm (a) + (b) — production lỡ bật `SIGNUP_ENABLED` thì deploy tự rollback.
6. Rollback: **không** lùi bằng down DB. Lùi = reset DB + MinIO và checkout bản cũ (cũng mất dữ liệu).

Log: `journalctl -u mtl-api -o cat` (JSON mỗi request: method, path, status, ms — không query/header/body),
`journalctl -u mtl-jobs`.

## 5. Modal worker

```bash
cd worker
uv run python scripts/fetch_models.py                     # tải + kiểm sha256 theo models.lock.json
modal volume create mtl-models && modal volume put mtl-models models/ /
pnpm worker-token create --name modal --kind modal --out ./modal.token   # token Modal, file 600
modal secret create mtl-worker MTL_TOKEN="$(cat modal.token)" MTL_API_URL=https://<app> \
  MODAL_DRAIN_SECRET=<trùng .env> GEMINI_API_KEY=<…>
rm modal.token
modal deploy modal_app.py                                 # URL app `mtl-drain` → MODAL_DRAIN_URL=<url>/drain
```

- `drain` (GPU L4, `MODAL_GPU=T4` để thử rẻ hơn): onnxruntime-gpu + CUDA/cuDNN qua pip, `MTL_ORT_STRICT=1` (thiếu
  CUDA → worker dừng, không âm thầm chạy CPU — kiểm log lần deploy đầu), weights từ Volume,
  `HF_HUB_OFFLINE=1`, chạy `mtl-worker --mode drain` tới khi hàng đợi rỗng 20s, báo
  `POST /worker/v1/sessions/end {dispatch_id, lifetime_s, busy_s}` → ledger `gpu_idle_seconds = lifetime − busy +
  MODAL_SCALEDOWN_S` (đuôi rỗi sau khi function trả về; `user_id` null = chi phí nền tảng, 1 dòng/dispatch). Bị kill không kịp báo → `mtl-jobs` ước lượng = `MODAL_SCALEDOWN_S` sau
  `MAX_LIFETIME + SCALEDOWN`.
- Endpoint `/drain` kiểm HMAC-SHA256 body `{dispatch_id, ts}` (`x-mtl-signature`), ts lệch > 5' → 401;
  hợp lệ → `drain.spawn()` trả 202. **Chấp nhận cho MVP (controller chốt 20/10/2026):** request hợp lệ bị gửi lại
  trong cửa sổ 5' sinh thêm container (cùng dispatch_id), luôn trong giới hạn `max_containers`; container thừa thấy
  hàng đợi rỗng sẽ thoát sau 20s. Chống phát lại triệt để (Modal Dict lưu dispatch_id đã nhận) để sau MVP.
- Dispatcher (5s) phục vụ job của mọi người dùng: dispatch đầu khi có job đủ điều kiện và không có
  dispatch mở (khi token Mac thấy trong 60s qua, chỉ tính job đã chờ > `MAC_GRACE_S` = 60s); thêm 1 khi job cũ > 60s, **không còn dispatch pending** và active < max; pending > 120s không claim →
  dispatch mở; thêm 1 khi job cũ > 60s, **không còn dispatch pending** và active < max; pending > 120s không claim →
  `no_claim` + backoff 1'→2'→4'→8'→15' + cảnh báo; container thoát mà không chạy job nào → cũng backoff (tránh vòng
  container rỗng); phiên có việc → hết backoff. Hết ngân sách → không dispatch.
- Worker Mac: token `kind=mac` (file 600 hoặc Keychain, xem [job-queue-worker.md](./job-queue-worker.md)). Worker chung
  toàn hệ thống nên token Mac claim được job và URL ảnh của **mọi** người dùng — credential toàn nền tảng, chỉ cấp cho
  người vận hành. Người dùng vượt `USER_DAILY_USD` thì job không-LLM của họ chỉ chạy trên Mac (Modal không nhận).

## 6. Kill-switch ngân sách + guardrail token

- `GLOBAL_DAILY_USD` / `GLOBAL_MONTHLY_USD`: tổng `usage_ledger.cost_usd` (server tính, gồm GPU rỗi) theo ngày/tháng
  **UTC**. Vượt → claim (Mac lẫn Modal) không trả `page.prepare`/`chapter.translate`/`page.ocr_region`, job đó đang
  `queued` → `paused_budget`; heartbeat job đang chạy trả `stop:"paused_budget"` → worker dừng, job về
  `paused_budget` (không tính attempt, page về trạng thái trước claim, artifact đã ghi giữ nguyên); dispatcher dừng.
- Mở lại: hết vượt (sang ngày/tháng mới hoặc nâng ngưỡng + restart) → `mtl-jobs` tự `paused_budget → queued`;
  hoặc `pnpm budget-resume` (in trạng thái; `--force` mở lại kể cả khi còn vượt).
- Cảnh báo 50/80/100% mỗi mốc 1 lần/kỳ (ngày, tháng) qua ntfy.
> Trần guardrail mặc định **4096 token ra/call** (= `TRANSLATE_MAX_OUTPUT_TOKENS`, = clamp server). Mặc định cũ
> 2000 loại cả lô dịch 4 trang hợp lệ (đo thật: 2022 token) → cả chương `chapter.translate` fail. Muốn chặt hơn thì
> đặt `MTL_MAX_OUTPUT_TOKENS_PER_CALL` (env worker Mac + Modal secret), nhưng đừng thấp hơn token ra thật của lô dịch.

- Worker: thinking tắt, `max_output_tokens` theo loại call, **assert token ra ≤ 4096/call**
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

## 9. Pháp lý tối thiểu (tài khoản tạo tay)

Production tắt đăng ký công khai (`SIGNUP_ENABLED=false`, tài khoản tạo bằng `pnpm create-user`; smoke kiểm sau mỗi deploy); bucket private (`mc anonymous set none`), chỉ presigned URL
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
| Smoke prod mode (20/10/2026, trước khi bỏ lời mời) | API `NODE_ENV=production` + runner | healthz 200, sign-up không lời mời → 403 |
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
- [ ] Đăng ký ở production khi `SIGNUP_ENABLED=false` bị chặn (smoke tự kiểm, xác nhận bằng trình duyệt).
- [ ] Hiệu năng editor với trang 12k/20k px + Safari.
- [ ] Re-inpaint ≤ 15s với worker thật; `kill -9` worker → job về hàng đợi ≤ 150s.
- [ ] Export 100 trang thật; mở CBZ bằng YACReader/Komga; soi mắt 5 trang.
- [ ] Golden set + `mtl bench` (có key LLM) để chốt gate Phase 1 (hiện GO tạm,
      [phase-01-results.md](./benchmarks/phase-01-results.md) ghi "chưa đo"); chạy lại qua Modal, đo chương KO thứ 2.
