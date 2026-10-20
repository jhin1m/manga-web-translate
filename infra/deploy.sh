#!/usr/bin/env bash
# Deploy từ commit sạch (git archive — không file lạ trong release) theo thư mục release + symlink `current`.
#   infra/deploy.sh <git-ref>     # build release mới, migrate, đổi symlink, restart, smoke; smoke hỏng → tự rollback
#   infra/deploy.sh rollback      # về release trước (≤ 2'): đổi symlink + restart + smoke, không build/migrate
# Bố cục: $MTL_ROOT/{repo (git clone), releases/<utc>-<sha12>, current -> releases/…, previous -> releases/…,
#         shared/.env (600)}
# Migration chỉ thêm (additive) → rollback app không cần down DB; down thủ công ở packages/db/migrations-down/.
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
  local ref=$1 sha rel started before before_prev
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
    notify "Deploy hỏng" "${rel##*/}: smoke test lỗi → rollback" urgent
    [ -n "$before" ] || die "deploy đầu tiên hỏng, không có bản để quay về"
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
  "" | -h | --help) sed -n '2,8p' "$0" && exit 2 ;;
  *) deploy "$1" ;;
esac
