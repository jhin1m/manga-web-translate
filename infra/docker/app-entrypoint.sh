#!/bin/sh
# Entrypoint image app: chạy root chỉ để chuẩn bị quyền thư mục bind mount (Docker tạo ./data thuộc root trên Linux),
# rồi hạ quyền về uid 1000 (khớp worker — token.py kiểm file token cùng uid) và chạy:
#   app  → API (backup + migrate + bootstrap local trước khi listen)
#   jobs → runner nền
#   khác → chạy lệnh tuỳ ý (vd `sh`)
set -eu

if [ "$(id -u)" = "0" ]; then
  data="${MTL_DATA_DIR:-/data}"
  mkdir -p "$data/files" "$data/secrets" "$data/backups" "$data/worker"
  # Không chown đệ quy files/backups (có thể rất lớn) — chỉ thư mục gốc; secrets/worker nhỏ nên -R.
  chown 1000:1000 "$data" "$data/files" "$data/backups"
  chown -R 1000:1000 "$data/secrets" "$data/worker"
  chmod 700 "$data/secrets"
  export HOME=/home/node
  exec setpriv --reuid=1000 --regid=1000 --init-groups "$0" "$@"
fi

case "${1:-app}" in
  app) exec node_modules/.bin/tsx src/index.ts ;;
  jobs) exec node_modules/.bin/tsx src/jobs/runner.ts ;;
  *) exec "$@" ;;
esac
