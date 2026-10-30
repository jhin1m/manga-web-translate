---
title: "Progress từng trang, dịch theo chuỗi lô, UX Xuất"
description: "Xuất 1 nút tự tải; tiến độ tiếng Việt cập nhật ≤5s; dịch theo chuỗi job lô ≤4 trang để sửa trang đầu khi lô sau còn chạy; 1 nút Dịch chương + chọn trang."
status: completed
priority: P1
effort: 34h
branch: feat/pipeline-progress-export-ux
tags: [jobs, worker, editor, export, ux, tdd]
created: 2026-10-29
---

# Progress từng trang, dịch theo chuỗi lô, UX Xuất

Nguồn: [brainstorm đã duyệt](../reports/brainstorm-261029-2114-pipeline-progress-streaming-export-ux-report.md).
Chế độ `--tdd`: mỗi phase viết test ở mục "Test viết trước", chạy thấy đỏ rồi mới code.

## Quyết định đã chốt (không bàn lại)

- CBZ 3 mức: Gốc (100, PNG) / Cao (90) / Nhẹ (75).
- Lô dịch đầu chạy ngay khi có ≥ 1 trang liên tiếp (từ frontier) đã prepared.
- Không nhớ lựa chọn "Chỉ xoá chữ + OCR" theo series.
- Kiến trúc B: chuỗi job `chapter.translate` theo lô (≤ 4 trang & ≤ 40 khối, port `make_batches`), tuần tự.

## Phase + phụ thuộc

| # | Phase | Phạm vi | Effort | Chặn bởi | Trạng thái |
|---|---|---|---|---|---|
| 1 | [UX Xuất](./phase-01-export-ux.md) | web | 4h | — | Completed |
| 2 | [Tiến độ + nhãn tiếng Việt](./phase-02-progress-labels.md) | worker + api + web, migration 0019 | 6h | — | Completed |
| 3 | [Chuỗi job dịch theo lô](./phase-03-batched-translate-chain.md) | api + worker tối thiểu, migration 0020, pipeline 0.7.0 | 10h | P2 (migration 0019 trước, `queue.ts`) | Completed |
| 4 | [Khoá + AI ghi khi đang dịch](./phase-04-lock-while-translating.md) | api + web editor | 6h | P3 (`pages.translate_queued`) | Completed |
| 5 | [1 nút Dịch chương + chọn trang](./phase-05-one-button-page-select.md) | web | 8h | P1, P2, P3, P4 | Completed |

Thứ tự chạy: **P1 ‖ P2** song song → P3 → P4 → P5.
P1 và P2 không chung file nào (đã kiểm cả CSS, test, shared — xem mục "File sở hữu" từng phase). Hợp đồng duy nhất
giữa hai bên: P1 giữ nguyên chữ ký export `ExportRow({x, cancelling, onCancel})` và `useExports(chapterId)` mà
`activity-drawer.tsx` (P2) đang import.

## Tiêu chí hoàn thành → phase + bằng chứng

| # | Tiêu chí (báo cáo) | Phase | Bằng chứng |
|---|---|---|---|
| 1 | Xuất 1 lần bấm ra file tự tải; không còn "slice", "ZIP PNG", ô số chất lượng; cảnh báo nói rõ trang chưa dịch không có trong file | P1 | `export-options.test.ts`, `export-warnings.test.ts`; e2e `chapter-tools.spec.ts` + `full-flow.spec.ts` (bấm "Tải chương" → tải); `grep -nE "slice\|ZIP PNG\|type=\"number\"" export-panel.tsx` rỗng |
| 2 | Chương 33 trang: lô 1 "Xong" và sửa được khi lô sau còn chạy | P3 + P4 | `translate-chain.test.ts` "lô 1 ready khi lô 2 còn chờ"; `ai-write-rules.test.ts` "PUT trang lô đã xong → 200 khi chuỗi còn chạy", "trang chờ lượt → 409 page_busy"; kiểm tay chương 33 trang |
| 3 | Nhãn tiến độ tiếng Việt, cập nhật ≤ 5s | P2 (+P5 nhãn lô) | `test_worker_runner.py` throttle heartbeat; `job-progress.test.ts`; `stage-labels.test.ts`; `page-status.test.ts`; kiểm tay: heartbeat ≤ 2s sau đổi bước + poll 2,5s |
| 4 | Lô 3 lỗi provider hết retry → lô 1–2 giữ, lô 4+ chạy tiếp, trang lô 3 "Lỗi" | P3 | `translate-chain.test.ts` "lô lỗi hẳn không chặn chuỗi" |
| 5 | "Chỉ xoá chữ + OCR" dừng ở "Chờ dịch" | P3 + P5 | `translate-chain.test.ts` "commit target=prepared dừng ở prepared"; `primary-action.test.ts` menu ⋯ |
| 6 | Chọn 3 trang → chỉ 3 trang dịch | P3 + P5 | `translate-chain.test.ts` "dịch tập trang chọn"; `page-selection.test.ts` |
| 7 | Token/chương tăng ≤ ~10%; tên nhân vật nhất quán giữa lô | P3 | Thay thế (không có key LLM): `test_translate_carry.py` (notes/characters vào lô sau), `translate-chain.test.ts` "carry từ result lô trước sang payload lô sau", `planBatches` khớp `make_batches` khi đủ trang. **Cần kiểm tay** với key thật: so `usage_ledger` 1 chương mẫu trước/sau + đọc tên nhân vật |
| 8 | Test: api chuỗi (tiến, lỗi, huỷ, gọi lặp, đồng thời), worker heartbeat throttle, web `page-status`, `stage-labels`, `export-warnings` | P1–P5 | các file test trên; `pnpm test` xanh toàn repo + `cd worker && uv run pytest` |

## Docs (controller cập nhật cuối, phase chỉ ghi chú)

- `docs/export-and-batch-edit.md` — P1 (mục Xuất: drawer mới), P4 (find/replace 409 khi chương đang chạy).
- `docs/job-queue-worker.md` — P2 (heartbeat `done/total`, throttle), P3 (luồng 2 giai đoạn → chuỗi lô, `run_target`, pipeline 0.7.0, `carry`), P4 (luật AI ghi).
- `docs/editor.md` — P4 (mục "Khoá chương theo trạng thái"), P5 (nút chính, chọn trang, drawer Xuất/Hoạt động).
- `docs/deployment-guide.md` + `README.md` — P3 (checklist nâng worker 0.7.0).

## Quy ước

Không đưa mã plan/phase vào comment code, tên test, tên migration, commit message. Migration đặt tên theo nội dung
(`--name jobs_progress_counts`, `--name translate_chain`).
