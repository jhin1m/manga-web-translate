#!/usr/bin/env bash
# Smoke test sau deploy: healthz 200 (chờ tối đa SMOKE_WAIT_S) + đăng ký công khai đúng với trạng thái /healthz.signup
# (admin bật/tắt trên UI nên không giả định "luôn tắt"). Không tạo user: mật khẩu cố ý quá ngắn.
# Giới hạn tốc độ đăng ký của API: 5 lần/giờ cho mỗi IP (không IP = chung 1 bucket) → chạy tay quá 5 lần/giờ sẽ nhận 429.
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
# Trạng thái đăng ký hiệu lực lấy từ /healthz (kể cả khi 503 vì runner chưa lên — lúc này healthz đã 200 nên có).
signup=$($CURL -s -m 5 "$BASE/healthz" | sed -n 's/.*"signup":"\([a-z]*\)".*/\1/p') || die "không đọc được /healthz"
[ "$signup" = open ] || [ "$signup" = closed ] || die "/healthz thiếu trường signup (open|closed): '$signup'"
# Thứ tự validate của better-auth: cờ đăng ký → email → mật khẩu → độ dài tối thiểu → tra email / tạo user. Mật khẩu
# "x" nên đăng ký mở cũng dừng ở PASSWORD_TOO_SHORT, trước khi tạo user.
email="smoke-$(date +%s)-$RANDOM@invalid.example"
out=$($CURL -s -w '\n%{http_code}' -m 10 -X POST "$BASE/api/auth/sign-up/email" \
  -H "content-type: application/json" -H "origin: $ORIGIN" \
  -d "{\"email\":\"$email\",\"password\":\"x\",\"name\":\"smoke\"}") || die "POST /api/auth/sign-up/email không có phản hồi"
code=${out##*$'\n'}
body=${out%$'\n'*}
# 400 phải đến từ đúng lớp kiểm (không phải sai Origin / sai body) → kiểm cả mã lỗi.
if [ "$signup" = closed ]; then
  [ "$code" = 400 ] && grep -q EMAIL_PASSWORD_SIGN_UP_DISABLED <<<"$body" ||
    die "đăng ký đang tắt nhưng trả HTTP $code (cần 400 EMAIL_PASSWORD_SIGN_UP_DISABLED): $body"
  log "đăng ký công khai bị chặn → 400"
else
  [ "$code" = 400 ] && grep -q PASSWORD_TOO_SHORT <<<"$body" ||
    die "đăng ký đang mở nhưng trả HTTP $code (cần 400 PASSWORD_TOO_SHORT): $body"
  log "CẢNH BÁO: đăng ký công khai đang mở (chưa xác thực email) — do admin bật trên UI hoặc SIGNUP_ENABLED=true"
fi
