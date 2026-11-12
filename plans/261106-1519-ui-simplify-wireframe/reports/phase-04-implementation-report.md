# Phase 4 report: Canvas và cột trang

## Việc theo mục
1. Một cụm giữa đáy canvas `‹ n/M › · 62%` (`canvas-controls.tsx`; `CanvasZoom` bỏ). Nút % đổi Vừa khung ↔ 100%; đang zoom khác (Ctrl+cuộn) → 100%. Tên + tooltip nói trạng thái và việc bấm ("Đang vừa khung (62%). Bấm để xem cỡ thật 100%" / "Đang 100%. Bấm để vừa khung"). Khi panel khối đè: cụm căn giữa phần canvas còn lộ (`left: 50% + overlay/2`), không bị che; e2e đo hộp + bấm được ‹ ›.
2. Cột 72px, thumb 52×72, chỉ ảnh + số. Cờ góc `ThumbFlagBadge` (`thumb-flag.tsx`, `role=img`, `aria-label` + `title`): "!" cần xem / chờ AI, "×" lỗi; `thumbFlag` thuần trong `page-status.ts` + unit test. Nút "✓" chọn nhiều dời vào giữa thumb (khỏi đè cờ).
3. Thanh % trên thumb trang đang chạy giữ; trang ẩn mờ + viền đứt giữ. Nhãn chữ bước (Đang dịch · 45%...) chuyển vào `thumbTitle` + `thumbAria`.
4. Bỏ đầu cột + lọc "Cần xem": xoá `reviewOnly`, `review`, `filtering`, `list`, CSS `.cw-thumbs-head button/[aria-pressed]`, `.cw-thumb-mark*`. `needsReview` còn dùng ở chip / `thumbMark`. Thanh "Dịch N trang · Bỏ chọn" giữ.
5. Menu ⋯ (`aria-label` "Thao tác trang n") luôn hiện trên trang đang mở; chuột phải / Shift+F10 / ⋯ cùng một `ContextMenu` (e2e so danh sách mục bằng nhau). Trang đang mở: Dịch / Dịch lại trang, Bỏ chỉnh sửa tay (chỉ khi khác bản AI), Ẩn trang. Trang khác: chỉ Ẩn trang; trang ẩn: Khôi phục. Bỏ nút thùng rác hover của cột trang.
6. Bỏ chỉnh sửa tay: không hộp xác nhận (đã bỏ từ trước), toast "Hoàn tác"; e2e thêm Ctrl+Z.
7. `SourceRail` cùng cỡ thumb, giữ kéo-thả, Alt+↑/↓, menu chuột phải, nút góc xoá/khôi phục. Nhãn dưới thumb → cờ góc (danger "×", warn "!", busy/idle "…", ok "✓") + `title` + `aria-label`; "Đã xoá" / "Credit · tự bỏ" chỉ mờ + viền đứt + tên truy cập + title. Đầu cột (đếm "N ảnh · đã bỏ k", bước cắt trang) giữ cho cột ảnh gốc.
8. `LockBand`: mỗi mục câu ngắn + nút; lý do dài trong `title` và span `sr-only` (đọc được bằng trình đọc màn hình). `aiWait` thành `{short, long}`; thêm `providerWaitShort` (+ test).

## Nút cũ → chỗ mới
- Dịch / Dịch lại trang ở thumb bất kỳ (menu chuột phải, phase trước) → chỉ trang đang mở (⋯ / chuột phải). Trang khác: bấm mở trước, hoặc ⌘/Shift chọn rồi "Dịch N trang". Theo đúng yêu cầu; không thêm số bấm vào luồng chính.
- Nút thùng rác hover → mục "Ẩn trang n" trong menu; Khôi phục: bấm / chuột phải trang ẩn.

## Quyết định tự chọn
- Nút % khi đang zoom khác (không phải 100%) → 100% (giữ đúng hành vi cũ "bấm 100%"). Từ 100% mới về Vừa khung.
- Tên nút % chứa phần trăm để khớp nhãn hiển thị; trạng thái vừa khung nằm ở tên + `data-fit`, không còn `aria-pressed`.
- Pager của cột ảnh gốc (`source-viewer.tsx`) hưởng CSS căn giữa chung, nội dung giữ ("Ảnh n/M").
- Đổi tên mục khôi phục băng: "Thay đổi chưa lưu ở trang 3, 4" (theo wireframe). e2e đổi selector.
- Thumb 52×72 đủ nhìn ở 1280x800 (xem ảnh); chưa cần 60×84.

## Số đo canvas (khung 1280x800, không chọn gì)
**1144 x 748** (rail 64 + cột trang 72). Chọn khối → box canvas không đổi (e2e `toEqual`). Mục tiêu 1160 cần rail 48 (phase sau): 1280 - 48 - 72 = 1160, còn lệch 16px đúng bằng phần rail.

## Gate
typecheck xanh, lint xanh (0 cảnh báo), unit: web 411 (408 + 3), api 435, shared 60, db 8. e2e 83/83 (82 cũ + 1 spec mới pager/panel + 0 xoá; test menu trang viết lại, test ẩn trang đổi theo ⋯). Lượt e2e đầu 3 lỗi do selector/giả định cũ (chữ băng khôi phục, tên credit ở cột ảnh gốc, fit scale = 100% của fixture 1px) — đã sửa selector, giữ nguyên ý assert. click-budget không đổi (không đụng).

## Test mới / đổi
- Unit: `thumbFlag`, `thumbTitle` (bước chạy, hint trang đang mở), `providerWaitShort`, `zoomLabel`.
- e2e: menu ⋯ = chuột phải = Shift+F10 (focus vào menu, Esc đóng + trả focus), trang khác chỉ có Ẩn trang, ⋯ chỉ ở trang đang mở, không còn nút xoá hover, Ctrl+Z hoàn tác Bỏ chỉnh sửa tay, cờ "!" và "×" có tên + tooltip, cụm pager không bị panel che + đổi % rồi chọn lại khối vẫn tự cuộn. Selector theo tên mới: `1/3`, `expectVisiblePages`, `zoomButton` (helpers), cờ nguồn ảnh. Không nới assertion.

## Đã xem bằng ảnh (1280x800, spec tạm đã xoá)
Mặc định, ⌘ chọn nhiều (thanh Dịch N trang), menu ⋯ mở, ẩn rồi khôi phục (mờ + viền đứt), 150 trang (cuộn cột, cờ ! và ×), cột ảnh gốc + kéo đổi thứ tự (hover nút xoá), LockBand tab khác. Ảnh: scratchpad/shots/p4-*.png.
Chưa xem bằng ảnh: cờ "Đang tải" của cột ảnh gốc và đầu cột lúc cắt trang (chỉ e2e), Shift-click chọn dải (chỉ e2e), menu ⋯ ở khung < 1000px, 150 trang thật (ảnh thumb giả bằng /progress nhân bản; không tải ảnh thật).

## Rủi ro còn lại
- Cờ 18px trên thumb 52px nhỏ; "×" dễ lẫn khi nhiều cờ. Theo dõi khi dùng thật.
- ⋯ che góc phải trên thumb trang đang mở (24px/52px).
- Mất lọc "Cần xem": chương nhiều trang lỗi phải nhảy lần lượt bằng chip.
- Lý do dài ở LockBand chỉ hiện khi rê chuột (cảm ứng không thấy); trình đọc màn hình vẫn đọc được.
