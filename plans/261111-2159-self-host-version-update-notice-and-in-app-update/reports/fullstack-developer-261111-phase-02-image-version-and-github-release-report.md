# Báo cáo phase 2: image có phiên bản + GitHub Release tự động

## Đã ghim
- Docker CLI image: `docker:29.9.3-cli@sha256:2357639ad1ea7d0194134bf3292622fd4e562483966ed674e5d7c945b5f3b28d`
  (digest index multi-arch, có amd64 + arm64/v8; trùng digest của `docker:cli` và `29.9-cli` lúc ghim).
- Compose trong image: v5.7.0 (khác v5.1.2 trong research; vẫn trong dòng v5.x có đủ tính năng cần dùng).
- Đường dẫn plugin nguồn: `/usr/local/libexec/docker/cli-plugins/docker-compose` (kiểm thật trong image).
- Binary trong image `mtl`: `/usr/local/bin/docker-compose`.

## Đã sửa
- `infra/docker/app.Dockerfile`: COPY compose, `docker-compose version` trong `RUN test`, `ARG/ENV MTL_VERSION` (mặc định `dev`) ở cuối stage.
- `.github/workflows/release.yml`: `build_args` trong matrix + `build-args`; job `promote` có `id: tags` và output `latest`;
  job `test` cảnh báo thiếu `docs/releases/vX.Y.Z.md` (step đặt sau checkout, vì trước đó chưa có file); job mới `github-release`.

## Đã kiểm local (macOS arm64, Docker 29.4.0)
- `docker build --build-arg MTL_VERSION=0.0.0-test` thành công; chạy: `MTL_VERSION=0.0.0-test`, `docker-compose version` -> v5.7.0.
- Build không arg -> `dev`.
- `actionlint` sạch. Tách tiêu đề `# ...` bằng bash đã thử.
- Đã xoá image test `mtl:vt`, `mtl:vt2`.

## Chưa kiểm
- Chạy compose trên amd64 (chỉ có arm64 local; digest index có amd64).
- Nhãn OCI trên image build local rỗng (do metadata-action chỉ có trên CI) nên chưa đối chiếu label.
- Hành vi `github-release` trên Actions thật (rc không có Release, tag chính thức "Latest", re-run) -> phase 8.
- Quyền: chỉ job `github-release` có `contents: write` (đọc lại diff).

## Ghi chú
- `docs/releases/` chưa tồn tại (phase 7 tạo v0.3.0.md); không có file thì job dùng `--generate-notes`.
