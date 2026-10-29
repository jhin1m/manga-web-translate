# Cook: progress từng trang, dịch theo chuỗi lô, UX Xuất

Ngày: 2026-10-30 · Branch: `feat/pipeline-progress-export-ux` (chưa merge, chưa push) · Plan:
[261029-2206-pipeline-progress-export-ux](../261029-2206-pipeline-progress-export-ux/plan.md) — status completed.
Nguồn: [brainstorm](./brainstorm-261029-2114-pipeline-progress-streaming-export-ux-report.md).

## Bước 0 — dọn working tree (trước branch)

Tree ban đầu có 43 mục dở. User cho phép tự xử lý → commit theo nhóm lên `main`:
`600b74c` lỗi dịch theo nguyên nhân + lớp lỗi `auth` (migration 0018) · `262ab45` chọn loại truyện, manga tự dịch ·
`764b530` xem trước font · `a119d37` `pnpm dev:all` (+ `.claude/agent-memory/` vào `.gitignore`) · `8a4b7d5` báo cáo
brainstorm. `queue.ts`/`worker-protocol.test.ts` lẫn 2 tính năng → stage từng phần bằng `git update-index`.

## Theo phase

| Phase | Agent (Herdr) | Commit | Ghi chú controller |
|---|---|---|---|
| Plan | planner subagent | `8ac3167` | P1/P2 tập file rời nhau (đã kiểm) |
| P1 UX Xuất | p1 ‖ | `cb47e69` | Controller sửa: `paused_budget` = đang chờ, không mời bấm lại (tránh lượt trùng) |
| P2 Progress | p2 ‖ | `dc94dd5` | Migration 0019 |
| P3 Chuỗi lô | p3 | `93fa1c0` | Giao lại 4 điểm: commit không target + hết quota → `prepared` (không 402); claim khoá chương trước trang; khôi phục ngữ cảnh trang sau khi dịch lại trang lẻ; sửa test proofread chập chờn |
| P4 Khoá khi dịch | p4 | `910e026`, `3457fd0` | Giao lại: `page_busy` giữ nháp + tự lưu; e2e theo hành vi mới; xoá `isChapterLocked`. `3457fd0` sửa 2 spec e2e đỏ sẵn từ `262ab45` |
| P5 1 nút + chọn trang | p5 | `280efc7`, `4d73f25` | Rate limit `/get-session`: buộc đo trước khi nới — 124 lần gọi ở cả HEAD lẫn bản mới → chập chờn sẵn có → `4d73f25`. Gợi ý ⌘/Ctrl theo nền tảng; bỏ "Bước 1" còn sót |
| Review | 2 code-reviewer | `8c972ae`, `b10c24b` | xem dưới |
| Docs | docs-manager | `c1f2c77` | editor, job-queue-worker, export-and-batch-edit, deployment-guide, design-guidelines, development-setup, README |

Không có agent nào BLOCKED → không cần kongming.

## Code review (diff `main...HEAD`)

Báo cáo: [backend](./code-review-261030-0030-backend-pipeline-progress-chain-report.md) ·
[frontend](./code-review-261030-0030-frontend-pipeline-progress-export-report.md).

Đã sửa (CONFIRMED, có test đỏ→xanh):
- BE High: lô của lượt cũ xoá cờ / đóng lượt mới → mọi đường dịch + chạy lại trang lỗi trả 409 `translate_running`
  khi chương còn job dịch active.
- BE Medium: huỷ / hết quota giữa chuỗi đánh `failed` trang chưa dịch → chỉ lô đã chạy và lỗi hẳn mới đánh `failed`.
- BE Low: `_carry` crash surrogate lẻ.
- FE High: mở lại drawer Xuất khi đang xuất → không tự tải. FE Medium: nháp lúc trang bận không tự lưu; selection quay
  lại sau lượt; trang lỗi bước 1 > 24h chọn được (thêm `ocr_ready` vào `/progress`); FE Plausible/Low: 409 `page_busy`
  không refetch progress; nhãn trang lỗi đang chờ dịch lại; 1 lần poll xuất lỗi dừng poll.

Không sửa (lý do): FE "bấm Tải chương lần 2 = xuất mới" (thao tác chủ động, nội dung có thể đã đổi, link bản cũ còn);
FE nhánh `paused_budget` của export không xảy ra (export không tính phí); BE chương manga dở lúc deploy dừng ở "Chờ
dịch" (ghi deployment guide); BE khả năng deadlock claim ↔ reaper (Postgres huỷ 1 tx, không mất dữ liệu).

## Tiêu chí hoàn thành (báo cáo brainstorm)

| # | Bằng chứng | Trạng thái |
|---|---|---|
| 1 Xuất 1 bấm tự tải, không "slice"/"ZIP PNG"/ô số, cảnh báo trang chưa dịch | `export-options.test.ts`, `export-warnings.test.ts`, e2e `chapter-tools` chờ sự kiện download | Đạt (tự động); kiểm tay trình duyệt chặn tải chưa làm |
| 2 Lô 1 sửa được khi lô sau chạy | `translate-chain.test.ts`, `ai-write-rules.test.ts` (PUT trang xong 200, trang chờ 409) | Đạt API; e2e không dừng được giữa 2 lô (worker giả nhận ngay); kiểm tay 33 trang chưa làm |
| 3 Nhãn VI, ≤ 5s | `test_worker_runner.py` throttle 2s, `job-progress.test.ts`, `stage-labels.test.ts`, `page-status.test.ts` | Đạt (tự động); chưa kiểm worker thật |
| 4 Lô lỗi không chặn chuỗi | `translate-chain.test.ts` | Đạt |
| 5 "Chỉ xoá chữ + OCR" dừng Chờ dịch | `translate-chain.test.ts` target=prepared, `primary-action.test.ts` | Đạt |
| 6 Chọn 3 trang chỉ dịch 3 | `translate-chain.test.ts`, `page-selection.test.ts` | Đạt |
| 7 Token ≤ +10%, tên nhất quán | `test_translate_carry.py`, test carry qua payload | Chỉ bằng chứng thay thế — **cần kiểm tay với key LLM** |
| 8 Bộ test | như trên | Đạt |

## Kết quả kiểm cuối (HEAD `b10c24b`)

`pnpm -r typecheck` sạch · `pnpm test`: api 308, web 241, shared 37, db 5 — pass · `cd worker && uv run pytest` 261 pass ·
`ruff check` + `ruff format --check` sạch (controller format lại 2 file worker do branch đưa vào) · `pnpm lint` sạch ·
`pnpm --filter @mtl/web e2e` 36/36. Baseline trước đợt: api 274, web 202, worker 246.

## Chưa làm / rủi ro còn lại

- **DB dev chưa chạy migration 0019, 0020** (bị cấm chạy lên DB dùng chung). App dev sẽ lỗi màn chương tới khi `pnpm db:migrate`.
- Thứ tự deploy: worker 0.7.0 trước API (`MIN_PIPELINE_VERSION`); API cùng lúc/trước web (`ocr_ready`). `deploy.sh`
  đưa API + web cùng release; worker Mac/Modal phải nâng tay. Rollback 0.6.0: huỷ job dịch còn chờ có `carry` trước.
- Kiểm tay còn để trống trong phase file (5 ô): tự tải khi trình duyệt chặn, nhãn với worker thật, chuỗi với key LLM,
  sửa trang giữa chuỗi trên chương thật, migrate DB dev.
- Huỷ 1 job lẻ (trang/lô) dừng cả lượt — quyết định controller, đã ghi docs.
- 2 lượt xuất song song: panel chỉ theo dõi lượt mới nhất; lượt cũ xong lúc drawer mở không tự tải (vẫn tải ở "Lượt xuất trước").
- Nhãn dài (VD "Dùng lại ảnh đã xoá chữ") có thể xuống 2 dòng trên thumbnail 112px.
- Shift-click chọn dải bỏ qua bộ lọc "Cần xem"; thông báo xuất xong đè thông báo đang hiện (nhỏ, để nguyên).
- Bước `typeset` báo `done=i+1` (đang làm) khác các bước khác (`done` = đã xong) — lệch ngữ nghĩa nhỏ.

## Câu hỏi mở cho user

1. Huỷ một lô/trang lẻ từ drawer Hoạt động có nên chỉ bỏ phần đó và cho chuỗi chạy tiếp, thay vì dừng cả lượt?
2. Lượt sau có nên chạy ngay khi có trang thay vì chờ đủ lô (nhanh hơn nhưng vụn lô → tốn token hơn)?
3. Khi muốn merge: chạy kiểm tay tiêu chí 7 với key thật (so `usage_ledger` 1 chương mẫu trước/sau) trước hay sau merge?
