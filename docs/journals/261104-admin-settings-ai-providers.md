# Admin settings và AI providers: 7 phase trong một ngày, review bắt được gì

**Date**: 2026-11-04
**Severity**: Medium
**Component**: API admin, AI provider/slot, worker (pipeline 0.10.0), hạn mức, user, font hệ thống
**Status**: Code xong, chưa commit (176 file staged trên `1aec051`); còn smoke key thật

## Đã làm được gì

Branch `feat/admin-settings-ai-providers`, 7 phase, migration 0021–0025:

1. Admin qua `ADMIN_EMAILS` (chuẩn hoá trim/lowercase), hook sign-up chặn email admin.
2. Key AI mã hoá AES-GCM (byte version, AAD `ai_provider:<id>`) + 3 slot là 3 cột FK RESTRICT.
3. `OpenAIProvider` cho OpenAI và compatible (OpenRouter...), mô hình env.
4. Cấu hình LLM theo từng job qua claim, pipeline 0.10.0, breaker theo provider.
5. Hạn mức và đăng ký đổi được lúc chạy (DB `??` env), có xác nhận khi hạ dưới số đã chi.
6. Danh sách user, chi phí, khoá/mở user (`disabled_at`).
7. Font hệ thống (`custom-<8hex>`, worker không phải đổi).

Gate cuối: api 431, web 371, shared 60, db 8, worker 351, e2e 55/55, migration up/down/up sạch.

## Sự thật khó chịu

Điểm review 8–8.5/10 nghe êm tai, nhưng gần như mọi lỗi đáng tiền đều là loại "code đúng, vận hành sai": doc, alert, runbook. Test xanh không bắt được cái nào.

## Lỗi review bắt được

- **Log SDK lọt qua**: `log_redact.py` ghim `httpx`/`httpcore`, nhưng `anthropic`/`openai` bản cài thật dùng `httpx2`/`httpcore2`, mức INFO. Mỗi call LLM in `HTTP Request: POST <url>`. Test `test_verbose_keeps_sdk_and_http_loggers_at_warning` lặp qua chính `QUIET_LOGGERS` nên không thể phát hiện tên thiếu.
- **Sửa provider nhiều bước không retry được**: `saveEdit` fail giữa chừng, bấm lại luôn `duplicate_model` vì model đã tạo ở lần trước.
- **Rollback doc tự mâu thuẫn**: `deployment-guide.md:235` hứa job có `payload.llm` sẽ chạy bằng key env, trong khi `handlers.py:83-85` cố ý `JobFailure("auth")`. Hành vi worker đúng, doc sai. Giữa sự cố, người đọc sẽ bị dắt sai.
- **Job của user bị khoá làm báo động giả (High duy nhất)**: `oldestQueuedAgeS` trong `health.ts` không loại job của user bị khoá. Sau 900s, `alert.sh` bắn ntfy `high` mỗi giờ. Alert này cũng là tín hiệu duy nhất cho worker chết thật, nên nó thành nhiễu.
- **`Scoped.selectShared` quá rộng**: `T extends PgTable & { userId?: never }` nhận cả `user`, `verification`, `aiProviders`, `workerTokens`. Ranh giới tenant isolation thành đọc thô có kiểu.
- **Bẫy runbook DB thắng env**: kill-switch ngưỡng 0 và "nâng ngưỡng + restart" trong docs chỉ nói env, vô tác dụng khi DB đã có giá trị.
- **Phân loại lỗi OpenAI**: nếu khớp theo `*_limit_exceeded` thì `rate_limit_exceeded` (429 tạm thời) bị coi là hết quota/auth. Đã chốt khớp đúng hậu tố `_spend_limit_exceeded`/`_usage_limit_exceeded` + `insufficient_quota`, `credit_balance_exhausted`.

Red team trước khi code đã chặn trước: chiếm admin qua đăng ký email, đổi `base_url` giữ key cũ, và máy xoay master key thừa (bỏ, đổi key = nhập lại).

## Bài học

- Test tự tham chiếu (lặp qua chính danh sách cần kiểm) không bảo vệ gì. Phải assert tên logger thực từ gói đã cài.
- Mỗi lần đổi hành vi (fail-closed, DB thắng env, user bị khoá), grep mọi nơi mô tả hành vi cũ: runbook, `alert.sh`, `smoke.sh`, README. Tất cả lỗi doc ở trên đều do bước này bị bỏ.
- Mọi chỗ "bỏ qua user bị khoá" phải được dùng chung một predicate. Dispatcher có, health quên.
- Escape hatch của lớp cách ly tenant nên là whitelist bảng, không phải điều kiện "không có `userId`".
- Câu "không lộ key" phải kiểm bằng thử thật (reviewer đã thử zod issues, không chứa key), không bằng đọc.

## Còn lại

1. Smoke tay key thật (chưa ai chạy): probe OpenAI + compatible, `--provider openai`/OpenRouter dịch 1 chương, Gemini OCR 1 trang, đổi key giữa chừng, quét log worker `-v`. Header probe OpenAI/compatible chưa kiểm live.
2. Thêm `ADMIN_EMAILS` + `SECRETS_KEY` vào `.env` local.
3. Runbook SQL font dùng `custom-xxxxxxxx` chạy nguyên văn thì `UPDATE 0`. Đổi thành `<font_id>`.
4. Xem lại sửa đổi docs-manager đồng thời (`README.md`, `docs/development-setup.md`) trước khi commit; commit tách theo phase.
5. Câu hỏi chờ user: (a) DB `null` = theo env nên không đặt được "không giới hạn" đè env; (b) `GLOBAL_MONTHLY_USD` chỉ env; (c) audit log admin (đang bỏ theo YAGNI); (d) worker token lộ = lộ mọi key slot; (e) huỷ hẳn job queued khi khoá user; (f) env override khẩn cấp; (g) force-delete font hệ thống đang là mặc định.

Status: Resolved (code + review + gate); smoke key thật và 7 câu hỏi sản phẩm còn mở.
File: /Users/jhin1m/Desktop/ducanh-project/manga-web-translate/docs/journals/261104-admin-settings-ai-providers.md
