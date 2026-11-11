# Báo cáo full gate — version notice + in-app update (2026-11-11)

Phạm vi: toàn bộ working tree (gồm `apps/web/src/features/chapter/**` của plan khác). Chỉ chạy, không sửa code.

## Kết quả

| # | Gate | Kết quả |
|---|------|---------|
| 1 | `pnpm lint` | PASS — 472 file, 0 lỗi |
| 2 | `pnpm typecheck` | PASS — shared, db, web, api đều Done |
| 3 | `pnpm test` | PASS — shared 114/114, web 485/485, db 8/8, api 705 pass + 1 skip |
| 4 | Web e2e (toàn bộ) | 111 pass, 2 fail: 1 đã biết, 1 flaky (pass khi chạy lại) |
| 5 | `uv run pytest -q` (worker) | PASS — 414 passed |
| 6 | `bash -n` + `shellcheck -x` smoke | PASS — exit 0 cả hai |
| 7 | `docker compose config -q` | PASS |
| 7b | `MTL_UPDATER=0 docker compose config` | `replicas: 0` xác nhận (`grep -A3` không tới dòng này, cần `-A8`). Mặc định `replicas: 1` |

## Fail chi tiết

- **`e2e/block-panel.spec.ts:317`** — `expect(locator).toBeHidden()`. Đỏ sẵn trên HEAD. Không thuộc feature này lẫn plan chapter. Bỏ qua.
- **`e2e/series-suggestions.spec.ts:18`** (flaky) — `toBeFocused()` lỗi ở dòng 42 (nút "Nhận 검성" không lấy focus). Chạy lại riêng: PASS. Giả định: focus chuyển sau re-render async. File không đổi trong diff (commit 01710e6). Không thuộc feature này lẫn plan chapter.

## Chi tiết khác

- **API skip**: `apps/api/test/local-mode.test.ts:150` (dump DB) skip vì không có `pg_dump` trong PATH. Test này bảo vệ bước "backup +1" của smoke.
- **E2E feature**: `update-notice.spec.ts` (toàn bộ test) PASS. `chapter-topbar.spec.ts` PASS.
- **Thời gian**: api 72 s, web 0.9 s, db 1.9 s, shared 0.2 s, e2e 6.3 phút, pytest 14 s.
- **Coverage**: không chạy (không thuộc gate).
- **Môi trường**: lần e2e đầu bị một session khác chạy `update-notice.spec.ts` trên cùng cổng 5181/8797 và DB `mtl_test_e2e`, ghi đè log. Kết quả lần đó bỏ. Lần sạch chạy sau khi xác nhận không còn playwright nào.

## Critical và khuyến nghị

- Không có lỗi chặn từ feature update/version.
1. Cài `pg_dump` (cùng major server), chạy lại `pnpm --filter @mtl/api test`.
2. Ổn định `series-suggestions.spec.ts:42` (`expect.poll` hoặc đợi re-render).
3. Không chạy e2e song song giữa session/worktree (cổng, DB cố định).
4. Chưa chạy: smoke `FROM=0.3.0-rc.1 TO=0.3.0-rc.2 infra/selfhost-update-smoke.sh` (cần Docker thật, tiêu chí 3) và checklist Windows (tiêu chí 4).

## Câu hỏi chưa giải quyết

- Có session khác vẫn chạy e2e không? Chưa rõ sau 23:35.
- `block-panel.spec.ts:317` đỏ sẵn trên HEAD: có kế hoạch sửa không?

Status: DONE_WITH_CONCERNS
Summary: lint PASS; typecheck PASS; test PASS (api 705 + 1 skip, web 485, shared 114, db 8); e2e 111 pass, 1 known fail, 1 flaky; pytest 414 PASS; shell + compose PASS, updater replicas:0 xác nhận.
Concerns/Blockers: thiếu `pg_dump` làm 1 test skip; `series-suggestions` flaky; e2e không chạy song song được.
