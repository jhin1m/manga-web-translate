# Tự host bằng Docker (bản cá nhân, 1 người dùng)

Chạy toàn bộ app trên máy của bạn bằng **một file** `docker-compose.yml`: không cần `.env`, không tài khoản, không MinIO.
Bản nhiều người dùng trên VPS (S3/MinIO + đăng nhập) xem [deployment-guide.md](./deployment-guide.md).

> **Cảnh báo bảo mật — chế độ local KHÔNG có đăng nhập.** Ai gọi được cổng là toàn quyền (xem/xoá dữ liệu, dùng key
> AI của bạn). Compose chỉ mở `127.0.0.1` — **đừng** đổi sang `0.0.0.0`, đừng mở ra LAN/Internet, đừng đặt sau reverse
> proxy công khai hay tunnel (Cloudflare Tunnel, ngrok…). App còn chặn Host lạ (chống DNS rebinding) và request ghi
> từ site khác (CSRF), nhưng đó là lớp phụ, không thay cho đăng nhập.

## Yêu cầu

- Docker Engine (Linux) hoặc Docker Desktop / OrbStack (macOS), Compose ≥ 2.17 (`docker compose version`).
  **Linux: Docker Engine ≥ 28.3.3** — bản cũ hơn có thể để máy cùng LAN gọi thẳng vào container dù cổng chỉ bind
  `127.0.0.1` (trước 28.0), hoặc lộ cổng localhost sau khi reload firewalld (CVE-2025-54388, 28.2.0–28.3.2). App
  không có đăng nhập nên lớp bảo vệ duy nhất là cổng chỉ mở cho `127.0.0.1`.
- RAM cho Docker **≥ 10 GB** (nên 12 GB) với mặc định 2 worker, hoặc **≥ 6 GB** nếu đặt `MTL_WORKERS=1` (xem [Worker](#worker)).
  Docker Desktop giới hạn RAM của VM thấp hơn RAM máy: chỉnh ở Settings → Resources → Memory. Đĩa ~2 GB cho model AI
  và chỗ cho ảnh truyện.
- Internet: tải image, tải model lần đầu, gọi API AI khi dịch.
- Nút **Cập nhật ngay** cần Docker socket. **Docker rootless trên Linux** (không có `/var/run/docker.sock`): đặt
  `MTL_DOCKER_SOCK=$XDG_RUNTIME_DIR/docker.sock` hoặc `MTL_UPDATER=0`, nếu không `docker compose up -d` báo lỗi mount.
  **Docker Desktop bật Enhanced Container Isolation** chặn updater: cập nhật tay.
- Kiến trúc `linux/amd64` hoặc `linux/arm64` (Apple Silicon chạy bản arm64). Chưa hỗ trợ GPU NVIDIA, Windows chưa kiểm (cập nhật trong app trên Windows cũng chưa kiểm, xem [Cập nhật](#cập-nhật)).

## Cài (3 lệnh)

```bash
mkdir mtl && cd mtl
curl -fsSLO https://raw.githubusercontent.com/jhin1m/manga-web-translate/main/docker-compose.yml
docker compose up -d
```

Lần đầu worker tải model (~1–2 GB, kiểm sha256): theo dõi bằng `docker compose logs -f worker` tới khi mỗi worker in
một dòng `mtl-worker … mode=loop threads=…` (mặc định 2 dòng). Trong lúc đó web vẫn mở được, job chỉ chạy khi worker
sẵn sàng. Lần đầu cả 2 worker cùng tải model vào `./data/models`: an toàn, chỉ tốn băng thông gấp đôi một lần.

`docker pull` báo `denied`/`unauthorized` → image GHCR chưa được đặt public (việc của người phát hành).

## Thêm nhà cung cấp AI (bắt buộc để dịch)

Mở <http://localhost:8080> → **Cài đặt → Nhà cung cấp** → thêm nhà cung cấp:

1. Loại **Anthropic**, nhập tên và API key.
2. Bấm gợi ý **+ claude-haiku-5-5** (điền sẵn giá, đã tick Vision).
3. Lưu. Nhà cung cấp **đầu tiên** tự được gán vào các tác vụ còn trống: Dịch dùng model đầu tiên trong danh sách; OCR
   và Hiệu đính dùng model đầu tiên có Vision (không có thì để trống). Không cần mở **Model tác vụ**.

Muốn đổi model sau đó: **Cài đặt → Model tác vụ**. Nhà cung cấp thêm sau không tự đổi gán.

Với Anthropic, worker chưa chạy được Sonnet 5.5, Opus 5.5, Fable, Mythos nên form và API từ chối các model này.

Phát hiện chữ, xoá chữ và OCR mặc định chạy local trên máy: không tốn token, key chỉ dùng cho dịch và hiệu đính. Nếu
chọn OCR bằng AI ở cài đặt pipeline thì tác vụ **OCR** phải có model Vision.

**Series mới mặc định nguồn tiếng Anh**, loại truyện chỉ quyết định định dạng trang. Dịch raw Hàn / Nhật / Trung thì chọn
"Dịch từ" ngay trong modal tạo series (hoặc đổi sau ở Cài đặt series). Nguồn Nhật hoặc Anh dạng từng trang đọc phải sang trái. Comic phương Tây dạng trang bị
đảo thứ tự: đổi định dạng sang Cuộn dọc chỉ áp dụng cho chương tải lên sau đó, và cuộn dọc sẽ ghép rồi cắt lại trang
theo vùng chữ.

## Cập nhật

### Xem phiên bản

Bấm avatar (góc phải trên): dòng cuối menu là `MTL v0.3.0`. Bản tự build, không qua Release, hiện `MTL dev`.

### Thông báo bản mới

App hỏi GitHub xem có bản mới không, tối đa 1 lần/ngày, chỉ khi bạn mở web. Việc hỏi do máy chủ app làm chứ không phải
trình duyệt. Request chỉ gồm IP máy bạn và User-Agent `mtl-selfhost`. Có bản mới thì avatar có chấm nhỏ (mở menu một lần
là tắt) và menu có mục **Có bản mới vX.Y.Z · Xem thay đổi**. Không hỏi GitHub nữa: ghi `MTL_UPDATE_CHECK=0` (cách ghi
như mục [Tắt nút cập nhật](#tắt-nút-cập-nhật)).

### Cập nhật ngay (từ 0.3.0)

Trong menu có bản mới, bấm **Cập nhật ngay** rồi **Cập nhật**. App làm lần lượt:

1. Tải bản mới trong lúc app vẫn chạy.
2. Dừng worker (chờ job đang chạy tối đa 90 giây), sao lưu DB, migrate, chạy lại. Giai đoạn này app tạm không mở được.
3. Khi app đã lên bản mới, trang đợi bộ cập nhật báo xong (tối đa 10 phút) rồi tự tải lại.

Mất vài phút, có thể lâu hơn nếu mạng chậm. Không hạ cấp được. Lỗi thì hộp thoại báo lý do; log ở
`docker logs mtl-local-update`. Nếu lỗi xảy ra khi app đã chạy bản mới (bước cuối), hộp thoại nói rõ app đã lên bản mới và
chỉ dẫn xem log. Bấm lần hai trong vòng 60 giây thì báo "Vừa thử cập nhật. Đợi một phút rồi thử lại."

Nút chỉ hiện khi: không ghim `MTL_TAG`, dùng đúng một file `docker-compose.yml` (không file override), service `updater`
đang chạy, và app xác định chắc được thư mục dữ liệu trên máy. Không đủ điều kiện thì menu hiện **Cách cập nhật** kèm
lệnh để chạy tay (kể cả khi app không xác định chắc được thư mục dữ liệu, mã `path_mismatch`: app dừng để an toàn).

> **Windows**: cập nhật trong app chưa được kiểm trên máy Windows thật. Nếu app không xác nhận được đường dẫn thư mục
> dữ liệu, nút tự đổi thành **Cách cập nhật** và bạn cập nhật tay như dưới.
>
> **Linux**: cập nhật trong app chưa kiểm trên máy Linux thật.

### Bảo mật của nút cập nhật

- Service `updater` giữ Docker socket, nghĩa là có quyền tương đương root/admin trên máy (Docker Desktop: trên VM và
  các thư mục chia sẻ). Service `app` (nơi xử lý ảnh, ZIP, font) **không** có socket.
- Updater không mở cổng, chỉ nói chuyện với `app` qua mạng nội bộ của compose, có token ở `data/secrets/updater-token`.
- Updater chỉ làm đúng một việc: cập nhật lên bản phát hành chính thức mới hơn (prerelease chỉ nhận khi đúng bằng `MTL_UPDATE_TARGET` của app, dành cho người phát hành, và mới hơn bản đang chạy), bằng image `ghcr.io/jhin1m/mtl*` và
  file compose của đúng tag đó trên GitHub.
- Không muốn thì tắt (ngay dưới).

### Tắt nút cập nhật

Ghi `MTL_UPDATER=0` vào file `.env` cạnh `docker-compose.yml`, rồi `docker compose up -d`. Updater không chạy và không
mount socket, và app không gọi đến updater. Menu vẫn báo bản mới (nếu chưa tắt `MTL_UPDATE_CHECK`) và hiện lệnh cập nhật tay.

Tạo/sửa `.env`:

- Windows: `notepad .env`, thêm dòng `MTL_UPDATER=0`, lưu. Đừng dùng `>` hay `Out-File` trong PowerShell: file bị lưu
  UTF-16 và Compose đọc sai.
- Linux/macOS: `echo MTL_UPDATER=0 >> .env`.

### Cập nhật tay

Dùng khi tắt updater, đang ghim `MTL_TAG`, hoặc bản đang chạy chưa có updater. Chạy trong thư mục chứa
`docker-compose.yml`.

Windows (PowerShell), gõ đúng `curl.exe`, từng dòng một:

```powershell
curl.exe -fsSLO https://raw.githubusercontent.com/jhin1m/manga-web-translate/main/docker-compose.yml
docker compose pull
docker compose up -d
```

Linux/macOS:

```bash
curl -fsSLO https://raw.githubusercontent.com/jhin1m/manga-web-translate/main/docker-compose.yml
docker compose pull && docker compose up -d
```

Lệnh `curl` tải lại `docker-compose.yml`, vì bản mới có thể đổi cả file này (vd thêm worker thứ 2). `pull` chỉ tải image
mới. File cũ bị ghi đè, nên đừng sửa thẳng file: đặt tuỳ chỉnh bằng biến môi trường hoặc file `.env` cạnh nó (xem dưới).

### Lần đầu từ 0.2.0 trở xuống

Bản cũ chưa có updater, nên cập nhật tay **một lần**:

```powershell
cd "C:\đường-dẫn\tới\thư-mục-mtl"
curl.exe -fsSLO https://raw.githubusercontent.com/jhin1m/manga-web-translate/main/docker-compose.yml
docker compose pull
docker compose up -d
docker compose ps
```

`docker compose ps` phải thấy service `updater` đang chạy. Từ đó về sau dùng nút trong app. (Linux/macOS: dùng khối bash
ở trên rồi `docker compose ps`.)

### Thứ tự khi cập nhật, ghim bản

Khi cập nhật (tay hay trong app), compose tự dừng `jobs` + `worker` **trước** khi tạo lại `app`, chờ `app` mới backup DB + migrate xong
(healthy) rồi mới chạy lại 2 service đó — code cũ không chạy trên schema mới (`depends_on … restart: true` trong compose).
Job đang chạy dở: worker chờ tối đa 90s cho job xong, quá thì job bị đánh lỗi `internal` (server cho chạy lại nếu job còn lượt thử) — vì vậy bước dừng worker có thể mất tới ~100s. Chỉ hỗ trợ nâng cấp, **không hạ cấp**
(DB đã migrate không chạy được với code cũ — muốn quay lại thì khôi phục bản backup trước nâng cấp, xem dưới).

Ghim một bản thay vì `latest`: `MTL_TAG=1.2.3 docker compose up -d` (hoặc ghi `MTL_TAG=1.2.3` vào file `.env` cạnh
`docker-compose.yml` để không phải gõ lại). Đang ghim thì app không hiện nút **Cập nhật ngay**, chỉ hiện lệnh tay; muốn
dùng lại nút thì bỏ dòng `MTL_TAG` khỏi `.env`.

## Tuỳ chỉnh (biến môi trường của compose, đều tuỳ chọn)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MTL_PORT` | `8080` | Cổng trên máy (luôn bind `127.0.0.1`). Cổng bận → đổi, vd `MTL_PORT=9090 docker compose up -d` |
| `MTL_TAG` | `latest` | Phiên bản image |
| `MTL_ALLOWED_HOSTS` | (trống) | Tên host thêm (csv) được phép gọi API — chỉ cần khi worker chạy ngoài compose (xem dưới) |
| `MTL_SKIP_BOOT_BACKUP` | (trống) | `1` = bỏ backup DB lúc `app` khởi động — chỉ dùng khi `pg_dump` lỗi chặn app (xem Sự cố) |
| `MTL_WORKERS` | `2` | Số worker, mỗi worker chạy 1 job một lúc. Mỗi worker cần ~4,6 GB RAM. Máy yếu → `MTL_WORKERS=1 docker compose up -d` (xem [Worker](#worker)) |
| `MTL_THREADS` | (trống) | Số luồng xoá chữ + OCR của **mỗi** worker. Trống = số nhân CPU chia đều cho `MTL_WORKERS` |
| `MTL_UPDATE_CHECK` | `1` | `0` = không hỏi GitHub có bản mới (xem [Thông báo bản mới](#thông-báo-bản-mới)) |
| `MTL_UPDATER` | `1` | Chỉ nhận `0` hoặc `1` (`false`/`no` làm `docker compose` báo lỗi). `0` = không chạy service `updater`, không mount Docker socket (xem [Tắt nút cập nhật](#tắt-nút-cập-nhật)) |
| `MTL_DOCKER_SOCK` | `/var/run/docker.sock` | Đường dẫn Docker socket mount cho `updater`. Docker rootless: `$XDG_RUNTIME_DIR/docker.sock` |

Biến bên trong image (compose/image đã đặt sẵn, chỉ cần biết khi chạy tay hoặc dev):

| Biến | Giá trị trong image | Ghi chú |
|---|---|---|
| `MTL_LOCAL_MODE` | `1` | Bật chế độ local: không đăng nhập, user local là admin, secret tự sinh, lưu file ra đĩa |
| `MTL_DATA_DIR` | `/data` | Gốc `secrets/`, `files/`, `backups/`, `worker/`. Dev chạy `MTL_LOCAL_MODE=1` ngoài Docker **phải** đặt (mặc định `/data` không ghi được trên macOS) |
| `API_PORT` | `8080` | Local mode mặc định 8080 (bản VPS 8787) |
| `SPA_DIR` | `/app/apps/web/dist` | API phục vụ luôn web build sẵn |
| `MTL_VERSION` | số phiên bản của tag (`dev` nếu build tay) | Phiên bản hiện ở menu tài khoản; `dev` thì không hỏi GitHub |

## Dữ liệu (`./data`, cạnh `docker-compose.yml`)

| Thư mục | Nội dung |
|---|---|
| `postgres/` | Database Postgres 17 |
| `files/` | Ảnh gốc, trang đã xử lý, file xuất ZIP/CBZ (xuất tự xoá sau 7 ngày) |
| `secrets/` | `better-auth-secret`, `secrets-key` (tự sinh lần đầu, quyền 600). **Mất `secrets-key` = mọi key AI đã lưu không giải mã được** → nhập lại ở Cài đặt |
| `backups/` | Bản dump DB tự động mỗi lần `app` khởi động |
| `worker/` | Token worker (app ghi, worker chỉ đọc) |
| `models/` | Model AI worker tải về (tải lại được, không cần sao lưu) |

Sao lưu = dừng app rồi chép cả thư mục `./data` (trừ `models/` nếu muốn):

```bash
docker compose stop
sudo cp -a data /nơi/khác/mtl-data-$(date +%F)    # Linux cần sudo: postgres/files/secrets/backups đều 0700
docker compose start
```

## Backup DB tự động + khôi phục

Mỗi lần `app` khởi động (trừ lần đầu DB trống) tạo `data/backups/mtl-<UTC>-m<N>.dump` (`N` = số migration đã áp),
giữ 5 bản mới nhất **cộng** bản mới nhất của mỗi phiên bản schema trong 3 phiên bản gần nhất → restart nhiều lần sau
nâng cấp không xoá mất bản trước nâng cấp. Migrate lỗi khi nâng cấp → `app` restart lặp, bản backup vừa tạo vẫn còn.
Image cũ hơn DB → `app` dừng trước khi backup (không tạo dump mới mỗi lần restart).

Khôi phục (thay `<file>` bằng tên bản dump):

```bash
sudo ls -l data/backups          # chọn bản dump
docker compose stop app jobs worker
sudo cat data/backups/<file>.dump | docker compose exec -T postgres pg_restore --clean --if-exists --create -U mtl -d postgres
docker compose up -d
```

`data/backups` (và `data/files`, `data/secrets`) quyền 700, chủ uid 1000 — chặn user khác trên máy → trên Linux mọi
lệnh đọc trong đó (`ls`, `cat`, `cp`) cần `sudo` nếu user của bạn không phải uid 1000; macOS/Windows (Docker Desktop)
bỏ `sudo`. `--create -d postgres` xoá hẳn database `mtl` rồi tạo lại từ bản dump — cần thiết khi khôi phục bản cũ hơn schema
hiện tại (chỉ `--clean` sẽ để sót bảng của migration mới, lần nâng cấp sau migrate lỗi). Phải dừng `app jobs worker`
trước (database đang có kết nối thì không xoá được).

Quay về bản cũ sau nâng cấp hỏng: khôi phục bản dump tạo khi còn chạy bản cũ (`m<N>` không lớn hơn số migration của
bản cũ) **và** ghim `MTL_TAG=<bản cũ>` trước `up -d`. Ghim bản cũ mà quên khôi phục → `app` từ chối khởi động (xem
Xử lý sự cố) thay vì chạy code cũ trên schema mới.
Backup DB không gồm ảnh (`files/`) — ảnh không bị migrate đụng tới.

Postgres được ghim major 17; nâng lên major mới (18…) là thủ tục riêng (dump → đổi image → restore), không tự động.

## Worker

- Worker trong compose dùng provider `anthropic`; key lấy từ Cài đặt → Nhà cung cấp (lưu mã hoá trong DB).
- **Mặc định 2 worker**: mỗi worker chạy 1 job một lúc, nên 2 job chạy song song. Khi có nhiều chương cùng chờ,
  2 worker chạy 2 chương cùng lúc, mỗi chương một worker; chương thứ 3 bắt đầu khi một trong hai chương hết trang chờ.
  Chỉ một chương chờ thì cả 2 worker cùng làm chương đó. Đổi lại, khi nhiều chương cùng chờ thì chương tải lên trước
  xong chậm hơn khoảng 2 lần so với lúc được cả 2 worker; tổng thời gian xong hết các chương không đổi. Xuất file, tẩy
  lại trang, OCR vùng được chạy trước, ngay khi một worker xong job đang chạy.
  - `MTL_WORKERS=1`: các chương thường chạy lần lượt, chương tải lên trước chạy trước.
  - Xoá chữ + OCR chạy bằng CPU, hai worker chia nhau số nhân (log in `threads=`). Nhanh hơn bao nhiêu thì tuỳ máy.
    Trên máy đo (arm64, 12 nhân) xoá chữ nhanh hơn ~2 lần so với 1 worker. Máy ít nhân thì tăng ít hơn.
  - RAM: mỗi worker nạp model riêng, đỉnh ~4,6 GB mỗi worker, cộng tới ~0,7 GB cho app + DB (đo trên arm64, 12 nhân;
    tổng ~9,8 GB, chưa gồm phần VM Docker tự dùng). Docker có ít hơn ~10 GB → `MTL_WORKERS=1 docker compose up -d`
    (cần ~6 GB). Ghi `MTL_WORKERS=1` vào `.env` cạnh `docker-compose.yml` để không phải gõ lại.
  - Đổi số worker bằng `MTL_WORKERS`, đừng dùng `docker compose up --scale worker=N`. `--scale` không đổi cách chia
    luồng, nên các worker giành nhân của nhau: chỉ chậm hơn, không hỏng.
  - Hai chương dịch cùng lúc → số request tới API AI tăng gấp đôi, dễ gặp giới hạn tốc độ (429). Server tự tạm dừng
    provider 2 phút khi lỗi dồn dập rồi chạy tiếp, không cần làm gì.
- **Thu hồi token worker** trong Cài đặt: token mới chỉ được sinh khi `app` khởi động lại, worker cũ sẽ 401 và restart
  lặp tới lúc đó → chạy `docker compose restart app worker`.
- **Worker chạy ngoài compose**: API chặn Host lạ. Worker chạy thẳng trên máy gọi `http://localhost:8080` thì không
  cần gì thêm; worker trong container khác gọi qua tên host khác (vd `host.docker.internal`) thì thêm tên đó vào
  `MTL_ALLOWED_HOSTS` (vd `MTL_ALLOWED_HOSTS=host.docker.internal docker compose up -d`). Thiếu bước này worker nhận
  403, coi là lỗi tạm và thử lại im lặng. Token: `data/worker/token` (quyền 600, chủ uid 1000 — worker chạy thẳng trên
  Linux phải chạy bằng uid 1000 hoặc chép token ra file riêng của user mình: `sudo cat data/worker/token > ~/.mtl-token && chmod 600 ~/.mtl-token`). Cổng chỉ bind `127.0.0.1` nên
  máy khác không gọi được.

## Gỡ cài

```bash
docker compose down --rmi all  # dừng + xoá container và image của compose, giữ ./data
docker rm -f mtl-local-update  # container chạy cập nhật nằm ngoài compose nên `down` không xoá (báo lỗi nếu chưa từng cập nhật trong app: bỏ qua)
sudo rm -rf data               # xoá hẳn dữ liệu (không lấy lại được); Linux cần sudo vì data/postgres
```

## Xử lý sự cố

- **Xem log**: `docker compose logs -f app` (hoặc `jobs`, `worker`, `postgres`); trạng thái: `docker compose ps`.
- **Cổng 8080 bận** (`port is already allocated`, hoặc trang mở ra không phải app): `MTL_PORT=9090 docker compose up -d`.
- **Lỗi quyền `./data`** (Linux, `permission denied`): container tự `chown` thư mục của nó về uid 1000 khi khởi động;
  nếu đã tạo tay bằng user khác: `sudo chown -R 1000:1000 data/files data/secrets data/backups data/worker data/models`
  (đừng đụng `data/postgres` — thuộc user của Postgres).
- **`app` không healthy, log báo `pg_dump` lỗi**: app cố ý dừng (không migrate khi chưa backup được). Xem nguyên nhân
  trong log; cần chạy gấp thì `MTL_SKIP_BOOT_BACKUP=1 docker compose up -d app` (sau đó bỏ biến này).
- **`app` restart lặp, log báo `DB đã ở schema m<X>, mới hơn bản app đang chạy`**: đang chạy image cũ hơn bản đã
  migrate DB (ghim `MTL_TAG` cũ, hoặc pull nhầm bản cũ). Dữ liệu chưa bị đụng. Dùng lại bản mới (bỏ `MTL_TAG` rồi
  `docker compose pull && docker compose up -d`), hoặc khôi phục bản dump của bản cũ (mục Backup DB) rồi mới `up -d`.
- **Worker restart lặp**: `docker compose logs worker` — tải model lỗi (mạng) sẽ tự thử lại; `401` = token bị thu hồi
  (xem mục Worker).
- **Worker tự khởi động lại giữa chừng** (log in lại dòng `mtl-worker … mode=loop` khi đang chạy job, `docker compose ps`
  có thể thấy `Restarting (137)`): thường là thiếu RAM, bị OOM kill. Tăng RAM cho Docker hoặc chạy 1 worker:
  `MTL_WORKERS=1 docker compose up -d`.
- **Mở web báo "Không kết nối được máy chủ"**: `app` chưa chạy xong (lần đầu/sau cập nhật đang migrate) — đợi rồi bấm Thử lại.
- **Bóng chỉ có dấu câu (`...!`) bị xoá trắng trên trang đã xử lý trước đây**: bản mới giữ nguyên hình gốc cho vùng không
  có chữ/số, nhưng trang cũ phải **Quét lại trang** mới áp dụng.
- **Cập nhật trong app báo lỗi**: xem `docker logs mtl-local-update`. Lỗi trước bước khởi động lại (tải, kiểm tra) thì
  app vẫn chạy bản cũ và `docker-compose.yml` chưa bị đổi: kiểm tra mạng rồi thử lại. Lỗi sau bước đó thì
  `docker-compose.yml` đã là bản mới (bản cũ ở `docker-compose.yml.bak`, giữ nguyên chủ sở hữu và quyền của file gốc). Khi đó chạy `docker compose up -d`, xem
  `docker compose logs app`, và đọc mục [Backup DB tự động + khôi phục](#backup-db-tự-động--khôi-phục).
- **Menu báo không cập nhật được trong app** (nút là **Cách cập nhật**, kèm một dòng lý do): bản cài chưa có
  `updater` (file compose cũ, hoặc `MTL_UPDATER=0`) / `updater` không truy cập được Docker (rootless: đặt
  `MTL_DOCKER_SOCK`) / đang ghim `MTL_TAG` / dùng compose tuỳ chỉnh hoặc file override / app không xác định chắc được
  thư mục dữ liệu (dừng để an toàn) / Docker quá cũ. Mọi trường hợp: cập nhật tay (mục [Cập nhật tay](#cập-nhật-tay)).
- **Sau khi cập nhật trong app, chạy `docker compose up -d` thấy tạo lại container**: bình thường, dữ liệu không đổi.
- **`403` khi mở bằng IP/tên máy**: chỉ `localhost`/`127.0.0.1` được phép (chống DNS rebinding) — mở đúng
  <http://localhost:8080>.

## Dành cho người phát hành (maintainer)

1. Merge vào `main` (link cài và cập nhật tay trỏ `docker-compose.yml` vào `main`). Người dùng tải file này ngay khi
   cập nhật, kể cả khi đang ghim `MTL_TAG` cũ → chỉ merge thay đổi compose cùng lúc với tag release có image tương ứng,
   và giữ compose chạy được với image cũ (biến mới chỉ thêm, không bắt buộc).
2. Viết `docs/releases/vX.Y.Z.md` (dòng đầu `# vX.Y.Z — tiêu đề`, dòng này thành tiêu đề Release) **trước** khi tag
   chính thức. Thiếu file thì Release dùng ghi chú tự sinh (job `test` cảnh báo).
3. Push tag prerelease, VD `git tag v0.3.0-rc.1 && git push origin v0.3.0-rc.1` → `release.yml` chạy test rồi build
   `ghcr.io/jhin1m/mtl:0.3.0-rc.1` và `ghcr.io/jhin1m/mtl-worker:0.3.0-rc.1`. Prerelease không gắn `latest` và không
   tạo GitHub Release.
4. Lần đầu có image: GitHub → Packages → `mtl` và `mtl-worker` → Package settings → đổi visibility thành **Public**
   (mặc định private, người dùng `pull` sẽ báo `denied`).
5. Thử trên máy sạch: `MTL_TAG=0.3.0-rc.1 docker compose up -d` hoặc `infra/selfhost-smoke.sh` với image rc. Thử cập nhật
   trong app giữa hai bản rc: `FROM=0.3.0-rc.1 TO=0.3.0-rc.2 infra/selfhost-update-smoke.sh` (script tự đặt
   `MTL_UPDATE_TARGET`, biến chỉ dành cho người phát hành, thay kết quả hỏi GitHub và cho phép đích là prerelease;
   cả hai tag phải đã push; cách dùng đầy đủ ở phần đầu script). Đổi updater, compose hoặc entrypoint thì thử cả trên Windows.
6. Push tag chính thức `vX.Y.Z`. Workflow lần lượt test → build image → promote (gắn `X.Y` + `latest`) → tạo GitHub
   Release. Release chỉ được tạo sau promote nên người dùng thấy thông báo khi `:latest` đã sẵn sàng.
7. Compose thêm biến mới thì phải thêm vào bảng khôi phục biến của updater (`apps/api/src/updater/compose-vars.ts`);
   test `updater-compose-vars` đỏ nếu quên.
8. Nút "Cập nhật ngay" cố ý từ chối, trước khi đổi gì, khi compose mới:
   - thêm, đổi hoặc bỏ một bind dưới `./data` của service có sẵn (kiểm hai chiều) → `path_mismatch`,
   - bỏ hoặc đổi tên một service đang chạy (service đang chạy mà compose mới không có) → `invalid_compose`.

   Bản như vậy phải ghi trong `docs/releases/vX.Y.Z.md` là cập nhật tay (lệnh ở mục Cập nhật). Bản bỏ hoặc đổi tên
   service thì lệnh `up` trong ghi chú phải là `docker compose up -d --remove-orphans`, nếu không container cũ vẫn
   chạy image cũ trên DB đã migrate, và mọi lần bấm nút sau đó tiếp tục báo `invalid_compose`.
