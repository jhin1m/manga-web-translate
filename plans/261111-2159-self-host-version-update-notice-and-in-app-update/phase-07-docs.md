---
phase: 7
title: "Docs: phiên bản, cập nhật trong app, cách tắt, cập nhật tay, release notes v0.3.0"
status: completed
priority: P2
effort: "2h"
dependencies: [3, 4, 5]
---

# Phase 7: Docs

## Overview

Người dùng cuối dùng Windows và đọc `docs/self-host.md` cùng ghi chú Release trên GitHub. Docs phải nói đủ, theo thứ tự:
- xem phiên bản ở đâu;
- app tự kiểm tra bản mới thế nào và cách tắt;
- nút Cập nhật ngay làm gì, rủi ro, cách tắt;
- cập nhật tay (bash và PowerShell);
- lần đầu đi từ 0.2.0 lên;
- người phát hành làm gì.

## Context (đã đọc)

- `docs/self-host.md:58-74` mục "Cập nhật" (lệnh tay, thứ tự stop → backup → migrate, ghim `MTL_TAG`). `:76-94` bảng
  biến. `:171-176` Gỡ cài. `:178-199` Sự cố. `:201-210` Dành cho người phát hành.
- `docs/self-host.md:21`: "Windows chưa kiểm". Sau phase 8 sửa thành kết quả thật.
- `README.md:18-19`: dòng cập nhật tay.
- Mẫu ghi chú Release của `v0.2.0` (lấy bằng `gh release view v0.2.0`): mục "Có gì mới", "Cách cập nhật" (PowerShell
  với `curl.exe`, từng dòng; bash), "Kỹ thuật". Release tự động (phase 2) đọc `docs/releases/v<ver>.md`, dòng đầu
  `# ` là tiêu đề.
- **Không sửa** `docs/editor.md` và `docs/design-guidelines.md` (plan khác chưa commit). Việc thêm một dòng về menu tài
  khoản vào design guidelines ghi ở "Câu hỏi chưa giải quyết" của `plan.md`.

## Files

| Thao tác | File |
|---|---|
| Sửa | `docs/self-host.md` |
| Sửa | `README.md` (l.18-19) |
| Tạo | `docs/releases/v0.3.0.md` |
| Sửa | `docs/project-roadmap.md` (thêm mục đã làm và giới hạn đã biết) |

## Nội dung

1. **`self-host.md` › "Cập nhật"**, viết lại theo thứ tự sau:
   - **Xem phiên bản**: bấm avatar (góc phải trên), dòng cuối là `MTL v0.3.0`.
   - **Thông báo bản mới**: app hỏi GitHub tối đa 1 lần/ngày, chỉ khi mở web, từ máy chủ chứ không từ trình duyệt.
     Request chỉ gồm IP máy bạn và User-Agent `mtl-selfhost`. Có bản mới thì avatar có chấm nhỏ, menu có "Xem thay đổi".
     Tắt bằng `MTL_UPDATE_CHECK=0`.
   - **Cập nhật ngay** (bản 0.3.0 trở đi): các bước app làm (tải bản mới trong lúc vẫn chạy, rồi dừng worker, backup,
     migrate, chạy lại). Mất vài phút. Không hạ cấp được. Log ở `docker logs mtl-local-update`. Nút chỉ hiện khi
     không ghim `MTL_TAG`, dùng đúng một file `docker-compose.yml` và updater đang chạy.
   - **Bảo mật**:
     - Service `updater` giữ Docker socket, nghĩa là có quyền tương đương root/admin trên máy (Docker Desktop: trên
       VM và các thư mục chia sẻ).
     - Updater không mở cổng, chỉ nói chuyện với `app` qua mạng nội bộ, có token ở `data/secrets/updater-token`.
     - Updater chỉ làm đúng một việc: cập nhật lên bản phát hành chính thức mới hơn, bằng image
       `ghcr.io/jhin1m/mtl*` và file compose của đúng tag đó.
     - Không muốn thì tắt.
   - **Tắt nút cập nhật**: ghi `MTL_UPDATER=0` vào `.env`, rồi `docker compose up -d`. Lệnh tạo `.env`:
     - Windows: `notepad .env`, thêm dòng, lưu.
     - Linux/macOS: `echo MTL_UPDATER=0 >> .env`.
     Tắt rồi thì menu hiện lệnh cập nhật tay.
   - **Cập nhật tay**: giữ lệnh bash cũ, thêm khối PowerShell dùng `curl.exe`, mỗi dòng một lệnh.
   - **Lần đầu từ 0.2.0 trở xuống**: bản cũ chưa có updater, nên cập nhật tay **một lần**:
     ```powershell
     cd "C:\đường-dẫn\tới\thư-mục-mtl"
     curl.exe -fsSLO https://raw.githubusercontent.com/jhin1m/manga-web-translate/main/docker-compose.yml
     docker compose pull
     docker compose up -d
     docker compose ps
     ```
     `docker compose ps` phải thấy service `updater` đang chạy. Từ đó về sau dùng nút trong app.
   - Giữ đoạn ghim `MTL_TAG` và thêm một câu: đang ghim thì app không hiện nút, chỉ hiện lệnh.
2. **Bảng biến**: thêm các dòng sau.
   - `MTL_UPDATE_CHECK` (mặc định `1`).
   - `MTL_UPDATER` (mặc định `1`, `0` = không chạy updater, không mount socket).
   - `MTL_DOCKER_SOCK` (mặc định `/var/run/docker.sock`, dùng cho Docker rootless).
   Bảng "biến trong image" thêm `MTL_VERSION`. Mục người phát hành thêm `MTL_UPDATE_TARGET`.
3. **Yêu cầu**: Linux rootless (không có `/var/run/docker.sock`) phải đặt `MTL_DOCKER_SOCK=$XDG_RUNTIME_DIR/docker.sock`
   hoặc `MTL_UPDATER=0`. Không đặt thì `docker compose up -d` báo lỗi mount. Docker Desktop bật Enhanced Container
   Isolation thì updater bị chặn, phải cập nhật tay.
4. **Gỡ cài**: thêm `docker rm -f mtl-local-update` (container runner nằm ngoài project compose nên `down` không xoá).
5. **Sự cố**: thêm 3 mục.
   - "Cập nhật trong app báo lỗi": xem `docker logs mtl-local-update`. Lỗi trước bước khởi động lại (tải, kiểm) thì
     app vẫn chạy bản cũ và `docker-compose.yml` chưa bị đổi. Lỗi sau bước đó thì `docker-compose.yml` đã là bản mới
     (bản cũ ở `docker-compose.yml.bak`). Khi đó chạy `docker compose up -d`, xem `docker compose logs app`, và đọc mục
     Backup DB.
   - "Menu báo không cập nhật được trong app": nguyên nhân theo bảng lý do của phase 5.
   - "Sau khi cập nhật trong app, chạy `docker compose up -d` thấy tạo lại container": bình thường, dữ liệu không đổi.
6. **Người phát hành**, thay mục cũ:
   1. Viết `docs/releases/vX.Y.Z.md` (dòng đầu `# vX.Y.Z — tiêu đề`) **trước khi** tag chính thức. Thiếu file thì
      Release dùng ghi chú tự sinh.
   2. Push `vX.Y.Z-rc.N`. Prerelease không tạo Release và không gắn `latest`.
   3. Smoke trên macOS: `infra/selfhost-smoke.sh` với image rc, rồi `FROM=<bản trước> TO=<rc> infra/selfhost-update-smoke.sh`.
   4. Checklist Windows (`plans/261111-2159-…/phase-08-…md` §Windows) chạy trên rc, bắt buộc khi đổi updater, compose
      hoặc entrypoint.
   5. Push tag chính thức. Workflow lần lượt test → image → promote (`latest`) → tạo Release (chỉ sau promote nên
      người dùng thấy thông báo khi `:latest` đã sẵn sàng).
   6. Compose thêm biến mới thì phải thêm vào bảng khôi phục của updater. Test `updater-compose-vars` sẽ đỏ nếu quên.
   Giữ quy tắc cũ: compose trên `main` phải chạy được với image cũ, biến mới chỉ là tuỳ chọn.
7. **`docs/releases/v0.3.0.md`**: theo mẫu ghi chú 0.2.0.
   - Có gì mới: nhãn phiên bản, thông báo bản mới, nút Cập nhật ngay, cách tắt.
   - Cách cập nhật: lần này phải làm tay, gồm khối PowerShell ở mục 1 và khối bash.
   - Kỹ thuật: service `updater` mới (socket Docker), image app có thêm `docker-compose`, biến mới đều tuỳ chọn.
8. **`README.md`** l.18-19: "Cập nhật: từ 0.3.0 bấm Cập nhật ngay trong menu tài khoản, hoặc làm tay (xem self-host.md)".
9. **`project-roadmap.md`**: thêm mục đã làm và giới hạn đã biết: Linux chưa kiểm cập nhật trong app (nếu đúng), rootless
   phải đặt biến, ECI chặn.

## Done

- Mọi lệnh trong docs đã chạy thật ít nhất một lần, ở smoke phase 6 hoặc checklist phase 8. Lệnh PowerShell lấy từ
  checklist Windows.
- Link nội bộ (`#cập-nhật`, ...) đúng. Bảng biến khớp `docker-compose.yml` (đối chiếu bằng grep `\${MTL_`).
- Không còn câu "Windows chưa kiểm" nếu checklist đạt. Nếu chưa đạt thì ghi đúng phạm vi đã kiểm.

> Ghi chú 11/11: docs đã viết. Việc chạy thật từng lệnh và sửa phần Windows theo kết quả checklist → phase 8.

## Risks

| Rủi ro | K×T | Giảm thiểu |
|---|---|---|
| Docs nói quá khả năng thật trên Windows | TB×Cao | Viết phần Windows sau phase 8, chỉ ghi điều đã kiểm |
| PowerShell tạo `.env` sai mã hoá (UTF-16) | TB×TB | Hướng dẫn dùng Notepad, không dùng `>` hay `Out-File` |

## Rollback

Revert file docs. `docs/releases/v0.3.0.md` chỉ được đọc lúc tag.
