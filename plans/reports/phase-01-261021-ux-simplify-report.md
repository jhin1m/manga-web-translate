# Phase 1 — Tín hiệu "cần xem" đúng: report

Ngày: 2026-10-21 · Branch: `feat/ux-p1-review-signals` (từ `main` @ 686ad4d, chưa merge, chưa push)
Plan: [plan.md](../261021-0111-ux-simplify-drop-to-translate/plan.md) · [phase-01](../261021-0111-ux-simplify-drop-to-translate/phase-01-accurate-review-signals.md)

## Đã làm
- `text-table/rows.ts`: region `kind: "bubble"` không thành dòng (`isTextRegion`). Bubble vẫn trong state. `rowKeyOfBox`, `sameKindBoxIds` chỉ khớp region chữ → box gắn vào bubble (hiếm) hiện là dòng "Tự thêm", không biến mất.
- `editor/measure.ts`: `boxOverflow` có dung sai theo trục: tràn ≤ `max(OVERFLOW_TOLERANCE_PX=2, OVERFLOW_TOLERANCE_RATIO=0.04 × cạnh box)` = vừa; vượt → trả số px đo thật. `boxOverflows` dựa trên nó. Một nguồn cho bảng, rail (`overflowPages` → `needsReview`), inspector ("Tràn khung Npx"), cảnh báo xuất.
- Mọi bộ đếm (Bản dịch · N khối, Cần xem, rail tràn khung, drawer Xuất "khối chưa có bản dịch") đều suy từ `buildRows` → tự đúng, không cần sửa `chapter-workspace.tsx`/`export-warnings.ts`/`page-status.ts`.
- Test: rows (bubble bỏ, index đếm lại), measure (1px/100px không cờ, 30px có cờ, dung sai 4% box cao, trục ngang), export-warnings (bubble không tính "chưa có bản dịch").
- `docs/editor.md`: 1 đoạn mô tả dung sai + "khối" = vùng chữ.

## Dữ liệu thật (chapter `01a15a7d-…`, đo bằng Chromium + font manifest như editor)
| | Trước | Sau |
|---|---|---|
| Dòng bảng | 145 | 77 (bỏ 68 bubble) |
| "Trống" | 70 | 2 (cờ `empty` của worker: crop không mực, trang 1 & 5 — đúng thiết kế) |
| Box tràn | 29/29 box có chữ | 0 |
| Cần xem (topbar/rail) | 5 | 0 (đã xem trên dev 5180) |

Mức tràn thật của 29 box: 0.0001–0.005px (render.py lưu kích thước làm tròn; `Math.ceil` cũ phóng thành "1px"). Ngưỡng 2px/4% dư rất xa so với sai số này; giữ đề xuất của plan vì còn chênh đo ngang Pillow↔canvas với dòng dài.

## Quyết định / lệch so với plan
- **Khối tiêu đề "CHƯƠNG 59: …" KHÔNG còn cờ.** Plan kỳ vọng nó vẫn bị cờ, nhưng đo thật: chữ nằm trong box (tràn 0.003px, ngang 0). Chữ "đè lên tranh" vì *bản thân box* (w=519, region `text_free`) phủ lên vùng tranh, không phải chữ tràn khỏi box. Đó không phải tín hiệu `boxOverflow` đo được; không bịa cờ. Plan đã ghi điều kiện "nếu tràn do box quá hẹp…" — điều kiện không xảy ra.
- Bỏ hàm đo thô (không dung sai) thay vì giữ 2 hàm: không còn nơi nào cần số thô dưới dung sai (YAGNI).

## Kiểm chứng
- `pnpm typecheck` ✓ · `pnpm lint` ✓ (235 files) · `pnpm test` ✓ (shared 8, web 116, db 3, api 144).
- e2e `editor`, `chapter-tools`, `typeset-parity`: 10/10 ✓ (parity: 82 dòng, lệch tối đa 1px, vượt ngưỡng 0).

## Vấn đề mở
1. Tiêu đề đè lên tranh (box phủ ngoài vùng đã tẩy): cần tín hiệu khác (vd. box chữ vượt vùng mask/clean, hoặc chữ trên nền không đồng màu) — đề xuất xét ở Phase 5 (typeset: viền trắng sẽ giảm hẳn cảm giác đè) hoặc phase riêng; không thuộc phạm vi P1.
2. e2e log có `console.error` có sẵn từ trước: "Cannot update a component (`LockBand`) while rendering a different component (`ChapterWorkspace`)" — setState trong render; không do P1, nên sửa ở P3 (gom trạng thái, đụng `lock-banner`).
3. Ảnh dev thấy "Trang –/5" vẫn sai — thuộc Phase 2 như plan.
