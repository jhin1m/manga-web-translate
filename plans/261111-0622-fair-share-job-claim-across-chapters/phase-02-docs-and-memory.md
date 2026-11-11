---
phase: 2
title: "Docs và memory"
status: completed
priority: P2
effort: "1h"
dependencies: [1]
---

# Phase 2: Docs và memory

## Overview

Thay mọi chỗ đang ghi "job lấy theo thứ tự tạo, chương sau chờ chương trước" bằng quy tắc mới, cập nhật memory, đóng plan.

## Requirements

- Viết theo hành vi người dùng thấy: 2 worker thì 2 chương chạy cùng lúc; chương thứ 3 chờ một chương hết trang chờ;
  1 worker thường vẫn lần lượt từng chương (đừng ghi tuyệt đối: sau khi worker khởi động lại có thể nhảy chương).
- Ghi cái giá: có từ 2 chương chờ thì chương tạo trước xong chậm hơn khoảng N lần với N worker (Modal: theo số
  container); tổng thời gian không đổi.
- Giữ dòng ghi "chưa chia lượt theo người dùng" cho bản nhiều người dùng.
- Số đo trong docs lấy từ report của phase 1, không ước lượng.

## Related Code Files

- Modify: `docs/job-queue-worker.md`
  - dòng 75: "Claim xếp `priority, created_at`" → thêm khoá "số job đang chạy của chương" và giải thích ngắn (đếm job
    `running` còn lease, mọi loại; chỉ xếp thứ tự, không chặn).
  - dòng 38-42 (Nhiều worker cùng lúc): thêm một câu "N worker → N chương cùng lúc".
  - dòng 83-85: giữ ý chưa chia lượt theo người; viết lại vế "(trước đây hàng loạt job 100 cũng chặn job tạo sau)"
    vì nay chỉ còn đúng trong cùng một chương. Thêm một câu: priority 10 cũng chia lượt theo chương.
- Modify: `docs/self-host.md` dòng 147-149 (mục Worker): bỏ "Job lấy theo thứ tự tạo… Chương sau bắt đầu khi chương
  trước hết trang chờ xoá chữ", thay bằng quy tắc mới + ghi chú `MTL_WORKERS=1`.
- Modify: `docs/project-roadmap.md` dòng 74 (Giới hạn đã biết): sửa thành giới hạn còn lại (số chương cùng lúc = số
  worker; 1 worker vẫn lần lượt; chưa chia theo người dùng).
- Modify: `apps/api/src/jobs/queue.ts` chú thích đầu file nếu phase 1 chưa sửa.
- Modify: `.claude/agent-memory/code-reviewer/selfhost-docker-release-probes.md` dòng 24 ("the claim is global FIFO").
- Modify: `~/.claude/projects/-Users-jhin1m-Desktop-ducanh-project-manga-web-translate/memory/selfhost-parallel-chapters-two-workers.md`
  và dòng tương ứng trong `MEMORY.md`.
- Modify: `plans/261111-0622-fair-share-job-claim-across-chapters/plan.md` (status).

## Implementation Steps

1. Grep lại để bắt chỗ sót, bỏ qua `docs/journals/` (nhật ký lịch sử, không sửa):
   `grep -rn -i "thứ tự tạo\|cũ nhất trước\|chương trước hết\|chương đến trước\|priority, created_at\|FIFO" docs README.md docker-compose.yml infra worker apps .claude --include="*.md" --include="*.yml" --include="*.ts" --include="*.py"`
2. Đọc từng đoạn trước khi sửa, sửa 3 file docs theo danh sách trên và mọi chỗ grep ra thêm.
3. Memory: đổi description và nội dung thành "đã làm: claim chia lượt theo chương bằng số job đang chạy; N worker → N
   chương; 1 worker vẫn lần lượt; không xoay vòng tuyệt đối vì chương đầu sẽ xong muộn". Giữ ba điều phải giữ (thứ tự
   trang, priority, `SKIP LOCKED`). Thêm đường dẫn plan này.
4. Kiểm link và số dòng trong docs khớp code sau khi sửa.
5. Đánh dấu phase bằng `ak plan check`, đặt `status: completed` trong `plan.md`, điền mục kết quả (số đo, test đã sửa).
6. Commit theo conventional commit, không ghi mã plan hay số phase. Ví dụ: `feat(api): share claim turns between chapters with queued jobs`,
   `docs: describe per-chapter claim sharing`.

## Success Criteria

- [x] Grep ở bước 1 không còn chỗ nào mô tả hành vi FIFO cũ ngoài `docs/journals/`.
- [x] Ba file docs mô tả đúng quy tắc mới và trường hợp 1 worker.
- [x] Memory file và `MEMORY.md` đã cập nhật.
- [x] `plan.md` có `status: completed`, hai phase đã check.

## Risk Assessment

Docs ghi quá lời ("mọi chương chạy cùng lúc") sẽ gây báo lỗi sai. Luôn ghi kèm điều kiện số worker.
