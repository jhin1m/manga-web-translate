---
phase: 1
title: "Phase 1: Retry wording"
status: pending
priority: P1
effort: "2h"
dependencies: []
---

# Phase 1: Retry wording

## Overview

Chỉ đổi chữ/tooltip phía web để nói rõ "Chạy lại" chỉ chạy trang lỗi. Hành vi API (`retry-failed`) giữ nguyên.

## Requirements

- Functional:
  - Nút chính chương `partial_failed` (đã là "Chạy lại N trang"): `title` = `Chỉ chạy lại N trang lỗi — trang đã xong giữ nguyên (dùng AI)`.
  - Mục menu ⋯ "Chạy lại trang lỗi" ở chương `prepared` có trang lỗi: cùng title.
  - Thông báo sau khi bấm: `Đang chạy lại N trang lỗi — các trang đã xong giữ nguyên.` (N = số trang lỗi, không phải
    số job). Không có job → giữ "Không có trang lỗi."
  - Chip đỏ "Lỗi N trang" có `title` tóm tắt nguyên nhân theo nhóm (dùng `failedPageGroups` / `jobErrorLabel` sẵn có
    trong `job-error.ts`), VD "2 trang: AI từ chối khoá API". Lỗi `auth` giữ gợi ý sửa khoá trước (`AUTH_HINT`).
  - `RETRY_HINT` bỏ "Chuột phải trang": `Bấm "Chạy lại N trang" ở góc trên phải (chỉ chạy trang lỗi), hoặc menu ⋯ của trang → "Dịch lại trang".`
    (kiểm lại tên mục thật trong `page-rail.tsx` trước khi ghi).
- Non-functional: không thêm nút/khối UI mới (memory: danh sách tối giản, không giấu sau chuột phải).

## Related Code Files

- Modify: `apps/web/src/features/chapter/primary-action.ts` (title nhánh `partial_failed` + menu `prepared`)
- Modify: `apps/web/src/features/chapter/chapter-workspace.tsx` (~dòng 526 thông báo `retry`)
- Modify: `apps/web/src/features/chapter/job-error.ts` (`RETRY_HINT`)
- Modify: `apps/web/src/features/chapter/chapter-topbar.tsx` (chip nhận `title` nếu chưa có) + nơi dựng chip trong `chapter-workspace.tsx`
- Modify tests: `primary-action.test.ts`, `job-error.test.ts` (nếu có assert chuỗi cũ)

## Implementation Steps

1. Grep chuỗi cũ ("Chạy lại các trang lỗi", "Đã xếp lại", "Chuột phải trang") trong `apps/web/src` + test.
2. Sửa title trong `primary-action.ts`; nhận số trang lỗi từ `input.failed` đã có.
3. Thông báo retry: lấy số trang lỗi từ progress hiện có (đếm `status === "failed"` không ẩn) thay `r.jobs.length`.
4. Chip title: tính chuỗi nguyên nhân từ `failedPageGroups(progress)` (rút gọn 1 dòng / nhóm), truyền qua topbar.
5. Cập nhật test chuỗi; chạy test đích.

## Success Criteria

- [x] Hover nút "Chạy lại N trang" thấy rõ chỉ chạy trang lỗi
- [x] Thông báo đếm theo trang
- [x] Hover chip lỗi thấy nguyên nhân
- [x] Không còn chuỗi "Chuột phải trang" trong gợi ý chạy lại

## Risk Assessment

- Thấp: chỉ chuỗi. Rủi ro duy nhất là test snapshot chuỗi → cập nhật cùng commit.
