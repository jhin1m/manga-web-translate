# Hàm dùng chung cho script vận hành (source, không chạy trực tiếp). Lệnh ngoài thay được qua env để kiểm bằng
# Docker ở máy dev: MC (mc client), PG_DUMP, PG_RESTORE, PSQL, CURL.
MC=${MC:-mc}
PG_DUMP=${PG_DUMP:-pg_dump}
PG_RESTORE=${PG_RESTORE:-pg_restore}
PSQL=${PSQL:-psql}
CURL=${CURL:-curl}

log() { printf '%s [%s] %s\n' "$(date -u +%FT%TZ)" "${0##*/}" "$*" >&2; }
die() { log "LỖI: $*"; exit 1; }
need() { for v in "$@"; do [ -n "${!v:-}" ] || die "thiếu biến môi trường $v"; done; }

# urlencode cho access/secret key trong MC_HOST_<alias> (ký tự / + @ : trong secret).
urlenc() {
  local s=$1 out='' c i
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case $c in [a-zA-Z0-9.~_-]) out+=$c ;; *) out+=$(printf '%%%02X' "'$c") ;; esac
  done
  printf '%s' "$out"
}

# mc_alias <alias> <endpoint http(s)://host:port> <access> <secret> → export MC_HOST_<alias> (không ghi ~/.mc).
mc_alias() {
  local proto=${2%%://*} rest=${2#*://}
  export "MC_HOST_$1=${proto}://$(urlenc "$3"):$(urlenc "$4")@${rest%/}"
}

# Kênh cảnh báo duy nhất (ntfy, ALERT_NTFY_URL). Không đặt URL → chỉ log. Không bao giờ làm script thất bại.
notify() {
  local title=$1 msg=$2 prio=${3:-high}
  log "ALERT $title: $msg"
  [ -n "${ALERT_NTFY_URL:-}" ] || return 0
  # Tiêu đề tiếng Việt → RFC 2047 (header HTTP chỉ an toàn với ASCII; ntfy giải mã).
  local enc
  enc="=?UTF-8?B?$(printf '[mtl] %s' "$title" | base64 | tr -d '\n')?="
  $CURL -fsS -m 10 -H "Title: $enc" -H "Priority: $prio" -H "Tags: mtl" -d "$msg" "$ALERT_NTFY_URL" \
    >/dev/null || log "gửi ntfy thất bại"
}

# sha256sum (Linux) hoặc shasum -a 256 (macOS) — cùng định dạng, cùng `-c`.
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
