#!/usr/bin/env bash
# Backup hằng đêm (systemd mtl-backup.timer): pg_dump (custom format) + mc mirror bucket MinIO → bucket đích ở
# nhà cung cấp khác (BACKUP_S3_*). Giữ 14 ngày nhờ lifecycle của bucket đích (versioning + offsite-lifecycle.json):
# dump pg/ hết hạn sau 14 ngày; object bị xoá/ghi đè ở nguồn còn bản cũ 14 ngày.
#   infra/backup.sh init   # 1 lần: tạo bucket đích, bật versioning, áp lifecycle
#   infra/backup.sh        # backup
# Biến: DATABASE_URL (hoặc BACKUP_DATABASE_URL), S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET,
#       BACKUP_S3_ENDPOINT/BACKUP_S3_ACCESS_KEY/BACKUP_S3_SECRET_KEY/BACKUP_BUCKET, ALERT_NTFY_URL (tuỳ chọn).
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
need S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET BACKUP_S3_ENDPOINT BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY \
  BACKUP_BUCKET
PG_URL=${BACKUP_DATABASE_URL:-${DATABASE_URL:-}}
mc_alias src "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
mc_alias offsite "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY"
DEST="offsite/$BACKUP_BUCKET"

if [ "${1:-}" = "init" ]; then
  $MC mb --ignore-existing "$DEST"
  $MC version enable "$DEST"
  $MC ilm import "$DEST" <minio/offsite-lifecycle.json
  log "đích $DEST: versioning bật, giữ 14 ngày"
  exit 0
fi
[ -n "$PG_URL" ] || die "thiếu DATABASE_URL"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d "${BACKUP_TMPDIR:-${TMPDIR:-/tmp}}/mtl-backup.XXXXXX")
# Mọi đường thoát lỗi (lệnh hỏng lẫn die) → cảnh báo; luôn dọn thư mục tạm.
on_exit() {
  local rc=$?
  rm -rf "$work"
  [ "$rc" -eq 0 ] || notify "Backup thất bại" "infra/backup.sh thoát mã $rc — kiểm journalctl -u mtl-backup" urgent
}
trap on_exit EXIT
dump="$work/mtl-$stamp.dump"

log "pg_dump → $dump"
$PG_DUMP --format=custom --no-owner --no-privileges "$PG_URL" >"$dump"
[ -s "$dump" ] || die "dump rỗng"
(cd "$work" && sha256 "${dump##*/}" >"${dump##*/}.sha256")
$MC cp --quiet "$dump" "$dump.sha256" "$DEST/pg/"

log "mirror $S3_BUCKET → $DEST/objects/"
# --remove: đích phản chiếu đúng nguồn; bản bị xoá còn giữ ở version cũ 14 ngày (lifecycle đích).
$MC mirror --quiet --overwrite --remove "src/$S3_BUCKET" "$DEST/objects/"

bytes=$(wc -c <"$dump" | tr -d ' ')
log "xong: pg/mtl-$stamp.dump ($bytes byte) + objects"
