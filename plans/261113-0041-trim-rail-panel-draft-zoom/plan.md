---
title: "Cắt mép ở rail trái + zoom ảnh gốc ở màn nháp"
status: in-progress
priority: P1
created: 2026-11-13
---

# Cắt mép ở rail trái + zoom ảnh gốc ở màn nháp

## Bối cảnh
User (13/11) không tìm thấy "Cắt mép ảnh n…" (chỉ có trong menu chuột phải thumbnail; Chrome của user còn chặn chuột
phải). Yêu cầu: "đừng chuột phải hay gì hết, cứ ném sang sidebar trái"; màn nháp không zoom được.

## Quyết định (tự chốt theo [[user-delegates-minor-product-decisions]], hướng rail icon → 1 panel)
1. `ToolRail` trái, chương nháp còn sửa được (`sourcesEditable`): icon **Cắt mép** (kéo) bật được; công cụ khác giữ
   như hiện tại. Bấm → panel trái "Cắt mép" cho ảnh đang xem: "Ảnh n/N", ô số Trên / Dưới (px ảnh thật, kẹp
   `MIN_TRIM_KEEP_PX`), nút Lưu / Huỷ, "Bỏ cắt" khi ảnh có trim, nhãn "Credit · tự cắt" khi `by=credit`, câu ngắn
   "Kéo 2 thanh trên ảnh hoặc gõ số". Ảnh bị xoá (skip) → panel báo "Ảnh đã xoá" thay vì công cụ.
2. Panel mở = chế độ cắt trên canvas (2 thanh như hiện tại). Đổi ảnh (rail/pager/phím) khi nháp khác giá trị đã lưu →
   tự lưu rồi sang ảnh mới (không mất công kéo); panel ở lại. Đóng panel / Esc / Huỷ → bỏ nháp chưa lưu.
3. Bỏ "Cắt mép ảnh n…" / "Bỏ cắt" khỏi menu chuột phải thumbnail (một chỗ duy nhất). Tooltip thumbnail không nhắc cắt.
4. Toast sau lưu giữ "Hoàn tác · Luôn cắt ở series này" như cũ.
5. Zoom ảnh gốc ở màn nháp (`source-viewer.tsx`): dùng lại `canvas-controls.tsx` (−/+/% /Vừa khung) như editor;
   Ctrl/⌘+cuộn và pinch trackpad (wheel + ctrlKey) zoom quanh con trỏ; cuộn thường = cuộn ảnh; phím `+`/`-`/`0` nếu
   editor đã có cùng phím. Zoom giữ khi đổi ảnh? → về "Vừa khung" khi đổi ảnh (đơn giản). Thanh cắt đúng px ảnh thật ở
   mọi mức zoom.
6. Sau Bước 1 (đã có page) icon Cắt mép ẩn như các công cụ nháp khác.

## Phase
| # | Việc | Status |
|---|------|--------|
| 1 | Rail + panel cắt mép, bỏ mục menu, zoom nháp, test + e2e | Done (13/11, nhánh `feat/trim-rail-panel`) |
| 2 | Review + sửa | Pending |
| 3 | Docs (`docs/editor.md`) | Done (làm cùng phase 1) |

## Tiêu chí xong
- [x] Chương nháp: bấm icon kéo ở rail trái → cắt được ảnh đang xem không cần chuột phải; reload giữ trim.
- [x] Gõ số Trên/Dưới cập nhật thanh; kéo thanh cập nhật số; kẹp đúng.
- [x] Đổi ảnh khi đang cắt → ảnh cũ tự lưu.
- [x] Màn nháp zoom được (nút, Ctrl/⌘+cuộn, pinch), cắt vẫn đúng px khi đang zoom.
- [x] e2e `trim-source`, `trim-learn-band`, `trim-auto-drop`, `upload-chapter` cập nhật + xanh; gate chung xanh.
