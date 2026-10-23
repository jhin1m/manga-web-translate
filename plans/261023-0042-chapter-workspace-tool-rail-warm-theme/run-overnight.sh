#!/usr/bin/env bash
# Chạy xuyên đêm: plan → cook → review → sửa theo review, mỗi vai 1 pane Claude trong Herdr.
# Chạy từ một pane shell của Herdr, tại gốc repo:
#   bash plans/261023-0042-chapter-workspace-tool-rail-warm-theme/run-overnight.sh
# Sáng dậy: xem pane, `git log main..HEAD`, và file reports/overnight-summary.md trong thư mục plan này.
set -euo pipefail

PLAN_DIR="plans/261023-0042-chapter-workspace-tool-rail-warm-theme"
BRIEF="$PLAN_DIR/brief.md"
REPORTS="$PLAN_DIR/reports"
BRANCH="feat/chapter-workspace-tool-rail"
LOG="$REPORTS/overnight-run.log"
MAX_NUDGES=8 # số lần nhắc "làm tiếp" tối đa cho mỗi bước, phòng agent dừng giữa chừng
CLAUDE_ARGS=(--permission-mode bypassPermissions)

[ "${HERDR_ENV:-}" = 1 ] || { echo "Phải chạy trong một pane Herdr."; exit 1; }
[ -f "$BRIEF" ] || { echo "Không thấy $BRIEF — chạy từ gốc repo."; exit 1; }
mkdir -p "$REPORTS"
log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"; }
notify() { herdr notification show "$1" --body "${2:-}" --sound "${3:-done}" >/dev/null 2>&1 || true; }

# --- Nhánh riêng; commit brief + mockup làm điểm xuất phát -------------------------------------------
if [ "$(git branch --show-current)" != "$BRANCH" ]; then
  git switch -c "$BRANCH" 2>/dev/null || git switch "$BRANCH"
fi
git add "$PLAN_DIR/brief.md" "$PLAN_DIR/design" "$PLAN_DIR/run-overnight.sh"
git diff --cached --quiet || git commit -m "docs: brief and mockup for chapter workspace tool rail and warm theme"

# --- Bố cục: cột phải chia 3 pane planner / cook / reviewer -----------------------------------------
split() { herdr pane split "$@" --cwd "$PWD" --no-focus | jq -r '.result.pane.pane_id'; }
P_PLAN=$(split --current --direction right --ratio 0.62)
P_COOK=$(split --pane "$P_PLAN" --direction down)
P_REVIEW=$(split --pane "$P_COOK" --direction down)
herdr pane rename "$P_PLAN" "plan" >/dev/null
herdr pane rename "$P_COOK" "cook" >/dev/null
herdr pane rename "$P_REVIEW" "review" >/dev/null

herdr agent start planner --kind claude --pane "$P_PLAN" --timeout 90000 -- "${CLAUDE_ARGS[@]}" >/dev/null
herdr agent start cook --kind claude --pane "$P_COOK" --timeout 90000 -- "${CLAUDE_ARGS[@]}" >/dev/null
herdr agent start reviewer --kind claude --pane "$P_REVIEW" --timeout 90000 -- "${CLAUDE_ARGS[@]}" >/dev/null
log "Đã mở 3 agent: planner=$P_PLAN cook=$P_COOK reviewer=$P_REVIEW"

COMMON="Chạy không người trông (owner đang ngủ): KHÔNG dùng AskUserQuestion, KHÔNG chờ xác nhận; tự quyết theo brief \
$BRIEF và docs/, ghi mọi điểm chưa chắc vào mục 'Câu hỏi mở'. Làm trên nhánh $BRANCH, KHÔNG push, KHÔNG đổi nhánh, \
KHÔNG commit vào main."

# step <agent> <file-hoàn-thành> <prompt đầu> <prompt nhắc tiếp>
# Gửi prompt, chờ agent dừng; chưa thấy file hoàn thành thì nhắc làm tiếp, tối đa MAX_NUDGES lần.
step() {
  local agent=$1 done_file=$2 first=$3 nudge=$4 i=0 status
  log "[$agent] bắt đầu"
  herdr agent prompt "$agent" "$first" --wait || true
  while [ ! -f "$done_file" ]; do
    status=$(herdr agent get "$agent" | jq -r '.result.agent.agent_status')
    if [ "$status" = blocked ]; then
      log "[$agent] đang chờ hộp thoại — dừng pipeline để owner xem."
      notify "Pipeline dừng" "$agent đang hỏi/chờ duyệt" request
      exit 2
    fi
    i=$((i + 1))
    if [ "$i" -gt "$MAX_NUDGES" ]; then
      log "[$agent] đã nhắc $MAX_NUDGES lần vẫn chưa có $done_file — dừng."
      notify "Pipeline dừng" "$agent chưa xong sau $MAX_NUDGES lần nhắc" request
      exit 3
    fi
    log "[$agent] chưa có $done_file (trạng thái $status) — nhắc lần $i"
    herdr agent prompt "$agent" "$nudge" --wait || true
  done
  log "[$agent] xong → $done_file"
}

# --- 1. Plan -----------------------------------------------------------------------------------------
step planner "$PLAN_DIR/plan.md" \
  "/ak:plan --auto Lập plan triển khai theo $BRIEF (đọc cả design/chapter-workspace-mockup.dc.html). Ghi plan.md và \
phase-XX-*.md vào ĐÚNG thư mục $PLAN_DIR (đừng tạo thư mục plan khác). Chia phase nhỏ, mỗi phase có file sửa, bước làm, \
cách kiểm tra. Thứ tự gợi ý: token màu + lỗi tên series → khung bố cục (rail công cụ + panel + cột thumbnail) → chuyển \
nội dung inspector/bảng dưới/tìm-thay vào panel → thanh nổi cạnh khối + Xem gốc + menu ⋯ → e2e + docs. $COMMON" \
  "Tiếp tục hoàn thành plan trong $PLAN_DIR (plan.md + các phase). $COMMON"
git add "$PLAN_DIR" && { git diff --cached --quiet || git commit -m "docs: implementation plan for chapter workspace tool rail"; }

# --- 2. Cook -----------------------------------------------------------------------------------------
COOK_DONE="$REPORTS/cook-done.md"
step cook "$COOK_DONE" \
  "/ak:cook $PLAN_DIR/plan.md --auto — làm lần lượt mọi phase. Sau mỗi phase: chạy kiểm tra hẹp liên quan, cập nhật trạng \
thái phase trong plan, commit (conventional commit, không nhắc AI/plan/phase). Cuối cùng chạy đủ: pnpm typecheck && pnpm \
lint && pnpm test && pnpm --filter @mtl/web e2e (pnpm infra:up nếu cần) và cập nhật docs/design-guidelines.md + \
docs/editor.md. CHỈ khi mọi phase xong và mọi kiểm tra qua thì ghi $COOK_DONE (tóm tắt việc đã làm, kết quả từng lệnh \
kiểm tra, việc còn dở). Kiểm tra fail mà không sửa được thì vẫn ghi $COOK_DONE nhưng nói rõ lệnh nào fail và vì sao. \
$COMMON" \
  "Tiếp tục phase chưa xong trong $PLAN_DIR/plan.md theo đúng hướng dẫn ban đầu; xong hết thì ghi $COOK_DONE. $COMMON"

# --- 3. Review (agent riêng, context sạch) -------------------------------------------------------------
REVIEW_FILE="$REPORTS/code-review-chapter-workspace-tool-rail-report.md"
step reviewer "$REVIEW_FILE" \
  "/ak:code-review Review toàn bộ thay đổi git diff main...HEAD đối chiếu $BRIEF và $PLAN_DIR/plan.md: lỗi chức năng, \
tính năng bị mất khi dời chỗ, phím tắt, a11y (aria-label, tương phản màu), test bị nới lỏng. CHỈ đọc và báo cáo, KHÔNG sửa \
code. Ghi kết quả (findings xếp theo mức độ, có file:dòng, kèm cách tái hiện) vào $REVIEW_FILE. $COMMON" \
  "Hoàn tất review và ghi $REVIEW_FILE. $COMMON"

# --- 4. Sửa theo review ------------------------------------------------------------------------------
FIX_DONE="$REPORTS/review-fixes-done.md"
step cook "$FIX_DONE" \
  "Đọc $REVIEW_FILE. Kiểm chứng từng finding với code; sửa finding có thật, bỏ qua finding sai (ghi lý do). Chạy lại \
pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @mtl/web e2e, commit. Ghi $FIX_DONE: finding đã sửa / bỏ qua \
(lý do) / kết quả kiểm tra. $COMMON" \
  "Tiếp tục xử lý $REVIEW_FILE và ghi $FIX_DONE. $COMMON"

# --- Tổng kết ----------------------------------------------------------------------------------------
{
  echo "# Kết quả chạy đêm — $(date '+%d/%m/%Y %H:%M')"
  echo
  echo "Nhánh: \`$BRANCH\` (chưa push). Commit so với main:"
  echo
  echo '```'
  git log --oneline main..HEAD
  echo '```'
  echo
  echo "- Plan: [plan.md](../plan.md)"
  echo "- Cook: [cook-done.md](./cook-done.md)"
  echo "- Review: [$(basename "$REVIEW_FILE")](./$(basename "$REVIEW_FILE"))"
  echo "- Sửa theo review: [review-fixes-done.md](./review-fixes-done.md)"
} >"$REPORTS/overnight-summary.md"
log "Xong toàn bộ — xem $REPORTS/overnight-summary.md"
notify "Pipeline xong" "Xem $REPORTS/overnight-summary.md"
