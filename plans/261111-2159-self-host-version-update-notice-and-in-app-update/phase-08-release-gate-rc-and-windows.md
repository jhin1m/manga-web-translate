---
phase: 8
title: "Cổng phát hành: rc trên GHCR, smoke macOS, checklist Windows thật, tag v0.3.0"
status: pending
priority: P1
effort: "3h máy + thời gian người dùng trên Windows"
dependencies: [1, 2, 3, 4, 5, 6, 7]
---

# Phase 8: Cổng phát hành

## Overview

Tính năng này chỉ được tag chính thức khi đủ 3 điều kiện:
1. Smoke macOS (phase 6) đạt.
2. Đường bootstrap tay 0.2.0 → rc đạt.
3. Người dùng chạy **checklist Windows** trên máy thật và đạt.

Người lập plan không có máy Windows. Mọi điểm ghi "phải kiểm trên Windows" ở phase 4 được gom vào checklist dưới.

## Files

| Thao tác | File |
|---|---|
| Tạo | `plans/261111-2159-…/reports/*` (báo cáo smoke, checklist Windows, ảnh menu) |
| Tạo | `apps/api/test/unit/fixtures/docker-inspect-windows-*.json` (fixture **thật** từ máy Windows, đã che tên user, thay fixture viết tay của phase 4) |
| Tạo | `docs/journals/2611xx-self-host-in-app-update.md` (sau khi tag) |

## Các bước

1. Gate code: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @mtl/web e2e` (trừ `block-panel.spec.ts:317`
   đã đỏ sẵn), `cd worker && uv run pytest -q`.
2. Tag `v0.3.0-rc.1`, sau đó tag `v0.3.0-rc.2` (cùng commit cũng được, image chỉ khác `MTL_VERSION`). Kiểm cả hai image
   có label `org.opencontainers.image.version` đúng, `docker run --rm ghcr.io/jhin1m/mtl:0.3.0-rc.1 docker-compose version`
   chạy được, có manifest amd64 và arm64. Prerelease **không** có GitHub Release.
3. Smoke macOS:
   - `infra/selfhost-smoke.sh` với image rc.2 (cách gắn tag `:smoke` như báo cáo 0.2.0).
   - `FROM=0.3.0-rc.1 TO=0.3.0-rc.2 infra/selfhost-update-smoke.sh`.
4. Bootstrap tay trên macOS: cài 0.2.0 (`latest`), seed, rồi tải compose của `v0.3.0-rc.1`,
   `MTL_TAG=0.3.0-rc.1 docker compose pull`, `up -d`. Kiểm dữ liệu còn, `updater` running, menu hiện `v0.3.0-rc.1`.
5. **Checklist Windows** (dưới), người dùng chạy trên rc. Ghi kết quả vào báo cáo kèm `docker inspect` (che tên user).
6. Viết `docs/releases/v0.3.0.md` (phase 7), merge `main` (compose mới), tag `v0.3.0`. Workflow phải tạo Release
   "Latest", tiêu đề lấy từ file.
7. Sau phát hành:
   - `curl -s https://api.github.com/repos/jhin1m/manga-web-translate/releases/latest` có `tag_name` = `v0.3.0`.
   - Kiểm D7 trên máy macOS đang chạy rc.2 (ghim `MTL_TAG=0.3.0-rc.2`):
     1. gỡ `MTL_UPDATE_TARGET`;
     2. `up -d`;
     3. kết quả mong đợi: menu báo có bản `v0.3.0` nhưng **không có chấm**, nút là "Cách cập nhật" kèm dòng bỏ `MTL_TAG`.
   - Một bản cài sạch 0.3.0 (`latest`) không có chấm, menu chỉ có `MTL v0.3.0`.
   - Đường `latest` chỉ được kiểm thật ở bản kế tiếp (0.3.1/0.4.0). Ghi rõ trong journal và chạy smoke với `TO` chính
     thức ngay sau khi phát hành bản đó.
8. Viết journal. Cập nhật `docs/self-host.md:21` ("Windows chưa kiểm") theo kết quả.

## Checklist Windows (người dùng chạy, Docker Desktop backend WSL2 mặc định)

Chuẩn bị: Windows 10/11, Docker Desktop bản mới, RAM cho Docker ≥ 10 GB (hoặc đặt `MTL_WORKERS=1` trong `.env`).
Dùng PowerShell, gõ **từng dòng**. Ghi phiên bản Docker Desktop (`docker version`) vào báo cáo.

**A. Cài bản cũ và tạo dữ liệu** (thư mục thường, vd `C:\Users\<bạn>\mtl`)
```powershell
mkdir C:\Users\<bạn>\mtl
cd C:\Users\<bạn>\mtl
curl.exe -fsSLO https://raw.githubusercontent.com/jhin1m/manga-web-translate/v0.2.0/docker-compose.yml
docker compose up -d
```
Mở <http://localhost:8080>, thêm provider, tạo series, tải 1 chương, bấm Dịch chương (ít nhất "Chỉ xoá chữ + OCR").
Ghi lại tên series và số trang.

**B. Bootstrap tay lên rc.1** (đây cũng là đường người dùng 0.2.0 sẽ đi)
```powershell
curl.exe -fsSLO https://raw.githubusercontent.com/jhin1m/manga-web-translate/v0.3.0-rc.1/docker-compose.yml
$env:MTL_TAG = "0.3.0-rc.1"
$env:MTL_UPDATE_TARGET = "0.3.0-rc.2"
docker compose pull
docker compose up -d
docker compose ps
```
- [ ] B1. `docker compose ps` có `updater` running. App healthy.
- [ ] B2. Web: series, chương, ảnh còn nguyên. Menu avatar hiện `MTL v0.3.0-rc.1`, có chấm (đang ghim rc nhưng đích là rc
      nên vẫn hiện, D7) và có "Có bản mới v0.3.0-rc.2" kèm nút **Cập nhật ngay**.
- [ ] B3. Lưu kết quả 2 lệnh sau vào báo cáo (che tên user):
  `docker inspect mtl-local-app-1 --format "{{json .Mounts}}"` và
  `docker inspect mtl-local-app-1 --format "{{json .Config.Labels}}"`.
  Đường dẫn `Source` dạng `/run/desktop/mnt/host/c/...` hay dạng khác?

**C. Cập nhật trong app lên rc.2**
- [ ] C0. Tắt mạng (Wi-Fi/dây), bấm **Cập nhật ngay** → **Cập nhật**. Kết quả mong đợi:
      - hộp báo "Không tải được bản mới";
      - app vẫn chạy rc.1;
      - `docker-compose.yml` không đổi (ngày sửa file giữ nguyên);
      - không có `docker-compose.yml.bak`.
      Bật mạng lại, đợi 60 giây (cooldown) rồi làm C1.
- [ ] C1. Bấm avatar → **Cập nhật ngay** → **Cập nhật**. Hộp hiện "Đang tải bản mới", rồi "Đang khởi động lại". Trang
      tự tải lại, menu hiện `MTL v0.3.0-rc.2`. Ghi thời gian từ lúc bấm tới lúc tải lại.
- [ ] C2. Dữ liệu ở A vẫn còn: mở chương, ảnh gốc và ảnh đã xử lý hiện đúng. **Đây là điểm quan trọng nhất**: lỗi đường
      dẫn sẽ làm app chạy với DB trống.
- [ ] C3. `docker logs mtl-local-update` kết thúc bằng `MTL_UPDATE result=ok`. Lưu toàn bộ log vào báo cáo.
- [ ] C4. Chạy lại lệnh `docker inspect` ở B3: `Source` của mọi mount **giống hệt** trước khi cập nhật.
- [ ] C5. Thư mục `C:\Users\<bạn>\mtl` có `docker-compose.yml` mới, có `docker-compose.yml.bak`, **không** có thư mục lạ
      (vd `run\desktop\...` hoặc `data` thứ hai lồng bên trong).
- [ ] C6. `docker compose logs app` có dòng `backup …` rồi `migrate xong`. `dir data\backups` có thêm 1 file.

**D. PowerShell vẫn quản lý được project sau khi updater đã chạy compose**
Mở **cửa sổ PowerShell mới** (không còn biến của bước B):
```powershell
cd C:\Users\<bạn>\mtl
$env:MTL_TAG = "0.3.0-rc.2"
docker compose ps
docker compose logs --tail 20 app
docker compose up -d
```
- [ ] D1. `ps` thấy đủ service, không báo lỗi. `up -d` chạy xong (có thể tạo lại container), web vẫn đủ dữ liệu.

**E. Đường dẫn có dấu cách và tiếng Việt** (rủi ro cao nhất với tên user Việt)
Dừng project cũ (`docker compose down` trong thư mục A). Làm lại A → C trong `C:\Users\<bạn>\Tài liệu\mtl thử`.
- [ ] E1. Đạt C1–C5.
- [ ] E2. (Nếu có ổ D:) làm lại trong `D:\mtl`, đạt C1–C5.

**F. Tắt và trường hợp lỗi**
- [ ] F1. `notepad .env`, thêm dòng `MTL_UPDATER=0`, lưu. Chạy `docker compose up -d`. Không còn container updater, menu
      có "Cách cập nhật" với lệnh `curl.exe`. Xoá dòng này rồi `up -d` để bật lại.
- [ ] F2. (Làm trong lượt E) Đóng tab ngay sau khi bấm Cập nhật, mở lại sau 10 giây. Hộp "Đang cập nhật" tự hiện lại,
      hoặc trang đã ở bản mới.

**G. Dọn**: `docker compose down`, `docker rm -f mtl-local-update`, xoá thư mục thử. Gỡ `$env:MTL_*` (đóng PowerShell).

Kết quả:
- Mọi ô C, D, E1 phải đạt thì mới được tag chính thức.
- F2, E2 không đạt: ghi giới hạn đã biết, rồi người dùng quyết có phát hành hay không.
- C hoặc E1 đỏ do đường dẫn (log runner hoặc status có `path_mismatch`): gửi lại `docker inspect` của B3, sửa
  `discovery.ts` theo dạng thật, ra rc.3 rồi chạy lại.
- Vẫn không qua: xem Câu hỏi 1 ở `plan.md`.

Mỗi lượt thử cần một cặp bản "đang chạy → đích" mới. Sau C, máy đang ở rc.2. Để làm lại C hoặc E thì quay về A với
thư mục mới. Không chạy lại C trên cùng project, vì rc.2 không còn bản mới hơn.

## Done

- Báo cáo smoke macOS, bootstrap, checklist Windows có trong `reports/`.
- Release `v0.3.0` tồn tại, là "Latest", có ghi chú từ file.
- Fixture inspect Windows thật đã thay fixture viết tay. Unit test phase 4 xanh với fixture thật.

## Risks

| Rủi ro | K×T | Giảm thiểu |
|---|---|---|
| Windows trả `Source` dạng khác dự đoán | TB×Cao | Updater dừng ở bước kiểm trước khi đổi gì (`path_mismatch`). Sửa theo fixture thật rồi ra rc.3 |
| Windows không mount được đường dẫn daemon vào runner | TB×Cao | Như trên. Nếu không có cách nào thì phát hành với updater mặc định **tắt** trên Windows. Hỏi người dùng (plan.md, Câu hỏi 1) |
| Không có máy Linux để kiểm | Cao×TB | Ghi giới hạn đã biết. Đường Linux giống macOS/OrbStack (đường dẫn host = đường dẫn daemon) |

## Rollback

Lỗi nặng sau khi đã tag: phát hành `v0.3.1` có `deploy.replicas` của updater mặc định `0`. Người dùng nào chưa bấm thì
không bị ảnh hưởng, vì app không bao giờ tự cập nhật.
