# Research: koharu — ý tưởng cho Editor + Pipeline

- Ngày: 2026-10-31 21:32 (Asia/Saigon)
- Nguồn: clone `koharu-rs/koharu` @ `cba6e46`: `packages/koharu/components/editor/*`, `packages/docs/guides/*`, `crates/koharu-pipeline/README.md` + `src/stages/*`. Đối chiếu `docs/editor.md`, `docs/job-queue-worker.md`, `apps/web/src/features/{editor,chapter}`, `worker/mtl_pipeline/pipeline.py`.
- Báo cáo trước (model ML, typeset): `research-261031-2126-koharu-features-to-adopt-report.md`.
- Không chạy code koharu. Chỉ giữ ý tưởng hợp nguyên tắc "ổn định > nhiều tính năng", UX tối giản.

## Tóm tắt

Editor + pipeline của mình **đã đầy đủ hơn** koharu ở phần lớn chỗ: dải chương tile hoá cho strip 20.000px (koharu chỉ hiện 1 trang), chuỗi lô dịch có ngữ cảnh, khoá chương, version/autosave, Dịch lại khối, OCR vùng tự vẽ, bảng văn bản, tìm & thay, hiệu đính. Koharu đáng học ở **4 điểm**: giữ bản sửa tay theo từng khối khi dịch lại, tách nhánh OCR khỏi nhánh xoá chữ, bảng hoạt động theo từng trang, vài thao tác canvas nhỏ.

## Pipeline

### P1. Giữ sửa tay theo khối — **ĐÃ CÓ** (sửa lại kết luận bản đầu)

- Bản đầu báo cáo kết luận sai (suy từ docs, chưa đọc code). Code thật: `apps/web/src/features/editor/panels/AiUpdatePanel.tsx` đã diff theo vùng (đổi / mới / AI bỏ) giữa bản hiện tại và `ai_state`, áp từng vùng hoặc tất cả, undo được; `page-state-writer.ts:6` ghi rõ "editor merge theo vùng". Sửa tay không bị ghi đè nếu không bấm áp.
- Khác koharu duy nhất: koharu **tự** nhận bản mới cho khối chưa sửa tay; mình bắt người dùng bấm áp. Cải tiến nhỏ có thể cân nhắc (tự áp vùng chưa sửa tay) — nhưng phải biết vùng nào đã sửa tay, hiện không lưu cờ theo vùng. Giá trị thấp, không ưu tiên.

### P2. Tách OCR khỏi xoá chữ trong `page.prepare` — giá trị trung bình, chưa đo

- koharu: DAG cố định `detect → OCR → dịch` và `detect → inpaint` là 2 nhánh độc lập; detect xong là 2 nhánh của trang đó chạy được ngay (`koharu-pipeline/README.md` "Fixed workflow").
- Mình (`worker/mtl_pipeline/pipeline.py:154-175`): tuần tự detect → mask → **inpaint → OCR** → nếu có SFX thì `restore_sfx` dán lại ảnh gốc lên vùng đã xoá. Hệ quả: (a) thời gian/trang = inpaint + OCR thay vì max; (b) SFX bị inpaint rồi mới trả lại → tốn compute + có thể lệch mép.
- Đề xuất (chỉ trong worker, không đổi giao thức): chạy OCR (LLM, đọc ảnh gốc) **song song** với inpaint, hoặc OCR trước → bỏ vùng `is_sfx` khỏi mask → inpaint 1 lần, bỏ `restore_sfx`. Trang đầu "Chờ dịch" sớm hơn → lô dịch đầu chạy sớm hơn.
- Phải đo trước bằng `timing.json` (inpaint vs ocr trên Mac/Modal). Nếu inpaint GPU chỉ ~1-2s thì lợi nhỏ, chỉ còn lợi SFX.

### P3. Dừng giữ kết quả đã xong — kiểm tra lại, có thể đã đúng

- koharu: Stop = không bắt việc mới; việc đang chạy chạy hết tới mốc an toàn, kết quả bị bỏ nếu stop trước commit; mọi commit trước đó giữ nguyên.
- Mình: "Huỷ xử lý" đóng cả lượt (`stopTranslateChain`). Trang đã `ready` giữ. Cần xác nhận: job đang chạy bị huỷ mà worker vẫn complete → fencing chặn ghi (đã có fencing) — chỉ cần 1 test e2e xác nhận, không cần đổi.

### Không lấy ở pipeline

- Chọn tổ hợp stage tuỳ ý (Detection/OCR/Dịch/Inpaint) + scope popover (`InferenceControl.tsx:181-190`): thêm quyết định cho người dùng. Mình có "Dịch chương" / "Chỉ xoá chữ + OCR" / "Dịch N trang" / "Dịch lại khối" là đủ.
- "Process Selected Layers": docs có nhưng code không có (`store.ts:39` chỉ 3 scope) — đừng lấy làm tham chiếu. Mình đã có "Dịch lại khối".
- Làn GPU đơn + OOM unload/retry, model nạp lười giữ thường trú: koharu desktop. Worker mình 1 job/lúc trên Mac, Modal tách container → không cần.

## Editor

### E1. Bảng hoạt động theo từng trang/job — giá trị trung bình

- koharu `ActivityCenter.tsx:104-160`: mỗi job 1 dòng (bước, "Trang n", model, %, nút dừng); lỗi có dòng riêng, đóng được (`:196`).
- Mình `chapter/activity-drawer.tsx:184-232`: nhãn bước cấp chương; dừng chỉ ở menu chương (`primary-action.ts:96`).
- Đề xuất tối giản: trong drawer, liệt kê trang đang chạy / lỗi (trang n · bước · lỗi + "Chạy lại"), **không** thêm nút dừng từng job (huỷ 1 job đã dừng cả lượt — thêm nút dễ gây hiểu nhầm). Dữ liệu đã có (`/progress`, `jobs_progress_counts`).

### E2. Alt + cuộn đổi cỡ cọ — rẻ

- koharu `CanvasWorkspace.tsx:766-779`. Mình: không có (`altKey` chỉ ở `use-shortcuts.ts:30`, `source-rail.tsx`, `text-table.tsx`). Thêm vào công cụ mask B/E (`panels/MaskPanel.tsx`) + hiện vòng cọ đúng cỡ. Chú ý không xung đột Ctrl+cuộn zoom / cuộn lật trang.

### E3. Giữ khung cũ khi chuyển trang/ảnh chưa tải xong — kiểm tra trước

- koharu `useCanvas.ts:124-131`: trạng thái `switching` giữ frame trước đến khi frame mới sẵn sàng; lỗi tải hiện overlay "thử lại" nhưng vẫn giữ frame (`CanvasWorkspace.tsx:855-885`); prefetch trang kề + khi hover thumbnail (`:305-330`, `PageRail.tsx:167-178`), thumbnail chờ 100ms mới tải khi cuộn nhanh (`PageRail.tsx:548-552`).
- Mình dùng dải chương tile 2048px (`canvas/TileLayer.tsx`) — đúng hướng cho strip dài. Chưa kiểm: lần đầu vào trang cao có chớp trắng không; đổi `clean_rev` (sau reinpaint) có chớp không (`editor.md:173`, `:258` nói ảnh sạch tải ngầm — có vẻ đã xử lý). Chỉ làm nếu soi thấy chớp.

### E4. Lấy màu từ ảnh (color picker) — để sau

- koharu `CanvasWorkspace.tsx:733-740` + `controls/ColorSampling.tsx`: hút màu từ ảnh ghép → áp vào chữ/cọ.
- Mình đã tự lấy màu chữ/viền theo chữ gốc → nhu cầu thấp hơn. Có ích khi người dùng muốn sửa màu tay. Đọc pixel trên ảnh 20.000px → lấy từ tile đang hiện, không ghép cả trang.

### Đã có, không cần làm

Space / chuột giữa để kéo (`ChapterCanvas.tsx:161, 255`), phím tắt công cụ, xoay có bước 90° (`TextLayer.tsx:105-112`), Esc huỷ thao tác + bỏ chọn, ô chữ lưu khi blur (+ autosave 2s; koharu debounce 360ms — không cần).

### Không lấy ở editor

- Danh sách lớp (layer) có ẩn/hiện, opacity, sắp thứ tự (`Inspector.tsx`): trái UX tối giản; "ẩn khi xuất" theo khối đã đủ.
- Đổi phím tắt tuỳ ý (`store.ts:123`).
- Cọ "Remove" chạy inpaint ngay khi nhả chuột (`CanvasWorkspace.tsx:712-730`): chạy model mỗi nét, không gate chi phí; mình dùng job reinpaint có ngân sách — an toàn hơn trên web nhiều người.
- Cọ vẽ / tẩy lớp paint tay: koharu có, nhưng thêm loại lớp mới + lưu raster → nặng; chỉ cân nhắc nếu người dùng thật sự cần vá tay sau inpaint.
- Resource monitor, quản lý tải model, menu Process kiểu desktop.

## Thứ tự đề xuất

1. ~~P1~~ — đã có (`AiUpdatePanel.tsx`).
2. **E2** Alt+cuộn cỡ cọ — nửa ngày, làm kèm đợt sửa nhỏ.
3. **P2** đo `timing.json` trên vài chương → nếu inpaint chiếm ≥ 30% thời gian `page.prepare` thì tách OCR song song + bỏ SFX khỏi mask trước inpaint.
4. **E1** drawer liệt kê trang chạy/lỗi.
5. **E3** soi chớp trắng khi vào trang cao / sau reinpaint → chỉ sửa nếu thấy.
6. **E4** color picker — sau cùng.

## Câu hỏi chưa giải quyết

- P2: chưa có số `timing.json` thật (inpaint vs OCR) trên Mac / Modal.
- E3: chưa xác nhận có chớp trắng khi vào trang cao.
- Người dùng có cần cọ vá tay (paint layer) sau inpaint không?
