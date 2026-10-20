#!/usr/bin/env bash
# Smoke test sau deploy: healthz 200 (chờ tối đa SMOKE_WAIT_S) + đăng ký không lời mời bị từ chối (invite-only).
#   infra/smoke.sh [base-url]   # mặc định http://127.0.0.1:$API_PORT (gọi thẳng API, không qua Cloudflare)
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
BASE=${1:-http://127.0.0.1:${API_PORT:-8787}}
ORIGIN=${WEB_ORIGIN:-$BASE}
deadline=$(($(date +%s) + ${SMOKE_WAIT_S:-60}))
until [ "$($CURL -s -o /dev/null -w '%{http_code}' -m 5 "$BASE/healthz" || true)" = 200 ]; do
  [ "$(date +%s)" -lt "$deadline" ] || die "healthz không 200 sau ${SMOKE_WAIT_S:-60}s: $($CURL -s -m 5 "$BASE/healthz" || true)"
  sleep 2
done
log "healthz 200"
email="smoke-$(date +%s)-$RANDOM@invalid.example"
out=$($CURL -s -w '\n%{http_code}' -m 10 -X POST "$BASE/api/auth/sign-up/email" \
  -H "content-type: application/json" -H "origin: $ORIGIN" \
  -d "{\"email\":\"$email\",\"password\":\"smoke-test-password-1\",\"name\":\"smoke\"}")
code=${out##*$'\n'}
# 403 phải đến từ cổng lời mời (không phải sai Origin) → kiểm cả thông điệp.
[ "$code" = 403 ] && grep -qi invitation <<<"${out%$'\n'*}" ||
  die "đăng ký không lời mời trả HTTP $code (cần 403 do thiếu lời mời): ${out%$'\n'*}"
log "đăng ký không lời mời → 403"
