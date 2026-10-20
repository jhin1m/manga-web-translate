# Phase 6 — Kiểm thử toàn luồng + docs: report

Branch `feat/ux-p6-verify` (từ main 4346153). Chưa merge, chưa push. Report này thay cho tên `verify-261021-ux-simplify-drop-to-translate-report.md` ghi trong phase file (owner chỉ định tên này).

Ảnh bằng chứng: `/private/tmp/claude-501/-Users-jhin1m-Desktop-ducanh-project-manga-web-translate/afd5f58a-ec25-40b0-a90d-9f37d96d1a71/scratchpad/evidence/` (01…11, tên mô tả nội dung). Log gate: `…/scratchpad/final/*.log`.

## Bối cảnh chạy
- Worker đã được controller restart (pane herdr, `--provider gemini`) — không đụng. `pnpm dev`, `pnpm jobs`, docker infra giữ nguyên.
- Gemini free-tier hết quota (429, "retry in 11h44m") → luồng thật dừng ở `page.prepare` (OCR/dịch). Tiêu chí canvas/bảng/trạng thái kiểm trên chương 5, 6 series "123" (đã dịch sẵn).

## Luồng thật (Chrome, 5180, cửa sổ 2048×945)
1. Home → chọn 5 webp `demo_manga_eng` (cùng đường với thả) → **0 thao tác thêm**: vào thẳng "Chương 7" (series 123 từ chương gần nhất), chip "Đang cắt trang", ảnh gốc xem trước (01). `chapter.ingest` succeeded ~27s, 5 `page.prepare` sinh ra.
2. `page.prepare` lỗi 429 → queue requeue (`rate_limited`, provider_retries tăng, backoff). Trang hiện ảnh gốc mờ + "Đang dịch…" ✓.
3. **Lỗi UX tìm thấy**: chip "Đang dịch 0/5", rail "Đang xử lý", inspector đổ nguyên JSON 429 của Gemini màu đỏ (~30 dòng, `rate_limited: gemini 429: …RESOURCE_EXHAUSTED…`), không nói là đang tự thử lại hay cần làm gì (02). → sửa (xem dưới), sau sửa (03): băng cảnh báo "Nhà cung cấp AI báo hết hạn mức / quá nhiều yêu cầu (429) — trang 1, 2, 3, 4, 5 đang chờ, tự thử lại lúc 02:19. Không cần làm gì; muốn dừng thì bấm "Huỷ xử lý"", rail "chờ AI thử lại", inspector câu ngắn + "Chi tiết kỹ thuật" thu gọn.
4. "Huỷ xử lý" → "Đã huỷ 5 job", trang "Lỗi", nút chính "Chạy lại trang lỗi" (04). Sau sửa inspector ghi "Đã huỷ xử lý. Bấm "Dịch lại trang này" hoặc "Chạy lại trang lỗi"…" (trước đó trang "Lỗi" không có lý do).
5. Header: đổi số chương 7 → 6 → báo tại chỗ "series đã có chương 6" (409) (08); → 99 → tên đổi "Chương 99" (09).
6. Chương 6: Xuất ZIP PNG → "Xong · 6.0 MB" (10); kiểm file bằng fetch trong trang (không tải về máy): chữ ký `PK`, 6 253 532 byte, đủ `001.png…005.png`.

## Tiêu chí chấp nhận (plan.md)
| Tiêu chí | Kết quả |
|---|---|
| Không "cần xem" vì tràn ≤ dung sai; tiêu đề tràn thật vẫn cờ | Đạt — chương 5 + 6 "Cần xem 0" (05, 11); cờ tràn thật phủ bằng unit test `measure`/`boxOverflow` (P1), chương mẫu không có khối tràn thật để soi tay |
| Bảng không còn region `bubble`; "chưa có bản dịch" chỉ đếm vùng chữ | Đạt — 77 khối/5 trang (trước 145), drawer Xuất "2 khối chưa có bản dịch" (10) |
| 1 trang trọn khung; "Trang i/5" đúng khi cuộn | **Đạt một phần** — "Trang 1/5" → "Trang 2/5" khi cuộn ✓ (07). Trọn trang: ở cửa sổ 2048×945 của owner canvas cao ~700px (bảng dưới mở) / ~815px (thu gọn) < 830px cần cho trang 1500px ở sàn 50% → thấy ~85–95% trang (05, 06). Do sàn `FIT_HEIGHT_MIN = 0.5` (commit fb32525, chủ ý: 27% chữ không đọc được) — không đảo |
| Đang dịch: ảnh gốc + "Đang dịch…" | Đạt (03) |
| Trạng thái chỉ ở topbar (+ rail); không banner tồn đọng | Đạt — chip duy nhất; băng chỉ hiện khi có việc phải biết (chờ AI), tự mất khi hết |
| Thả 5 ảnh → ≤ 1 thao tác tới khi tự dịch; e2e click-budget | Đạt (01) + e2e `click-budget` xanh |
| Đổi series/số chương trên header, test API + tenant isolation | Đạt (08, 09) + test P4 xanh |
| Font comic VN + viền trắng; `typeset-parity` xanh | Đạt — chương 6 Bangers viền trắng (05); parity xanh |
| typecheck/lint/test + toàn bộ e2e xanh | Xem Kiểm chứng (trên branch; main sau merge do controller) |

## Đã sửa (commit riêng, có test)
- `19c7e68 fix(web): explain provider rate limits and auto-retry time instead of raw job errors`
  - API `jobView` thêm `run_after` (thêm trường, không đổi gì khác).
  - Web `features/chapter/job-error.ts` (thuần): `describeJobError`, `providerWait`, `providerWaitText`, `ERROR_CLASS` (dời từ activity-drawer). Dùng ở inspector, page-rail (title + cờ), activity-drawer (dòng chờ), `LockBand` (prop `aiWait`).
  - Test: `job-error.test.ts` (7), `error-classes.test.ts` thêm kiểm `/progress` trả `error_class` + `run_after` khớp DB sau 429.
- `ecfe801 docs:` `design-guidelines.md` (băng cảnh báo + quy tắc lỗi job), `editor.md` (lỗi job của trang), `development-setup.md` (quota Gemini → backoff ~4h, Huỷ xử lý / Chạy lại trang lỗi).

## Quyết định tự chốt (owner ngủ)
1. Không thêm nút "Thử ngay" cho job đang backoff — cần API mới (đặt lại `run_after`), YAGNI; đường thoát = tự thử lại + "Huỷ xử lý" → "Chạy lại trang lỗi".
2. Không đổi backoff/Retry-After: Gemini nói "retry in 11h44m" nhưng worker không chuyển thành `retry_after_s` → job thử lại 20 lần trong ~4h, mỗi lần ăn 1 request vô ích. Ghi mở (dưới), không sửa ở phase verify.
3. **Chương thử "Chương 99"** (id `01a15abd-56b7-74f3-afa4-52ede2829de3`, tạo từ bước 1, đã huỷ xử lý, số đổi 7 → 99 khi kiểm header) **giữ lại**: app không có API xoá chương, xoá tay trong DB sẽ để lại object MinIO mồ côi. Giữ cũng tiện để owner bấm "Chạy lại trang lỗi" sau khi quota reset để kiểm nốt dịch thật với Bangers. Muốn bỏ: đổi số về 7 hoặc xoá khi có tính năng xoá.
4. Chỉ sửa đoạn docs liên quan; phần drop-to-translate/header/font đã được P4/P5 cập nhật, kiểm lại khớp hành vi.

## Kiểm chứng
Chạy trên branch sau 2 commit sửa (baseline trước sửa cũng xanh: web 140, e2e 18/18):
- `pnpm typecheck` → exit 0 (`apps/web typecheck: Done`, `apps/api typecheck: Done`).
- `pnpm lint` → `Checked 242 files in 70ms. No fixes applied.` exit 0.
- `pnpm test` → shared 8, web 147 (+7), db 3, api 147 — exit 0.
- `pnpm --filter @mtl/web e2e` → `18 passed (1.1m)` exit 0 (gồm typeset-parity: 83 dòng, lệch tối đa 1px, vượt ngưỡng 0).
- `cd worker && uv run pytest -q` → `136 passed in 5.28s`.

## Còn mở
- Backoff 429 không theo thời gian reset quota của provider (`providers/gemini.py` chỉ đọc header `retry-after`; Gemini để `retryDelay` trong body — job đo được `run_after` = +30s) → ~20 request vô ích/trang trong ~4h; breaker 2' chỉ giảm nhẹ. Nên: worker parse `RetryInfo.retryDelay` → `retry_after_s`, hoặc lỗi quota ngày (`PerDay`) → fail sớm với thông báo "hết hạn mức ngày".
- Trọn trang ở cửa sổ ~945px cao không đạt vì sàn 50% (trên). Nếu owner muốn trọn trang ở màn này: hạ sàn (~0.4) hoặc giảm `EDGE` 40 → 16 — cần owner chọn (đổi trade-off đã chốt).
- Rail/inspector giữ trang "đang chọn" (Trang 1) khi cuộn, chỉ báo góc dưới theo trang giữa khung (Trang 2/5) — có thể gây nhầm; chưa sửa (chưa rõ ý đồ: chọn ≠ đang xem).
- Hình học vùng đặt chữ: trang 4 (đã biết từ P5) và trang 2 chương 6 — 2 khối thuyết minh chồng lên nhau ("ĐƯỢC NGƯỜI BỐ…" / "CÓ MỘT NGƯỜI MẸ…") (07). Không sửa.
- Pane `pnpm jobs` lỗi `relation "dispatches" does not exist`: không có bằng chứng mới (bảng có trong DB `mtl`).
- Chương cũ (≤ 5) vẫn PatrickHand không viền — đúng như P5 ghi.
