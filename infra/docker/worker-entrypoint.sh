#!/bin/sh
# Entrypoint image worker: root chỉ để chuẩn bị quyền /data/models (bind mount có thể thuộc root trên Linux), rồi hạ
# về uid 1000 — cùng uid với app ghi /data/worker/token (token.py từ chối file khác chủ / quyền rộng hơn 600).
# Tải model theo models.lock.json (bỏ qua file đúng sha256); lỗi → thoát ≠ 0 để compose restart thử lại.
set -eu

if [ "$(id -u)" = "0" ]; then
  models="${MTL_MODELS_DIR:-/data/models}"
  mkdir -p "$models"
  chown -R 1000:1000 "$models"
  export HOME=/home/mtl
  exec setpriv --reuid=1000 --regid=1000 --init-groups "$0" "$@"
fi

python scripts/fetch_models.py
exec mtl-worker "$@"
