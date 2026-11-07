# Smoke self-host local mode — 07/11/2026 21:12 (bổ sung OCR thật 21:45)

Plan: `plans/261107-1953-selfhost-local-mode/` phase 4. Branch `feat/selfhost-local-mode` (trên 1460eee). Máy: macOS arm64, OrbStack Docker 29.4.0, Compose v5.1.2, Node 24.18.0.

## Lệnh

```
SMOKE_PORT=18081 infra/selfhost-smoke.sh   # build 2 image :smoke, project -p mtl-smoke, ./data trống (mktemp), tải model thật
```

Cổng 18081 thay 18080: 18080 đang bị tiến trình khác của user chiếm (`steam-access-fix.py serve`) — không đụng.

## Kết quả: SMOKE OK

Lần 4 (21:42, trang có chữ thật, `./data` trống, tải model thật) + lần 5 (`SMOKE_PAGE=<đường dẫn tương đối>`). Trước đó: lần 2–3 OK với trang không chữ, lần 1 hỏng ở bước kiểm cổng do script.

| # | Kiểm | Kết quả |
|---|------|---------|
| 1 | Mở `/` không đăng nhập | `GET /` 200 html có `id="root"`; `/api/config` `local_mode:true`; `/api/me` không cookie → `is_admin:true`; `/api/auth/get-session` 404 |
| 2 | Upload chương | series ja + chương 1 trang PNG 800×1200 có chữ (37486 B, vẽ trong image worker); POST multipart tới URL tương đối `/files/…` 2xx; commit `accepted:1` |
| 3 | `page.prepare` không tốn token | ingest → prepare → chương `prepared`, trang `prepared` + `ocr_ready` (detector + manga_ocr + big_lama local); 0 provider AI, `spent_usd = 0`. **OCR thật**: 4 vùng (2 bóng + 2 khối chữ), `r1` "こんにちは元気ですか" (conf 1), `r3` "ありがとうまたね" (conf 0.9993) — khớp 18/18 ký tự đã vẽ. **Ảnh xoá chữ** `clean_rev 1` tải được qua `images.clean`, 9023 B ≠ gốc; xem tận mắt (lần 5): chữ biến mất sạch, viền bóng + khung tranh còn nguyên. Trang không chữ (lần 2–3) cũng `succeeded` |
| 4 | Export tải được | `png_zip` succeeded; `/download` 302 `Location: /files/…`; GET 200, `attachment`, 37598 B, `PK\x03\x04` |
| 5 | `down && up` còn dữ liệu | chương `prepared`, đủ 1 trang, ảnh gốc tải lại (magic khớp file đã upload), export vẫn trong danh sách + tải được |
| 6 | Backup DB khi khởi động lại | up đầu (DB trống): 0 backup; sau down/up: 1 (`mtl-…-m26.dump`); `restart app`: 1 → 2 |
| + | Mạng/quyền | postgres không publish cổng; app `127.0.0.1:18081`; `data/secrets/*` (2 file) + `data/worker/token` quyền 600 |

Model: `data/models` 1,2 GB tải mới từ thư mục trống (`fetch_models.py` theo `models.lock.json`).

## Thời gian (lần 4, tổng 118s)

| Bước | s |
|------|---|
| build image (cache) | 17 |
| vẽ trang có chữ (docker run image worker; font tải ~4,6 MB) | 1 |
| up lần đầu (`--wait`, app healthy) | 12 |
| HTTP run (gồm worker tải model ~60s trước khi nhận job + prepare 3s + export 2s) | 66 |
| kiểm OCR (psql) | 0 |
| down && up + verify | 14 |
| restart app + backup | 8 |
| cổng + quyền | 0 |

Ghi chú: `--wait` không chờ worker tải model (worker không có healthcheck) → thời gian tải model nằm trong bước HTTP; timeout `SMOKE_PREPARE_TIMEOUT_S` (900s) bao cả phần này.

## Kích thước image (arm64)

`docker images` (containerd store, cộng cả blob nén): `ghcr.io/jhin1m/mtl:smoke` 691 MB, `ghcr.io/jhin1m/mtl-worker:smoke` 751 MB. Giải nén ≈ 514 / 546 MB như báo cáo phase 3.

## Bug đã sửa

- **Code phase 1–3: không có bug** — không sửa file nào ngoài 2 script phase 4 → không cần chạy lại `test:unit`/`pnpm test`/`typecheck`. `pnpm lint` xanh (sau format `selfhost-smoke.mjs`).
- **Script smoke (lần 1)**: `docker compose port postgres 5432` khi cổng không publish in `invalid IP:0` (stdout, exit 0) chứ không rỗng → kiểm sai "postgres lộ cổng". Sửa: đọc cột Ports của `docker compose ps` (chỉ có `->` khi publish ra host; đã đối chiếu với `mtl-dev-postgres-1` có `127.0.0.1:5442->5432/tcp`).

- **Script smoke (sau code review 8/10, `from-code-reviewer-to-controller-261107-2115-selfhost-smoke-scripts-review-report.md`)**:
  - Kiểm backup/quyền secret qua `docker compose exec -T app` (root trong container) thay vì đọc `data/` trên host — Linux uid ≠ 1000 / rootless không đọc được `data/secrets` (700) → trước đây báo lỗi giả, và `count_backups` nuốt lỗi `find` → kiểm "DB trống không backup" luôn đúng (false-pass).
  - `cleanup`: `set +e` + `exit "$rc"` (rm lỗi sau "SMOKE OK" không còn đổi mã thoát); `trap` đặt trước `cp`/`cd`.
  - `unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES MTL_SKIP_BOOT_BACKUP MTL_ALLOWED_HOSTS` + `-f "$work/docker-compose.yml"`: biến shell dev không lọt vào stack smoke.
  - Còn stack `mtl-smoke` cũ (vd `SMOKE_KEEP=1`) → dừng với hướng dẫn, không chiếm rồi down.
  - App: kiểm **mọi** binding publish phải đúng `127.0.0.1:<port>->8080/tcp` (không chỉ binding đầu của `compose port`).
  - `.mjs`: timeout env không phải số → thoát 2; job `cancelled` (đúng chính tả enum, trước ghi `canceled`) → thoát ngay; verify so danh sách id trang, không chỉ số lượng.

## Bổ sung kiểm OCR thật (yêu cầu sau smoke đầu)

- **Trang thử**: 800×1200, khung 2 ô, 2 bóng thoại elip trắng viền đen, chữ tiếng Nhật dọc cỡ 52 (cột phải → trái): 「こんにちは / 元気ですか」, 「ありがとう / またね」. Vẽ bằng Python + Pillow của image worker (`docker run --rm --user uid:gid --entrypoint python`), script nhúng heredoc trong `selfhost-smoke.sh`.
- **Font**: image worker KHÔNG có font CJK (36 font trong `worker/fonts` chỉ vi/en/es/fr/id/pt; hệ thống không có font nào) → tải `NotoSansJP-Bold.otf` (OFL) từ `notofonts/noto-cjk` tag `Sans2.004`, kiểm sha256; `SMOKE_FONT=<file>` để dùng font có sẵn / chạy offline. Không thêm font CJK vào image (tăng size, runtime không cần).
- **`SMOKE_PAGE=<file>`**: ghi đè trang (png/jpg/webp theo magic); khi đó chỉ kiểm "≥ 1 khối có chữ" (không biết chữ mong đợi). Đường dẫn tương đối đổi sang tuyệt đối trước khi `cd` (áp cả `SMOKE_FONT`, `SMOKE_MODELS_CACHE`).
- **Đọc OCR**: API **chưa có** endpoint trả kết quả OCR trước khi dịch (`pages.ocr_result` chỉ dùng nội bộ cho `chapter.translate`; `/pages/:id` trả `state`/`ai_state`, rỗng tới khi dịch) → đọc `pages.ocr_result` bằng `psql` trong container postgres (`json_agg … order by ord`); `selfhost-smoke.mjs ocr` assert ≥ 1 item `!empty` + `source` không rỗng; trang tự vẽ: thêm ≥ 50% ký tự đã vẽ có trong text OCR (chặn OCR ra rác). Không thêm API mới (ngoài phạm vi).
- **Ảnh xoá chữ**: `GET /api/chapters/:id/pages` → `clean_rev` ≠ null, `images.clean` tải được, khác byte ảnh gốc.
- **Không lộ bug code phase 1–3** → không sửa code, không cần chạy lại `pnpm test`/`typecheck`; `pnpm lint` xanh.

## Lệch so với spec phase (tự chốt)

- Export `format: "png_zip"` (spec ghi `"zip"` — enum thật `png_zip|cbz`), `layout: "pages"` (schema không có mặc định, bắt buộc).
- Series `source_lang: "ja"` + commit `target: "prepared"`: OCR mặc định `manga_ocr` local, dừng sau Bước 1 (không có provider → không được tự nối bước dịch). Strip (`ko`) dừng chờ duyệt cắt trang nên không dùng.
- Poll bằng `GET /api/chapters/:id/progress` (có trạng thái trang + job + lỗi) thay vì ghép `/chapters/:id` + `/pages` + `/jobs/:id`.
- Kiểm "không tốn token" thêm `GET /api/admin/providers` rỗng (không chỉ `spent_usd`).
- `verify` tải lại cả file export (ngoài việc liệt kê).

## License cần rà trước phát hành công khai (ngoài phạm vi)

Image worker mang code vendor GPL-3.0 (`mtl_pipeline/vendor/ctd_*`, `lama_pre_post.py` từ manga-image-translator) và model `comic_text_detector` GPL-3.0; xem `worker/THIRD_PARTY.md`. Phát hành image public = phân phối → phải rà (memory: không ràng buộc license ở MVP, audit ở Phase 8).

## Câu hỏi còn mở

- Tên image GHCR + đặt package public (OPEN trong `plan.md`).
- Chưa build/smoke amd64 (chỉ arm64 local); để CI release lần đầu kiểm.
- Có nên thêm API đọc OCR Bước 1 (vd `ocr` trong `GET /pages/:id`) để smoke/editor không phải đọc DB? UI hiện không cần → để nguyên.
