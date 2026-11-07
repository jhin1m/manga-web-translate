# Review bản sửa finding self-host (working tree, branch feat/selfhost-local-mode)

Ngày: 2026-11-07 · Chỉ đọc code, không chạy docker · Điểm: **8/10**

Đã chạy: `pnpm --filter @mtl/api test:unit` (11 file, 68 test, xanh), `vitest run src/lib/api.test.ts` của web (9 test, xanh), `actionlint release.yml` (sạch). Đã kiểm SHA action bằng `gh api repos/<r>/commits/<tag>`: cả 9 SHA khớp tag ghi trong comment. Đã chạy thử Hono để xem API cũ trả gì cho `/api/config`.

## Từng finding

| Finding | Đóng chưa | Ghi chú |
|---|---|---|
| M1 | Đóng | `/data` trong dockerignore neo ở gốc context, dưới đó không có mẫu `!` nên BuildKit bỏ hẳn thư mục; repo không có file `*.dump` nào đang được track |
| M2 | Đóng (còn 3 lỗi Low ở promote) | Job `test` có output; `if` của promote ngầm cộng `success()`; image lỗi → promote bị skip; quyền khai báo riêng cho từng job; `flavor latest=false` + `type=raw` chỉ ra tag `:version` |
| M3 | Đóng | Điều kiện so sánh khớp drizzle (`pg-core/dialect.js:62`: áp migration khi `created_at < folderMillis`); journal tăng dần (26 entry, không entry nào lùi thời gian); chưa có git tag nên image nào phát hành ra cũng có guard |
| L1 | Đóng (gây hồi quy cho docs, xem F2) | Umask được giữ qua exec của setpriv; token đã ghi 0600 rõ ràng, worker cũng chạy uid 1000; `data/worker` đã đặt 0700 sẵn; jobs cùng uid; postgres không bị ảnh hưởng; smoke đọc file qua container |
| L2 | Đóng | tini nhận SIGTERM rồi chuyển cho tsx, tsx chuyển tiếp cho node con; còn file tmp của pg_dump bị bỏ lại thì prune dọn sau 6h |
| L4 | **Mới đóng một nửa** (F1) | |

---

## Các phát hiện

### F1 (Low, chưa đóng hết L4): web mới gặp API cũ, người chưa đăng nhập vẫn kẹt ở màn lỗi
- File: `apps/web/src/lib/api.ts:89-93`
- Ở `main`, `userApi()` gắn `app.use("*", requireUser)` và được mount tại `/api`. Middleware này chạy với cả đường dẫn không có route. Đã chạy thử Hono: không có cookie thì `/api/config` trả **401**, có phiên thì trả 404.
- Kịch bản: rollback API trên VPS, hoặc web được deploy trước API. Người đã đăng nhập vào được app (404 → `local_mode:false`). Người chưa đăng nhập, hoặc phiên đã hết hạn, nhận 401 → `config.isError` → màn "Không kết nối được máy chủ", không bao giờ thấy form đăng nhập. Đây đúng là trường hợp L4 cần chặn.
- Sửa: map cả 401 lẫn 404 thành `{ local_mode: false }`. Bản local không bao giờ trả 401 ở route public này. Thêm test cho 401.

### F2 (Low, hồi quy do L1): lệnh khôi phục trong docs hỏng khi user trên host Linux có uid khác 1000
- File: `infra/docker/app-entrypoint.sh:17` (`chmod 700 … backups`), `docs/self-host.md:98` (`… pg_restore … < data/backups/<file>.dump`)
- Kịch bản: host Linux có user uid 1001, hoặc Docker rootless. Phép chuyển hướng `<` do shell của host đọc file, nên báo `Permission denied` và không khôi phục gì. Trước bản sửa, thư mục 0755 và dump 0644 nên đọc được. Thông báo lỗi của guard mới (M3) lại trỏ người dùng tới đúng lệnh này.
- Sửa docs: `sudo cat data/backups/<file>.dump | docker compose exec -T postgres pg_restore …`, hoặc thêm một câu ghi chú về quyền.

### F3 (Low): promote không có pipefail, `gh api` lỗi thì `:latest` bị bỏ qua mà run vẫn xanh
- File: `.github/workflows/release.yml:150-151`
- Khi không khai báo `shell:`, GitHub chạy `bash -e {0}`, không có `-o pipefail`. Exit code của `newest="$(gh api … | sed | grep | sort -V | tail -n1)"` là của `tail`, tức 0. Nếu `gh api` lỗi (mạng, rate limit, 5xx) thì `newest=""` → `VERSION != newest` → không gắn `:latest`. Job chỉ in `::notice::… (bản mới nhất: )` rồi xanh. Bản 1.3.0 ra mà người dùng `latest` vẫn ở 1.2.x, và không ai biết.
- Sửa: thêm `shell: bash` (bật `-eo pipefail`), hoặc kiểm `[ -n "$newest" ] || { echo "::error::không đọc được danh sách tag"; exit 1; }`.

### F4 (Low): `:<major>.<minor>` có thể bị dời lùi
- File: `.github/workflows/release.yml:154` (`tags=(-t "$img:$MINOR")` không có điều kiện)
- Kịch bản: image của v1.3.0 build lỗi. Maintainer ra v1.3.1, lúc này `:1.3` và `:latest` trỏ 1.3.1. Sau đó có người bấm "Re-run failed jobs" ở run v1.3.0, hoặc chạy lại run bị huỷ ở F5. Promote của 1.3.0 dời `:1.3` về 1.3.0. Người ghim `MTL_TAG=1.3` bị hạ một bản patch; nếu 1.3.1 có migration thì guard M3 chặn khởi động và app restart lặp. `:latest` thì có điều kiện bảo vệ, `:minor` thì không.
- Sửa: tính thêm bản mới nhất trong cùng dòng minor (`grep "^${MINOR//./\\.}\."`) và chỉ gắn `:$MINOR` khi `VERSION` bằng bản đó.

### F5 (Low): concurrency `release` chỉ giữ 1 run chờ, push từ 3 tag trở lên thì run ở giữa bị huỷ
- File: `.github/workflows/release.yml:19-21`
- Mỗi concurrency group của GitHub chỉ có 1 run chạy và 1 run chờ. Run mới vào hàng chờ sẽ **huỷ** run đang chờ, kể cả khi `cancel-in-progress: false`. Kịch bản: `git push --tags` 3 tag một lúc (hoặc v1.2.6 rồi v1.3.0 trong lúc v1.2.5 còn build ~90 phút) → tag ở giữa không có image. `MTL_TAG=<bản đó>` sẽ báo "manifest unknown".
- Sửa: tag image là bất biến nên build song song an toàn. Chỉ cần đặt `concurrency` ở mức **job promote** (chạy vài phút, cửa sổ huỷ rất hẹp; điều kiện newest-tag đã chống ghi lùi). Bỏ concurrency ở mức workflow.

### F6 (Low): guard chạy sau backup, nên khi app restart lặp thì lần nào cũng pg_dump toàn bộ DB và đẩy bản dump cũ ra
- File: `apps/api/src/local/boot.ts:24-31`
- Kịch bản: ghim nhầm `MTL_TAG` cũ, `restart: unless-stopped` → mỗi lần restart (backoff tối đa khoảng 1 phút) lại pg_dump toàn bộ DB, tối đa 10 phút. Prune giữ 5 bản mới nhất, nên chỉ sau khoảng 5 lần restart là các bản m29 chụp ở các thời điểm trước (của những ngày trước) bị xoá hết. Chỉ còn bản mới nhất của mỗi schema, mà bản dump mới thì không thêm gì: guard ném lỗi trước khi DB bị đụng tới.
- Sửa: gọi `assertSchemaNotNewer` **trước** `backupBeforeMigrate`. Truy vấn rẻ, và lỗi không làm đổi DB.

### F7 (Low/nit): thông báo lỗi chỉ tới file dump có thể không tồn tại; docs chưa có mục cho lỗi này
- File: `apps/api/src/local/schema-guard.ts:54`
- Kịch bản: người dùng lên thẳng 1.0 (m20) → 1.3 (m29) rồi ghim 1.2 (m26). Không có file `mtl-*-m26.dump` nào. Cách đúng là khôi phục bản m20 mới nhất rồi để 1.2 tự migrate lên m26.
- Sửa câu chữ: "bản dump mới nhất có m ≤ 26". Thêm một dòng vào mục "Xử lý sự cố" trong `docs/self-host.md`.

### F8 (nit, DRY): `readDbMigrations` gần như chép lại `appliedMigrations`
- File: `schema-guard.ts:27-42` và `boot-backup.ts:64-76`: cùng truy vấn `to_regclass`, mỗi hàm mở một kết nối riêng. Nên gộp thành một helper trả `{ count, lastCreatedAt }`. Truy vấn DB của guard chưa có test (unit test chỉ phủ phần logic thuần), nên gộp lại cũng giúp đường này được smoke kiểm gián tiếp.

### F9 (nit): prune chỉ chạy sau khi dump thành công
- File: `boot-backup.ts:131`. Đĩa đầy → pg_dump lỗi → không prune → file tmp mồ côi không được dọn đúng lúc cần chỗ trống nhất. Có thể prune file tmp trước khi dump.

### Về lựa chọn trong disk-driver (`disk-driver.ts:204-212`): chấp nhận được
Hai lần rename trong cùng một thư mục: rename sidecar xong rồi mà rename dữ liệu lại lỗi thì gần như chỉ xảy ra với EIO/EROFS/EACCES thoáng qua. Khi đích đã có file cũ, giữ sidecar thì tệ nhất là sai Content-Type cho dữ liệu cũ (thẻ `<img>` vẫn tự nhận dạng định dạng ảnh). Xoá sidecar thì `readMeta` trả undefined, không tốt hơn. Còn khả năng đua (A xoá sidecar đúng lúc B commit cùng key) thì bỏ qua được. Không cần đổi.

## Rủi ro chưa kiểm được
- Pytest của worker **chưa từng chạy trên CI** (ci.yml không có). Lần push tag đầu tiên sẽ là lần đầu chạy trên ubuntu. Nếu fail vì môi trường (font, model bị skip, lib hệ thống) thì release bị chặn. Nên thêm bước pytest vào ci.yml, hoặc chạy thử trên nhánh trước khi tag.
- Service worker chưa có `init: true`: `sh` là PID 1 trong lúc chạy fetch_models, nên vẫn bị SIGKILL như ghi chú cũ. Ngoài phạm vi L2, chỉ nhắc lại.
- "Re-run all jobs" sẽ push đè `:<version>` bằng digest mới (GHCR không ép tag bất biến). Chỉ cần ghi chú cho maintainer.

## Câu hỏi
1. Có muốn dời guard lên trước backup (F6) không, hay giữ thứ tự hiện tại có chủ ý?
2. F5: chấp nhận ghi chú "chạy lại run bị huỷ" hay chuyển concurrency xuống mức job promote?
