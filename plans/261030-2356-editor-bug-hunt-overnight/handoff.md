# Handoff — editor bug hunt (dừng 31/10/2026 ~01:20)

Branch `fix/editor-bug-hunt` (từ `main` @ `e76956b`), chưa push/merge. Working tree sạch (chỉ thư mục plans này chưa
track). Report: `reports/overnight-editor-bug-hunt-report.md` (đầy đủ chi tiết, đề xuất UI, câu hỏi cho user).

## Đã xong (đều có test, gate xanh)

| Commit | Nội dung |
|---|---|
| `fc1fd7d` | Áp kiểu cả chương = 1 batch `PUT /chapters/:id/states` + toast "Hoàn tác" (`find-replace/undo`) |
| `b8daf73` | Ô số panel kiểu chữ không kẹp từng phím (gõ "24" ra 64) — `panels/number-input.ts` |
| `04f2a9b` | Áp kiểu không bỏ sót khối trùng id ở trang khác; toast áp kiểu sticky |
| `ff4ef85` | Tìm/Thay, Glossary: áp lại cùng bản xem trước → 409 `preview_stale`, nút Áp dụng tắt sau áp |
| `747d90c` | E2E `chapter-tools`/`full-flow` theo nhãn Export mới |
| `bbf5a45` | Worker: tên schema inputs kebab (`page.ocr_region` từng hỏng trên worker thật) |
| `7b0fb88` | Docs `editor.md`, `export-and-batch-edit.md` |
| `3d3d53e` | Giữ khối đang chọn khi trang đang mở nạp bản mới |

Gate lần cuối: `pnpm typecheck` ✓, `pnpm lint` ✓, `pnpm test` ✓ (web 246, api 312, shared 37, db 5), worker pytest 264 ✓,
e2e 33/37 — 4 fail là spec trang series hỏng sẵn từ `e76956b` (open, xem report #10); spec editor/chương xanh.

## Đang dở

Không có code dở. Report đã cập nhật tới trạng thái này.

## 7 luồng (checklist brief)

Đã đi hết 1–7 trên dev 5180 với chương QA. Chưa tái hiện tay: xung đột phiên bản 2 tab (công cụ Chrome mất nhóm tab khi đóng
tab; đã kiểm qua code + unit test). Còn lại nếu muốn làm tiếp:
1. (tuỳ chọn) Viết lại 4 e2e trang series theo luồng modal — chỉ khi user đồng ý (ngoài phạm vi editor).
2. Sau khi user restart worker dev: thử lại "Dịch lại khối" / OCR vùng (R) trên chương QA để xác nhận sửa `bbf5a45` end-to-end.
3. Chờ user trả lời câu hỏi trong report (Cmd+Z cho lượt hàng loạt, căn giữa dọc, cuộn sang trang).

## Môi trường

- Dev: SPA `localhost:5180`, API `:8787`, worker Python thật (Gemini) + `pnpm jobs` chạy từ `pnpm dev:all` của user —
  **worker dev đang chạy code cũ**, cần user restart để nhận `bbf5a45`. Không kill process của user.
- Dữ liệu QA: series "QA đêm" `01a18df3-d212-70fa-82a5-b7a51a11ca31`, chương `01a18df3-d21d-7100-9a4d-d0ddd106b526`
  (4 trang ảnh tổng hợp, ảnh nguồn + script ở scratchpad phiên cũ, không cần). Glossary series: `라면 → mì gói`.
  Có thể còn tab QA mồ côi trong Chrome giữ khoá (hết hạn 15').
- Chương thật `01a18dab-be1b-72b5-ad44-450025cfd188`: chỉ xem, không ghi.
- Torii: dự án có sẵn đang mở ở tab của user → bị chặn xem; không upload/dịch.
- Lệnh: `pnpm typecheck && pnpm lint && pnpm test`; worker `cd worker && .venv/bin/python -m pytest -q`;
  e2e `cd apps/web && pnpm exec playwright test [file] [-g tên]` (API 8797 + Vite 5181, DB `mtl_test_e2e`, worker giả;
  không chạy song song 2 lượt e2e).

## Phiên 2 (31/10 01:21–01:45)

- Tái hiện tay khoá/chỉ xem + xung đột phiên bản 2 tab trên dev → bug #11 (rebase `text`/`lines` lệch) — `b645fbe`.
- Xác nhận end-to-end "Dịch lại khối" + OCR vùng sau restart worker (#5 xong).
- Code review toàn diff → sửa #12 `3350822`, #13 `e3c3642`, #14 `4e68761`; #15–#16 open cần user, #17 chấp nhận.
- Gate: typecheck/lint/test ✓ (web 252), worker 264 ✓, e2e editor+chapter-tools+full-flow 16/16 ✓.
- Còn open (cần user): so Torii, 4 e2e trang series (#10), #8, #9, #15, #16.

## Phiên 3 (31/10 02:05–02:35)

- #15 hoàn tác Áp kiểu chế độ skip `32d24e6`; #16 giữ nguyên; #10 4 e2e series `6b5f2ef`; khối 1 trang 1 QA gõ lại (hết lệch).
- Review commit phiên 2–3 → `4d16a74` (#18), `cd9e30c` (#19); #20 open thấp.
- Gate: typecheck/lint/test ✓ (web 253, api 313), worker 264 ✓, e2e toàn bộ 38/38 ✓. Tab Chrome agent mở: đã đóng hết.
- Còn mở: Torii, #8, #9, #20, flake `ai-write-rules.test.ts` (1 lần). Xem "Tóm tắt cho sáng mai" đầu report.

## Phiên 4 (31/10 02:30–02:50)

- #23 test chập chờn `fc933b2` (thứ tự claim trùng created_at, chỉ test); #9 OCR báo lỗi thử lại + Huỷ `0b0e01c` `f990690`
  `07ec87b` `d357aeb`; #20 `b0612fa`; #21 `a797c41` (+ `40eb9d9`).
- Gate: typecheck/lint ✓, pnpm test 3/3 ✓ (web 266, api 313), worker 264 ✓, e2e 40/40 ✓. Không mở tab Chrome vòng này.
- Còn mở: #8 (user), Torii, 3 điểm thấp (nháy dòng thử lại OCR, role nút Huỷ, tie-break hàng đợi) — xem "Tóm tắt cho sáng mai".
