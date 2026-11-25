# Smoke LLM thật: AI tự bổ sung trí nhớ series (phase 5, bước 2–3)

Kết luận: **BLOCKED, chưa chạy smoke.** Chưa có số đo nào. Cần người dùng cung cấp ảnh nguồn trước khi chạy.

## Lý do dừng

- Chương nguồn cũ "Prince Seal Rebellion Log" #3 (43 ảnh webp) không còn trong DB dev. Bản dump `pg_restore` của DB dev trước migration 0030 (sao lưu ngày 24/11) cũng chỉ có một series "roof" (en→vi, 1 chương).
- Trong MinIO bucket `mtl` không còn nhóm `src/` nào có 21, 22 hay 43 file. Toàn bộ nhóm có nhiều file là dữ liệu e2e (10 file mỗi chương). Ảnh nguồn smoke cũ đã bị dọn.
- Chương "roof" (`01a1f2cf-4aba-7218-9c5e-1ba8fcc99c99`) chỉ có 1 ảnh strip 800×4000 px, nguồn là scanlation (có watermark nhóm dịch rõ ràng trong ảnh). Ảnh này quá ngắn để tách thành 2 chương có ý nghĩa cho trí nhớ series, và không so được với số nền 372,8 token/trang của smoke cũ.

## Trạng thái môi trường (đã kiểm, chưa thay đổi)

- API dev :8787 đã nạp code mới: `GET /api/series` trả trường `style_origin`.
- Migration 0030 đã áp (cột `style_origin`, `pronoun_rules`, `style_prompt` tồn tại).
- DB không có job `queued` hoặc `running` (toàn bộ `jobs` là `succeeded`).
- Worker dev đang chạy là PID 44169 (python) dưới uv PID 44018, khởi động 13/11 từ `scripts/dev-all.sh` (PID 44017), tức chưa có worker 0.13.0. `MTL_PROVIDER=anthropic`. Chưa restart worker vì smoke chưa chạy.
- Chưa tạo series smoke, chưa upload gì, chưa xoá gì. Series "roof" của người dùng không bị đụng tới.

## Việc cần người dùng quyết định

1. Cung cấp 2 chương ảnh nguồn (tiếng Anh, khoảng 40 trang tổng, cùng một câu chuyện, tuần tự), hoặc cho phép dùng bộ khác.
2. Chấp nhận số nền mới thay cho số nền 372,8 của smoke cũ, vì đổi nguồn làm so sánh token không còn cùng điều kiện (số nền chỉ ghi nhận, không làm ngưỡng).
3. Xác nhận restart worker dev sang 0.13.0 sau khi smoke xong (worker mới sẽ là worker dev của người dùng).

## Ngưỡng cần đo khi chạy (chưa có kết quả)

- Số lô lỗi `schema`: ngưỡng cứng 0.
- Token vào và ra mỗi lô, chương 2 so chương 1, so số nền.
- Số entry/cặp AI ghi sau chương 1, số sai (tên sai, từ thường, watermark/nhóm scan). Ngưỡng cứng: không có watermark trong glossary.
- Chương 2 dùng đúng các tên đó.
- Giọng văn AI: điền ở lô đầu, một dòng mô tả, ≤ 150 ký tự, `settings_rev` không đổi.

Ảnh "roof" có watermark DesireScans và link Discord trong strip. Đây là ca thực tế cho kiểm tra watermark, nhưng không đủ để làm smoke đầy đủ.

Status: BLOCKED
Summary: Chưa chạy smoke vì ảnh nguồn smoke cũ đã bị xoá khỏi DB và MinIO; chương "roof" hiện có chỉ là một strip 800×4000 px có watermark. Cần người dùng cung cấp ảnh nguồn (2 chương, en) hoặc xác nhận dùng bộ thay thế.
