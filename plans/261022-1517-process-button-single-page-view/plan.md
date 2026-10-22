# Nút "Xử lý" + xem từng trang

Status: done · 2026-10-22 (đã sửa sang 2 bước — xem cuối file)

## Bối cảnh (debug)
- Ghép slice → cắt theo detector đã có (`worker/mtl_pipeline/ingest.py`); chương mẫu 96 slice → 33 page, không cut_flag.
- Thả ảnh = autoCommit → ingest → `createIngestedPages` enqueue `page.prepare` mọi page (tốn AI) ngay.
- Canvas xếp cả chương thành strip dọc; rail theo page active (chỉ đổi khi bấm), cuộn chỉ đổi `centerPageId` → rail lệch.
- `stripSize` lấy page rộng nhất (credit 4036px) → fit 37%, page 800px dạt trái.

## Quyết định user
1. Upload xong tự ghép/cắt trang, dừng; bấm **Xử lý** mới chạy xoá chữ/OCR/dịch cả chương.
2. Màn chính hiện **từng trang một**, chuyển trang bằng rail / ←/→.

## Phase 1 — API: dừng sau ingest
- `CHAPTER_STATUSES` thêm `ingested` (cắt xong, chờ Xử lý) + migration đổi `chapters_status_chk`.
- `createIngestedPages`: không enqueue prepare; chapter → `ingested`, page giữ `pending` (= "Chưa xử lý").
- `refreshChapter` bỏ qua `ingested`.
- `POST /w/:ws/chapters/:id/process`: chương `ingested` → enqueue prepare mọi page, → `processing`.
- Huỷ xử lý / xoá chương / retry không đổi.
- Test: chapters/queue tests cập nhật kỳ vọng sau ingest.

## Phase 2 — Web: nút Xử lý
- `ChapterStatus` + nhãn chip "Chờ xử lý"; `primaryAction` ingested → "Xử lý"; draft commit đổi nhãn "Cắt trang".
- Lệnh `process` gọi endpoint mới.

## Phase 3 — Web: xem từng trang
- `pageOffsets` → mọi page tại y=0 (mỗi page là một "strip" riêng); canvas chỉ mount page active; content = kích thước page active → căn giữa + fit theo page đó.
- Đổi page active → vừa khung lại, đưa lên đầu trang; `centerPageId` = page active.
- Bỏ "cuộn liên tục cả chương" khỏi nhãn canvas.

## Kiểm tra
- `pnpm -r typecheck`, vitest api/web liên quan, e2e nếu có spec chạm luồng.
- Trình duyệt: chương mẫu căn giữa, rail khớp khi ←/→.

## Sửa đổi 15:38 — 2 bước (thay nút "Xử lý")
- User: Bước 1 = cắt trang + xoá chữ + OCR (bấm tay, upload xong không tự chạy); Bước 2 = Dịch.
- API: bỏ `ingested`/`/process`; chapter status `prepared` (xong bước 1, chờ dịch); `refreshChapter` không tự enqueue
  translate; `POST /chapters/:id/translate-prepared` (`translatePrepared`).
- Web: bỏ `autoCommit` khỏi upload-manager; nút "Bước 1 · Xoá chữ + OCR" / "Bước 2 · Dịch"; page `prepared` = "Chờ dịch",
  hiện ảnh sạch (không lớp mờ) để soát.
- Chưa làm: định dạng series (dải dọc / trang rời) — API hiện chỉ cho series tiếng Hàn, chờ user chốt.
