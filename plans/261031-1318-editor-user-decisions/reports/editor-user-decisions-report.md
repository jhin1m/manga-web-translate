# Báo cáo — editor theo quyết định user (31/10/2026)

Branch `feat/editor-user-decisions` (tách từ `fix/editor-bug-hunt`, chưa push/merge). Brief: `../brief.md`.

## Tóm tắt

- **Cả 5 việc xong**, mỗi việc có test, đã qua review (`/ak:code-review`, 2–3 vòng mỗi việc) và kiểm tay trên dev (5180, worker thật).
- **Gate cuối** (HEAD `02c6421`, `test-261031-final-gate-report.md`): `pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm test` ✓
  (shared 38, web 313, db 5, api 316) · worker pytest 267 ✓ + ruff check/format ✓ · parity `--check` ✓ · **e2e toàn bộ 46/46 ✓ 2 lượt**
  (thêm 3 lượt 46/46 trước đó ở `936b050`). Không lỗi; log Vite có cảnh báo "Several Konva instances detected" (không làm hỏng test, chưa rõ chỉ ở dev).
- **Lỗi thật tìm thấy thêm**: e2e `upload-chapter` chập chờn là lỗi sản phẩm — ngăn "Hoạt động" lấy tên chương đang tải
  từ danh sách gần đây (giới hạn 20, chương bị khoá xếp trước) → người có >20 chương gần đây thấy "Chương mới", không có link.
- **Không làm**: redo (Cmd+Shift+Z) cho lượt hàng loạt — server không có "áp lại"; lượt hàng loạt xoá stack redo.
- **Cần user**: xem "Câu hỏi cho user" cuối report (chuyển khối cũ sang căn giữa? triển khai worker 0.7.1 trước API).

| # | Việc | Commit chính | Sửa sau review |
|---|------|--------------|----------------|
| 4 | Hàng đợi: job trùng `created_at` claim theo thứ tự trang | `fd71708` | — (review OK) |
| 1 | Cmd+Z hoàn tác lượt hàng loạt | `aa6b579`, `e174bdc` | `65d3b50`, `983d71c`, `f30f133` |
| 3 | Cuộn quá mép trang → trang kế/trước | `1cac803` | `b090677`, `6ca2388`, `9709d1d`, `936b050`, `02c6421` |
| 2 | Căn giữa dọc chữ trong khung (#8) | `0f96567` | `0cc477a`, `c8f0791` |
| — | Ngăn Hoạt động đặt tên chương đang tải | `87b53e2` | |
| 5 | Xoá series "QA đêm" qua app | (dữ liệu dev) | |

## 4. Hàng đợi job — tie-break theo thứ tự trang

- `claim()` (`apps/api/src/jobs/queue.ts`) `LEFT JOIN pages`, xếp `priority, created_at, pages.ord asc nulls last, jobs.id`;
  `FOR UPDATE OF jobs SKIP LOCKED` (hợp lệ: `jobs` là phía không NULL). Không migration. Job không gắn trang xếp sau trong nhóm hoà.
- Test `queue.test.ts`: 5 job cùng `created_at` chèn ngược thứ tự → claim trả trang 1 trước (đỏ khi bỏ sửa).
- Review: EXPLAIN vẫn dùng `jobs_claim_idx`. Ghi chú thấp: nếu sau này 1 transaction tạo job cho nhiều chương thì nên xếp thêm `chapter_id`.

## 1. Cmd+Z hoàn tác lượt hàng loạt (Áp kiểu, Tìm/Thay, Áp glossary)

- Lượt hàng loạt = 1 mục trong lịch sử undo của trang đang mở; lịch sử trước lượt được giữ qua lần nạp lại sau khi áp.
  Cmd+Z (và nút hoàn tác trên topbar) ở mục đó gọi đúng đường của nút "Hoàn tác" (`find-replace/undo`, chế độ skip), cùng thông báo
  ("Đã hoàn tác áp kiểu / thay thế / áp glossary trên N trang"); Cmd+Z tiếp theo lùi các sửa trước lượt.
- Sửa sau lượt trên trang đang mở → Cmd+Z lùi sửa đó trước; trang đang mở được client tự khôi phục về trạng thái trước lượt.
- Mục bị tiêu thụ dù hoàn tác bằng cách nào (toast, panel, Cmd+Z); 1 cờ "đang hoàn tác" chung cho cả 3 đường.
- Lỗi tạm (409 `chapter_busy`, 423, mạng, 5xx) giữ mục + nút toast; chỉ 404 (lượt không còn) mới bỏ.
- API: kết quả áp trả thêm `versions` (version mới từng trang; client cũ bỏ qua). Hoàn tác xét "đã sửa sau đó" **theo nội dung**
  (state hiện tại == state lượt đã ghi → vẫn khôi phục) → Cmd+Z 2 lượt liên tiếp lùi trọn cả hai. Truy vấn history lấy đúng cặp
  `(page_id, version)`.
- Lịch sử theo từng trang (như trước): mục nằm ở trang đang mở lúc áp; ở trang khác dùng nút toast.
- Cmd+Z trong ô nhập (ô Tìm…) vẫn là undo chữ của trình duyệt.
- **Redo: không làm** (server không có áp lại) — áp lượt xoá stack redo, không có trạng thái hỏng.
- Test: unit `chapter-session.test.ts`/history (server giả theo version + nội dung, nhiều lượt), API `find-replace.test.ts`
  (A, B, undo B, undo A; `versions`), e2e `editor.spec.ts` (Áp kiểu → Cmd+Z → Cmd+Z), `chapter-tools.spec.ts` (Tìm/Thay → Cmd+Z;
  Cmd+Z trong ô Tìm không gửi undo). Glossary test ở mức unit (chung lõi).
- Còn lại (thấp): sửa trong lúc hoàn tác đang chạy không vào lịch sử (không mất dữ liệu); khoảng rất ngắn giữa lúc server áp xong và
  trang nạp lại thì Cmd+Z chưa thấy mục.

## 3. Cuộn quá mép trang → trang kế / trước

- Module thuần `apps/web/src/features/editor/wheel-page-flip.ts`, nối ở `ChapterCanvas.tsx`; đổi trang qua `ChapterSession.activate`
  (cùng đường pager → lưu trang cũ trước).
- Chỉ lật khi đã ở mép theo chiều cuộn và cuộn thêm ~160px (1 nấc chuột ~100px không lật, 2 nấc / 1 cú vuốt thì lật).
  Trang vừa khung ("Vừa khung") coi như ở cả hai mép, không xê dịch.
- Chống quán tính: sau lật khoá ≥600ms, kéo dài khi sự kiện còn tới <300ms; trong khoá **nuốt** cuộn cùng chiều (đáp đúng đầu/cuối
  trang mới), cho cuộn ngược chiều (không lật); trần khoá 1.5s, sau trần nếu page vẫn dính mép thì phải ngừng 300ms mới lật
  được tiếp (trang vừa khung không lật 2 trang trong 1 cú vuốt); page cao đã cuộn rời mép thì cuộn đều tới cuối lại lật tiếp
  (`02c6421`, đọc liền như webtoon). Đánh đổi: page chỉ cao hơn khung chút ít + cú vuốt trackpad rất dài có thể lật thêm 1 trang.
- Không lật khi: Ctrl/Cmd+wheel / pinch (zoom), Shift, cuộn ngang trội, đang sửa chữ inline, đang kéo/resize khối hoặc giữ chuột
  (`buttons`, `Konva.isDragging/isTransforming`), trang đầu/cuối.
- Xuống → đáp đầu trang mới; lên → đáp cuối trang trước. Hiệu ứng 200ms fade + trượt 28px; `prefers-reduced-motion` → đổi tức thì.
- Bảng phím tắt có dòng "Cuộn quá mép trang"; `docs/editor.md` cập nhật.
- Test: unit (ngưỡng, quán tính, reset hướng/mép/pause, zoom/ngang bỏ qua, busy, locked, ngược chiều, trần khoá, đầu/cuối),
  e2e (trang cao ở fit: nấc nhỏ không lật, Ctrl+wheel không lật, giữ chuột kéo khối không lật + thả ngoài stage vẫn lật được,
  2 wheel ngay sau lật vẫn trang 2 và ở đầu trang, lật lên đáp cuối trang, reduced-motion, "Vừa khung" 1 nấc không xê dịch).
- Lỗi phát hiện khi làm: trang vừa đáp nằm ở y=16 nhưng mép trên đòi y≥40 → không lật lên được; kiểm "vừa khung" dùng 40 thay vì 16 → lệch 24px (sửa `936b050`, hàm chung `fitsAxis`).

## 2. Căn giữa dọc chữ trong khung (#8)

**Chọn**: trường mới theo từng khối `valign: "top" | "middle"`; **thiếu trường = `top`**; khối mới (vẽ tay, OCR vùng qua
`newTextBox`, AI `typeset_region`) ghi `middle`. Công thức chung editor + worker:
`dy = valign==="middle" ? max(0, (h − 2·pad − blockH)/2) : 0`, baseline_i = `y + pad + dy + ascent + i·step`.

**Lý do**: (a) căn giữa toàn cục sẽ làm xê dịch mọi khối đã lưu và đổi file export các chương cũ khi user không yêu cầu;
(b) trường per-box giữ khối cũ **giống từng pixel** ở editor và export, khối mới căn giữa, user bật/tắt từng khối (nút Trên/Giữa
cạnh căn ngang, "Áp kiểu" lan sang khối cùng loại). Kẹp `max(0,…)` giữ hành vi cũ khi chữ tràn. Không lưu baseline nên không cần migration.

- Sửa: zod `packages/shared/src/page-state.ts` + json-schema emit, `measure.ts linePlacements`, overlay textarea (4 padding riêng,
  offset tính từ `drawnBox` giống canvas), `Properties.tsx`, worker `render.py layout_lines` + `schema.py` + `text_box_from_shared`
  + `typeset.py`; `docs/typeset-layout-contract.md` quy tắc 3, `docs/editor.md`.
- `relayout` chỉ gán `lines`/`font_size` khi thật sự đổi → áp lại cùng kiểu không ghi trang nào, không tạo lượt rỗng.
- **Pipeline version 0.7.1** (worker + `MIN_PIPELINE_VERSION` API): worker <0.7.1 có schema input strict → **job export lỗi** với
  state có `valign`; vì vậy API từ chối worker cũ (426). Triển khai: worker trước (Mac + Modal `modal deploy`), rồi API/web.
  `docs/deployment-guide.md` có thứ tự rollback + SQL gỡ `valign` (chưa chạy thử, ghi rõ).
- **Gate parity**: generator lấy mọi font trong manifest trừ `EXCLUDED_FONTS`; mỗi font ≥2 box và ≥1 box căn giữa; 33/34 font,
  122 dòng, lệch tối đa 1px. Spec dùng `linePlacements` thật của editor (trước đây vẽ từng dòng riêng nên có thể che lỗi).
  `ShantellSans-Variable` lệch 2px (font biến thiên, advance Konva ≠ Pillow) → loại khỏi gate, ghi trong contract là lỗ hổng đã biết.
- Test: shared zod, web unit (middle/top/kẹp tràn, `newTextBox`, lan kiểu, no-op), worker pytest (layout_lines, text_box_from_shared,
  typeset_region), API round-trip PUT state, e2e bật "Giữa" + Áp kiểu lan `valign`, parity spec. Đỏ trước sửa: unit layout, 3 test worker,
  parity 24 dòng vượt ngưỡng (max 32px) với code editor cũ.
- Kiểm tay dev: "Giữa" căn giữa trên canvas; export qua worker thật khớp editor 1–2px; khối cũ vẫn căn trên ở cả hai.

## Lỗi thêm: ngăn Hoạt động (`87b53e2`)

e2e `upload-chapter` lỗi ~1/2 lượt full run. Bằng chứng: `/api/recent-chapters` trả 20 chương, không có chương 501 (DB e2e có 25 chương
còn khoá từ spec trước; danh sách đưa chương khoá lên đầu, giới hạn 20). Ngăn lấy tên chương chỉ từ danh sách đó → "Chương mới".
Sửa: mỗi dòng đang tải tự nạp chi tiết chương của nó. Sau sửa e2e full 46/46 ×3. Ghi chú: spec này không chạy được với
`--repeat-each` trên DB dùng chung (chương 501 đã tồn tại) — không phải lỗi sản phẩm.

## 5. Xoá series "QA đêm"

Làm cuối, sau kiểm tay. Xoá qua UI: series → "Cài đặt dịch" → "Xoá series" (gõ đúng tên "QA đêm" mới mở nút — xác nhận trong
trang, không dùng SQL). Kiểm: thư viện còn 4 series (Wireless Onahole, Alpha Injection, jinx, arm-boy-rivalry); URL series → "not found",
API cũng 404; chương thật `01a18dab-…` vẫn mở được, thuộc "Wireless Onahole".
Tab: agent phiên này dùng agent-browser (đã đóng), không mở tab Chrome nào. Tab "QA đêm" còn sót từ phiên đêm qua (nếu có) nằm ngoài
nhóm tab của phiên này → không đóng được bằng công cụ, cần user đóng tay. Chi tiết: `qa-261031-delete-qa-series-report.md`.

## Môi trường

- ~14:28 OrbStack dừng (có cờ update) và herdr server không chạy → pane `w1H:p17` không còn. Đã mở lại OrbStack và chạy
  `pnpm dev:all` nền từ shell của phiên Claude (dev 5180 + worker 0.7.1). Khi phiên này đóng, tiến trình dev có thể dừng theo —
  chạy lại `pnpm dev:all` trong herdr nếu cần.

## Report chi tiết

`fix-261031-queue-page-order-report.md`, `cook-261031-bulk-undo-shortcut-report.md`, `cook-261031-wheel-page-flip-report.md`,
`cook-261031-vertical-center-report.md`, `fix-261031-flaky-upload-and-lows-report.md`, `code-review-261031-*.md`,
`test-261031-full-gate-report.md`, `qa-261031-manual-dev-check-report.md`, `qa-261031-delete-qa-series-report.md`.

## Câu hỏi cho user

1. **Khối cũ có chuyển sang căn giữa không?** Hiện khối đã lưu (không có `valign`) giữ căn trên để không đổi export cũ; user bật "Giữa"
   từng khối hoặc dùng "Áp kiểu" cho cả chương. Có muốn thêm nút "căn giữa mọi khối của chương" hay migrate hàng loạt?
2. **Triển khai 0.7.1**: worker (Mac + Modal) phải lên trước API, nếu không API từ chối worker cũ. Đồng ý thứ tự này?
3. **Redo lượt hàng loạt** (Cmd+Shift+Z): không làm vì server không có "áp lại". Cần không? (cần API mới.)
4. **Cảm giác cuộn lật trang**: ngưỡng 160px (2 nấc chuột) là ước lượng — thử thấy cứng/nhạy thì chỉnh `FLIP_THRESHOLD`.
5. Kiểm bằng bàn phím thật: Cmd+Z trong ô Tìm hoàn tác chữ đã gõ (trình duyệt tự động không kích hoạt được undo chữ native trên macOS;
   đã xác nhận app không bắt phím ở đó).
6. Cảnh báo "Several Konva instances detected" trong log e2e (dev server Vite) — có muốn điều tra (có thể chỉ do dep optimize ở dev)?
7. `ShantellSans-Variable` lệch 2px giữa editor và export — có cần sửa (đổi sang bản font tĩnh?) hay chấp nhận?

## Quyết định cho các câu hỏi trên (user giao quyết định hộ, 31/10)

1. Không migrate khối cũ sang căn giữa — giữ export chương cũ ổn định; "Áp kiểu" đã lan `valign` cho cả chương khi cần.
2. Triển khai: worker 0.7.1 (Mac + Modal) trước, API/web sau — ràng buộc kỹ thuật, đã ghi `docs/deployment-guide.md`.
3. Không làm redo lượt hàng loạt — cần API mới, ưu tiên ổn định hơn thêm tính năng.
4. Giữ `FLIP_THRESHOLD` 160px — kiểm tay 2 nấc mới lật thấy hợp lý.
5. Cmd+Z trong ô Tìm: chốt theo bằng chứng (unit + e2e: app không bắt phím trong ô nhập → undo chữ native của trình duyệt).
6. Cảnh báo "Several Konva instances": điều tra (nghi do import `konva` thêm ở `6ca2388`) — kết quả ở mục dưới.
7. ShantellSans-Variable lệch 2px: thử thay bằng bản font tĩnh; đạt ≤1px thì đưa lại vào gate, không thì giữ nguyên ghi chú.

### Kết quả mục 6–7 (`fix-261031-konva-instance-and-shantell-font-report.md`)

- **6. Konva**: cảnh báo không do code app — `e2e/typeset-parity.spec.ts` (có từ trước, `d357aeb`) nạp `konva.min.js` UMD làm
  `window.Konva` cạnh Konva ESM của app. Bundle dev và prod chỉ có 1 instance → `Konva.isDragging()` kiểm đúng instance react-konva.
  Không sửa code; cảnh báo vô hại, chỉ xuất hiện ở spec parity.
- **7. ShantellSans** (`c36fe91`): gốc là font biến thiên `wght` mặc định 300 — trình duyệt áp CSS 400 lên trục, Pillow dùng 300.
  Thay cả 2 bản (web + worker) bằng bản tĩnh `wght=300` (fontTools instancer, giữ id/tên file/manifest; 1,28 MB → 401 KB).
  Gate parity: 34/34 font, 123 dòng, lệch tối đa 1px; `EXCLUDED_FONTS` rỗng. **Quyết định**: giữ 300 (Light) — export vốn luôn
  vẽ 300 nên chương đã export không đổi; chỉ bản xem trước trong editor đổi từ 400 về đúng 300.
- Gate sau `c36fe91`: typecheck, lint, `pnpm test`, pytest 267 + ruff, parity `--check`, e2e 46/46 ✓.
