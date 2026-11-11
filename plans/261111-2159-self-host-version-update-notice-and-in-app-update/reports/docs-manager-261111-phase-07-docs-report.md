# Báo cáo phase 7: docs

Status: DONE_WITH_CONCERNS. Phase file `status: completed`. Không sửa code, không commit.

## Đã sửa / tạo
- `docs/self-host.md` (320 dòng): mục Cập nhật viết lại (xem phiên bản, thông báo bản mới, Cập nhật ngay, bảo mật,
  tắt nút, cập nhật tay bash + PowerShell `curl.exe`, lần đầu từ 0.2.0, ghim `MTL_TAG`); bảng biến thêm `MTL_UPDATE_CHECK`,
  `MTL_UPDATER`, `MTL_DOCKER_SOCK`, `MTL_VERSION`; Yêu cầu (rootless, ECI); Gỡ cài thêm `docker rm -f mtl-local-update`;
  Sự cố thêm 3 mục; Người phát hành viết lại (có `MTL_UPDATE_TARGET`, `docs/releases/vX.Y.Z.md`, bảng khôi phục biến).
- `README.md`: dòng Cập nhật.
- `docs/releases/v0.3.0.md` (mới, dòng đầu `# v0.3.0 — …`): Có gì mới, Cách cập nhật (PowerShell + bash), Kỹ thuật.
- `docs/project-roadmap.md`: mục chưa kiểm (Windows, Linux, `latest`) + giới hạn đã biết (rootless, ECI, 0.2.0 làm tay).

## Đã đối chiếu với code
- Biến: `grep '\${MTL_'` docker-compose.yml khớp bảng. `MTL_VERSION` mặc định `dev` (env.ts, Dockerfile).
- Tên runner `mtl-local-update` (`name: mtl-local` trong compose). `docker-compose.yml.bak` (runner.ts:237).
- Copy UI: "Cập nhật ngay", "Cách cập nhật", "Xem thay đổi", `MTL v…` (app-shell.tsx, update-dialog.tsx). Nút chỉ cho admin local.
- Lệnh tay trùng `manualCommands()` (curl.exe trên Windows). URL compose đúng `composeUrl("main")`.
- Neo nội bộ (`#cập-nhật`, `#tắt-nút-cập-nhật`, `#cập-nhật-tay`, `#thông-báo-bản-mới`, backup) khớp tiêu đề.

## Phạm vi claim (không nói quá)
- Windows và Linux: ghi "chưa kiểm", có fallback `path_mismatch`. Giữ câu "Windows chưa kiểm" ở Yêu cầu.
- Lỗi trước/sau bước khởi động lại theo runner (`.bak` ghi ngay trước `up`).

## Concerns
- `infra/selfhost-update-smoke.sh` (phase 6) chưa có trong repo nên docs không nhắc; người phát hành thử rc→rc bằng
  `MTL_UPDATE_TARGET`. Thêm lại bước smoke khi phase 6 xong.
- Lệnh trong docs chưa được chạy thật trên Windows (chờ phase 8). Phase 4 mới kiểm tới bước download; phần pull/up/check
  với artifact thật chưa kiểm, nên mô tả luồng "Cập nhật ngay" dựa trên thiết kế + code, chưa có smoke end-to-end.
- Phase 8 cần cập nhật khối Windows/Linux trong self-host.md, v0.3.0.md, roadmap theo kết quả thật.
- Chưa chạy `validate-docs.cjs` (script không có trong repo).
