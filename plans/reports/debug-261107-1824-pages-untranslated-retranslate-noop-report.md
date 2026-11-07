# Debug: trang dịch sót, "Dịch lại" không có tác dụng

Ngày: 2026-11-07 · Dữ liệu: DB dev local (mtl-dev-postgres-1), 151 trang, 825 item OCR, OCR engine = `llm` cho cả 151 job prepare.

## Kết luận

**Nguyên nhân chính: OCR LLM gắn nhầm `is_sfx = true`, không phải detector.**

Vùng có `is_sfx`:
1. `restore_sfx` trả pixel gốc → chữ gốc **không bị xoá** (`worker/mtl_pipeline/pipeline.py:199`, `worker/mtl_worker/handlers.py:135`).
2. Bị loại khỏi dịch: `apps/api/src/jobs/claim-inputs.ts:119`, `worker/mtl_worker/handlers.py:270`, `regionCount` ở `translate-chain.ts:46`.
3. Không có text box → không có khối để chọn "Dịch lại khối".

→ Người dùng thấy chữ gốc nằm nguyên = "dịch sót".

**Vì sao "Dịch lại" không hoạt động:** `retranslate` → `startTranslateRun` (`translate-chain.ts:294`) chỉ chạy lại `chapter.translate` trên `pages.ocr_result` cũ. Không chạy lại detect/OCR → `is_sfx` vẫn true → kết quả y hệt. Cũng đúng với mọi lỗi giai đoạn 1 (detector bỏ sót bóng, OCR đọc sai): hiện **không có đường nào trong UI để quét lại 1 trang**. Riêng "Chạy lại trang lỗi" chỉ prepare lại trang `failed` / input_rev lệch.

Phụ: trang đã sửa tay (`state_origin='user'`) → dịch lại chỉ ghi `ai_state` + `ai_update_available` (`page-state-writer.ts:36`), dễ bị tưởng là không chạy.

## Bằng chứng

| lang | kind | sfx / tổng |
|---|---|---|
| ko | text_bubble (trong bóng) | 68 / 276 |
| ko | text_free | 115 / 167 |
| en | text_bubble | 15 / 260 |
| en | text_free | 34 / 122 |

Tiếng Hàn: 41% vùng bị coi là SFX. Mẫu bị gắn SFX nằm trong bóng thoại: `MY CHANCE.`, `웅?`, `하하`, `Ugh...`, `까이이이이...`; text_free bị gắn SFX gồm cả tên người `박진`, `피오르`, câu `으악...`.

Prompt (`worker/mtl_pipeline/prompts/ocr_page.md:8`) để LLM tự phán SFX, không có ràng buộc vùng trong bóng; LLM chỉ thấy crop, không biết vùng nằm trong bóng.

Khác: 65 item `empty` (ink < 0.004) không được gửi OCR; 0 item low_conf rỗng; 1 job translate lỗi `schema`. Không thấy dấu hiệu detector là thủ phạm trong data này (chưa kiểm ảnh).

## Đã sửa (2026-11-07)

- Worker `ocr.py`: `in_bubble` → gỡ `is_sfx` cho vùng trong bóng sau OCR LLM. Prompt OCR siết định nghĩa SFX.
- API `POST /chapters/:id/rescan` (`rescanPages`): prepare lại + lượt dịch; 409 `page_has_manual_cleanup` khi `clean_rev ≠ mask_rev`.
- `terminal` page.prepare: trang đã có OCR → giữ `ready`/`prepared`, bỏ khỏi lượt (trước: `failed`).
- Web: menu trang "Quét lại trang n".
- Test: worker 82 pass; API 438 pass (3 test rescan mới); web 139 pass; tsc + biome + ruff sạch. Chưa chạy OCR thật end-to-end.

## Hướng sửa ban đầu

1. **Vùng trong bóng (`kind=text_bubble` hoặc có `bubble_id`) bỏ qua `is_sfx`**: vẫn xoá chữ + dịch. Sửa ở `restore_sfx` + 3 chỗ lọc. Rủi ro thấp.
2. Siết prompt OCR: chỉ đánh SFX với chữ vẽ tay đè lên art; tên riêng / câu có dấu câu thoại → false.
3. Thêm "Quét lại trang" (prepare lại detect + OCR rồi dịch) để người dùng tự cứu trang khi giai đoạn 1 sai. Trang cũ đã prepare cần cái này mới sửa được (clean đã giữ chữ gốc).
4. Cho phép chọn vùng SFX trong editor để "Dịch lại khối" (`page.ocr_region` vốn bỏ qua `is_sfx`).

## Câu hỏi mở

- Có dịch SFX không (vd tiếng rên/tượng thanh trong bóng của truyện người lớn)? Quyết định sản phẩm.
- Cần chương / trang cụ thể người dùng báo để loại trừ detector bỏ sót bóng.
