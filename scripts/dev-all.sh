#!/usr/bin/env bash
# Một lệnh chạy cả môi trường dev: hạ tầng Docker + migrate, API + web, jobs nền, worker AI.
# Worker đọc cấu hình (MTL_*, ANTHROPIC_API_KEY / GEMINI_API_KEY) từ .env gốc qua `uv run --env-file`.
# Ctrl+C dừng mọi process; hạ tầng Docker vẫn chạy (tắt bằng `pnpm infra:down`).
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -f .env ]] || { echo "Thiếu .env — chạy: cp .env.example .env"; exit 1; }

pnpm infra:up
pnpm db:migrate

trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT

# Chạy nền, gắn tiền tố tên process vào từng dòng log.
run() {
  local name=$1
  shift
  ("$@" 2>&1 | sed -l "s/^/[$name] /") &
}

run dev pnpm dev
run jobs pnpm jobs
# `uv run --env-file` không ghi đè biến đã có trong shell → khoá cũ còn export ở terminal sẽ thắng .env.
# Bỏ các biến worker mà .env có khai báo để .env luôn là nguồn cấu hình duy nhất.
for v in $(grep -oE '^(MTL_[A-Z_]+|ANTHROPIC_API_KEY|GEMINI_API_KEY)=' .env | tr -d '='); do unset "$v"; done
run worker env PYTHONUNBUFFERED=1 uv run --directory worker --env-file ../.env mtl-worker

wait
