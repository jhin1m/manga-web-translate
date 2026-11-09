# Brainstorm: self-host dễ cài, giữ dấu câu, dọn giao diện

Ngày: 2026-11-10. Trạng thái: user đã duyệt thiết kế, chuyển `/ak:plan`.

## Bối cảnh

Lần đầu chạy bản Docker trên máy Windows của bạn user (`0.1.0-rc.1`), gặp: 35 trang lỗi vì chưa gán model vào tác vụ; bóng chỉ có `...!` bị xoá trắng; nhiều chỗ cấu hình/nhãn khó hiểu. Ưu tiên sản phẩm: cơ bản dễ dùng, ổn định, ít chữ.

## Yêu cầu đã chốt

| # | Yêu cầu | Quyết định |
|---|---|---|
| 1 | Tự gán provider đầu tiên | Chỉ `MTL_LOCAL_MODE`; DB chưa có provider; chỉ điền ô trống |
| 1b | Điền model Anthropic | Form gợi ý `claude-haiku-5-5` (giá 0.1/0.5, vision), như gợi ý OpenAI/DeepSeek đang có |
| 1c | Model worker chưa chạy được | Chặn ở form + API với Anthropic: Sonnet 5.5, Opus 5.5, Fable, Mythos; báo rõ và gợi ý Haiku 5.5 |
| 1d | Lỗi thiếu cấu hình | Không còn báo "AI từ chối khoá API"; nói rõ tác vụ chưa chọn model, kèm link Model tác vụ |
| 1e | Docs cài đặt | `docs/self-host.md`: bước thêm provider, model khuyên dùng, Model tác vụ, OCR local/AI |
| 2 | Bóng chỉ dấu câu bị xoá trắng | Trả pixel gốc, không dịch; áp cho vùng không có chữ/số gồm OCR rỗng |
| 3 | Ngôn ngữ mặc định | Mọi loại truyện tạo mới: nguồn tiếng Anh; loại truyện chỉ còn quyết định định dạng trang |
| 4 | Thứ tự đọc | Nguồn `en` + `pages` → phải sang trái, như `ja` + `pages` |
| 5 | Font thoại mặc định | `KomikaText-Regular` (đủ 6 ngôn ngữ đích) |
| 6 | Ô chọn font | Giữ dropdown; tên dễ đọc; font khuyên dùng lên đầu; "Mặc định hệ thống" hiện tên font thật |
| 7 | Sửa ngôn ngữ trong editor | Đã có ở popover tên chương nhưng giấu; thêm chip `Hàn → Indonesia` mở đúng popover |
| 8 | Nút "Gốc" | Ẩn khi trang đang mở chưa có bản dịch |
| 9 | Hoạt động | Rút gọn và viết lại |
| 10 | "Áp kiểu cho khối thoại" | Đổi thành "Áp dụng cho mọi khối thoại" (theo loại khối) |
| 11 | Lưu cài đặt series | Lưu thành công thì đóng modal, bỏ câu "Đã lưu…"; lỗi thì giữ modal |

Không làm đợt này: sửa worker để chạy được Sonnet/Opus 5.5 (cần xử lý thinking và trần token riêng), toast trang series, picker font riêng, nhãn "SFX" riêng cho vùng dấu câu.

## Phương án đã cân nhắc

**Giữ dấu câu**

| Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|
| Trả pixel gốc | Đúng màu/kiểu; chạy cả khi OCR không đọc được; không tốn token; dùng lại `restore_sfx` | Không sửa như text box; trang cũ phải Quét lại trang | Chọn |
| Đặt text box chữ gốc | Sửa được; trang cũ chỉ cần Dịch lại | Không có text khi OCR rỗng; khác kiểu gốc; phải chuẩn hoá dấu CJK/chữ dọc | Loại |
| Kết hợp | Phủ hết | Hai đường xử lý phải test | Loại (YAGNI) |

**Phạm vi tự gán:** chỉ local mode, vì trên VPS đang chạy key env, thêm provider đầu tiên sẽ âm thầm chuyển job sang key DB.

## Thiết kế

### Phase 1: self-host dễ cài

- `apps/api/src/routes/admin-providers.ts` `POST /providers`: trong cùng transaction, nếu `env.MTL_LOCAL_MODE` và có model: `lockSystemSettings` trước, đếm provider trước khi insert; bằng 0 thì điền slot trống: `translate` = model đầu trong form, `ocr` + `proofread` = model đầu có vision (không có thì để trống); ghi bằng `saveSlots`. Map id theo `model_id` và thứ tự body, không tin thứ tự `returning`.
- Gợi ý model: `apps/web/src/features/admin/price-suggestions.ts` thêm danh sách Anthropic (`claude-haiku-5-5`, 0.1/0.5, vision), nối vào `suggestionsFor`; đối chiếu giá khi làm.
- Chặn model không chạy được: lý do là `worker/mtl_pipeline/providers/anthropic.py` luôn gửi `thinking: {type: "disabled"}`, API trả 400 với Sonnet 5.5, Opus 5.5, Fable, Mythos. Danh sách/prefix dùng chung ở `packages/shared/src/ai-providers.ts`; kiểm ở form (`provider-form-model.ts`) và API (`POST /providers`, `POST /providers/:id/models`); báo lỗi kèm gợi ý Haiku 5.5. Provider đã lưu trước đó không bị xoá.
- `packages/shared/src/series-lang.ts`: `COMIC_KIND_SETTINGS` đổi `source_lang` của cả 3 loại thành `en`, giữ `page_format`. `readingOrder`: `(src === "ja" || src === "en") && fmt === "pages"` → `rtl`.
- Font mặc định: `worker/mtl_pipeline/fonts.py` `DEFAULT_FONT`, `apps/api/src/jobs/enqueue.ts` `DEFAULT_DIALOGUE_FONT`, `manifest.defaults[0]` (kiểm tra nguồn sinh manifest / sync-fonts trước khi sửa).
- Sửa comment/nhãn `comic-kind-picker.tsx` cho đúng nghĩa mới.
- Docs `docs/self-host.md`: thêm provider (Anthropic, `claude-haiku-5-5`, tick Vision); tự gán ở lần đầu; đổi model ở Model tác vụ; OCR local là mặc định, chọn AI thì cần ô OCR; mục tiêu cài trên Windows chưa kiểm.

### Phase 2: giữ vùng không có chữ/số

- Quy tắc: `not any(ch.isalnum() for ch in source)` sau `strip` → vùng giữ nguyên ảnh gốc. Phủ `...!`, `?!`, `♥`, `empty`, source rỗng.
- Làm ở cuối `ocr_page` và `ocr_page_local` qua 1 helper: đặt `is_sfx=True` cho cả item và region. Luồng `restore_sfx` và 5 chỗ lọc dịch có sẵn lo phần còn lại.
- **Bắt buộc chạy sau** đoạn `ocr_page` xoá `is_sfx` của vùng trong bóng (`worker/mtl_pipeline/ocr.py`), nếu không mất tác dụng.
- Chỉ trả pixel thôi là sai: `...!` vẫn đi dịch và đặt chữ chồng lên hình gốc.
- `page.ocr_region` lọc theo `empty`/source, bỏ qua `is_sfx`: kiểm tra không đổi hành vi.
- Giữ `low_conf` để người dùng soát. Sửa comment "is_sfx luôn false" ở `local_ocr/__init__.py`.

### Phase 3: giao diện

- `series-settings-form.tsx`: `onSuccess` gọi `onClose`, bỏ state `saved`; lỗi giữ modal.
- `select-panel.tsx`: nút và trạng thái thành "Áp dụng cho mọi khối {kind}" / "Đang áp dụng…".
- `chapter-topbar.tsx` + `chapter-meta-popover.tsx`: chip `pairLabel` mở popover có sẵn.
- `more-menu.tsx` `OriginalToggle`: chỉ render khi trang đang mở đã có bản dịch. Phím `O`, `\` và Chia đôi giữ nguyên.
- `series-settings-form.tsx` `fontSelect`: nhãn dễ đọc suy từ id, font khuyên dùng lên đầu, option rỗng hiện tên font mặc định.
- `activity-drawer.tsx`: ẩn mục trống; 1 dòng tóm tắt chương; job gấp vào "Chi tiết"; đổi nhãn job kỹ thuật.
- Lỗi thiếu cấu hình: hằng tiền tố dùng chung như `QUOTA_EXCEEDED`, không thêm `error_class`; worker `main.py:70` và `handlers.py` dùng nó; `job-error.ts` hiện "Chưa chọn model cho tác vụ …" kèm nút mở Model tác vụ (`/settings?section=tasks`).

## Rủi ro

- Người dùng raw Hàn/Nhật/Trung phải đổi nguồn tay; series cũ không đổi.
- Series cũ chưa chọn font sẽ đổi sang KomikaText từ lần dịch sau.
- Nguồn `en` + `pages` hiện có sẽ đảo thứ tự từ lần prepare sau; comic phương Tây dạng trang bị ảnh hưởng.
- OCR đọc nhầm `...!` thành `...1` thì vẫn đi dịch.
- Vùng dấu câu hiện như SFX trong bảng chữ.
- Detector nhầm vào tranh và OCR rỗng: nay giữ tranh, đúng mong muốn.
- Trang đã xử lý cần Quét lại trang.

## Kiểm thử và tiêu chí xong

- API: local/không local; DB trống/đã có provider; có/không vision; slot đã gán không bị ghi đè; không có model.
- API + form: model Anthropic bị chặn trả lỗi rõ ở cả tạo provider và thêm model; `claude-haiku-5-5` và provider khác không bị chặn; gợi ý Anthropic điền đúng giá + vision.
- Shared: `readingOrder` cho các cặp `ja`/`en`/`ko` × định dạng; `COMIC_KIND_SETTINGS`.
- Worker: `...!` trong bóng; `……！`; OCR rỗng; câu có chữ không đổi; vùng cạnh bên không bị đè; không gửi đi dịch; cả OCR LLM lẫn local.
- Web: lưu thành công đóng modal, lỗi giữ modal; nút Gốc ẩn/hiện; chip mở popover; Hoạt động tóm tắt đúng, lỗi thiếu cấu hình có link.
- Cài mới Docker: thêm provider đầu tiên → dịch được ngay không vào Model tác vụ; bóng `...!` còn nguyên.
- Sau đợt này mới push `v0.1.0`.

## Câu hỏi chưa rõ (plan xử lý)

- Có cần bump `PIPELINE_VERSION` không: hợp đồng không đổi nhưng hành vi prepare đổi; xem ảnh hưởng tới `prepareInputRev` và trang đã prepare.
- `manifest.json` sinh tự động hay sửa tay.
- Cách xác định "trang đang mở đã có bản dịch" cho nút Gốc (state region có `translation` hay status trang).
- Danh sách font khuyên dùng lên đầu: đề xuất KomikaText, WildWords, MTOComic, AnimeAce, BeVietnamPro.
