# Brainstorm: progress từng trang, dịch theo dòng chảy, UX Xuất

Ngày: 2026-10-29 · Trạng thái: user đã duyệt hướng · Tiếp theo: lập plan

## Vấn đề (user nêu)
- Không biết app đang làm gì lúc cắt/ghép, xoá chữ, dịch.
- Phải chờ cả chương dịch xong mới sửa được trang 1; lỗi 1 trang kéo cả lô; muốn chọn trang để dịch.
- Hai bước "Bước 1 · Xoá chữ + OCR" / "Bước 2 · Dịch" khó hiểu.
- Drawer Xuất khó hiểu (ảnh chụp 29/10).

## Hiện trạng đã kiểm trong code
| Điểm | Bằng chứng |
|---|---|
| Heartbeat cố định 20s → % đứng rồi nhảy, UI poll 2–3s vô ích | `worker/mtl_worker/runner.py:28` `HEARTBEAT_S = 20.0` |
| Nhãn bước tiếng Anh lộ ra UI (`download`, `detect`, `upload`) | `activity-drawer.tsx:240`, `export-panel.tsx:234` |
| Ingest 1 job cả chương, 3 mốc %, mọi ảnh gốc cùng "Đang cắt trang X%" | `worker/mtl_worker/ingest.py`, `source-rail.tsx:79` |
| Prepare không báo bước inpaint (detect 5% → ocr 60%) | `worker/mtl_worker/handlers.py:97-99` |
| `chapter.translate` = 1 job cả chương, lô ≤ 4 trang/40 khối chạy tuần tự trong job; % kẹt 10% suốt phần gọi LLM; kết quả chỉ ghi khi cả job xong | `worker/mtl_pipeline/translate.py:19,151`, `handlers.py:245` |
| Đang dịch → không giữ khoá, editor chỉ xem; AI ghi `state` chỉ khi `state_origin='ai'` VÀ chương không khoá | `docs/editor.md` mục khoá, `apps/api/src/jobs/page-state-writer.ts:4` |
| Hai bước = quyết định user 22/10 (soát ảnh sạch trước khi tốn tiền dịch) | `plans/261022-1517-process-button-single-page-view/plan.md` |
| Xuất: mặc định `include_untranslated=false` → trang chưa dịch **bị bỏ khỏi file** không báo rõ; "slice", "ZIP PNG", ô chất lượng 1–100, "Huỷ" ≈ "Đóng", xuất xong phải bấm "Tải xuống" lần 2 | `export-panel.tsx`, `worker/mtl_worker/export.py:89,117`, `export-warnings.ts` |

## Quyết định (user chốt 29/10)
1. **Một nút "Dịch chương" chạy nối** (thay 2 bước). Menu ⋯ giữ "Chỉ xoá chữ + OCR (soát trước)" → dừng ở `prepared` như cũ, sau đó bấm Dịch. *Đảo quyết định 22/10 — user chủ động đổi.*
2. **Kiến trúc B: chuỗi job theo lô** (không A "ghi từng phần trong 1 job", không C "mỗi trang 1 job song song").
3. **Progress theo từng ảnh/trang**, nhãn tiếng Việt.
4. **Chọn trang để dịch, mức tối thiểu**: "Dịch trang này" + Shift/Ctrl-click thumbnail → "Dịch N trang".
5. **Xuất: 1 nút tải + tuỳ chọn thu gọn**, làm **phase riêng, đầu tiên** (chỉ web, độc lập).

## Phương án đã cân nhắc (dịch theo dòng chảy)
| | A. Ghi từng phần trong 1 job | **B. Chuỗi job theo lô** ✔ | C. 1 trang 1 job song song |
|---|---|---|---|
| Ngữ cảnh liền mạch | giữ | giữ (tuần tự) | mất (tên, xưng hô lệch) |
| Lỗi 1 lô | retry rắc rối (bỏ trang đã ghi) | cô lập, dùng sẵn retry/huỷ/error_class | cô lập |
| Nối với Bước 1 | khó | tự nhiên | tự nhiên |
| Chi phí | = | = | tăng |
| Đụng code | giao thức worker mới | chủ yếu server `enqueue.ts` | trung bình |
Giá của B: ~2s giữa các lô (worker claim lại ngay sau complete, backoff 2–30s chỉ khi rảnh).

## Thiết kế

### Phase 1 — UX Xuất (web)
- Thứ tự: cảnh báo (nếu có) → "Tuỳ chọn" thu gọn (dòng tóm tắt: "Ảnh .zip · 96 ảnh như lúc tải lên") → nút chính "⬇ Tải chương (.zip|.cbz)" → trạng thái tại nút "Đang xuất 40%…" → **xong tự tải** (fallback toast "Tải xuống" nếu trình duyệt chặn / drawer đã đóng) → "Lượt xuất trước (n)" thu gọn.
- Nhãn mới: "Ảnh trong .zip — để đăng web" / ".cbz — đọc bằng app đọc truyện"; chất lượng CBZ 3 mức Gốc (100, PNG) / Cao (90) / Nhẹ (75?) thay ô số; "Cách chia ảnh: Giống lúc tải lên (N ảnh) / Theo trang đã cắt (M ảnh)" có số thật; "Đưa cả trang chưa dịch vào (ảnh đã xoá chữ, chưa có bản dịch)".
- Cảnh báo nói hậu quả: "N khối chưa dịch → để trống chữ"; "N trang AI có bản mới → xuất bản đang hiện"; "N trang chưa dịch → **không có trong file**" (tắt cảnh báo này khi bật "Đưa cả trang chưa dịch vào"); "N khối tràn khung → chữ có thể bị cắt"; nút "Xem N chỗ này".
- Bỏ: mục "Phạm vi" chỉ đọc, câu "PNG luôn không mất dữ liệu", dòng "link 5 phút / giữ 7 ngày" (→ tooltip/ghi chú ở lượt xuất), nút "Huỷ" (đã có "Đóng").
- Không đổi API/worker. Cần số ảnh gốc còn dùng (đã có từ `source-files`) cho nhãn "N ảnh".

### Phase 2 — Progress (worker + api + web)
- `runner.py`: `report()` đổi stage → heartbeat ngay (throttle ≥ 2s), giữ nhịp 20s để gia hạn lease. Heartbeat thêm optional `done`, `total`.
- Ingest: "Đang tải ảnh i/n" → "Đang cắt trang i/n đoạn" → "Đang lưu trang i/n"; thumbnail ảnh gốc: đã tải / đang xử lý.
- Prepare: callback stage trong `prepare_image` → nhận diện → xoá chữ → OCR → lưu.
- DB: `jobs.progress_done`, `jobs.progress_total` (migration 0019); `jobView` trả thêm.
- Web: `stage-labels.ts` (1 bảng mã → nhãn VI, có test); dùng ở thumbnail, panel Chọn, drawer Hoạt động, export.

### Phase 3 — Chuỗi job dịch theo lô (api, worker tối thiểu)
- `chapters.run_target`: `prepared` | `translated` (đặt khi bấm "Dịch chương" / "Chỉ xoá chữ").
- `advanceTranslateChain(tx, chapterId)` dưới khoá dòng chapter, idempotent; gọi ở complete/fail của `page.prepare` và `chapter.translate`:
  - có lô đang chạy → no-op;
  - frontier = trang đầu (theo ord) chưa dịch trong lượt, bỏ trang ẩn / lỗi Bước 1; lấy trang liên tiếp đã `prepared` ≤ 4 trang & ≤ 40 khối (port `make_batches`) → enqueue `chapter.translate` kèm `context_lines` từ bản dịch trang trước;
  - lô lỗi hẳn không chặn chuỗi; trang đó "Lỗi" + "Chạy lại trang lỗi".
- Chương xong khi hết frontier → `review | partial_failed` (`refreshChapter`).
- Huỷ = huỷ job đang chạy + xoá cờ lượt.
- "Dịch lại" cả chương cũng đi qua chuỗi; dịch trang chọn = chuỗi trên tập trang đó (context neighbors).
- **Kiểm `notes`**: worker hiện tích luỹ notes giữa lô trong 1 job → tách job phải lưu notes vào result và truyền lô sau; nếu không, nhất quán tên giảm.

### Phase 4 — Khoá + sửa trong lúc dịch (rủi ro cao nhất)
- Cho giữ khoá khi chương đang dịch; trang trong lô đang chạy/chờ lượt = chỉ xem; trang xong sửa bình thường.
- Luật AI ghi: `state_origin='ai'` → ghi `state` **kể cả khi chương đang khoá**; trang sửa tay → `ai_update_available` như cũ. An toàn vì trang đang chạy AI không sửa được + `If-Match` 409/rebase.
- `runAi` thôi nhả khoá.
- Cập nhật `docs/editor.md`, `docs/job-queue-worker.md`.

### Phase 5 — Luồng 1 nút + chọn trang (web + api)
- `primaryAction`: "Dịch chương" (commit → ingest → prepare → chuỗi); menu ⋯ "Chỉ xoá chữ + OCR (soát trước)".
- Thumbnail: "Chờ lượt · lô k/n", "Đang dịch", "Đang đặt chữ", "Xong"; thanh trên "Đang dịch · x/y trang xong".
- Panel Chọn: "Dịch trang này" (trang `prepared`); rail Shift/Ctrl-click → "Dịch N trang".

## Tiêu chí hoàn thành
1. Xuất: 1 lần bấm ra file tự tải; không còn từ "slice", "ZIP PNG", ô số chất lượng; cảnh báo nói rõ trang chưa dịch không có trong file.
2. Chương 33 trang: lô 1 "Xong" và sửa được khi lô sau còn chạy.
3. Nhãn tiến độ tiếng Việt, cập nhật ≤ 5s.
4. Lô 3 lỗi provider hết retry → lô 1–2 giữ, lô 4+ chạy tiếp, trang lô 3 "Lỗi".
5. "Chỉ xoá chữ + OCR" dừng ở "Chờ dịch".
6. Chọn 3 trang → chỉ 3 trang dịch.
7. Token/chương tăng ≤ ~10%; tên nhân vật nhất quán giữa lô (chương mẫu).
8. Test: api chuỗi (tiến, lỗi, huỷ, gọi lặp, gọi đồng thời), worker heartbeat throttle, web `page-status`, `stage-labels`, `export-warnings`.

## Ngoài phạm vi
Tự chạy ngay khi upload xong; làm lại bố cục editor; ETA; nhật ký từng bước; dịch song song nhiều lô; AI phân loại credit.

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Đổi luật AI ghi khi khoá → ghi đè sửa tay | chỉ ghi khi `state_origin='ai'`; trang busy read-only; test 409/rebase |
| Race giữa prepare complete & translate complete cùng gọi advance | khoá dòng chapter + idempotent + test đồng thời |
| Mất notes giữa job → dịch lệch tên | truyền notes qua result; so chương mẫu trước/sau |
| Heartbeat dày hơn → tải API | throttle 2s, chỉ khi đổi stage/done |
| Tự tải file bị trình duyệt chặn | fallback toast + nút Tải xuống |
| Modal drain thoát giữa 2 lô | lô kế enqueue trong tx complete → hàng đợi không rỗng |

## Câu hỏi còn mở
- Mức "Nhẹ" CBZ = quality bao nhiêu (75?).
- Lô đầu: chờ đủ 4 trang prepared hay chạy ngay khi có ≥ 1 trang liên tiếp (đề xuất: chạy ngay, ưu tiên thấy kết quả sớm).
- Có giữ ô "Chỉ xoá chữ + OCR" theo series (nhớ lựa chọn) không — tạm: không.
