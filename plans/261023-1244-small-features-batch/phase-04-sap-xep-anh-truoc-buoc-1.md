---
phase: 4
title: "Sắp xếp tay thứ tự ảnh trước Bước 1"
status: completed
priority: P2
effort: "4h"
dependencies: []
---

# Phase 4: Sắp xếp tay thứ tự ảnh trước Bước 1

## Overview
Trong cột ảnh gốc (trước Bước 1), kéo-thả hoặc dùng menu để đổi thứ tự ảnh; Bước 1 ghép/cắt theo thứ tự mới.

## Hiện trạng
- Natural sort chỉ ở client (`apps/web/src/features/upload/natural-sort.ts`, `files.ts:82-90`,
  `upload-manager.ts:60-64`); server lưu `source_files.ord` = index lúc tạo chương (`chapters.ts:176-181`).
- Ingest đọc theo `ord` (`claim-inputs.ts:145-156` → `worker/mtl_worker/ingest.py`). Đổi `ord` là đủ, worker không đổi.
- Ingest chỉ chạy khi bấm Bước 1 (`chapter-workspace.tsx:397`) → có thời gian sắp xếp.
- Chỉ có `PATCH .../source-files/:fileId {skip}`; guard `assertSourcesEditable` (`chapters.ts:241-252`), web
  `sourcesEditable` (`chapter-workspace.tsx:483`).
- Không có thư viện drag-and-drop. Rail có menu chuột phải (`ContextMenu`, Shift+F10) + nút góc (vừa thêm).

## Requirements
- Functional:
  - Khi `editable`: kéo thumbnail thả vào vị trí mới (vạch chỉ vị trí thả); menu chuột phải thêm "Đưa lên đầu",
    "Lên 1", "Xuống 1", "Đưa xuống cuối"; phím Alt+↑/↓ trên thumbnail đang focus.
  - Ảnh đã bỏ (skip) vẫn sắp được (giữ chỗ trong thứ tự).
  - Số thứ tự hiển thị cập nhật ngay (optimistic); lỗi API → trả về thứ tự cũ + toast.
  - Toast "Đã đổi thứ tự · Hoàn tác" theo mẫu toast hoàn tác của xoá ảnh.
  - Không `editable` (đã Bước 1 / người khác giữ khoá) → không kéo được, không có mục menu.
- Non-functional: không thêm dependency (HTML5 DnD gốc); vẫn dùng được bằng bàn phím.

## Architecture
- API `PUT /w/:ws/chapters/:chapterId/source-files/order` body `{ ids: string[] }`:
  - Tx + `lockChapter` + `assertSourcesEditable` (cùng mẫu PATCH skip `chapters.ts:322-337`).
  - `ids` phải đúng bằng tập source file của chương (không thiếu, không thừa, không trùng) → không thì 400.
  - Ghi `ord = index` (một `UPDATE ... FROM (VALUES ...)` hoặc vòng lặp trong tx).
- Web: `setSourceOrder` trong `features/chapter/api.ts`; `useReorderSources` trong `use-source-images.ts` (optimistic,
  cùng mẫu `useSetSourceSkip`); helper thuần `moveItem(ids, from, to)` trong `source-rail-model.ts`.
- `source-rail.tsx`: `draggable` + `onDragStart/Over/Drop/End` trên thumbnail; menu + phím gọi `onMove(id, to)`.
- Item chưa có id server (đang tạo) → không kéo được (kiểm khi implement).

## Related Code Files
- Modify: `apps/api/src/routes/chapters.ts`, `apps/api/test/chapters.test.ts`, `apps/api/test/tenant-isolation.test.ts`,
  `apps/web/src/features/chapter/api.ts`, `use-source-images.ts`, `source-rail.tsx`, `source-rail-model.ts` (+ test),
  `chapter-workspace.tsx` (nối `onMove` + toast), `chapter-workspace.css` (vạch thả, trạng thái đang kéo)
- Docs: `docs/editor.md` mục "Ảnh gốc trước Bước 1"; README (gạch mục sắp xếp tay)
- E2E: `apps/web/e2e/` spec có sẵn cho source rail (hoặc thêm vào `chapter-tools.spec.ts`)

## Implementation Steps
1. API route + test (ok, tập sai 400, chương đã Bước 1 → mã lỗi như PATCH skip, khoá người khác 423, tenant isolation).
2. `moveItem` + unit test.
3. Hook optimistic + nối rail (menu, phím, DnD) + toast hoàn tác.
4. E2E: dùng menu "Xuống 1" → thứ tự đổi → reload vẫn giữ; Bước 1 với worker giả nhận thứ tự mới (nếu worker giả cho
   kiểm được thứ tự input).
5. Docs.

## Success Criteria
- [x] Test API + unit + e2e xanh.
- [ ] Kéo-thả mượt trên Chrome/Safari (Chrome qua e2e `dragTo`; Safari chưa kiểm tay); [x] bàn phím làm được hết thao tác (menu + Alt+↑/↓).
- [x] Bước 1 nhận thứ tự mới (test API: job ingest `sources` đúng thứ tự `ord`, bỏ qua ảnh skip); chưa kiểm bằng ảnh đánh số với worker thật.

## Risk Assessment
- HTML5 DnD trên Safari/touch kém → menu + phím luôn có. Trên mobile không hỗ trợ kéo (chấp nhận).
- Upload đang chạy song song với đổi thứ tự → chỉ đổi `ord`, không đụng trạng thái upload; kiểm `rejected` handling
  khi commit (`chapters.ts:272-289`) vẫn đúng.
