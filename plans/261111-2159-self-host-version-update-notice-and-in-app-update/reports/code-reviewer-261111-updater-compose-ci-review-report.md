# Review: updater, runner, compose, entrypoint, Dockerfile, release.yml

Điểm: **8/10**. Không có lỗi critical hay high. Có 3 lỗi medium và 4 lỗi low. Các bất biến của phase 2 và phase 4 đều đúng
theo code, chỉ có kiểm bind là còn hở một chiều (M2).

## Kết quả chạy (e)
- `pnpm --filter @mtl/api test:unit`: 17 file, 169/169 xanh. `pnpm typecheck`, `pnpm lint` (471 file) sạch.
- `actionlint release.yml` sạch. `sh -n app-entrypoint.sh` sạch. Digest `docker:29.9.3-cli@sha256:2357639a…` khớp với `imagetools inspect`.
- `docker compose config -q` thoát 0. `MTL_UPDATER=0 docker compose config` ra `updater.deploy.replicas: 0`.
- Các probe đã chạy trên OrbStack, Compose v5.1.2 (thư mục scratch, đã dọn):
  - `pull` vẫn kéo image của service có `replicas: 0`. Nhờ vậy `MTL_WORKERS=0` không bị `version_mismatch`.
  - `MTL_SKIP_BOOT_BACKUP=` truyền qua env thắng dòng `=1` trong `.env`.
  - Khi không truyền `MTL_TAG`, dòng ghim `MTL_TAG=0.2.0` trong `.env` lộ ra đúng như mong đợi.
  - Hạ `replicas` từ 1 xuống 0 rồi `up -d` thì container bị xoá, không cần `--remove-orphans`.
  - Engine API nhận ref image đã `encodeURIComponent`.
  - Label `org.opencontainers.image.version` có trên cả image `mtl` lẫn `mtl-worker`.

## Bất biến (a): đã kiểm, đều đúng
- **Không ghi gì trước bước apply.** File tạm ẩn được ghi ở `runner.ts:192` và luôn bị xoá ở `:273`. Lần ghi đầu tiên vào thư mục người dùng là `:237-240`, sau bước verify (`:224-233`).
- **Ghi compose an toàn.** `rename` cùng thư mục (`:240`). uid, gid, mode lấy từ `:188` và trả lại ở `:238-239`. File `.bak` tạo ở `:237`.
- **Từ chối đường dẫn Windows.** Dạng `C:\` và `/run/desktop/mnt/host/wsl/` bị chặn (`discovery.ts:75-83,148-151`).
- **Allowlist image.** `postgres` được chuẩn hoá trước khi so (`runner-plan.ts:80-100`). Có chặn `build:`.
- **Label phiên bản.** Label của cả hai image phải bằng T (`runner.ts:224-233`), và được kiểm lại sau `up` (`:261-269`).
- **Tag và ghim.** Bản chính thức chạy `latest`, prerelease chạy `T` (`runner-plan.ts:26`, kiểm lại ở `runner.ts:73`). Ghim phát hiện từ image (`discovery.ts:218`, `server.ts:155`) và từ `.env` (`runner.ts:202-212`).
- **Khôi phục tuỳ chỉnh.** Cổng, số worker, env được khôi phục (`discovery.ts:167-187`). Test quét đủ mọi `${…}` hiện có.
- **Khoá theo tên runner.** Tên runner cố định, trùng tên thì trả 409 (`server.ts:161-185`).
- **Không tự rollback.** Đúng như thiết kế.
- **`MTL_UPDATER=0`.** `replicas` về 0, không mount socket.

## Bảo mật (b): đều đạt
- **Token.** So bằng `timingSafeEqual`, khác độ dài thì coi là sai ngay (`server.ts:59-63,217-220`).
- **Body.** Giới hạn 1 KB và chỉ đọc sau khi xác thực xong (`:205-214`).
- **Route.** Chỉ có 2 route, chỉ nhận `version` và đã qua semver, cấm tiền tố `v` (`:222-242`, kiểm lại ở `runner.ts:69`).
- **Lệnh compose.** `spawn` không qua shell (`runner.ts:90`).
- **Mạng và socket.** Không publish cổng, chỉ ở mạng `internal`. Socket chỉ có ở updater và runner.
- **Entrypoint.** Hai lệnh mới rẽ nhánh trước khối root/chown (`app-entrypoint.sh:11-14`). Nhánh `app` và `jobs` không đổi.
- **release.yml.** Chỉ `github-release` có `contents: write` (`:185-186`). `run:` chỉ đọc biến env, không có `${{ }}` lấy từ tag. Tag prerelease bị bỏ qua (`:181`).

## Medium
**M1. Updater nhận mọi bản prerelease mới hơn, không cần người vận hành bật.**
- Vị trí: `server.ts:154-157`. Test `updater-server.test.ts:319` khoá hành vi này với `MTL_UPDATE_TARGET=` rỗng. Ca "ghim + prerelease" ở `:333` cũng trả 202.
- Kịch bản: app bị chiếm quyền (app xử lý ZIP, ảnh, font không tin cậy) gửi `POST {version:"0.4.0-rc.1"}`. Runner cài rc với `MTL_TAG=rc` và migrate DB lên schema của rc. Lần `docker compose up -d` tay sau đó chạy `latest` cũ hơn, app từ chối khởi động, người dùng phải khôi phục backup.
- Điều này trái với câu trong plan: updater "chỉ lên bản chính thức mới hơn".
- Sửa: với T là prerelease, chỉ nhận khi `compareVersions(T, info.vars.MTL_UPDATE_TARGET) === 0`. Giá trị này lấy từ `Config.Env` của container app, tiến trình app không sửa được. Thêm test cho ca bị từ chối.

**M2. Kiểm bind chỉ đi một chiều nên bỏ lọt khi mount bị dời ra ngoài thư mục project.**
- Vị trí: `runner-plan.ts:106-122`. Hàm chỉ duyệt bind của compose mới có source nằm dưới `dir`.
- Có hai trường hợp lọt qua:
  - Bind đang chạy (ví dụ `postgres:/var/lib/postgresql/data`) mà trong compose mới trỏ ra ngoài `dir`.
  - Bind đang chạy bị bỏ hẳn khỏi compose mới.
- Test `updater-runner-plan.test.ts:69-77` còn khoá ca đầu là `null` (cho qua).
- Hậu quả: postgres khởi tạo cụm DB trống ở chỗ mới, app migrate trên DB trống. Lỗi chỉ bị bắt sau `up` (`runner.ts:253-260`). Đây đúng là kịch bản mà D12 muốn chặn trước khi đổi gì.
- Hiện lỗi chưa xảy ra được, vì compose dùng `./data/*`. Nó sẽ thành lỗi thật khi một tag sau dùng đường dẫn tuyệt đối hoặc đường dẫn lấy từ biến.
- Sửa: với mỗi service đang có container, duyệt từng cặp `(target, source)` trong `have`. Compose mới phải có bind cùng target và cùng source, thiếu hoặc lệch thì `path_mismatch`. Giữ nguyên kiểm cho bind mới nằm dưới `dir`. Đổi kỳ vọng của test ở dòng 74.

**M3 (thiếu test). `runUpdate`, nơi giữ thứ tự an toàn, chưa có test nào.**
- Vị trí: `runner.ts:166-275`. Test hiện có chỉ phủ các hàm thuần. Lần chạy thật dừng ở bước download (báo cáo phase 4).
- Những điều sau chưa được test khoá:
  - Không ghi gì trước apply, cả khi `config`, `pull` hay `verify` lỗi.
  - `.bak`, mode và chủ sở hữu được giữ.
  - File tạm bị xoá.
  - Ánh xạ reason.
- Sửa: dùng `DockerApi` giả, `dir` là một `mkdtemp`, và một script `docker-compose` giả đặt trên `PATH` (vì `composeEnv` chuyển tiếp `PATH`). Sau mỗi bước lỗi, assert `docker-compose.yml` còn nguyên byte và không có `.bak`.

## Low
- **L1.** `runner.ts:238`: `chmod` không có `.catch`, trong khi `chown` ở `:239` có. Trên filesystem không cho chmod (bind của Docker Desktop Windows, chưa kiểm), apply sẽ hỏng sau khi đã ghi `.bak`. Vẫn an toàn vì compose chưa đổi, nhưng không bao giờ cập nhật được. Nên `.catch` + log giống chown.
- **L2.** `runner.ts:237`: `.bak` thuộc `root:root` và giữ mode gốc. Nếu file cài với umask 077 (mode 0600), lệnh khôi phục trong docs (`self-host.md:292`, `cp docker-compose.yml.bak …`) phải dùng sudo. Nên chown `.bak` về uid/gid gốc, bỏ qua nếu lỗi.
- **L3.** `server.ts:161` và `:68`: hai POST đồng thời. Request B có thể `remove(force:false)` runner của A khi runner đó còn ở trạng thái `created`. A nhận 422 `path_mismatch` sai lý do. Khoá theo tên vẫn bảo đảm chỉ có một runner chạy. Ngoài ra, runner kẹt ở `created` (start lỗi và dọn cũng lỗi) sẽ làm `busy` mãi mãi.
- **L4.** `docker-compose.yml:145`: `MTL_UPDATER=false` làm `compose config` lỗi `strconv.Atoi`, cả stack không lên. Trong khi đó `MTL_UPDATE_CHECK` lại nhận `false`, hai công tắc đặt cạnh nhau mà khác cách hiểu. Docs nên ghi rõ chỉ dùng `0`/`1`.

## Tương thích ngược (c): không có hồi quy mới
- Các service cũ chỉ được thêm 3 biến env có mặc định. Healthcheck, `depends_on`, cổng và mount giữ nguyên.
- Image cũ + compose mới: updater restart lặp vì `chown` trên mount `ro` lỗi. Kết quả giống plan mô tả và đã được chấp nhận.
- Image mới + compose cũ: không có service updater, nên báo `unavailable`.
- Docker rootless: `up` lỗi mount nếu chưa đặt `MTL_DOCKER_SOCK` hoặc `MTL_UPDATER=0`. Đã ghi ở `self-host.md:21-22`, rủi ro đã chấp nhận.

## Quy ước (d)
Không có plan ID hay số phase trong code, test, compose hay workflow. Ranh giới import có test riêng.
## Câu hỏi mở
- Trên Docker Desktop Mac, `Mounts[].Source` thực tế có dạng gì (`/host_mnt/…` hay `/Users/…`)? Fixture hiện viết tay, cần smoke phase 6 xác nhận.
