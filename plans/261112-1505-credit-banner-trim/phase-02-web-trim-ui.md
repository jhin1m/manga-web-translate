---
phase: 2
title: "Web: cắt mép ảnh gốc"
status: completed
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 2: Web — cắt mép ảnh gốc

## Overview
Ở màn chương nháp (sau khi thả ảnh, trước "Dịch chương"), người dùng kéo 2 thanh ngang trên ảnh gốc để bỏ dải banner.

## Requirements
- Vào chế độ cắt: menu chuột phải thumbnail ảnh gốc (`source-rail.tsx`) **"Cắt mép ảnh n…"**; có trim thì thêm
  **"Bỏ cắt"**. Chỉ khi bộ ảnh còn sửa được (`editable`) và ảnh không bị bỏ qua. Không thêm nút mới trên rail/topbar.
- Chọn "Cắt mép" → canvas mở ảnh đó (`source-viewer.tsx`) ở chế độ cắt:
  - 2 thanh ngang (mép trên, mép dưới) kéo bằng chuột/cảm ứng (pointer events); vùng bị cắt phủ mờ.
  - Bàn phím: Tab vào thanh, ↑/↓ = 1 px ảnh thật, Shift = 10 px; Enter = Xong, Esc = Huỷ.
  - Thanh dưới canvas (`cw-canvas-foot`) thay pager bằng: "Trên N px · Dưới M px · Huỷ · Xong".
  - Ảnh webtoon cao: thanh dưới nằm ở đáy ảnh, cuộn tới; vào chế độ cắt mà ảnh là **ảnh cuối** → cuộn sẵn xuống đáy.
  - Kẹp: luôn còn ≥ `MIN_TRIM_KEEP_PX`; toạ độ lưu theo pixel ảnh thật (`naturalHeight`), không theo px màn hình.
- Xong → PATCH `{trim, height: naturalHeight}` lạc quan; lỗi → trả trim cũ + toast lỗi (map 409/423 như skip).
  Toast "Đã cắt mép ảnh n" + "Hoàn tác" (về trim trước đó).
- Ngoài chế độ cắt: ảnh có trim vẫn hiện phủ mờ dải bị cắt + chú thích "Phần mờ bị bỏ khi cắt trang".
- Thumbnail: cờ góc "Đã cắt" (`thumb-flag.tsx`), tooltip + tên truy cập "Ảnh n, đã cắt mép". `by: "credit"` →
  "Credit · tự cắt" (dùng ở P4, làm sẵn nhãn).
- Sau Bước 1 (đã có page): menu không còn mục cắt.

## Architecture
- `source-rail-model.ts`: `SourceItem.trim`; hàm thuần `clampTrim(top, bottom, h)` + `trimLabel` (test được).
- `source-viewer.tsx`: thêm `trimMode` + state nháp `{top, bottom}`; overlay 2 div phủ mờ + 2 handle tuyệt đối theo
  tỉ lệ `displayH / naturalHeight`. Tách component nếu file > ~200 dòng: `source-trim-overlay.tsx`.
- `chapter-workspace.tsx`: giữ `trimFileId`, nối menu → viewer, gọi API qua `features/chapter/api.ts` (cùng chỗ PATCH
  skip), cập nhật cache source files như `onSkip`.

## Related Code Files
- Create: `apps/web/src/features/chapter/source-trim-overlay.tsx` (nếu cần tách)
- Modify: `apps/web/src/features/chapter/source-viewer.tsx`, `source-rail.tsx`, `source-rail-model.ts` (+ test),
  `thumb-flag.tsx`, `chapter-workspace.tsx`, `chapter-workspace.css`, `features/chapter/api.ts`
- Tests: `source-rail-model.test.ts`; e2e mới hoặc mở rộng `upload-chapter` / `chapter-tools` spec: thả ảnh → cắt mép
  → reload vẫn còn → Dịch chương (fake worker) → page cuối cao = H − bottom.

## Implementation Steps
1. Test model: `clampTrim` (kẹp min keep, âm → 0, top+bottom quá → giảm thanh đang kéo), nhãn cờ.
2. API client `setSourceTrim(chapterId, fileId, {trim, height})`.
3. Menu rail + cờ thumbnail.
4. Overlay + chế độ cắt trong viewer (chuột, cảm ứng, phím), focus về thumbnail khi Huỷ/Xong.
5. Toast Hoàn tác; lỗi trả về trạng thái cũ.
6. e2e; kiểm tay trên Chrome + Safari với ảnh 720×15000.

## Success Criteria
- [x] Cắt/huỷ/hoàn tác/bỏ cắt chạy đúng; reload giữ trim (e2e `trim-source.spec.ts`).
- [x] Chỉ bàn phím vẫn cắt được (e2e); màn cảm ứng kéo được — dùng pointer events, CHƯA kiểm tay trên thiết bị cảm ứng / Safari.
- [x] e2e xanh; gate chung xanh; `react-doctor` không có trong repo nên chưa chạy.

## Risk Assessment
- Ảnh rất cao: overlay theo tỉ lệ, sai số làm tròn ≤ 1 px ảnh thật — chấp nhận.
- Ảnh chưa tải lên xong (đang dùng Blob local): vẫn cắt được, `naturalHeight` có từ `<img>`.
- Dễ đụng quy ước UI tối giản: không thêm nút cố định; chế độ cắt chỉ hiện khi gọi từ menu.
