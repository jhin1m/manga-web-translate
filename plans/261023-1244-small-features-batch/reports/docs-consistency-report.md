# Docs consistency report — small-features-batch

## Đã sửa
- `README.md`: bỏ mục "Ẩn/khôi phục trang sau khi đã xuất chưa đánh dấu cần xuất lại" (đã làm, migration 0011); thêm `0011_pages_skip_changed_at` vào danh sách migration deploy; trỏ tới checklist và yêu cầu dựng `re2`.
- `docs/deployment-guide.md`: thêm checklist release (mục 4): worker 0.5.1 trước, `re2`, SMTP, `MIN_PIPELINE_VERSION`, migration 0011+0012, smoke tay, rollback (không hạ worker < 0.5.0).
- `docs/job-queue-worker.md`: "web chỉ dùng RegExp gốc ở bảng văn bản" -> thêm form nhập (khớp `ignore-text.ts`).

## Đã đối chiếu với code (đúng)
- `MIN_PIPELINE_VERSION` mặc định 0.5.1, `PIPELINE_VERSION` API 0.4.0, worker `PIPELINE_VERSION` 0.5.1 (`env.ts`, `mtl_worker/__init__.py`).
- Migration 0009-0012 tồn tại (`0011_pages_skip_changed_at`, `0012_workspace_fonts`); `re2` trong `allowBuilds` và `apps/api/package.json`; Node >= 24.
- `SMTP_URL`/`MAIL_FROM` (bắt buộc cặp), `mail_enabled`/`mail_sent`, link chỉ log khi không gửi được mail (`auth.ts`).
- Route `PUT .../source-files/order`, `source_set_mismatch`, `chapter_not_draft`; `ignore-apply` preview/apply/undo, `locked|busy|changed`, 410 `batch_not_found`.
- Font: 10MB, 20 font, TTL URL 10', cache `~/.cache/mtl-worker/fonts` + `MTL_FONT_CACHE_DIR`; `/w/$ws/settings` có tab Font.
- Guard regex (lồng lượng từ, tối đa 5 lượng từ, thiếu tham chiếu ngược/lookaround) áp mọi nơi — docs mô tả đúng; không còn mô tả "chỉ trình duyệt".
- `FONT_IDS` không còn trong docs/README (chỉ còn trong code/test, ngoài phạm vi).

## Không kiểm / lưu ý
- Không chạy test, không build `re2`; binary prebuilt cho Node 24 dựa vào ghi chú phase agent, chưa xác minh.
- Mục "Kết quả kiểm local" (4 migration) là số liệu lịch sử 20/10, giữ nguyên.
- Tất cả file docs < 800 dòng.

Status: DONE
Summary: Docs khớp code; sửa README (việc còn lại, migration 0011), thêm checklist release vào deployment-guide, chỉnh một câu về RegExp ở form.
Concerns/Blockers: Chưa xác minh prebuilt `re2` cho Node 24 trên VPS thật; SMTP thật chưa thử (đã nêu trong README).
