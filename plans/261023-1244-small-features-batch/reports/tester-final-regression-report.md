# Báo cáo regression cuối: batch small-features (nhánh feat/small-features-batch)

Ngày: 2026-10-23 (Asia/Saigon, 21:28–21:31). Môi trường: macOS, zsh, dev docker infra đang chạy (postgres, minio, files-proxy healthy).
Phạm vi: toàn bộ thay đổi chưa commit so với `main` + các fix review mới (re2, ignore-apply per-chapter tx, reorder scope, resume sort, invite mail_sent, worker font 4xx fallback, font_path, JobFonts id pattern, font copy-on-commit).
Không sửa source code. Không chạy coverage, không chạy `pnpm build` (không nằm trong yêu cầu).

## 1. Tóm tắt kết quả

| # | Bước | Kết quả |
|---|------|---------|
| 1 | `pnpm install --frozen-lockfile` | PASS: lockfile khớp, không resolve lại. re2 load được từ apps/api (`new RE2('^a+$').test('aaa')` = true) |
| 2 | `pnpm schema:emit` | PASS: rc=0. Không sinh thay đổi mới (xem 2.2) |
| 3 | `pnpm db:migrate` | PASS: "migrations applied" |
| 4 | `pnpm typecheck` | PASS: shared, db, web, api đều Done, không lỗi |
| 5 | `pnpm lint` (biome) | PASS: 300 file, không lỗi, không fix |
| 6 | `pnpm -r --workspace-concurrency=1 test` | PASS: 471/471 test TS, 64 file, 0 fail, 0 skip |
| 7 | `uv run pytest` (worker) | PASS: 188 passed (8.2s) |
| 8 | `uv run ruff check .` | PASS: All checks passed |
| 9 | `uv run ruff format --check .` | PASS: 63 file đã format |
| 10 | `pnpm --filter @mtl/web e2e` (Playwright) | PASS: 32 passed (2.2m), 0 fail, 0 skip |

Tổng: 0 fail. Không flaky quan sát được (không có retry trong e2e). 1 console.error từ Vite (xem mục 5).

## 2. Chi tiết

### 2.1 Install và native addon
- `pnpm install --frozen-lockfile`: "Lockfile is up to date, resolution step is skipped". Không có cảnh báo supply-chain.
- `allowBuilds` trong `pnpm-workspace.yaml` có `re2: true`. Addon load được.

### 2.2 Schema emit (kiểm tra no-diff)
Ghi nhận trước và sau khi chạy `pnpm schema:emit`:

- Trước: `git diff --stat -- packages/shared/json-schema` = 8 file, 272 insertions(+) (thay đổi batch chưa commit, đã có sẵn).
- Sau: 8 file, 272 insertions(+). Giống hệt.
- md5 toàn bộ `packages/shared/json-schema/*.json` trước và sau: IDENTICAL.
- `git status --short packages/shared/json-schema`: không có file mới.

Kết luận: emit idempotent với trạng thái hiện tại, không có lệch zod vs file đã emit.

### 2.3 Migration dev DB
- `pnpm db:migrate` chạy thành công trên DB dev.
- Không chạy lại down-test (đã làm ở lần full trước, không có migration mới).

### 2.4 Typecheck và lint
- Typecheck: 4 workspace Done, không cảnh báo.
- Biome: 300 file (lần trước 297), không lỗi.

### 2.5 Unit và integration TS (`pnpm -r --workspace-concurrency=1 test`)

| Workspace | File | Test | Thời gian | Kết quả |
|-----------|------|------|-----------|---------|
| packages/shared | 4 | 32 | 159ms | pass |
| apps/web | 31 | 191 | 676ms | pass |
| packages/db | 1 | 3 | 1.31s | pass |
| apps/api | 28 | 245 | 52.1s | pass |
| **Tổng** | **64** | **471** | ~56s | **0 fail** |

So với lần full trước (449): +22 test (api +17, shared +4, web +1). Log không có dòng `skipped`, `unhandled`, `warn`.

Ghi chú: `pnpm test --workspace-concurrency=1` bị lỗi CACError vì flag đi vào script vitest. Phải đặt flag trước `test`: `pnpm -r --workspace-concurrency=1 test`.

### 2.6 Worker Python
- `uv run pytest`: 188 passed, 8.20s (lần trước 184). Không có warning.
- `uv run ruff check .`: All checks passed.
- `uv run ruff format --check .`: 63 file đã format.

### 2.7 E2E Playwright
- `pnpm --filter @mtl/web e2e`: 32 passed (2.2m), 0 fail, 0 skip. Số spec giống lần full trước.
- Spec liên quan batch đều pass, gồm `workspace-fonts`, `series-manage`, `upload-chapter` (credit bỏ ở series), `chapter-tools`, `editor` (lock band + retry), `typeset-parity`.

## 3. Kiểm tra các fix review có test đi kèm

| Fix | Test |
|-----|------|
| re2 cho ignore regex | `apps/api/test/ignore-text-re2.test.ts`: 6 case, gồm "finishes a catastrophic-looking pattern in linear time" và "rejects what RE2 cannot compile" |
| ignore-apply per-chapter tx | `apps/api/test/series-ignore-apply.test.ts`: 15 case (apply theo batch, chapter bị lock/job bỏ qua, chapter đổi sau preview bị skip, undo) |
| reorder mutation scope | Test web: "applies local edits by id even after the server reordered/removed other boxes" |
| resume upload sort | Test web: "resume matches dropped files by creation order even after the user reordered the images" |
| invite mail_sent | `apps/api/test/invite-email.test.ts`: "sends exactly one mail…", "transport failure keeps the invitation (200)…", không log password |
| worker font 4xx fallback | `worker/tests/test_job_fonts.py`: `test_client_error_skips_font_and_falls_back` (403, 404); `test_server_error_propagates_so_job_retries` (503 vẫn retry) |
| font_path restriction | `worker/tests/test_job_fonts.py`: `test_path_like_font_family_never_resolves_outside_fonts_dir` |
| JobFonts id pattern + schema | `packages/shared/test/shared-contracts.test.ts` |
| font copy-on-commit | `apps/api/test/fonts-upload.test.ts`: "moves the verified file to a key the upload form cannot write…", "returns the existing font for the same bytes and drops the duplicate object" |

## 4. Độ phủ và rủi ro còn lại
- Không đo coverage lần này. Số liệu coverage gần nhất chưa được cập nhật, nên không kết luận được ngưỡng 80%.
- Không có test riêng cho `apps/api/src/lib/invite-mail-status.ts`. File này được test gián tiếp qua `invite-email.test.ts` (import trong `routes/workspaces.ts`).
- `packages/shared/json-schema` vẫn ở trạng thái chưa commit. Nếu commit cần đi kèm đúng 8 file đó.

## 5. Cảnh báo và vấn đề phát hiện
- E2E log có 1 `console.error` từ Vite: "Several Konva instances detected". Đã có trong lần full trước, không làm fail test. Chưa xác định có phải do batch không.
- `git diff --stat main -- . ':!plans'` không liệt kê file untracked. Có 3 file mới chưa `git add`: `apps/api/src/lib/ignore-text.ts` (15 dòng), `apps/api/src/lib/invite-mail-status.ts` (19 dòng), `apps/api/test/ignore-text-re2.test.ts` (64 dòng). Cộng thêm khoảng 98 dòng không nằm trong con số dưới.
- Thư mục `.claude/` đang untracked, lộ ra trong `git status`. Không rõ có nên đưa vào `.gitignore` hay không.
- Không có Dockerfile trong repo, nên không kiểm tra được build re2 trong container. Mục này không thuộc phạm vi lần chạy.

### Diff so với main
```
115 files changed, 11001 insertions(+), 351 deletions(-)
```
(`git diff --stat main -- . ':!plans'`, chỉ tính file đã tracked.)

## 6. Khuyến nghị
1. Commit 3 file mới (`ignore-text.ts`, `invite-mail-status.ts`, `ignore-text-re2.test.ts`) trước khi merge. Nếu không, branch sẽ thiếu code mà test đang dùng.
2. Thêm test trực tiếp cho `invite-mail-status.ts` nếu logic có nhánh riêng.
3. Chạy coverage (`pnpm -r test:coverage` nếu có) trước khi ship để có số liệu thật so với ngưỡng 80%.
4. Kiểm tra Konva warning: xác định xem có phải do import Konva từ nhiều chỗ trong batch không.

## 7. Câu hỏi chưa giải quyết
- `.claude/` có nên gitignore không, hay là file cố ý để untracked?
- Konva "several instances" có phải do batch đưa thêm import không, hay đã có từ `main`?

Status: DONE_WITH_CONCERNS
Summary: Regression cuối pass toàn bộ: install frozen OK, re2 load OK, schema emit không đổi (md5 giống hệt), typecheck, lint, 471 TS test, 188 pytest, ruff, 32 e2e đều pass, 0 fail.
Concerns/Blockers: 3 file mới chưa tracked (ignore-text.ts, invite-mail-status.ts, ignore-text-re2.test.ts) không nằm trong git diff stat; `.claude/` untracked; Konva console.error cũ; coverage chưa đo.
