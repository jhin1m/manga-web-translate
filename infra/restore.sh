#!/usr/bin/env bash
# Khôi phục toàn bộ (DB + object) từ đích backup vào môi trường RỖNG (máy khác / stack thử). Không chạy trên prod
# đang phục vụ: pg_restore --clean xoá dữ liệu hiện có của DB đích.
#   infra/restore.sh [mtl-<stamp>.dump|latest]
# Biến: RESTORE_DATABASE_URL (DB đích, đã tạo rỗng), S3_* (MinIO đích), BACKUP_S3_* + BACKUP_BUCKET (nguồn backup).
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
need RESTORE_DATABASE_URL S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET BACKUP_S3_ENDPOINT BACKUP_S3_ACCESS_KEY \
  BACKUP_S3_SECRET_KEY BACKUP_BUCKET
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

log "object → bucket đích $S3_BUCKET"
./minio-setup.sh
mc_alias dst "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
$MC mirror --quiet --overwrite "$SRC/objects/" "dst/$S3_BUCKET"

# Kiểm: mọi ảnh gốc page trong DB có object tương ứng (đủ để mở chương trong editor).
pages=$($PSQL -At "$RESTORE_DATABASE_URL" -c "select count(*) from pages")
missing=0
while IFS= read -r key; do
  [ -n "$key" ] || continue
  $MC stat --quiet "dst/$S3_BUCKET/$key" >/dev/null 2>&1 || {
    log "thiếu object: $key"
    missing=$((missing + 1))
  }
done < <($PSQL -At "$RESTORE_DATABASE_URL" -c "select original_key from pages where original_key is not null")
[ "$missing" -eq 0 ] || die "$missing ảnh page không có object sau restore"
log "restore xong: $name, $pages page, mọi ảnh gốc có object"
