#!/usr/bin/env bash
# Smoke end-to-end bản self-host: build 2 image tag `smoke`, chạy docker-compose.yml trong thư mục tạm có ./data trống,
# kiểm qua HTTP thật (infra/selfhost-smoke.mjs), down/up giữ dữ liệu, backup DB khi khởi động lại, cổng + quyền file.
# Chạy tay trên máy dev (nặng: build image + tải model) — KHÔNG đưa vào CI.
#
#   infra/selfhost-smoke.sh
# Biến tuỳ chọn:
#   SMOKE_SKIP_BUILD=1         dùng image ghcr.io/jhin1m/{mtl,mtl-worker}:smoke đã build
#   SMOKE_PORT=18080           cổng localhost cho app
#   SMOKE_MODELS_CACHE=<dir>   chép model đã tải (đúng sha256) vào data/models → bỏ qua tải lần đầu
#   SMOKE_KEEP=1               giữ stack + thư mục tạm khi thoát (in đường dẫn)
#   SMOKE_PREPARE_TIMEOUT_S    chờ page.prepare (mặc định 900; gồm cả thời gian worker tải model)
#   SMOKE_PAGE=<file>          ảnh trang (png/jpg/webp) thay trang tự vẽ; khi đó chỉ kiểm "≥ 1 khối có chữ"
#   SMOKE_FONT=<file>          font tiếng Nhật để vẽ trang (mặc định tải Noto Sans JP Bold, OFL, ghim tag + sha256)
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
. "$REPO/infra/lib.sh"

PROJECT=mtl-smoke
export MTL_TAG=smoke MTL_PORT=${SMOKE_PORT:-18080}
# Biến shell của dev không được lọt vào compose (COMPOSE_FILE ghi đè file trong thư mục tạm; biến MTL_* bị nội suy).
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES MTL_SKIP_BOOT_BACKUP MTL_ALLOWED_HOSTS
# Đường dẫn người dùng truyền vào → tuyệt đối trước khi cd sang thư mục tạm.
for v in SMOKE_PAGE SMOKE_FONT SMOKE_MODELS_CACHE; do
  [ -n "${!v:-}" ] || continue
  [ -e "${!v}" ] || die "$v không tồn tại: ${!v}"
  printf -v "$v" '%s/%s' "$(cd "$(dirname "${!v}")" && pwd)" "$(basename "${!v}")"
done
BASE="http://127.0.0.1:$MTL_PORT"
MJS="$REPO/infra/selfhost-smoke.mjs"
T0=$(date +%s)
TIMES=()
step() { # step <tên> → ghi thời gian bước trước, log bước mới
  local now
  now=$(date +%s)
  [ -n "${STEP_NAME:-}" ] && TIMES+=("$STEP_NAME: $((now - STEP_T))s")
  STEP_NAME=$1 STEP_T=$now
  log "== $1"
}

# Stack cũ (vd lần trước SMOKE_KEEP=1) → dừng lại, không chiếm rồi down nó (thư mục dữ liệu cũ sẽ mồ côi).
if docker compose ls -a -q | grep -qx "$PROJECT"; then
  die "còn stack '$PROJECT' từ lần trước — dọn trước: docker compose -p $PROJECT down (rồi xoá thư mục tạm đã in)"
fi

if [ "${SMOKE_SKIP_BUILD:-}" != 1 ]; then
  step "build image"
  docker build -f "$REPO/infra/docker/app.Dockerfile" -t "ghcr.io/jhin1m/mtl:$MTL_TAG" "$REPO"
  docker build -f "$REPO/infra/docker/worker.Dockerfile" -t "ghcr.io/jhin1m/mtl-worker:$MTL_TAG" "$REPO"
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/mtl-smoke.XXXXXX")
work=$(cd "$work" && pwd -P) # macOS: /var → /private/var (Docker Desktop/OrbStack chia sẻ /private)
dc() { docker compose -p "$PROJECT" -f "$work/docker-compose.yml" "$@"; }

cleanup() {
  local rc=$?
  set +e # dọn dẹp không được đổi mã thoát (đã in SMOKE OK mà rm lỗi vẫn phải thoát 0)
  if [ "${SMOKE_KEEP:-}" = 1 ]; then
    log "SMOKE_KEEP=1 → giữ stack '$PROJECT' tại $work (dọn: cd $work && docker compose -p $PROJECT down)"
    exit "$rc"
  fi
  if [ "$rc" != 0 ] && [ -f "$work/docker-compose.yml" ]; then
    log "log cuối mỗi service:"
    dc logs --no-color --tail 40 >&2
  fi
  [ -f "$work/docker-compose.yml" ] && dc down --remove-orphans >/dev/null 2>&1
  # data/postgres thuộc uid 999, data/* khác uid 1000 → xoá trong container.
  [ -d "$work/data" ] && docker run --rm -v "$work:/w" busybox rm -rf /w/data >/dev/null 2>&1
  rm -rf "$work" || log "không xoá được $work — xoá tay"
  exit "$rc"
}
trap cleanup EXIT
cp "$REPO/docker-compose.yml" "$work/"
cd "$work"

# Kiểm file trong /data qua container app (root): host có thể không đọc được data/* (Linux uid ≠ 1000, rootless).
in_app() { dc exec -T app sh -c "$1"; }
count_backups() {
  local out
  out=$(in_app 'find /data/backups -maxdepth 1 -name "mtl-*.dump" | wc -l') || die "không đọc được /data/backups"
  echo "${out//[[:space:]]/}"
}

# Trang thử có chữ thật: series smoke là tiếng Nhật (OCR mặc định manga_ocr) → 2 bóng thoại trắng viền đen, chữ dọc.
# Vẽ bằng Python + Pillow của image worker; image không có font CJK (worker/fonts chỉ có font Latin/Việt) → tải font.
FONT_URL=https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/SubsetOTF/JP/NotoSansJP-Bold.otf
FONT_SHA256=1b0edfb500b73a4fa8a4fcaae1bbbd403994e08e73e3e0da37e70d3853f42c5f
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
if [ -n "${SMOKE_PAGE:-}" ]; then
  [ -f "$SMOKE_PAGE" ] || die "SMOKE_PAGE không phải file: $SMOKE_PAGE"
  export SMOKE_PAGE_FILE=$SMOKE_PAGE
  unset SMOKE_EXPECT_TEXT
else
  step "vẽ trang thử có chữ tiếng Nhật"
  mkdir -p "$work/page"
  if [ -n "${SMOKE_FONT:-}" ]; then
    cp "$SMOKE_FONT" "$work/page/font"
  else
    $CURL -fsSL --retry 3 -m 120 -o "$work/page/font" "$FONT_URL" || die "không tải được font $FONT_URL"
    [ "$(sha256 "$work/page/font")" = "$FONT_SHA256" ] || die "sai sha256 font $FONT_URL"
  fi
  cat >"$work/page/render.py" <<'PY'
import sys
from PIL import Image, ImageDraw, ImageFont

font_path, out, cols_a, cols_b = sys.argv[1:5]
SIZE = 52
f = ImageFont.truetype(font_path, SIZE)
img = Image.new("RGB", (800, 1200), "white")
d = ImageDraw.Draw(img)
d.rectangle((30, 30, 770, 1170), outline="black", width=6)  # khung tranh
d.line((30, 600, 770, 600), fill="black", width=6)


def bubble(cx, cy, cols):
    """Bóng thoại elip trắng viền đen, chữ dọc: cột đầu bên phải, đọc phải → trái."""
    n, rows = len(cols), max(len(c) for c in cols)
    w, h = n * (SIZE + 18) + 110, rows * (SIZE + 4) + 130
    d.ellipse((cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2), fill="white", outline="black", width=5)
    x0 = cx + (n * (SIZE + 18)) // 2 - SIZE
    y0 = cy - (rows * (SIZE + 4)) // 2
    for i, col in enumerate(cols):
        for j, ch in enumerate(col):
            d.text((x0 - i * (SIZE + 18), y0 + j * (SIZE + 4)), ch, font=f, fill="black")


bubble(520, 310, cols_a.split())
bubble(330, 890, cols_b.split())
img.save(out)
PY
  bubble_a="こんにちは 元気ですか" bubble_b="ありがとう またね"
  docker run --rm --user "$(id -u):$(id -g)" --entrypoint python -v "$work/page:/w" "ghcr.io/jhin1m/mtl-worker:$MTL_TAG" \
    /w/render.py /w/font /w/page.png "$bubble_a" "$bubble_b"
  export SMOKE_PAGE_FILE=$work/page/page.png SMOKE_EXPECT_TEXT="$bubble_a $bubble_b"
  log "trang thử: $SMOKE_PAGE_FILE (bóng 1: $bubble_a | bóng 2: $bubble_b)"
fi

if [ -n "${SMOKE_MODELS_CACHE:-}" ]; then
  step "nạp model từ cache"
  [ -d "$SMOKE_MODELS_CACHE" ] || die "SMOKE_MODELS_CACHE không phải thư mục: $SMOKE_MODELS_CACHE"
  mkdir -p data/models
  cp -R "$SMOKE_MODELS_CACHE"/. data/models/
fi

step "up lần đầu (./data trống)"
dc up -d --wait --wait-timeout 900
n=$(count_backups)
[ "$n" = 0 ] || die "DB trống mà đã có $n backup"
log "DB trống → không backup"

step "kiểm HTTP: SPA, upload, page.prepare, export"
node "$MJS" run "$BASE" "$work/smoke-state.json"
log "data/models: $(du -sh data/models 2>/dev/null | cut -f1) (worker tải theo models.lock.json)"

step "kiểm OCR thật (pages.ocr_result)"
# API chưa trả kết quả OCR trước khi dịch (chỉ dùng nội bộ cho chapter.translate) → đọc cột jsonb qua psql.
chapter_id=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).chapterId' "$work/smoke-state.json")
[[ $chapter_id =~ ^[0-9a-f-]{36}$ ]] || die "chapterId lạ trong state: $chapter_id"
dc exec -T postgres psql -U mtl -d mtl -AtX -v ON_ERROR_STOP=1 \
  -c "select coalesce(json_agg(ocr_result order by ord), '[]') from pages where chapter_id = '$chapter_id'" \
  >"$work/ocr.json" || die "psql đọc pages.ocr_result lỗi"
node "$MJS" ocr "$BASE" "$work/smoke-state.json" "$work/ocr.json"

step "down && up → dữ liệu còn"
dc down
dc up -d --wait --wait-timeout 600
node "$MJS" verify "$BASE" "$work/smoke-state.json"

step "backup DB khi khởi động lại"
n=$(count_backups)
[ "$n" -ge 1 ] || die "khởi động lại không tạo backup"
dc restart app
dc up -d --wait --wait-timeout 600
m=$(count_backups)
[ "$m" = $((n + 1)) ] || die "restart app: số backup $n → $m (cần +1)"
log "backup: $n → $m sau restart app"

step "cổng + quyền file"
# `compose port` in "invalid IP:0" khi không publish và chỉ trả binding đầu → đọc cột Ports (có "->" = publish ra host).
[ -n "$(dc ps -q postgres)" ] || die "postgres không chạy"
pg_ports=$(dc ps --format '{{.Ports}}' postgres)
case $pg_ports in *'->'*) die "postgres lộ cổng: $pg_ports" ;; esac
app_ports=$(dc ps --format '{{.Ports}}' app)
bindings=$(tr ',' '\n' <<<"$app_ports" | grep -- '->' | sed 's/^ *//') || true
[ "$bindings" = "127.0.0.1:$MTL_PORT->8080/tcp" ] || die "app bind '$app_ports' (cần đúng 127.0.0.1:$MTL_PORT->8080/tcp)"
modes=$(in_app 'stat -c "%a %n" /data/secrets/* /data/worker/token') || die "thiếu secret/token: $modes"
nsec=$(grep -c ' /data/secrets/' <<<"$modes") || die "data/secrets trống"
bad=$(grep -v '^600 ' <<<"$modes") && die "quyền sai (cần 600): $bad"
log "postgres không publish, app $bindings, $nsec secret + token quyền 600"

step "xong"
log "thời gian từng bước:"
for t in "${TIMES[@]}"; do log "  $t"; done
log "tổng: $(($(date +%s) - T0))s"
echo "SMOKE OK"
