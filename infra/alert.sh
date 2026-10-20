#!/usr/bin/env bash
# Kiểm mỗi phút (mtl-alert.timer), 1 kênh ntfy (ALERT_NTFY_URL):
#   - /healthz lỗi 2 lần liên tiếp (DB, MinIO hoặc runner mtl-jobs ngừng) → báo; hồi phục → báo hồi phục;
#   - oldest_queued_age_s > 15' → báo (lặp lại tối đa 1 lần/giờ khi còn).
# Ngân sách ≥ 50/80/100% do mtl-jobs báo (cùng kênh). Trạng thái giữa các lần chạy ở ALERT_STATE_DIR.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
HEALTHZ_URL=${HEALTHZ_URL:-http://127.0.0.1:${API_PORT:-8787}/healthz}
STATE=${ALERT_STATE_DIR:-/var/lib/mtl-alert}
QUEUE_AGE_MAX_S=${QUEUE_AGE_MAX_S:-900}
REALERT_S=${REALERT_S:-3600}
mkdir -p "$STATE"
now=$(date +%s)

# Đã báo điều kiện $1 trong REALERT_S giây gần nhất? Chưa → ghi mốc, trả 0 (được báo).
due() {
  local f="$STATE/$1.last" last=0
  [ -f "$f" ] && last=$(cat "$f")
  [ $((now - last)) -ge "$REALERT_S" ] || return 1
  echo "$now" >"$f"
}

code=0
body=$($CURL -sS -m 10 -o - -w '\n%{http_code}' "$HEALTHZ_URL" 2>&1) || code=$?
status=${body##*$'\n'}
body=${body%$'\n'*}
fails=$(cat "$STATE/healthz.fails" 2>/dev/null || echo 0)
if [ "$code" -ne 0 ] || [ "$status" != 200 ]; then
  fails=$((fails + 1))
  echo "$fails" >"$STATE/healthz.fails"
  if [ "$fails" -ge 2 ] && due healthz; then
    notify "healthz lỗi" "$HEALTHZ_URL lỗi $fails lần liên tiếp (HTTP ${status:-?}): ${body:0:300}" urgent
  fi
else
  if [ "$fails" -ge 2 ]; then
    notify "healthz hồi phục" "$HEALTHZ_URL OK sau $fails lần lỗi" default
    rm -f "$STATE/healthz.last"
  fi
  echo 0 >"$STATE/healthz.fails"
fi

age=$(printf '%s' "$body" | grep -o '"oldest_queued_age_s":[0-9]*' | cut -d: -f2 || true)
if [ -n "$age" ] && [ "$age" -gt "$QUEUE_AGE_MAX_S" ] && due queue_age; then
  notify "Hàng đợi cũ" "job chờ lâu nhất $((age / 60)) phút (> $((QUEUE_AGE_MAX_S / 60))') — worker Mac/Modal có chạy không?" high
fi
