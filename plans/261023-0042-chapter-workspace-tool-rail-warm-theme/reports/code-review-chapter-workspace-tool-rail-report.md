# Code review: màn chương "rail công cụ + 1 panel" + bảng màu Giấy ấm (`main...HEAD`)

Ngày 23/10/2026 · nhánh `feat/chapter-workspace-tool-rail` (HEAD `01282de`) · chỉ đọc, không sửa code.
Đối chiếu: [brief.md](../brief.md), [plan.md](../plan.md), report review trước
([code-reviewer-261023-chapter-workspace-diff-report.md](./code-reviewer-261023-chapter-workspace-diff-report.md)).
Phạm vi: 74 file, +4598/−1412 (apps/web + docs + plan). Trọng tâm: lỗi chức năng, tính năng mất khi dời chỗ, phím tắt,
a11y (aria-label, tương phản), test bị nới.

## Kết luận nhanh

- **Không có lỗi Critical/High.** Các lỗi High/Medium của review trước (H1 xung đột, H2 mất "Hoàn tác", M1 canvas không
  vừa lại, M2 menu toàn mục tắt, M3 rail không báo công cụ) đã sửa đúng trong code (`chapter-workspace.tsx:251-258`,
  `:799-831`, `ChapterCanvas.tsx:108-126`, `context-menu.tsx:62-66`, `tool-rail.tsx:46`).
- Tính năng cũ đều còn (bảng đối chiếu ở cuối); 1 thông tin bị hạ xuống tooltip (cột "Loại" của bảng).
- Phím tắt: `shortcuts.ts` chỉ đổi nhãn bảng trợ giúp, `resolveKey` không đổi; Esc cũ cũng chỉ bỏ chọn → không mất hành vi.
- Test không bị nới: số test mỗi spec bằng hoặc hơn, không `skip/fixme/only`, assertion cũ có thay thế tương đương.
- Tìm được 2 Medium (1 chức năng chưa tái hiện tay, 1 a11y) + 8 Low.

## Kiểm tra đã chạy (lần này)

| Lệnh | Kết quả |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (Biome 275 file) |
| `pnpm --filter @mtl/web test` | exit 0 — 30 file, 179 test |
| `pnpm --filter @mtl/web e2e` | **không chạy lại** (cần infra + ghi DB); report cook ghi 29 passed |
| Tương phản token | tính bằng công thức WCAG (bảng dưới) |

## Medium

### M1. Chọn + kéo khối khi panel đang thu → khung nhìn đổi giữa lúc kéo, khối bị dời lệch so với ảnh (PLAUSIBLE)

- `TextBoxNode.tsx:65` chọn khối ở `onMouseDown`. `chapter-workspace.tsx:262-275`: selection đổi mà `panel === null` →
  `setPanel("tool")` → panel 288px hiện → `.ed-canvas` hẹp lại → `ChapterCanvas.tsx:108-126` (chưa zoom) **vừa lại**:
  đổi `scale` và căn giữa lại `x`. Tất cả xảy ra trong lúc chuột còn giữ, tức đúng lúc Konva bắt đầu kéo
  (`draggable` ở `TextLayer.tsx:94`).
- Konva giữ khối dưới con trỏ theo toạ độ màn hình (`setAbsolutePosition`), còn ảnh bên dưới đã co/dịch → khi thả, `moveBox`
  ghi vị trí mới lệch theo độ dịch bố cục (cỡ ~144px màn hình + phần đổi tỉ lệ), dù người dùng chỉ định kéo vài px.
- Tái hiện: chương đã dịch, trang 1 → bấm icon Chọn để thu panel → nhấn giữ chuột trên một khối chữ và kéo ngay ~20px
  → thả. Mong đợi: khối dịch ~20px. Khả năng thực tế: khối nhảy lệch xa hơn so với bóng thoại; Ctrl+Z mới về.
- Chưa tái hiện trên trình duyệt (review chỉ đọc) — cần thử tay. Plan mục 22 chấp nhận "ảnh co lại một chút" khi chọn,
  nhưng không nói tới trường hợp đang kéo.
- Hướng sửa (để owner quyết): mở panel ở `pointerup`/sau khi kết thúc kéo, hoặc khi panel tự mở do chọn thì chỉ
  `clampView` (không đổi scale), hoặc không tự mở panel khi chọn (bỏ quyết định mục 7).

### M2. Bấm "Thu panel" bằng bàn phím → focus rơi về `<body>`

- `context-panel.tsx:32-36`: nút "Thu panel" nằm trong `<aside hidden={!open}>`. Bấm → `setPanel(null)` → aside bị ẩn
  khi focus đang ở chính nút đó → focus mất (về body), lần Tab kế tiếp bắt đầu lại từ đầu trang (nút ‹ series).
- Thu/mở panel là thao tác chính của bố cục mới, nên với người dùng bàn phím đây là lỗi thứ tự focus (WCAG 2.4.3).
  Bấm lại icon rail để thu thì không bị (focus ở rail).
- Tái hiện: Tab tới nút "Thu panel" (X ở đầu panel) → Enter → `document.activeElement === document.body`.
- Hướng sửa: sau khi thu bằng nút này, focus nút rail của panel vừa thu.

## Low

- **L1. Tab trong menu nổi đóng menu nhưng làm mất focus** (`context-menu.tsx:119` + `:125`): nhánh Tab gọi `onClose()` rồi
  vẫn `preventDefault()`. Menu bị gỡ khi focus đang trong nó → focus về body. Esc thì trả focus về nút mở (đúng). Tái hiện:
  chuột phải thumbnail → Tab → `activeElement` là body. Hướng sửa: không `preventDefault` với Tab, hoặc trả focus về
  `anchor` như Esc.
- **L2. Phím T/B/E/R vẫn đổi công cụ khi đang "Chỉ xem"** (`chapter-workspace.tsx:629-632`): chỉ chặn khi `sourceMode`.
  Rail tắt các nút này khi `readOnly` (`:606-610`) và `docs/editor.md:127` ghi "Chỉ xem → mọi công cụ trừ Chọn tắt". Bấm
  `B` lúc chỉ xem → nút Mask (đang `disabled`) thành `aria-pressed="true"`, panel đổi sang "Mask xoá chữ". Hành vi phím có
  từ trước (không phải hồi quy), nhưng nay mâu thuẫn với rail và docs. Hướng sửa: `if ((sourceMode || s.readOnly) && a.tool !== "select") return;`.
- **L3. Bảng Bản dịch bỏ cột "Loại"** (`text-table/text-table.tsx:163-169`); loại khối chỉ còn trong `title` của hàng
  (`:185`) — không đọc được bằng bàn phím/trình đọc màn hình, không thấy được khi lướt bảng. Brief: panel Bản dịch dùng
  "bảng văn bản cả chương hiện có". Panel Chọn vẫn hiện loại, nên không mất hẳn, chỉ bị hạ cấp. Xem Câu hỏi mở 2.
- **L4. Vùng bấm < 32px**: `.btn-link` có `min-height: 0; padding: 0; font-size: xs` (`chapter-workspace.css:778-784`).
  Mới trong đợt này: "Dịch lại trang này" ở panel Chọn khi có khối chuyển từ nút thường sang link
  (`select-panel.tsx:91`, `:205`). "Bỏ chỉnh sửa tay, dùng lại bản AI" (`:295`) đã là link từ trước. Brief ràng buộc "vùng
  bấm ≥ 32px trên desktop".
- **L5. Xung đột khi lưu biến mất nếu người dùng thu panel sau khi danh sách hiện** (`chapter-workspace.tsx:251-258`):
  panel chỉ tự mở khi số xung đột đổi 0→n. Thu panel lúc đã có xung đột thì không còn chỗ nào báo, đổi trang (`load()`
  xoá conflicts) là mất lựa chọn. Inspector cũ không thu được nên không gặp. Hướng sửa: rail/thanh trên có chấm báo khi
  `conflicts.length > 0`, hoặc không cho thu khi còn xung đột.
- **L6. Thanh nổi không hiện khi khối cao hơn khung nhìn** (`page-layout.ts` `blockBarPos`, dùng ở `block-toolbar.tsx:48`):
  khối sát mép trên → đặt dưới khối; khối cao hơn khung (đã zoom) thì "dưới khối" nằm ngoài khung → thanh bị cắt
  (`overflow: hidden`), không kẹp theo chiều dọc. Tái hiện: zoom 200–300% vào một khối lớn, cuộn để mép trên khối ra khỏi
  khung → chọn khối → không thấy thanh. Chưa có unit test cho trường hợp này.
- **L7. Màu nhấn cam đất gần trùng màu cảnh báo** (`tokens.css:23`, `:28`, `:32`): `#c2501b` (accent/info/focus) với
  `#a15c00` (warn) tương phản giữa nhau chỉ 1.10:1. Hệ quả: outline "trang đang mở" (`chapter-workspace.css:350`) và
  viền "Cần xem/Chờ AI" (`:357`) gần cùng màu; chấm trạng thái "Đang xử lý" (busy = `--c-info`, `tokens.css:321`) và chấm
  cảnh báo khó phân biệt. Có nhãn chữ đi kèm nên không vi phạm "chỉ dùng màu", nhưng giảm khả năng nhận biết. Đúng theo
  bảng token của brief (`--c-info` theo accent) → xem Câu hỏi mở 3.
- **L8. Lặt vặt**
  - CSS chết: `.ed-tool kbd`, `.ed-tool.on` (`editor/editor.css:5-12`) — `CanvasToolbar` đã xoá, không còn TSX nào dùng
    `ed-tool`.
  - Trang series: `h1` tên dài xuống dòng (`home.css:373-376`), không cắt "…" và không có `title`
    (`series-page.tsx:92`); plan nghiệm thu ghi "cắt … + title ở home, trang series, thanh trên". Xuống dòng hiện đủ tên
    nên có thể là chủ ý → Câu hỏi mở 4.
  - Plan mục 20 / cook-done ghi "Chạy lại trang lỗi trong ⋯ khi chương đang chạy"; thực tế (`primary-action.ts:70`, `:79`)
    mục này có trong ⋯ khi chương ở "Chờ dịch" (prepared) có trang lỗi; lúc processing ⋯ chỉ còn Chia đôi + Phím tắt.
    Chỉ lệch mô tả, hành vi hợp lý.
  - Nút rail bị tắt chỉ giải thích lý do qua `title` (`tool-rail.tsx:43`); `aria-label` đè tên nên trình đọc màn hình
    không đọc lý do. Nhỏ.

## Tương phản (WCAG, tính lại)

| Cặp | Tỉ lệ | Dùng cho | Đạt |
|---|---|---|---|
| fg-muted / bg · surface · surface-2 | 5.63 · 5.16 · 4.72 | chữ phụ, nhãn rail 11px | ✓ |
| fg-subtle / bg | 4.52 | figcaption, kbd (chỉ trên bg) | ✓ (sát ngưỡng) |
| fg-subtle / surface-2 | 3.79 | icon `.icon-btn` khi hover nền | ✓ (≥3 cho icon) |
| accent-hover / accent-weak · bg | 4.86 · 5.74 | nút đang bật, link, chữ nhấn | ✓ |
| trắng / accent · accent-hover | 4.71 · 6.04 | nút chính, count-badge, seg bật | ✓ |
| warn / warn-weak · danger / danger-weak | 4.62 · 5.53 | nhãn thumbnail, `.cw-warn` | ✓ |
| accent / bg · surface · canvas | 4.48 · 4.11 · 3.62 | outline focus, viền (không phải chữ) | ✓ (≥3) |
| line-strong / bg | 1.70 | viền thumbnail thường (trang trí) | n/a |

Không còn chỗ nào dùng `--c-accent` làm màu chữ trên nền sáng (đã chuyển sang `--c-accent-hover`), không còn mã màu xanh
cũ (`#1f4fd1`) trong `src`. Số trang trên thumbnail ẩn đã giữ tương phản (chỉ ảnh mờ — `chapter-workspace.css` quy tắc
`.cw-thumb[data-tone="hidden"] .cw-thumb-img`).

## aria-label / tooltip / phím tắt

- Mọi nút chỉ-icon có `aria-label`: rail (kèm phím `Chọn (V)`…), Thu panel, pager (`Trang trước (←)`), Vừa khung/100% (có
  chữ), thanh nổi (Sửa chữ, Dịch lại khối, Nhân đôi khối, Xoá khối), ⋯ ("Thêm thao tác"), Hoàn tác/Làm lại. Nhãn hiện
  trên rail nằm trong tên truy cập (label-in-name đạt).
- Thumbnail: `aria-label` luôn đủ trạng thái (`thumbAria`, có unit test), nhãn chữ thấy được `aria-hidden` → không đọc
  lặp. Trang ẩn có `aria-haspopup="menu"`.
- Tooltip có phím tắt: V/T/B/E/R, Ctrl+F, Xem gốc (giữ O · `\`), Hoàn tác/Làm lại, ←/→, Delete, Enter. Không có phím cho
  Bản dịch / Nhân đôi / ⋯ (không có phím từ trước → không thiếu).
- Phím tắt trong `docs/editor.md` đều còn chạy: `resolveKey` không đổi; listener ở `window` (bubble) và menu nổi
  `stopPropagation` mọi phím → phím trong menu không lọt ra phím tắt màn chương.

## Test có bị nới không

| Spec | Test main → HEAD | Ghi chú |
|---|---|---|
| chapter-tools | 4 → 4 | Tab bảng dưới → panel Tìm (segmented); "Tới khối" vẫn kiểm dòng sáng + panel Chọn "Khối 1 / 1 · Thoại" + panel Tìm vẫn mở. Test xoá trang → ẩn trang qua menu (kiểm thêm Esc trả focus, Shift+F10). |
| editor | 7 → 9 | Segmented Gốc/Dịch/Chia đôi → Xem gốc + mục bật/tắt trong ⋯ (kiểm cả `aria-checked`, Esc trả focus). Inspector/heading → pager + panel Chọn + `aria-current`. +2 test: thu/mở panel (đo bề rộng canvas, nhớ khi reload, Ctrl+F focus, Vừa khung↔100%), thanh nổi (Sửa chữ focus, Nhân đôi + undo, Xoá lưu server). |
| full-flow, upload-chapter | 1 → 1, 4 → 4 | `.status` chữ trên rail → tên truy cập thumbnail; nút Xoá/Khôi phục thường trực → menu chuột phải + nút panel. |
| series-manage | 4 → 5 | +1 test tên series dài (home 1568/390px, trang series, thanh trên). |

Không có `skip/fixme/only`, không tăng timeout. Assertion bị bỏ đều thuộc hành vi brief đã bỏ (bộ lọc "Tất cả/Đã xoá",
segmented, inspector). Một chỗ yếu hơn chút: test credit kiểm "không còn nhãn Credit/Đã xoá" thay vì "nút Xoá ảnh 3 hiện
lại" — vẫn đủ ý.

Chưa có e2e cho: M1 (kéo khi panel thu), M2/L1 (focus khi thu panel / Tab trong menu), phím công cụ khi chỉ xem, thanh
nổi khi khối sát mép trên, H1/H2 cũ (xung đột ở panel Bản dịch, Hoàn tác Tìm/Thay sau khi chương chạy lại) — giữ như
cook-done đã ghi.

## Tính năng cũ → chỗ mới (đã soát trong code)

| Tính năng | Chỗ mới | Kết quả |
|---|---|---|
| Công cụ V/T/B/E/R, Hoàn tác/Làm lại | rail trái; icon thanh trên | ✓ (tắt khi chỉ xem/chưa có page) |
| Gốc/Bản dịch, OCR lại, Áp kiểu cùng loại, Xoá khung, thuộc tính | panel Chọn (+ "Kiểu chữ nâng cao") + thanh nổi | ✓ (Áp kiểu, căn lề, màu, viền nay sau 1 cú mở `<details>` — đúng brief) |
| Thông tin trang, Dịch lại trang này, Bỏ chỉnh sửa tay, AI có bản mới, xung đột | panel Chọn; xung đột trên mọi panel | ✓ (xem L5) |
| Mask/Tẩy + Xoá chữ vùng đã tô | panel Mask/Tẩy (segmented Tô/Tẩy nét) | ✓ |
| Bảng văn bản + lọc, "N khối" | panel Bản dịch 560px | ✓, mất cột Loại (L3) |
| Tìm/Thay, Áp glossary (+ Hoàn tác, giữ state) | panel Tìm, segmented, giữ mount | ✓ |
| Gốc/Dịch/Chia đôi, Dịch lại cả chương, Phím tắt | Xem gốc + ⋯ | ✓ (+ "Chạy lại trang lỗi" ở trạng thái Chờ dịch, trước đây không có trên thanh trên) |
| Rail trang: lọc cần xem, xoá/khôi phục, ảnh gốc trước Bước 1, credit, "Có thể là credit" | cột thumbnail + menu chuột phải/Shift+F10 + nút panel | ✓ |
| Pager, % zoom | góc dưới canvas + Vừa khung/100% | ✓ |
| Chip, băng cảnh báo, nút chính, drawer Xuất/Hoạt động, "Xem các khối này" của drawer Xuất | giữ nguyên; drawer mở panel Bản dịch + lọc | ✓ |
| Kéo cao bảng dưới | bỏ (không còn bảng dưới) | đúng brief |

## Câu hỏi mở

1. **M1** — khi panel đang thu, chọn khối có nên tự mở panel không (plan mục 7)? Nếu giữ, chấp nhận chỉ kẹp khung nhìn
   (không đổi tỉ lệ) để tránh khối nhảy khi vừa chọn vừa kéo? Cần owner thử tay để xác nhận mức độ.
2. **L3** — giữ bảng 5 cột (bỏ "Loại") hay thêm lại "Loại" (có thể thay cột "#")? Panel 560px có chỗ cho 6 cột hẹp.
3. **L7** — bảng token của brief đặt `--c-info` = màu nhấn cam, rất gần `--c-warn`. Owner có muốn tách `--c-info`
   (VD xanh trung tính) để "Đang xử lý" khác "Cần xem", và outline trang đang mở khác viền cảnh báo không?
4. **L8** — trang series: tên dài xuống dòng (hiện đủ) hay cắt "…" + `title` như plan nghiệm thu ghi?
5. Khả năng dùng ở màn hẹp: không có `@media` cho màn chương; ở ~1280px panel 560 + rail + cột trang còn ~544px cho canvas,
   thanh trên nhiều nút `nowrap` có thể tràn dưới ~1150px. Màn chương có cần tối thiểu bề rộng nào không (e2e chỉ chạy
   1920×1080)?
6. Plan câu 1–23 vẫn chờ owner xem lại (Tìm 560px, Loại chỉ đọc, Dịch lại khối = OCR lại, thumbnail 72×100 thấy ~5–6
   trang…). Review này không thấy lý do kỹ thuật để đổi các quyết định đó.

Status: DONE
Summary: Không có lỗi Critical/High; lỗi của review trước đã sửa đúng; còn 2 Medium (kéo khối khi panel tự mở — cần thử tay; focus mất khi "Thu panel") và 8 Low. Test không bị nới.
