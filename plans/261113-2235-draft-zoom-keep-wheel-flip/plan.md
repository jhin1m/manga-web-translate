---
title: "Màn nháp: giữ zoom khi đổi ảnh + cuộn quá mép để đổi ảnh"
status: completed
priority: P2
created: 2026-11-13
---

# Màn nháp: giữ zoom khi đổi ảnh + cuộn quá mép để đổi ảnh

## Bối cảnh
User (13/11): ở màn "Nháp" zoom không giữ khi sang ảnh khác; cuộn chuột không chuyển ảnh như editor. Nguyên nhân:
`source-viewer.tsx` gắn zoom với id ảnh (cố ý, plan `261113-0041` quyết định 5 — chốt sai, editor giữ zoom);
`editor/wheel-page-flip.ts` chưa được gắn vào màn nháp.

## Quyết định
1. Zoom tuyệt đối (scale) giữ qua đổi ảnh như editor; nút % → Vừa khung bỏ zoom. Không giữ sau khi rời chương.
2. Ảnh mới vào (đang zoom, rộng hơn khung) → cuộn ngang căn giữa.
3. Cuộn quá mép dùng lại `stepFlip` (cùng ngưỡng / khoá / quán tính với editor), đổi ảnh qua `onStep` (cùng đường
   pager, có tự lưu trim). Cuộn xuống → đầu ảnh sau; cuộn lên → cuối ảnh trước (đặt sau khi ảnh tải + đo xong).
4. Đang mở panel Cắt mép: cuộn không đổi ảnh (tránh lỡ tay tự lưu khi kéo thanh dưới sát đáy).
5. Không làm hiệu ứng trượt / mờ (YAGNI).

## Phase
| # | Việc | Status |
|---|------|--------|
| 1 | `chapter/source-viewer.tsx`: zoom giữ + căn giữa + wheel flip | Done |
| 2 | e2e `trim-source.spec.ts` (zoom giữ) + `draft-wheel-flip.spec.ts` | Done |
| 3 | `docs/editor.md` mục màn nháp | Done |

## Tiêu chí xong
- [x] Zoom 2 nấc rồi bấm › / chọn thumbnail → ảnh mới vẫn cùng %.
- [x] Cuộn quá đáy ảnh (≥ 160px) → ảnh sau, ở đầu ảnh; quá đỉnh → ảnh trước, ở cuối ảnh.
- [x] Ảnh đầu cuộn lên / ảnh cuối cuộn xuống: đứng yên. Ctrl+cuộn vẫn zoom, không đổi ảnh.
- [x] Đang mở Cắt mép: cuộn quá mép không đổi ảnh.
- [x] Unit + typecheck + lint + e2e trim/upload xanh.

## Kết quả
- Review 7.5/10, không blocker. Đã sửa: listener wheel/gesture gắn 1 lần lên `.cw-canvas` (không bị key) để quán tính
  không lọt vào khung cuộn mới; đặt vị trí vào ảnh chờ `<img>` có cỡ thật; ẩn ảnh khi đang zoom mà chưa đo (không nháy);
  e2e có kiểm tra căn giữa ngang (ảnh 3000px) + chờ theo hằng số `FLIP_*`.
- Bỏ qua: cờ "vào từ đáy" chưa gắn id ảnh nguồn — không xảy ra hiện tại (`hasPrev` khớp `stepSource`).
- Gate: typecheck, vitest 533/533, biome, e2e draft-wheel-flip (3 lần) / trim-source / trim-learn-band / trim-auto-drop /
  upload-chapter xanh. Safari pinch chưa thử tay.
