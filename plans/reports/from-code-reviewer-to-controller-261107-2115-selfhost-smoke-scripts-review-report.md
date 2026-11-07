# Review: infra/selfhost-smoke.sh + infra/selfhost-smoke.mjs

Điểm: **8/10**. Đủ yêu cầu của spec. Không có critical. Có 1 lỗi major, chỉ gặp trên Linux khi uid người chạy khác 1000 hoặc Docker chạy rootless/userns. Phần còn lại là minor về độ bền.
Chỉ đọc code: không chạy docker, không sửa file. Đã thử hành vi bash trong scratch (bash 3.2 và bash trên PATH).

## Đối chiếu Requirements

| Yêu cầu | Kết quả | Chỗ kiểm |
|---|---|---|
| Mở `/` không cần đăng nhập | Đạt | mjs:113-125. HTML có `id="root"`, không redirect (manual), `local_mode`, `/api/me` admin khi không có cookie, `/api/auth/get-session` trả 404 |
| Upload chương | Đạt | mjs:129-154. Presign lấy từ response của `POST /api/chapters` (chapters.ts:206-210). Tương đương bước `/presign` trong spec |
| page.prepare xong, không tốn token | Đạt | mjs:157-187. Mọi trang `prepared` + `ocr_ready` + job succeeded. 0 provider (admin-providers.ts:89-103), `spent_usd === 0` (me.ts:20). Không có provider thì worker không thể gọi AI, nên bằng chứng này đủ chặt |
| Export zip tải được | Đạt | mjs:190-224. `png_zip` và `pages` đúng enum (packages/shared/src/job.ts:86-89). Có 302 → `/files/`, attachment, `PK\x03\x04` |
| down && up còn dữ liệu | Đạt | sh:80-82 + mjs verify. Kiểm số trang, ảnh gốc PNG, export vẫn còn trong danh sách và tải lại được |
| Khởi động lại tạo backup | Đạt | sh:72, 85-91. Backup ghi ra tmp rồi rename, tên khớp `mtl-*.dump` (boot-backup.ts:94-103), stamp theo giây, giữ 5 bản, nên +1 là xác định |
| Postgres không lộ cổng / app chỉ 127.0.0.1 / 600 | Đạt (xem M1) | sh:95-107 |
| Không đụng project compose khác | Đạt | `-p mtl-smoke` ghi đè `name: mtl-local`. Xem m3, m4 cho các trường hợp biên |

## Major

**M1. Kiểm file phía host gãy trên Linux khi uid khác 1000, Docker rootless hoặc userns-remap. Có một chỗ kiểm luôn đúng (false-pass).** sh:60-61, 72, 85, 100-105
- app-entrypoint.sh:13-15 chown `data/secrets` về 1000 và chmod 700. Người chạy trên host không phải uid 1000 thì không liệt kê được thư mục này. Khi đó `secrets=(data/secrets/*)` giữ nguyên chuỗi glob và script die "data/secrets trống": báo lỗi giả.
- `count_backups` nuốt lỗi của `find` (`2>/dev/null`). Nếu `data/backups` không đọc được hoặc không tồn tại:
  - sh:72 `[ "$(count_backups)" = 0 ]` luôn đúng → **false-pass**.
  - sh:85 `n=$(count_backups)` là phép gán. Với pipefail, `find` lỗi làm errexit thoát script mà không in dòng LỖI nào (đã tái hiện trong scratch).
- Cách sửa: kiểm ngay trong container, nơi uid và cách ánh xạ luôn đúng. Cách này cũng bỏ được nhánh `stat -c`/`stat -f` trên host:
  ```bash
  in_app() { dc exec -T app sh -c "$1"; }
  count_backups() { in_app 'ls -1 /data/backups' | grep -c '^mtl-.*\.dump$' || true; }
  modes=$(in_app 'stat -c "%a %n" /data/secrets/* /data/worker/token')
  # thêm: [ -n "$modes" ] và mọi dòng bắt đầu "600 "
  ```
  Nếu muốn giữ kiểm phía host: đặt `[ -r data/backups ] && [ -x data/backups ] || die ...` trước khi đếm, và không nuốt stderr.

## Minor

**m1. Trap cleanup chạy dưới `set -e`.** sh:43-57
- Lệnh lỗi trong trap EXIT làm trap dừng giữa chừng, và mã thoát đổi từ 0 sang 1 (đã thử: in "OK" rồi vẫn exit=1).
- Trên Linux, nếu `docker run busybox` lỗi (máy offline, chưa có image busybox) thì lỗi bị nuốt. Sau đó `rm -rf "$work"` vấp `data/postgres` (uid 999, 0700) → script thoát 1 dù đã in "SMOKE OK", và thư mục tạm nằm lại.
- Sửa: dòng đầu của `cleanup` thêm `set +e`; đổi thành `rm -rf "$work" || log "không xoá được $work (cần sudo)"`; cuối hàm thêm `exit "$rc"`.

**m2. Trap đặt sau `cp`/`cd`.** sh:37-58. `cp` hoặc `cd` lỗi thì `$work` bị bỏ lại. Sửa: chuyển `trap cleanup EXIT` lên ngay sau sh:38. `dc down` khi chưa có stack thì vô hại, đã có `|| true`.

**m3. Biến môi trường của shell lọt vào compose.** sh:41
- `COMPOSE_FILE` được ưu tiên hơn `./docker-compose.yml` khi không có `-f`. Nếu shell của dev có export biến này, smoke chạy file khác dưới project `mtl-smoke` và kiểm nhầm cấu hình.
- `MTL_SKIP_BOOT_BACKUP=1` hoặc `MTL_ALLOWED_HOSTS` từ shell được nội suy vào compose: bước backup báo lỗi giả, hoặc host allowlist bị nới.
- Sửa:
  ```bash
  dc() { docker compose -p "$PROJECT" -f "$work/docker-compose.yml" "$@"; }
  unset MTL_SKIP_BOOT_BACKUP MTL_ALLOWED_HOSTS COMPOSE_PROFILES
  ```

**m4. Stack `mtl-smoke` còn lại từ lần chạy `SMOKE_KEEP=1` trước bị chiếm và down.** sh:71, 53
- Lần chạy mới recreate container của stack cũ sang bind mount mới, rồi cleanup down nó.
- Thư mục `$work` cũ có file của uid 999 thành mồ côi, trên Linux phải busybox hoặc sudo mới xoá được.
- Sửa: sau `cd "$work"`, kiểm `[ -z "$(dc ps -aq)" ] || die "stack mtl-smoke đang tồn tại (SMOKE_KEEP lần trước?) — down trước"`.

**m5. Kiểm cổng app chỉ xem binding đầu tiên.** sh:98. `compose port` chỉ in 1 binding (index 1). Nếu có thêm binding `0.0.0.0` thứ hai thì kiểm vẫn qua. Sửa: tách cột `dc ps --format '{{.Ports}}' app` theo dấu phẩy, yêu cầu mọi mục có `->` đều bắt đầu `127.0.0.1:`.

**m6. Timeout của mjs đọc sai giá trị env.** mjs:14-15
- `SMOKE_PREPARE_TIMEOUT_S=abc` → `NaN`. `Date.now() > NaN` luôn false nên vòng poll chạy mãi.
- Giá trị `""` → 0, timeout ngay lập tức.
- Sửa: kiểm `Number.isFinite(n) && n > 0`, sai thì `die`.

**m7. Job `canceled` trong poll prepare không bị bắt.** mjs:162-166. Kết quả là chờ hết 900s mới báo, thay vì die ngay. Sửa: điều kiện thành `["failed","canceled"].includes(j.status)`.

**m8. verify chỉ so số trang, không so id.** mjs:232. Sửa: `pg.pages.map(p=>p.id)` phải trùng `st.pageIds` (cùng thứ tự). Phát hiện được trường hợp ingest chạy lại sau restart và tạo trang mới.

## Đã kiểm, không có lỗi
- `set -u` với mảng rỗng trên bash 3.2: `TIMES` luôn có ít nhất 4 phần tử khi lặp ở sh:111. `secrets` đã được chặn bằng `[ -e ]` trước khi lặp.
- Hàm `step` kết thúc bằng `log`, nên `[ -n ] && ...` không gây errexit.
- `mktemp -d <template>` và `pwd -P` chạy được cả GNU lẫn BSD. `rm -rf` và busybox chỉ chạm `$work`, mà `$work` luôn khác rỗng khi trap đã được đặt. Không có đường nào xoá ra ngoài thư mục tạm.
- Kiểm cổng postgres bằng cột Ports (theo quyết định đã chốt) là đúng. Postgres chỉ nằm trên mạng `internal: true`.
- Backup sau `restart app` + `up --wait`: backup chạy xong trước khi app listen, nên healthy đồng nghĩa với file đã rename xong. Không có race.
- PNG sinh tự động: các khối nằm trong khung 800×1200, CRC và IHDR đúng.

## Câu hỏi còn mở
- Có cần chạy trên Docker Engine Linux bản rootless không? Nếu chỉ hỗ trợ Docker Desktop và Linux với uid 1000, M1 hạ xuống minor, nhưng false-pass ở sh:72 vẫn nên sửa.

Status: DONE_WITH_CONCERNS
Summary: Script đủ 6 yêu cầu chức năng và phần kiểm cổng/quyền, không có critical. Có 1 major: kiểm file phía host gãy trên Linux khi uid khác 1000 hoặc Docker rootless, kèm false-pass ở sh:72. Ngoài ra trap cleanup dưới `set -e` có thể đổi mã thoát sau "SMOKE OK".
