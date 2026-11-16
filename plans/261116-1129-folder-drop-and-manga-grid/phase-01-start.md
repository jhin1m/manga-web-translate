---
phase: 1
title: "Phase 1: Folder drop + tên chương"
status: done
priority: P1
effort: "4h"
dependencies: []
---

# Phase 1: Folder drop + tên chương

## Overview
Thả folder (kéo-thả hoặc nút "Chọn folder") → mỗi folder lá chứa ảnh = 1 chương; số chương + tên chương lấy từ tên
folder. Áp cùng quy tắc tên chương cho ZIP. Tên chương sửa được trong popover số chương.

## Requirements
- Functional:
  - Kéo-thả folder vào dải thả, vào bất kỳ đâu trên trang (home + series), và vào thẻ chương "tải tiếp".
  - Folder chứa ảnh trực tiếp = 1 chương. Folder chứa folder con → mỗi folder con chứa ảnh = 1 chương. Ảnh nằm ngay
    trong folder cha cùng lúc có folder con → ảnh đó thành chương của folder cha (quy tắc "nhóm theo thư mục chứa trực
    tiếp").
  - ZIP nằm trong folder vẫn là 1 chương riêng như ZIP thả thẳng.
  - Thứ tự chương: sort tự nhiên theo đường dẫn đầy đủ; thứ tự trang: sort tự nhiên theo tên trong folder.
  - Bỏ rác (`isJunkEntry`: `.DS_Store`, `Thumbs.db`, file ẩn, `__MACOSX/`).
  - Series đoán như hiện nay, có thêm tên folder cha + tên folder chương vào danh sách tên đem khớp.
  - Tên chương (`chapters.title`) = `chapterTitleFrom(name, seriesTitle)`; rỗng thì UI chỉ hiện "Ch.N".
  - Nút "Chọn folder…" cạnh "Chọn file…" (`webkitdirectory`).
  - Popover số chương cho sửa tên chương.
- Non-functional: không đổi hợp đồng `onFiles(files: File[])` của các component thả (giảm phạm vi sửa); không chặn
  main thread khi duyệt folder lớn (readEntries async).

## Architecture
- **Đường dẫn tương đối không đổi kiểu `File[]`**: module mới `features/upload/dropped-paths.ts`:
  - `WeakMap<File, string>` lưu path cho file lấy qua `FileSystemEntry`.
  - `relPath(f) = map.get(f) ?? (f.webkitRelativePath || f.name)` — file từ `<input webkitdirectory>` có sẵn
    `webkitRelativePath`.
  - `filesFromDataTransfer(dt): Promise<File[]>`: **lấy hết entry đồng bộ trước mọi await**
    (`[...dt.items].map(i => i.webkitGetAsEntry())` — item hết hạn sau tick đầu), rồi duyệt đệ quy; `readEntries`
    gọi lặp tới khi trả mảng rỗng (Chrome trả theo lô ~100). Không hỗ trợ entry API → fallback `dt.files`.
- `drop-zone.tsx`: `useDropTarget`, `usePageDrop` gọi `filesFromDataTransfer` (async) thay `filesOf`. `usePageDrop`
  vẫn `preventDefault` đồng bộ trong handler drop rồi mới await.
- `drop-to-translate.ts`:
  - `Dropped` thêm `folders: { name: string; parent: string | null; path: string; pages: PageFile[] }[]`.
  - `readDropped`: file không ZIP có `relPath` chứa `/` → nhóm theo thư mục chứa trực tiếp; không có `/` → `loose`.
  - `dropGroups` trả thêm `name` (tên folder / tên ZIP không đuôi, null cho ảnh lẻ) → caller tính `title`.
  - `resolveDropSeries` nhận `fileNames` = tên file + tên folder chương + folder cha.
- `parse-chapter-filename.ts`: thêm `chapterTitleFrom(name, seriesTitle): string` (thuần):
  1. `stem` bỏ đuôi; bỏ cụm số chương khớp cuối (`PREFIXED`, rồi `SUFFIXED`; không bỏ số trần để tránh xoá số trong
     tiêu đề — trừ khi phần còn lại chỉ là số).
  2. Bỏ tên series ở đầu: ăn dần từng từ ở đầu chuỗi tới khi `normalizeName(prefix) === normalizeName(seriesTitle)`;
     không khớp thì giữ nguyên.
  3. Gộp chuỗi ký tự nối lặp ở giữa (` -  - ` → ` - `), trim ký tự nối `-_.:|·–—` và khoảng trắng hai đầu; chỉ còn
     số / rỗng → `""`; cắt 200 ký tự (khớp zod API).
- `upload-manager.startNewChapter` nhận `title` (API `ChapterCreate` đã có `title`).
- `new-chapter-confirm-row.tsx`: truyền `title` theo từng nhóm; không thêm ô nhập.
- API `ChapterPatch` (`apps/api/src/routes/chapters.ts`) thêm `title` (trim, max 200); refine thêm `title`; nhánh
  "không đổi gì" phải so cả title.
- `chapter-meta-popover.tsx`: ô "Tên chương" lưu cùng số chương.

## Related Code Files
- Create: `apps/web/src/features/upload/dropped-paths.ts`, `apps/web/src/features/upload/dropped-paths.test.ts`
- Modify: `apps/web/src/features/upload/drop-zone.tsx`, `apps/web/src/features/home/drop-to-translate.ts`,
  `apps/web/src/features/home/drop-to-translate.test.ts`, `apps/web/src/features/upload/parse-chapter-filename.ts`,
  `apps/web/src/features/upload/parse-chapter-filename.test.ts`, `apps/web/src/features/upload/upload-manager.ts`,
  `apps/web/src/features/upload/api.ts`, `apps/web/src/features/home/new-chapter-confirm-row.tsx`,
  `apps/web/src/features/chapter/chapter-meta-popover.tsx`, `apps/web/src/features/chapter/api.ts`,
  `apps/api/src/routes/chapters.ts` (+ test route chương)
- Delete: —

## Implementation Steps
1. `dropped-paths.ts`: WeakMap + `relPath` + `filesFromDataTransfer` (đệ quy, readEntries lặp, fallback). Test với
   fake `FileSystemDirectoryEntry` (lô 100 + 30, folder lồng, rác, file ở gốc).
2. `drop-zone.tsx` dùng `filesFromDataTransfer`; `FilePickButton` thêm prop `directory` → input
   `{...{ webkitdirectory: "" }}`; `DropZone` render thêm nút "Chọn folder…" (strip: link "chọn folder").
3. `readDropped` + `dropGroups` nhóm folder; `resolveDropSeries` nhận tên folder. Cập nhật test.
4. `chapterTitleFrom` + test: `Chapter 105 - The Return` → "The Return"; `Solo Leveling ch 105` (series "Solo
   Leveling") → ""; `Tên truyện - Chương 12.5 - Hồi kết` (series "Tên truyện") → "Hồi kết"; `[Nhóm X] Tên truyện ch 3`
   → "[Nhóm X] Tên truyện" (tên series không ở đầu → giữ nguyên, người dùng sửa — chấp nhận); `013` → ""; `105화` → "";
   ZIP `ch12.zip` → "".
5. `useDropToTranslate` + `startNewChapter` + confirm row truyền `title`.
6. API `ChapterPatch.title` + test; popover thêm ô tên chương.
7. Chạy `pnpm --filter @mtl/web test`, `pnpm --filter @mtl/api test` (cần `pnpm infra:up`), typecheck, lint.

## Success Criteria
- [ ] Thả folder 40 ảnh → 1 chương, trang đúng thứ tự tự nhiên.
- [ ] Thả folder chứa 3 folder con (`ch 9`, `ch 10`, `ch 11`) → 3 chương 9, 10, 11; mở chương đầu.
- [x] Folder > 100 file (nhiều lô `readEntries`) không mất file.
- [x] Thả folder rỗng → không tạo gì, báo "không có ảnh" (dòng xác nhận / lỗi hiện có).
- [ ] "Chọn folder…" hoạt động Chrome / Edge / Firefox.
- [x] Tên chương lưu + sửa được (API test + test thuần); test thuần cho `chapterTitleFrom` và nhóm folder.

## Risk Assessment
- Item `DataTransfer` hết hạn sau await → mất file: lấy entry đồng bộ đầu handler (test bằng fake).
- `webkitdirectory` không có trong type React: spread object; Safari iOS không hỗ trợ — chấp nhận (nút vẫn mở chọn file).
- `chapterTitleFrom` đoán sai → tên rác: người dùng sửa được trong popover; hàm thận trọng (không khớp series thì giữ).
- Thả nhiều folder + ZIP cùng lúc: thứ tự = folder trước hay ZIP trước? Chốt: gộp mọi nhóm (ZIP, folder) rồi sort tự
  nhiên theo đường dẫn/tên; ảnh lẻ ở gốc là nhóm cuối như hiện nay.
- Rollback: revert commit phase; không có migration.
