---
phase: 3
title: "Phase 3: Queue waiting labels web"
status: pending
priority: P1
effort: "2h"
dependencies: [2]
---

# Phase 3: Queue waiting labels web

## Overview

Dùng `queue` / `queue_state` từ Phase 2 để chip chương và thẻ chương nói rõ "đang chờ lượt".

## Requirements

- Chip (màn chương, `status.ts` `chapterChip` cho `ingesting` | `processing`):
  - `waiting`: `Đang chờ lượt` + (`· N chương đang chạy` nếu N > 0) + (`· X/Y trang` nếu đã có trang xong — chương có
    thể bị chờ giữa chừng khi worker rảnh chuyển sang chương chưa có job chạy). Tone `idle`.
    Title: `Mỗi worker làm một chương một lúc. Chương này tự bắt đầu khi có worker rảnh — không cần bấm gì.`
  - `no_worker`: `Đang chờ worker`, tone `warn`. Title: `Chưa thấy worker nào chạy. Lần đầu worker tải model mất vài phút; xem: docker compose logs -f worker`.
  - `chapterProgress` trả `undefined` khi chờ (không vẽ thanh chạy qua lại gây hiểu nhầm đang làm).
- Thẻ chương grid series/home (`next-action.ts` nhánh `processing`/`ingesting`): `row.queue_state` → state
  `Đang chờ lượt` (tone idle) / `Đang chờ worker` (tone warn); không có → giữ như cũ.
- Thumbnail trang: không đổi (đã có "Chờ xoá chữ").

## Related Code Files

- Modify: `apps/web/src/features/chapter/api.ts` (type `Progress.chapter.queue`)
- Modify: `apps/web/src/features/series/api.ts` (type `ChapterRow.queue_state`)
- Modify: `apps/web/src/features/chapter/status.ts` (`ChipInput.queue`, `chapterChip`, `chapterProgress`)
- Modify: `apps/web/src/features/chapter/chapter-workspace.tsx` (truyền `queue` vào chip input; title chip)
- Modify: `apps/web/src/features/chapter/next-action.ts`
- Modify tests: `status.test.ts`, `next-action.test.ts`

## Implementation Steps

1. Thêm type (optional field — server cũ không gửi vẫn chạy).
2. `chapterChip`: kiểm `queue` trước `processingView`; tái dùng đếm của `processingView` cho phần `X/Y trang`.
3. Chip title: tận dụng cơ chế title thêm ở Phase 1.
4. `nextAction`: nhánh bận đọc `queue_state`.
5. Test thuần: waiting có/không running_chapters, waiting giữa chừng, no_worker, null → nhãn cũ; progress undefined khi chờ.

## Success Criteria

- [x] Chương chờ không còn giống chương đang chạy ở cả chip lẫn thẻ grid
- [x] Test thuần xanh

## Risk Assessment

- Polling grid series chỉ chạy khi có chương bận (`series-page.tsx` refetchInterval) — chương chờ vẫn là bận nên vẫn poll; kiểm lại.
