# Code review: backend trí nhớ series (shared, db, worker, API)

Ngày 11/11/2026. Reviewer chỉ đọc, không sửa file và không đụng DB dev. Điểm **7/10**: 0 Critical, 1 High, 2 Medium, 7 Low.

## Lệnh đã chạy (đều xanh)

| Lệnh | Kết quả |
|---|---|
| `pnpm --filter @mtl/api test` (DB test riêng `mtl_test_api_<tag>`) | 557 pass, 1 skip |
| `cd worker && uv run pytest -q` | 414 pass |
| `uv run ruff check` | sạch |
| `@mtl/shared test` | 83 pass |
| `@mtl/db test` | 8 pass |
| `pnpm typecheck`, `pnpm lint` | sạch |

So snapshot drizzle 0025 với 0026: chỉ có 1 bảng mới và 1 cột mới.

## High

**H1. Gợi ý đã Nhận vẫn bị tính vào trần 200 mãi mãi.**
- Vị trí: `apps/api/src/lib/series-memory.ts`, hàm `pendingCount`.
- Nguyên nhân: `pendingCount` đếm mọi dòng có `dismissed_at is null`. Nhận một gợi ý không đặt `dismissed_at`, mà khi đọc thì dòng đó bị ẩn vì đã có trong glossary.
- Hậu quả: series dài có thể đầy trần. Từ đó không gợi ý mới nào được lưu, không có lỗi nào hiện ra, và người dùng không Bỏ được vì các dòng chiếm chỗ đang bị ẩn.
- Sửa: chỉ đếm những dòng pending chưa bị phủ. Thêm test: Nhận một gợi ý thì phải giải phóng được một chỗ.

## Medium

**M1. Trí nhớ ghi sau mỗi lô, nên lượt dịch cả chương bị huỷ hoặc dừng vì hết quota sẽ thay trí nhớ đủ bằng trí nhớ dở dang.**
- Vị trí: `rememberTranslate`, được gọi ở `jobs/queue.ts` sau mỗi lô.
- Hậu quả: chương sau thừa hưởng trí nhớ nghèo, trái với ý đồ của quyết định "chỉ ghi từ lượt dịch cả chương".

**M2. Luồng manhwa mặc định (ingest `prepared` rồi `translatePrepared`) không bao giờ ghi trí nhớ nếu có một trang hỏng ở bước 1.**
- Nguyên nhân: `runTotal` bằng số trang hiện trừ 1, nên lượt bị coi là lượt một phần.
- Không nhất quán với luồng ingest `translated`, nơi `runTotal` tính cả trang hỏng.
- Toàn bộ test hiện tại chỉ dùng ingest `translated`.

## Low

- **L1. Deadlock khi 2 lần complete cùng series chèn cùng các khoá theo thứ tự ngược nhau.** Reviewer đã tái hiện được `40P01` trên DB test. Khi xảy ra, complete trả 500, worker không thử lại, và lô đã dịch bị mất. Sửa: sắp xếp các dòng theo (kind, key) trước khi chèn (mẫu ở `breaker.ts`).
- **L2.** Khoá đã tồn tại (đã Bỏ hoặc đang chờ) vẫn chiếm suất trong `slice(0, room)`, nên gần trần thì khoá mới thật sự bị gạt ra.
- **L3.** Report phase 2 viết sai rằng `page.ocr_region` không đi qua `translate_batch`. Thực tế có đi qua (`handlers.py` gọi `translate_chapter`), nên mỗi lần OCR vùng LLM trả thêm 2 mảng rồi bị bỏ đi. Không gây hỏng chức năng, chỉ tốn token.
- **L4.** `worker/mtl_worker/__init__.py` thiếu dòng lịch sử `# 0.11.0:` trong comment phiên bản.
- **L5.** `series-memory.test.ts` có một `db.update(seriesSuggestions)` không có WHERE, đụng dữ liệu của test khác trong DB test dùng chung.
- **L6.** Gợi ý không lưu cặp ngôn ngữ. Đổi ngôn ngữ đích thì gợi ý cũ vẫn hiện, và khoá đã Bỏ chặn luôn gợi ý cho cặp mới. Cần quyết định sản phẩm.
- **L7.** Bộ lọc `?` chỉ bắt ký tự ASCII, chưa bắt `？` full-width.
- **Có từ trước, không phải lỗi mới:** ký tự NUL trong chuỗi của AI làm hỏng việc ghi jsonb. Các field mới chỉ làm bề mặt lỗi này rộng thêm.

## Đã xác minh đạt

- Tiêu chí xong #1, #2, #4. Thứ tự khoá job → chapter → pages giữ nguyên. Không có `FOR UPDATE` trên `series`.
- `translateKey` không chứa carry. Payload không đổi. Hai key trong result là optional. json-schema đồng bộ với zod.
- `PIPELINE_VERSION` và `MIN_PIPELINE_VERSION` của API không đổi.
- Route chỉ dùng `sdb` đã khoá phạm vi, và có case trong `tenant-isolation`. `memoryCarry` lọc theo series và user.
- So số chương bằng `numeric` (có test 0.5 và 10 so với 5). Cắt UTF-16 giữ nguyên cặp surrogate.
- `casefold` ở worker và `toLowerCase` ở API lệch nhau nhưng không gây vi phạm unique, vì API tính lại khoá và dùng ON CONFLICT.
- Không có mã plan, phase hay quyết định trong code.

## Xử lý (lead quyết)

Xem `fix-review-findings-series-memory-report.md`.
