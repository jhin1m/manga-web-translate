#!/usr/bin/env bash
# Deploy từ commit sạch (git archive — không file lạ trong release) theo thư mục release + symlink `current`.
#   infra/deploy.sh <git-ref>     # build release mới, migrate, đổi symlink, restart, smoke; smoke hỏng → tự rollback
#                                 # (trừ khi release có migration mới: chỉ báo động + in file down cần chạy)
#   infra/deploy.sh rollback      # về release trước (≤ 2'): đổi symlink + restart + smoke, không build/migrate
# Bố cục: $MTL_ROOT/{repo (git clone), releases/<utc>-<sha12>, current -> releases/…, previous -> releases/…,
#         shared/.env (600)}
# Phần lớn migration chỉ thêm (additive) → rollback app không cần down DB; down thủ công ở
# packages/db/migrations-down/. Migration gỡ cột / bảng thì bản cũ chạy trên schema mới sẽ lỗi → xem
# docs/deployment-guide.md trước khi `rollback` qua release có migration mới.
set -euo pipefail
INFRA=$(cd "$(dirname "$0")" && pwd)
. "$INFRA/lib.sh"
MTL_ROOT=${MTL_ROOT:-/srv/mtl}
REPO=${MTL_REPO:-$MTL_ROOT/repo}
RELEASES=$MTL_ROOT/releases
KEEP=${KEEP_RELEASES:-5}
SYSTEMCTL=${SYSTEMCTL:-sudo systemctl}
SERVICES=(mtl-api mtl-jobs)

# Đổi symlink nguyên tử (rename đè): không có khoảnh khắc symlink không tồn tại.
swap_link() {
  ln -sfn "$1" "$2.next"
  mv -Tf "$2.next" "$2"
}

# current → $1; `previous` → bản đang chạy trước đó (đích của rollback), trừ khi $2 = keep-previous.
switch_to() {
  local old
  old=$(readlink -f "$MTL_ROOT/current" 2>/dev/null || true)
  swap_link "$1" "$MTL_ROOT/current"
  if [ "${2:-}" != keep-previous ] && [ -n "$old" ] && [ "$old" != "$(readlink -f "$1")" ]; then
    swap_link "$old" "$MTL_ROOT/previous"
  fi
  log "current → ${1##*/}"
}

restart() {
  $SYSTEMCTL restart "${SERVICES[@]}"
  # Caddyfile nằm trong release (symlink /etc/caddy/Caddyfile → current/infra/caddy/Caddyfile).
  $SYSTEMCTL reload caddy || log "caddy reload lỗi (bỏ qua nếu chưa cài)"
}

# Migration (tên file, bỏ .sql) có trong release $2 mà release $1 không có, mới nhất trước — tức các migration lần
# deploy này vừa áp (bản đang chạy luôn đã migrate đủ migration của nó).
migration_names() { find "$1/packages/db/migrations" -maxdepth 1 -name '*.sql' 2>/dev/null | sed 's#.*/##; s/\.sql$//' | sort; }
new_migrations() { comm -13 <(migration_names "$1") <(migration_names "$2") | sort -r; }

# Smoke hỏng sau khi đã áp migration mới: bản cũ có thể không chạy được trên schema mới (cột đã gỡ) mà smoke vẫn qua
# → không tự quay về; giữ release mới (chứa file down) và in các bước cho người vận hành.
refuse_auto_rollback() {
  local rel=$1 before=$2 added=$3 m down
  notify "Deploy hỏng" "${rel##*/}: smoke test lỗi, release có migration mới → KHÔNG tự rollback, cần xử lý tay" urgent
  log "Bản ${rel##*/} vẫn chạy. Muốn quay về ${before##*/}: (1) đọc ghi chú từng migration trong" \
    "docs/deployment-guide.md (vài migration ghi thứ tự khác); (2) chạy file down, mới nhất trước; (3) rồi mới" \
    "\`$0 rollback\`. Lệnh down (DATABASE_URL trong $MTL_ROOT/shared/.env):"
  while read -r m; do
    down="$rel/packages/db/migrations-down/$m.down.sql"
    if [ -f "$down" ]; then
      log "  psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f $down"
    else
      log "  ($m: không có file down)"
    fi
  done <<<"$added"
  die "deploy ${rel##*/} hỏng, chưa quay về ${before##*/} vì đã áp migration: $(paste -sd ' ' - <<<"$added")"
}

# Nạp .env (API_PORT, WEB_ORIGIN) để smoke gọi đúng cổng + Origin hợp lệ.
smoke() { (set -a && . "$MTL_ROOT/shared/.env" && set +a && "$MTL_ROOT/current/infra/smoke.sh"); }

rollback() {
  local prev
  prev=$(readlink -f "$MTL_ROOT/previous" 2>/dev/null || true)
  [ -n "$prev" ] && [ -d "$prev" ] || die "không có release trước để rollback"
  switch_to "$prev"
  restart
  smoke
  log "rollback xong: ${prev##*/}"
}

deploy() {
  local ref=$1 sha rel started before before_prev added
  started=$(date +%s)
  before=$(readlink -f "$MTL_ROOT/current" 2>/dev/null || true)
  before_prev=$(readlink -f "$MTL_ROOT/previous" 2>/dev/null || true)
  git -C "$REPO" fetch --quiet --prune origin
  sha=$(git -C "$REPO" rev-parse --verify "$ref^{commit}")
  rel="$RELEASES/$(date -u +%Y%m%d%H%M%S)-${sha:0:12}"
  mkdir -p "$rel"
  log "release ${rel##*/} từ $ref ($sha)"
  git -C "$REPO" archive "$sha" | tar -x -C "$rel"
  [ -f "$MTL_ROOT/shared/.env" ] || die "thiếu $MTL_ROOT/shared/.env"
  ln -s "$MTL_ROOT/shared/.env" "$rel/.env"
  (
    cd "$rel"
    pnpm install --frozen-lockfile --prod=false --reporter=silent
    pnpm --filter @mtl/web build
    pnpm db:migrate
  )
  # Nạp env (S3_*) cho cấu hình bucket — private + lifecycle export 7 ngày.
  (set -a && . "$MTL_ROOT/shared/.env" && set +a && "$rel/infra/minio-setup.sh")
  switch_to "$rel"
  restart
  if ! smoke; then
    [ -n "$before" ] || {
      notify "Deploy hỏng" "${rel##*/}: smoke test lỗi (deploy đầu tiên)" urgent
      die "deploy đầu tiên hỏng, không có bản để quay về"
    }
    added=$(new_migrations "$before" "$rel")
    [ -z "$added" ] || refuse_auto_rollback "$rel" "$before" "$added"
    notify "Deploy hỏng" "${rel##*/}: smoke test lỗi → rollback" urgent
    # Quay về bản vừa chạy, khôi phục `previous` như trước deploy; xoá release hỏng.
    switch_to "$before" keep-previous
    [ -z "$before_prev" ] || swap_link "$before_prev" "$MTL_ROOT/previous"
    restart
    smoke
    rm -rf "$rel"
    die "deploy ${rel##*/} hỏng, đã quay về ${before##*/}"
  fi
  # Dọn release cũ (giữ KEEP bản gần nhất, không xoá current).
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort | head -n "-$KEEP" |
    { grep -vxF -e "$(readlink -f "$MTL_ROOT/current")" -e "$(readlink -f "$MTL_ROOT/previous" || true)" || true; } |
    xargs -r rm -rf
  log "deploy xong ${rel##*/} trong $(($(date +%s) - started))s"
}

case "${1:-}" in
  rollback) rollback ;;
  "" | -h | --help) sed -n '2,10p' "$0" && exit 2 ;;
  *) deploy "$1" ;;
esac
