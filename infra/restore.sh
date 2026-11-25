#!/usr/bin/env bash
# Khôi phục toàn bộ (DB + file) từ đích backup vào môi trường RỖNG (máy khác / stack thử). Không chạy trên prod
# đang phục vụ: pg_restore --clean xoá dữ liệu hiện có của DB đích.
#   infra/restore.sh [mtl-<stamp>.dump|latest]
# Biến: RESTORE_DATABASE_URL (DB đích, đã tạo rỗng), RESTORE_FILES_DIR (thư mục file đích = FILES_DIR của app chạy sau
#       restore), BACKUP_S3_* + BACKUP_BUCKET (nguồn backup).
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
need RESTORE_DATABASE_URL RESTORE_FILES_DIR BACKUP_S3_ENDPOINT BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY BACKUP_BUCKET
mc_alias offsite "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY"
SRC="offsite/$BACKUP_BUCKET"
name=${1:-latest}
if [ "$name" = latest ]; then
  name=$($MC ls "$SRC/pg/" | awk '{print $NF}' | grep -E '^mtl-.*\.dump$' | sort | tail -1)
  [ -n "$name" ] || die "không có dump nào ở $SRC/pg/"
fi
work=$(mktemp -d "${BACKUP_TMPDIR:-${TMPDIR:-/tmp}}/mtl-restore.XXXXXX")
trap 'rm -rf "$work"' EXIT

log "tải $name"
$MC cp --quiet "$SRC/pg/$name" "$SRC/pg/$name.sha256" "$work/"
(cd "$work" && sha256 -c "$name.sha256") || die "sha256 dump không khớp"

log "pg_restore → DB đích"
$PG_RESTORE --no-owner --no-privileges --clean --if-exists --exit-on-error -d "$RESTORE_DATABASE_URL" <"$work/$name"

log "file → $RESTORE_FILES_DIR"
mkdir -p "$RESTORE_FILES_DIR"
$MC mirror --quiet --overwrite "$SRC/objects/" "${RESTORE_FILES_DIR%/}/"

# Kiểm: mọi ảnh gốc page trong DB có file tương ứng (đủ để mở chương trong editor).
pages=$($PSQL -At "$RESTORE_DATABASE_URL" -c "select count(*) from pages")
missing=0
while IFS= read -r key; do
  [ -n "$key" ] || continue
  [ -f "${RESTORE_FILES_DIR%/}/$key" ] || {
    log "thiếu file: $key"
    missing=$((missing + 1))
  }
done < <($PSQL -At "$RESTORE_DATABASE_URL" -c "select original_key from pages where original_key is not null")
[ "$missing" -eq 0 ] || die "$missing ảnh page không có file sau restore"
log "restore xong: $name, $pages page, mọi ảnh gốc có file"
