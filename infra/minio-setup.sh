#!/usr/bin/env bash
# Cấu hình bucket ứng dụng (chạy lại nhiều lần an toàn): tạo bucket, chặn truy cập ẩn danh (private-by-default,
# không link chia sẻ công khai), rule lifecycle xoá file export (tag mtl-kind=export) sau 7 ngày.
# Dùng bởi deploy.sh và restore.sh. Biến: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
need S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET
mc_alias app "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
$MC mb --ignore-existing "app/$S3_BUCKET"
$MC anonymous set none "app/$S3_BUCKET"
# import = thay toàn bộ cấu hình lifecycle → luôn đúng 1 bộ rule như file.
$MC ilm import "app/$S3_BUCKET" <minio/lifecycle.json
log "bucket $S3_BUCKET: private, export hết hạn sau 7 ngày"
