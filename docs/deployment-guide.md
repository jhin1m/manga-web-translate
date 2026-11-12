# Deploy production (MVP, tài khoản tạo tay) — runbook

> Bản cá nhân 1 người dùng trên máy mình (Docker 1 lệnh, không đăng nhập, không MinIO): xem [self-host.md](./self-host.md).

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
| `GLOBAL_DAILY_USD`, `GLOBAL_MONTHLY_USD` | kill-switch, xem mục 6. Ngưỡng ngày là mặc định, admin đổi được trên UI; ngưỡng tháng chỉ env |
| `DISPATCHER_ENABLED`, `MODAL_DRAIN_URL`, `MODAL_DRAIN_SECRET` (≥ 32) | Modal, xem mục 5 |
| `MODAL_MAX_CONTAINERS=2`, `MODAL_SCALEDOWN_S=60`, `MODAL_MAX_LIFETIME_S=3600` | **khớp** `worker/modal_app.py` |
| `ALERT_NTFY_URL=https://ntfy.sh/<topic-ngẫu-nhiên>` | kênh cảnh báo duy nhất |
| `ADMIN_EMAILS=a@x.com,b@y.com` | email quản trị (không phân biệt hoa thường; phân tách bằng dấu phẩy). Chỉ các tài khoản này vào được `/settings` và `/api/admin/*`. Đăng ký qua web bằng các email này **luôn bị từ chối** (kể cả khi `SIGNUP_ENABLED=true`): tạo tài khoản admin bằng `pnpm create-user --email …` trước khi đặt biến. Không đặt = không ai là admin |
| `SECRETS_KEY` | khoá chính 32 byte base64 (`openssl rand -base64 32`) mã hoá key provider AI (AES-256-GCM) lưu trong DB (Cài đặt → AI → Nhà cung cấp). **Sao lưu ngoài DB** (password manager): mất hoặc đổi khoá = mọi key provider không giải mã được → nhập lại key từng provider trên UI (API vẫn khởi động, log + ntfy cảnh báo). Không đặt = không lưu / đổi được key provider; worker vẫn chạy bằng key env |
| `SIGNUP_ENABLED=false` | **mặc định** đăng ký công khai khi admin chưa chỉnh trên UI (Cài đặt › Hạn mức & đăng ký; giá trị trên UI thắng env, có hiệu lực ngay không restart). **Production giữ `false` tới Phase 8** (xác thực email + hạn mức dung lượng): admin bật trên UI = chấp nhận đăng ký chưa xác thực email. `true` (env) = ai cũng đăng ký được ở `/login` (rate limit 5/giờ/IP) và API từ chối khởi động nếu thiếu `GLOBAL_DAILY_USD` hoặc `USER_DAILY_USD`; bật trên UI cũng yêu cầu đủ 2 hạn mức hiệu lực. Tắt → tạo tài khoản bằng `pnpm create-user --email …` (`OWNER_PASSWORD=…` hoặc nhập trên terminal). **Đổi env không đóng được đăng ký nếu admin đã bật trên UI** (DB thắng): đóng khẩn cấp = tắt trên UI hoặc `UPDATE system_settings SET signup_enabled = false WHERE id = 1;`; `/healthz.signup` cho biết trạng thái thật |
| `USER_DAILY_USD` | hạn mức chi phí AI mỗi người mỗi ngày UTC (LLM + GPU); `0` = chặn mọi job LLM; không đặt = không giới hạn. Là mặc định khi DB trống — admin đổi trên UI (giá trị UI thắng). Hành vi: [job-queue-worker.md](./job-queue-worker.md#hạn-mức-mỗi-người-user_daily_usd) |
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
  (nguyên tử) → restart → `smoke.sh` (healthz 200 + đăng ký công khai khớp `/healthz.signup`: đóng → 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`; mở → cảnh báo, 400 `PASSWORD_TOO_SHORT`, không tạo user). Smoke hỏng →
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
  (partial) của các trang đó, kể cả khi hạ `MIN_PIPELINE_VERSION`. Muốn quay lại phải chạy lại xoá chữ + OCR trên worker mới
  hoặc xoá kết quả prepare của các trang.
- Mỗi lần dừng vì ngân sách tăng `provider_retries` (để số attempt trên dây không trùng ledger) → job bị dừng/mở lại
  > 20 lần sẽ `failed` ở lỗi provider kế tiếp.
- Container chết không báo chiếm slot `active` tới khi reaper ước lượng (~`MAX_LIFETIME + SCALEDOWN`); trong lúc đó
  dispatcher không scale-up quá `MODAL_MAX_CONTAINERS`.
- Khẩn cấp: `DISPATCHER_ENABLED=false` (chỉ worker Mac), hoặc kill-switch = đặt ngưỡng ngày 0 **trên UI admin** (Cài đặt › Hạn mức & đăng ký). Giá trị UI khác trống **thắng env**: nếu DB đã có giá trị thì đặt `GLOBAL_DAILY_USD=0` trong env không có tác dụng. Khi không vào được UI: `UPDATE system_settings SET global_daily_usd = 0 WHERE id = 1;` (có hiệu lực ngay, không restart).

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
5. Smoke tay: admin (`ADMIN_EMAILS`) vào Cài đặt → Pipeline lưu được (cài đặt chung toàn hệ thống, đã copy từ hàng `user_settings` cập nhật gần nhất ở migration 0021 — kiểm lại mục Pipeline sau deploy; user thường bị đưa về `/`); chương tiếng Nhật với OCR = MangaOCR chạy xoá chữ + OCR không
   tốn token (Hoạt động/ledger không có `llm_tokens_*` của `page.prepare`); "Hiệu đính" trên rail chạy và Nhận được 1
   gợi ý; người dùng chưa cấu hình → xoá chữ + OCR cho kết quả như trước.
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
5. **Smoke**: (a) healthz 200; (b) đăng ký đúng với trạng thái thật trong `GET /healthz` (`signup: "open" | "closed"`,
   = bật + đủ 2 hạn mức hiệu lực): `closed` → đăng ký bị từ chối trước khi tra email (HTTP 400,
   `code: EMAIL_PASSWORD_SIGN_UP_DISABLED`, cả email mới lẫn đã tồn tại); `open` → gửi mật khẩu cố ý quá ngắn, mong
   `PASSWORD_TOO_SHORT` (400) và **không tạo user**, kèm dòng log cảnh báo "đăng ký công khai đang mở (chưa xác thực
   email)":
   `curl -s -X POST https://<app>/api/auth/sign-up/email -H 'content-type: application/json' -H 'origin: https://<app>' -d '{"email":"x@example.invalid","password":"x","name":"smoke"}'`;
   (c) `OWNER_PASSWORD=… pnpm create-user --email <bạn>` → đăng nhập ở `/login` (không còn `/workspaces`, `/w/…`,
   `/accept-invite`; không redirect) → dịch 1 chương, xuất; (d) `GET /api/me` có `quota` đúng hạn mức hiệu lực.
   `infra/smoke.sh` (gọi bởi `deploy.sh`) tự kiểm (a) + (b) theo trạng thái thật — admin bật đăng ký trên UI **không** làm
   deploy tự rollback (chỉ log cảnh báo); rollback chỉ khi API không trả `signup` hoặc phản hồi đăng ký sai trạng thái.
6. Rollback: **không** lùi bằng down DB. Lùi = reset DB + MinIO và checkout bản cũ (cũng mất dữ liệu).

**Checklist nâng cấp lên pipeline 0.7.0 (dịch theo chuỗi lô)** (migration 0019 `jobs_progress_counts` + 0020 `translate_chain`):
dịch chương theo chuỗi job lô, tiến độ từng trang, menu Xuất một nút.

1. **Worker lên 0.7.0 TRƯỚC API**: cập nhật worker Mac (`PIPELINE_VERSION` 0.7.0; thử `uv run mtl-worker --once`) rồi
   `modal deploy modal_app.py`. Worker 0.7.0 vẫn đọc payload cũ (không có `carry`) nên lên trước không hại gì. Đảo thứ tự
   → API mới (`MIN_PIPELINE_VERSION` mặc định 0.7.0 trong `env.ts`) từ chối worker 0.6.x bằng 426 và hàng đợi dừng; job dịch
   mới có `payload.carry` mà schema worker cũ (`additionalProperties: false`) không đọc được. `.env` không ghi đè
   `MIN_PIPELINE_VERSION` thấp hơn 0.7.0; `PIPELINE_VERSION` của API (muối input_rev) giữ 0.4.0.
2. **API trước hoặc cùng lúc với web**: web mới đọc `pages[].ocr_ready` (cùng `chapter.run`, `translate_queued`, `run_batch`) từ
   `GET /chapters/:id/progress` của API mới; web lên trước thì thiếu `ocr_ready` nên không chọn được trang nào để dịch riêng.
   `infra/deploy.sh <ref>` đưa cả hai lên cùng release.
3. `infra/deploy.sh <ref>`: `pnpm db:migrate` chạy 0019 (`jobs.progress_done/progress_total`) + 0020 (`chapters.run_target`,
   `run_started_at`, `run_total`; `pages.translate_queued`) — chỉ thêm cột, mặc định = hành vi cũ. Down tay:
   `0019_*.down.sql`, `0020_*.down.sql`.
4. Chương đang chạy lúc deploy: chương manga (`ingest_mode=pages`) đang cắt trang / xoá chữ + OCR không có lượt dịch (cột
   mới null) nên xoá chữ + OCR xong sẽ dừng ở "Chờ dịch" — bấm "Dịch chương" để tiếp. Job dịch cả chương đã xếp từ bản cũ vẫn
   chạy xong bình thường.
5. Smoke tay: "Dịch chương" một chương ≥ 9 trang → trang đầu "Xong" và sửa được trong khi các lô sau còn "Chờ lượt · lô k" /
   "Đang dịch"; thanh trên "Đang dịch · x/y trang · lô k/n"; xuất ra file tự tải.
6. Rollback về 0.6.0 (API/web + worker cùng lúc; migration additive nên không cần down): **trước** khi hạ, huỷ mọi job
   `chapter.translate` còn `queued` / `paused_budget` có `payload.carry` (worker 0.6.0 không đọc được → fail hợp đồng), và đợi
   job đang chạy xong hoặc huỷ. Chương kẹt `processing` giữa chuỗi:
   `UPDATE chapters c SET status='prepared', run_target=NULL WHERE status='processing' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.chapter_id=c.id AND j.status IN ('queued','running','paused_budget'));`
   rồi người dùng bấm dịch lại (trang `ready` giữ nguyên).

**Pipeline 0.7.1 (căn giữa dọc `valign`)**: worker lên 0.7.1 trước API (`MIN_PIPELINE_VERSION` mặc định 0.7.1). Worker cũ **không**
bỏ qua `valign` mà fail job export: input được kiểm bằng schema `additionalProperties: false` (`runner.py`), nên mọi chương có
box tạo sau khi deploy đều không xuất được; bởi vậy API từ chối worker < 0.7.1 bằng 426. Không có migration; box lưu từ trước
(không có trường) vẽ như cũ, và worker 0.7.1 đọc được dữ liệu không có `valign`. Rollback: giữ worker ≥ 0.7.1 (đừng hạ `MIN_PIPELINE_VERSION`). Nếu buộc phải quay lại worker 0.7.0, làm đúng thứ tự:
(1) hạ `MIN_PIPELINE_VERSION` về 0.7.0; (2) quay web/API về bản trước (để không còn ai ghi `valign` lại); (3) chạy SQL dưới đây;
(4) rồi mới khởi động worker 0.7.0. Job export đã xếp hàng không cần sửa: input dựng lúc worker nhận job.

SQL xoá `valign` (**chưa chạy thử, chạy trong transaction**, kiểm số dòng rồi mới `COMMIT`):

```sql
BEGIN;
UPDATE page_states SET state = jsonb_set(state, '{text_boxes}', (
  SELECT coalesce(jsonb_agg(e.b - 'valign' ORDER BY e.i), '[]'::jsonb)
  FROM jsonb_array_elements(state->'text_boxes') WITH ORDINALITY AS e(b, i)))
WHERE state @? '$.text_boxes[*].valign';
UPDATE page_states SET ai_state = jsonb_set(ai_state, '{text_boxes}', (
  SELECT coalesce(jsonb_agg(e.b - 'valign' ORDER BY e.i), '[]'::jsonb)
  FROM jsonb_array_elements(ai_state->'text_boxes') WITH ORDINALITY AS e(b, i)))
WHERE ai_state @? '$.text_boxes[*].valign';
UPDATE page_state_history SET state = jsonb_set(state, '{text_boxes}', (
  SELECT coalesce(jsonb_agg(e.b - 'valign' ORDER BY e.i), '[]'::jsonb)
  FROM jsonb_array_elements(state->'text_boxes') WITH ORDINALITY AS e(b, i)))
WHERE state @? '$.text_boxes[*].valign';
COMMIT;
```
**Pipeline 0.8.0 (font theo loại chữ `Region.style`)**: thứ tự bắt buộc: (1) deploy worker 0.8.0 (Mac + Modal); (2) đặt
`MIN_PIPELINE_VERSION=0.8.0` (mặc định trong `env.ts`); (3) rồi mới deploy API/web. Schema worker cũ có `additionalProperties: false`
nên từ chối region có `style` và settings có `thought_font`/`note_font` (job fail hợp đồng); API từ chối worker < 0.8.0 bằng 426.
Không có migration (`default_fonts` là jsonb, thêm khoá `thought`/`note`). Trang cũ không có `style` vẽ như trước. Rollback: **không**
hạ worker dưới 0.8.0 sau khi đã có chương dịch bằng 0.8.0 (trang đã lưu mang `style`; export bằng worker cũ sẽ fail).

**Pipeline 0.9.0 (OCR vùng tự xoá chữ gốc, `page.reinpaint.auto_text_bbox`)**: thứ tự như 0.8.0: (1) deploy worker 0.9.0
(Mac + Modal); (2) `MIN_PIPELINE_VERSION=0.9.0` (mặc định trong `env.ts`); (3) deploy API/web. Worker cũ đòi `user_mask_key`
nên fail job xoá chữ theo khung; API từ chối worker < 0.9.0 bằng 426. Không migration, `PIPELINE_VERSION` API giữ 0.4.0.
Rollback: hạ `MIN_PIPELINE_VERSION` về 0.8.0 + quay web/API về bản trước (không còn ai gửi `auto_text_bbox`) rồi mới hạ
worker; job `auto_text_bbox` còn xếp hàng lúc đó sẽ fail hợp đồng (huỷ được, không mất dữ liệu).

### Checklist nâng cấp lên pipeline 0.10.0 (key AI theo job, bỏ tier)

1. Backup DB (mục 7); `.env` API có `SECRETS_KEY` (backup ngoài DB) và `ADMIN_EMAILS`; không ghi đè
   `MIN_PIPELINE_VERSION` < 0.10.0.
2. Worker Mac: `git pull && cd worker && uv sync` (có `openai`), restart launchd; Modal: `modal deploy modal_app.py`.
   Worker 0.10.0 đọc được payload / claim cũ (không `llm`, có `model_tier`) bình thường, nên deploy worker **trước** API.
3. `infra/deploy.sh <ref>`: migrate (0023 gỡ cột `series.llm_tier`), API + web + `mtl-jobs`.
4. Đảo thứ tự (API trước) → API mới trả 426 cho worker cũ, hàng đợi dừng tới khi worker lên 0.10.0 (không mất job).
5. Rollback API về bản trước: **chạy các file down theo thứ tự ngược, từ migration mới nhất tới 0023** (vd
   `packages/db/migrations-down/0023_drop_series_llm_tier.down.sql` là file cuối; mỗi down xoá hàng `max(id)` của bảng
   migration nên sai thứ tự sẽ làm lần migrate sau chạy lại migration đã áp) — bản cũ đọc cột `series.llm_tier`.
   **Job có `payload.llm` sẽ `failed` lớp `auth` sau rollback**: API cũ không đính `llm` vào claim và worker 0.10.0 từ chối
   dùng key env thay cho slot DB ("thiếu cấu hình AI của job"). Runbook: *trước khi* rollback, gỡ cả 3 slot ở Cài đặt › Model
   tác vụ (job mới sẽ không mang `llm`, dùng env); job đã `failed` → bấm "Chạy lại trang lỗi" (API cũ enqueue lại không
   `llm` → chạy bằng env, cần env worker có key). Không hạ worker < 0.10.0 khi còn job có `llm` trong payload (schema cũ từ
   chối) — huỷ hoặc chờ chạy hết.
6. **Rủi ro còn lại**: token worker (Mac / Modal) bị lộ → kẻ giữ token claim được job và **lấy mọi key đang gán slot**, dùng
   ngoài ledger (vượt mọi hạn mức). Bảo vệ token như secret cấp nền tảng (file 600, không commit), thu hồi ngay khi nghi lộ
   (`pnpm worker-token revoke`) và đổi key ở provider; bật giới hạn chi tiêu phía provider cho mọi key nhập vào.
7. Sau một phiên bản ổn định: bỏ `model_tier` / `proofread_tier` legacy (cấp hiệu đính cũ chỉ còn dùng khi chưa gán slot Hiệu đính).

### Ghi chú: trí nhớ series và gợi ý từ AI (migration 0026, worker 0.11.0)

`0026_series_memory` chỉ thêm (cột `chapters.translate_memory` nullable, bảng `series_suggestions`), nên deploy API và
worker theo thứ tự nào cũng được; `MIN_PIPELINE_VERSION` giữ 0.10.0 và `PIPELINE_VERSION` API không đổi (worker 0.10.0
vẫn chạy, chỉ không sinh gợi ý). Rollback app không cần down DB; gỡ hẳn thì chạy
`packages/db/migrations-down/0026_series_memory.down.sql` (đúng thứ tự ngược như checklist 0.10.0).

### Checklist cắt mép credit (pipeline 0.12.0, migration 0027 + 0028)

Cắt mép ảnh gốc trước Bước 1 + học dải credit theo series. `MIN_PIPELINE_VERSION = 0.12.0` (mặc định trong `env.ts`; nếu
`.env` có ghi đè thì sửa); `PIPELINE_VERSION` API không đổi.

1. Migration chỉ thêm: `0027_add_source_file_trim` (`source_files.trim` jsonb) và `0028_add_series_skip_image_edge`
   (`series_skip_images.edge`, null = ảnh cả tấm). Down tay: `packages/db/migrations-down/0027_add_source_file_trim.down.sql`,
   `0028_add_series_skip_image_edge.down.sql`.
2. Nâng worker Mac, image Modal và worker self-host lên ≥ 0.12.0 **cùng lúc** với API. Worker < 0.12.0 nhận 426 khi claim
   (hàng đợi dừng, không mất job); worker 0.12.0 vẫn đọc được payload cũ không có `trim`, nên có thể lên worker trước API.
3. Web và API ship cùng nhau: `POST /series/:id/skip-images` đường dải bắt buộc `band_px`; web cũ không gửi `edge` nên không học dải.
4. Rollback API: không cần down DB cho `trim` (bản cũ bỏ qua cột), nhưng **phải chạy down 0028** (rồi 0027 nếu gỡ hẳn, đúng
   thứ tự ngược như checklist 0.10.0) — bản cũ không biết cột `edge` sẽ coi dải đã học là ảnh credit cả tấm và tự bỏ
   nhầm ảnh. Down 0028 xoá các dải đã học (ảnh cả tấm giữ nguyên). Chương đã cắt mép mà ingest bằng API cũ sẽ không
   cắt (API cũ không gửi `trim`).
5. Phát hành một lần sau khi xong mọi phase: rc → smoke → tag cùng commit → GitHub Release.

### Checklist OCR local mặc định (MangaOCR / PaddleOCR)

1. **Model OCR local giờ nằm trên đường mặc định** (`ja` → MangaOCR ~460MB, `ko`/`zh`/`en` → PaddleOCR ~45MB). Trước khi
   deploy API: `uv run python scripts/fetch_models.py` (KHÔNG `--required`) → `modal volume put mtl-models models/ /`
   và kiểm worker Mac có đủ file trong `worker/models/`. Thiếu trên volume → mỗi container Modal lạnh tự tải giữa job.
2. Cài đặt pipeline đã lưu (`system_settings.pipeline.ocr_engines`) thắng mặc định: hệ thống từng bấm Lưu ở mục
   Pipeline sẽ giữ engine đã lưu — đổi trên UI nếu muốn OCR local.
3. "Chạy lại trang lỗi" với trang lỗi bước 1 (hoặc rev OCR khác cài đặt hiện tại) chạy lại `page.prepare` theo cài đặt
   **hiện tại** — trang OCR bằng LLM trước đây sẽ được OCR lại bằng engine local (như mọi lần đổi cài đặt pipeline).
   Trang dịch xong không bị đụng.
4. Kill-switch ngân sách / LLM tạm dừng không chặn `page.prepare` OCR local (không tốn token) — GPU vẫn chạy.

Log: `journalctl -u mtl-api -o cat` (JSON mỗi request: method, path, status, ms — không query/header/body),
`journalctl -u mtl-jobs`.

## 5. Modal worker

```bash
cd worker
uv run python scripts/fetch_models.py                     # tải + kiểm sha256 theo models.lock.json
modal volume create mtl-models && modal volume put mtl-models models/ /
pnpm worker-token create --name modal --kind modal --out ./modal.token   # token Modal, file 600
modal secret create mtl-worker MTL_TOKEN="$(cat modal.token)" MTL_API_URL=https://<app> \
  MODAL_DRAIN_SECRET=<trùng .env> GEMINI_API_KEY=<…>   # key env chỉ còn là dự phòng khi chưa gán slot AI ở Cài đặt
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

- `GLOBAL_DAILY_USD` / `GLOBAL_MONTHLY_USD` (ngưỡng ngày là mặc định, admin đổi trên UI; tháng chỉ env): tổng `usage_ledger.cost_usd` (server tính, gồm GPU rỗi) theo ngày/tháng
  **UTC**. Vượt → claim (Mac lẫn Modal) không trả `page.prepare`/`chapter.translate`/`page.ocr_region`, job đó đang
  `queued` → `paused_budget`; heartbeat job đang chạy trả `stop:"paused_budget"` → worker dừng, job về
  `paused_budget` (không tính attempt, page về trạng thái trước claim, artifact đã ghi giữ nguyên); dispatcher dừng.
- Mở lại: hết vượt (sang ngày/tháng mới, hoặc nâng ngưỡng ngày trên UI admin — có hiệu lực ngay, không restart; ngưỡng tháng chỉ env + restart) → `mtl-jobs` tự `paused_budget → queued`;
  hoặc `pnpm budget-resume` (in trạng thái; `--force` không cần khi đã nâng ngưỡng trên UI).
- Cảnh báo 50/80/100% mỗi mốc 1 lần/kỳ (ngày, tháng) qua ntfy.
> Trần guardrail mặc định **4096 token ra/call** (= `TRANSLATE_MAX_OUTPUT_TOKENS`, = clamp server). Mặc định cũ
> 2000 loại cả lô dịch 4 trang hợp lệ (đo thật: 2022 token) → cả chương `chapter.translate` fail. Muốn chặt hơn thì
> đặt `MTL_MAX_OUTPUT_TOKENS_PER_CALL` (env worker Mac + Modal secret), nhưng đừng thấp hơn token ra thật của lô dịch.

- Worker: thinking tắt, `max_output_tokens` theo loại call, **assert token ra ≤ 4096/call**
  (`MTL_MAX_OUTPUT_TOKENS_PER_CALL`) → vượt = lỗi `schema`, không gọi lại trong job (hàng đợi tính attempt). Server
  vẫn clamp riêng (`apps/api/src/billing/prices.ts`).

### Khoá / mở tài khoản

Cài đặt › Hệ thống › Người dùng: bảng người dùng + chi phí hôm nay / 30 ngày (ngày UTC, từ `usage_ledger`), icon khoá / mở.
Khoá = đặt `user.disabled_at` rồi xoá mọi phiên của người đó: tab đang mở về màn đăng nhập ở thao tác kế tiếp, đăng nhập lại
(đúng mật khẩu) báo "Tài khoản đã bị khoá.", job đang chờ của họ không được claim và không bật Modal (job đang chạy chạy nốt;
mở khoá thì job chờ chạy tiếp — job không tự huỷ). Không khoá được tài khoản thuộc `ADMIN_EMAILS` (kể cả chính mình).
`pnpm create-user` không tạo phiên nên không bị ảnh hưởng. Đừng bật `session.cookieCache` của better-auth (khoá sẽ chỉ có
hiệu lực sau `maxAge` của cache).

Rollback: quay API/web về bản trước **trước** (cột `disabled_at` additive, bản cũ bỏ qua nên không cần down). Bản cũ không
đọc cột này: **người đang bị khoá đăng nhập lại được** và **job đang chờ của họ được claim lại (tốn tiền AI/GPU)** — huỷ job
chờ của các tài khoản đang bị khoá, hoặc chấp nhận, rồi mới lùi; sau khi nâng cấp lại hãy kiểm tra và khoá lại. Chỉ chạy
`packages/db/migrations-down/0024_user_disabled_at.down.sql` **sau khi** API đã lùi: chạy khi API mới còn sống thì claim,
đăng nhập và mọi request có phiên đều lỗi 500 (API mới đọc `disabled_at`).

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
- Key provider AI trong DB được mã hoá bằng `SECRETS_KEY`: backup DB **không** chứa khoá → giữ `SECRETS_KEY` ở nơi
  riêng; restore cần đúng `SECRETS_KEY` lúc backup (sai khoá = nhập lại key từng provider trên UI).
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

Production mặc định tắt đăng ký công khai (`SIGNUP_ENABLED=false`, tài khoản tạo bằng `pnpm create-user`; admin chỉ bật trên UI khi chấp nhận đăng ký chưa xác thực email; smoke kiểm theo trạng thái thật sau mỗi deploy); bucket private (`mc anonymous set none`), chỉ presigned URL
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
- [ ] Đăng ký ở production khi đang tắt (`SIGNUP_ENABLED=false`, hoặc admin tắt trên UI) bị chặn (smoke tự kiểm theo `/healthz.signup`, xác nhận bằng trình duyệt).
- [ ] Hiệu năng editor với trang 12k/20k px + Safari.
- [ ] Re-inpaint ≤ 15s với worker thật; `kill -9` worker → job về hàng đợi ≤ 150s.
- [ ] Export 100 trang thật; mở CBZ bằng YACReader/Komga; soi mắt 5 trang.
- [ ] Golden set + `mtl bench` (có key LLM) để chốt gate Phase 1 (hiện GO tạm,
      [phase-01-results.md](./benchmarks/phase-01-results.md) ghi "chưa đo"); chạy lại qua Modal, đo chương KO thứ 2.
