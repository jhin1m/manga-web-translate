# Debug: bóng thoại bị bỏ sót (báo từ người dùng Windows)

Ngày: 2026-11-11 · Chương thử: Prince Seal Rebellion Log Ch.3 (Anh → Indonesia), trang 7, 13 và các trang 1, 5, 14, 15, 18

## Kết luận

- **Không phải do Windows hay Mac.** Hai máy đang dùng **engine OCR khác nhau**: Mac đọc bằng PaddleOCR chạy local (mặc định cho tiếng Anh), Windows đọc bằng **LLM** (Cài đặt › Pipeline đặt OCR = AI).
- **Khối bị bỏ sót thật (7·1 `"THAT GUY"?! HOW INSOLENT...!`)** là lỗi ở bước OCR bằng LLM, không phải bước dịch: câu mở đầu bằng dấu nháy kép ASCII `"`, model in ra `"` đầu tiên và với structured output thì ký tự đó đóng luôn chuỗi JSON → `source=""`.
- Code tiếp theo coi `source=""` là "vùng không có chữ" (`keep_regions_without_text` → `is_sfx=True`), nên khối đó **không được dịch**.
- Các khối "—" còn lại (1·5, 1·7, 5·3–5·7, 14·4, 15·1, 18·1, 18·3) **không phải thoại**: SFX tiếng Hàn vẽ tay, logo tên truyện, màn hình app ngân hàng, chấm trang trí, logo nhóm dịch. LLM trả `empty` là đúng.

## Bằng chứng

| Kiểm tra | Kết quả |
|---|---|
| Bảng ký tự `ppocrv6-rec-small` (Paddle cho en) | 0 ký tự Hangul → không thể ra "히!" như bên Windows |
| Model Paddle tiếng Hàn trên cùng vùng | 7·3 ra "헉!", 7·5 ra "THE DONGHAE KINGDOM?!" (Windows ra "...?!") → loại trừ |
| Image worker `0.1.0` linux/amd64 (Rosetta), detect + Paddle | Giống hệt Mac: 8 vùng, 7·1 đọc được với độ tin 0.99 → loại trừ nguyên nhân do nền tảng |
| OCR bằng LLM (claude-haiku-5-5) trên trang 1/5/14/15/18 | Danh sách khối rỗng trùng khớp danh sách Windows |
| LLM trên trang 7, lặp lại nhiều lần | 7·1 rỗng ở 2/2, 3/6 và 5/8 lần chạy; luôn có `empty=false` (tự mâu thuẫn); 7·3 ra chữ Hàn "헉!/허!" |
| A/B: xoá 2 dấu nháy khỏi crop 7·1 | Rỗng 0/8 lần (có nháy: 5/8) |
| Thêm vào prompt: "chép ngoặc kép bằng “ ”, không dùng `"`" | Rỗng 0/10, ra `“THAT GUY”?! HOW INSOLENT...!` |

## Luồng lỗi (code hiện tại, v0.1.0)

1. `ocr.ocr_page`: LLM trả `{source:"", empty:false}`. Id vẫn đủ nên `validate_ids` cho qua và không gắn `low_conf`.
2. `keep_regions_without_text`: source không có chữ/số → `is_sfx=True`.
3. `restore_sfx` trả lại pixel gốc cho vùng này, bước dịch bỏ qua nó. Cờ của khối chỉ còn `sfx`, nên khối **bị ẩn khỏi bộ lọc "Chỉ khối cần xem"**. Kết quả là bỏ sót một cách âm thầm: bóng thoại vẫn giữ chữ tiếng Anh.
4. Ảnh chụp của người dùng Windows cho thấy bóng 7·1 đã bị xoá chữ và khối có cờ "!". Đó là hành vi trước commit `6f2a99a` (rc.2), nên **có thể máy Windows đang chạy bản rc.1**. Ở bản rc.1, vùng rỗng bị xoá chữ và gắn cờ `empty`.

## Đã sửa (2026-11-11)

- 3 prompt (`ocr_page`, `translate_batch`, `proofread_page`): quy tắc ngoặc kép “ ” đặt thành dòng riêng. Khi nằm lẫn giữa câu, model hay bỏ qua quy tắc.
- `ocr.py`: thêm `is_blank` + `reread_blank`. Item tự mâu thuẫn được gửi lại riêng crop đó một lần; vẫn trống hoặc lỗi thì gắn `low_conf`. Lỗi trong lần đọc lại không làm fail job.
- Test: 4 test mới + 3 test prompt trong `tests/test_llm_contract.py`. 3 test fail khi bỏ phần sửa. Toàn bộ 392 test pass, ruff sạch.
- Docs: thêm ghi chú OCR LLM vào `docs/job-queue-worker.md`.
- Kiểm thật với Haiku, trang 7: OCR rỗng 0/8 lần, trong đó 2 lần phải nhờ lượt đọc lại (10 call); bản dịch dùng “ ” 3/3 lần, không có khối trống.

## Đề xuất sửa (bản gốc)

1. `worker/mtl_pipeline/prompts/ocr_page.md`: thêm quy tắc chép ngoặc kép bằng “ ”. Đã thử: 0/10 lần rỗng.
2. `worker/mtl_pipeline/ocr.py` (phòng thủ thêm một lớp): item có `empty=false` mà `source` rỗng là kết quả tự mâu thuẫn. Gửi lại riêng các id đó một lần; nếu vẫn rỗng thì gắn `low_conf=True`, để khối hiện cờ "!" thay vì bị ẩn như SFX.
3. Áp cùng quy tắc ngoặc kép cho `translate_batch.md` và `proofread_page.md`, vì cùng cơ chế structured output (bản dịch 7·1 cũng mở đầu bằng `"ORANG ITU"`). Rủi ro này **chưa tái hiện** ở bước dịch: dev DB có 1/1 câu mở đầu bằng nháy dịch đúng.
4. Thêm test: OCR có item `source=""` và `empty=false` → không bị chuyển thành SFX ẩn, phải có `low_conf`.

## Cách xử lý ngay cho người dùng Windows

- Đổi Cài đặt › Pipeline › OCR tiếng Anh về **PaddleOCR** (mặc định, không tốn token), hoặc dùng "OCR lại vùng" cho khối 7·1.
- Cập nhật lên `v0.1.0`.

## Câu hỏi còn mở

- Máy Windows đang chạy phiên bản nào (rc.1?) và slot OCR dùng model nào? Đã thử với Haiku; model khác có thể có tỉ lệ lỗi khác.
- 13·2 (`THOSE OF US OFFICIALLY APPOINTED...`) bị rỗng bên Windows, nhưng Haiku đọc đúng 6/6 lần trên các vùng do Mac detect. Có thể do model hoặc vùng detect bên Windows khác, cần dữ liệu của họ để xác nhận.
