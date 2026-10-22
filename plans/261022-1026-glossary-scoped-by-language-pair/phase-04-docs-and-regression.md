---
phase: 4
title: "Phase 4: Docs + hồi quy"
status: done
priority: P2
effort: "1h"
dependencies: [3]
---

# Phase 4: Docs + hồi quy

## Overview
Cập nhật docs theo contract mới, chạy toàn bộ suite, đóng M3 ở plan trước.

## Requirements
- Docs chỉ ghi hành vi thật sau khi code xong (đọc lại file trước khi sửa).

## Related Code Files
- Modify: `docs/export-and-batch-edit.md` — mục "Glossary": entry chung theo cặp (API đảm bảo, không CHECK DB), unique
  mới (migration 0006), query `source_lang`/`target_lang` bắt buộc ở route workspace, CSV theo cặp đang chọn, entry
  series không gắn cặp + cảnh báo ở form, entry chung cặp NULL (từ rollback app) bị bỏ qua; bảng `glossary-apply`:
  "series đè workspace **cùng cặp**".
- Modify: `docs/development-setup.md` — route `/w/$ws/glossary[?src=&tgt=]`.
- Modify: `docs/job-queue-worker.md` chỉ nếu có đoạn mô tả glossary trong snapshot `settings` (grep trước).
- `docs/deployment-guide.md` — không đổi: 0006 vẫn chỉ thêm, giữ đúng câu "rollback app không cần down DB".
- Modify: `plans/261022-0918-series-language-and-page-format/plan.md` — dòng "Còn mở: … (M3)" → trỏ plan này.

## Implementation Steps
1. Sửa docs như trên; ghi rủi ro backfill (entry chung tạo sau 0.4.0 bị gán ko→vi) và tab SPA cũ cần tải lại.
2. Chạy: `pnpm --filter @mtl/db test`, `pnpm --filter @mtl/api test`, `pnpm --filter @mtl/web test`,
   `pnpm --filter @mtl/web e2e`, `pnpm typecheck`, `pnpm lint`. Worker không đổi — không bắt buộc pytest.
3. Smoke tay: series ko→vi cũ dịch 1 chương → `settings.glossary` trong payload `chapter.translate` giống trước.

## Success Criteria
- [x] Mọi lệnh ở bước 2 xanh, báo kết quả thật (không ẩn lỗi).
- [x] Docs khớp code; link nội bộ còn đúng.

## Risk Assessment
- Deploy: `infra/deploy.sh` bình thường (migrate → đổi symlink → restart). Worker không cần nâng version.
