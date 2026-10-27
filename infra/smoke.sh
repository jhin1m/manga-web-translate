#!/usr/bin/env bash
# Smoke test sau deploy: healthz 200 (chờ tối đa SMOKE_WAIT_S) + đăng ký công khai bị chặn (production giữ
# SIGNUP_ENABLED=false tới khi có xác thực email + hạn mức dung lượng).
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
# 400 phải đến từ cờ tắt đăng ký (không phải sai Origin / sai body) → kiểm cả mã lỗi.
[ "$code" = 400 ] && grep -q EMAIL_PASSWORD_SIGN_UP_DISABLED <<<"${out%$'\n'*}" ||
  die "đăng ký công khai trả HTTP $code (cần 400 EMAIL_PASSWORD_SIGN_UP_DISABLED — SIGNUP_ENABLED phải false): ${out%$'\n'*}"
log "đăng ký công khai bị chặn → 400"
