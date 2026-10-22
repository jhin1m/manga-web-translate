---
phase: 2
title: "Web: rail ảnh gốc, xem lớn, xoá/hoàn tác"
status: completed
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 2: Web — rail ảnh gốc, xem lớn, xoá/hoàn tác

## Overview
Khi chương chưa có page, rail trái liệt kê ảnh gốc ("Ảnh n") ngay lúc upload; bấm → canvas hiện ảnh đó vừa khung;
icon Xoá/Khôi phục trên mục rail; toast có "Hoàn tác".

## Requirements
- Functional:
  - Chế độ rail "ảnh gốc" khi `pages.length === 0` (draft / ingesting / partial_failed chưa page). Có page → rail trang
    như cũ.
  - Mục rail: thumbnail (Blob local từ `uploadManager.localFiles` nếu có, không thì URL ký `fetchSourceFiles`),
    "Ảnh n", trạng thái tải từng file (Đang tải / Lỗi / Chưa tải / xong = không nhãn). Bộ đếm "Tất cả n · Đã bỏ m".
  - Ảnh `skip != null`: mờ + nhãn ("Đã xoá" khi `user`; P4 thêm "Credit · tự bỏ") + icon Khôi phục; không có icon Xoá.
  - Bấm mục → canvas hiện ảnh fit chiều ngang (trần 100%), ảnh cao cuộn dọc như đọc webtoon; ← / → chuyển ảnh, nút ‹ › dưới canvas
    (tái dùng `CanvasStatus`-kiểu điều hướng hiện có nếu khớp; không thì component nhỏ riêng).
  - Thanh trạng thái upload + drop zone "Tải tiếp ảnh" giữ ở trên canvas như hiện tại. Bỏ lưới `SourcePreview`.
  - Xoá: optimistic + `PATCH skip:"user"`; toast "Đã xoá ảnh n · Hoàn tác" (6s, theo `NOTICE_MS`); lỗi → hoàn lại +
    toast lỗi. Khi đang chạy Bước 1 (status ≠ draft) ẩn icon Xoá.
  - Nút Bước 1 (`primaryAction`) dùng số ảnh **không skip**; 0 ảnh còn lại → disabled với title "Đã bỏ hết ảnh".
- Non-functional: rail memo như hiện tại (không render lại khi gõ); thumbnail `loading="lazy"`; 400 ảnh vẫn mượt
  (không decode full-size vào rail — `<img>` với CSS object-fit là đủ).

## Architecture
- `PageRail` nhận union `items` hoặc tách `SourceRail` (component riêng trong `page-rail.tsx` dùng chung CSS
  `.cw-rail*`). Chọn **component riêng `SourceRail`** để không làm phức tạp props của rail trang (KISS).
- State ảnh đang xem: `useState<string | null>` trong `Workspace` (không đưa vào editorStore — không phải page).
- Canvas ảnh gốc: `SourceViewer` (`<img>` fit trong `.cw-canvas`), thay chỗ `<SourcePreview>` trong nhánh
  `isDraft || pages.length === 0` của `chapter-workspace.tsx:546`.
- Phím ←/→: nhánh `page` của `keys.current` dùng danh sách ảnh khi chưa có page.
- Logic thuần (sắp thứ tự, nhãn trạng thái, đếm) đặt `source-rail-model.ts` để test vitest.

## Related Code Files
- Create: `apps/web/src/features/chapter/source-rail.tsx`, `source-viewer.tsx`, `source-rail-model.ts` (+ `.test.ts`)
- Modify: `apps/web/src/features/chapter/chapter-workspace.tsx`, `chapter-workspace.css`, `api.ts` (`setSourceSkip`),
  `primary-action.ts` (+ test), `page-rail.tsx` (chỉ nếu tách CSS/helper dùng chung)
- Delete: `apps/web/src/features/chapter/source-preview.tsx` (+ CSS `.source-preview*`) nếu không còn nơi dùng
- E2E: `apps/web/e2e/upload-chapter.spec.ts`, `click-budget.spec.ts`

## Implementation Steps
1. **Tests Before**: `primary-action.test.ts`, `upload-manager.test.ts` xanh; e2e `upload-chapter` xanh (ghi lại
   assert đang dựa vào lưới SourcePreview để sửa có chủ đích).
2. `source-rail-model.ts`: `sourceRailItems(files, uploadStates, localUrls)` → `{id, ord, label, url, state, skip}`.
   Test: thứ tự theo ord, nhãn trạng thái, đếm đã bỏ.
3. `SourceRail` + `SourceViewer` + nối vào workspace; phím ←/→.
4. Xoá/khôi phục (mutation + optimistic + toast Hoàn tác). `primaryAction` dùng số ảnh không skip.
5. **Tests After**: vitest model + primary-action; e2e `upload-chapter`: thả 5 ảnh → rail 5 mục; bấm mục 3 → ảnh lớn
   đúng; xoá mục 2 → "Đã bỏ 1"; Hoàn tác → về 0; xoá mục 2 lần nữa → Bước 1 → chương có page từ 4 ảnh (fake worker).
   `click-budget` không tăng số thao tác.
6. **Regression Gate**: `pnpm typecheck && pnpm lint && pnpm --filter @mtl/web test` + e2e `upload-chapter`,
   `click-budget`, `full-flow`.

## Success Criteria
- [x] Rail hiện ảnh ngay khi upload bắt đầu (Blob local), không đợi upload xong.
- [x] Xoá/Hoàn tác phản ánh ngay ở rail và ở số ảnh của Bước 1.
- [x] Resume upload (tab đóng giữa chừng) sau khi xoá ảnh vẫn khớp bộ file (hàng skip vẫn tồn tại).

## Lệch so với plan khi làm (sau code review)
- Hook dữ liệu tách `use-source-images.ts` (thay `SourcePreview`): `useSourceImages` + `useSetSourceSkip`.
- Sau khi xoá/khôi phục **không** lấy lại danh sách ảnh (mỗi lần lấy = URL ký mới → tải lại mọi ảnh đang hiện); ghi
  `skip` server trả về vào cache; bấm liên tiếp cùng ảnh chỉ ghi kết quả lần cuối; lỗi hoàn lại đúng ảnh đó + toast.
- `upload-manager`: store có `files` (trạng thái từng file, giữ nguyên object khi chỉ có tiến độ → rail không vẽ lại
  mỗi tick) + `uploadedIds()` (cả dấu tab cũ). `primaryAction` thêm `pendingFiles`: upload lỗi/dở nhưng đã xoá hết ảnh
  thiếu → Bước 1 được (không kẹt ở "Tải ảnh").
- Nhãn rail: "Chờ tải" / "Đang tải" / "Tải lỗi" / "Chưa tải" (ảnh tab cũ chưa lên storage); đầu rail "n ảnh · đã bỏ m".
  "Ảnh n" = vị trí trong rail (ord có thể thủng sau commit loại file hỏng).
- Chế độ ảnh gốc chỉ bật khi đã có tiến độ (tránh chương có page chớp sang rail ảnh gốc lúc chi tiết về trước).
- `.icon-btn` chuyển từ `features/home/home.css` sang `styles/tokens.css` (dùng chung 3 màn).
- Khôi phục ảnh chỉ đóng thông báo "Đã xoá ảnh…" (Notice `key`), không đóng lỗi khác.
- Kết quả: web 157/157, api 165/165, typecheck + lint sạch, e2e 24/24; ảnh chụp kiểm bố cục rail 1440×900.

## Risk Assessment
- Ảnh rất cao (webtoon 800×12000): fit cả chiều cao sẽ quá nhỏ → đã chốt fit ngang + cuộn dọc; e2e kiểm ảnh cao không
  tràn ngang.
- Optimistic lệch với server khi 2 người cùng sửa: refetch `chapterKeys.sourceFiles` sau mutation.
