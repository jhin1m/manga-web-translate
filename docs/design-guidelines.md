# Design guidelines (web)

Áp cho mọi màn của `apps/web` (màn chương gộp dùng lại cùng token). Token nằm ở
`apps/web/src/styles/tokens.css` — không hard-code màu/khoảng cách trong component nếu token đã có.

## Hướng thiết kế

Đã cân nhắc 3 hướng; **chọn A** cho MVP (owner đã duyệt 20/10/2026; bảng màu đổi sang "Giấy ấm" 23/10/2026 — xem
"Việc còn mở").

| Hướng | Mô tả | Hợp | Không hợp |
|---|---|---|---|
| **A. Bảng làm việc dày (đang dùng)** | Nền giấy ấm `#fbf9f4`, thang ấm trung tính, 1 màu nhấn cam đất `#c2501b`; bảng dày (13px), thanh trên màn chương 52px, trạng thái = chấm màu + chữ | Nhóm dịch xử lý hàng trăm trang/chương, cần quét nhanh trạng thái | Ít "cảm xúc" — chấp nhận, đây là công cụ |
| B. Tài liệu thoáng | Cột giữa 720px, chữ 15–16px, nhiều khoảng trắng, thẻ thay bảng | Người mới, ít dữ liệu | Lưới 150 trang + glossary vài trăm dòng phải cuộn rất dài |
| C. Tối kiểu IDE | Nền tối `#16161a`, panel chia cột, phím tắt nổi bật | Editor (Phase 5) làm việc lâu với ảnh | Màn quản lý (series, glossary) khó đọc bảng dày; ảnh manhwa nền trắng chói trên nền tối |

Vùng canvas của màn chương dùng nền ấm trung tính `--c-canvas` để nhìn ảnh, giữ cùng token chữ/nhấn. Ảnh trang,
bóng thoại, chữ chèn trên ảnh không đổi theo bảng màu. Chưa có dark mode.

Ảnh chụp dữ liệu thật của hướng A: chạy `pnpm --filter @mtl/web e2e` (series, upload 10 trang, chương "Chờ duyệt").

## Danh sách cấm

- Chữ gradient, nền gradient, viền gradient.
- Glassmorphism (`backdrop-filter: blur`, nền trong suốt mờ), neumorphism.
- Blob/hình trang trí nền, hoạ tiết, ảnh minh hoạ trang trí.
- Pastel/cute: màu kẹo, bo góc > 8px, icon hoạt hình, mascot.
- Emoji trang trí trong UI (nhãn, nút, tiêu đề, thông báo). Ký hiệu chức năng (↑ ↓ ✓) được dùng.
- Bóng đổ lớn/nhiều lớp; hiệu ứng hover nảy, phóng to; animation không mang thông tin.
- Hơn 1 màu nhấn. Màu trạng thái (ok/warn/danger/busy) chỉ dùng cho trạng thái, không trang trí.
- Chữ marketing ("Tuyệt vời!", "Siêu nhanh") — viết thông báo trung tính, nói rõ việc gì đã xảy ra.

## Token

| Nhóm | Token | Ghi chú |
|---|---|---|
| Màu nền | `--c-bg` `#fbf9f4`, `--c-surface` `#f3efe6`, `--c-surface-2` `#ebe5d8` | surface cho header bảng, hover, vùng thả file |
| Nền canvas | `--c-canvas` `#e7e1d4` | vùng ảnh màn chương |
| Viền | `--c-line` `#e3dccd`, `--c-line-strong` `#cbc1ad` | input dùng `line-strong` |
| Chữ | `--c-fg` `#2a2620`, `--c-fg-muted` `#6b6357`, `--c-fg-subtle` `#7a7264` | cả 3 đạt ≥ 4.5:1 trên `--c-bg` (subtle 4.52:1) |
| Nhấn | `--c-accent` `#c2501b`, `--c-accent-hover` `#a8430f`, `--c-accent-weak` `#f6e3d6` | nền nút chính (chữ trắng 4.71:1), viền/icon/focus, thanh tiến độ. **Chữ** màu nhấn (link, tab/nút đang chọn) dùng `--c-accent-hover` — `#c2501b` trên nền chỉ 4.48:1 |
| Trạng thái | `--c-ok` `#1d7a3e`, `--c-warn` `#a15c00`, `--c-danger` `#b42318`, `--c-info` `#2f6690` | `info` (đang xử lý, thông báo) là xanh lam dịu, tách khỏi cam nhấn và vàng `warn`; 5.8:1 trên `--c-bg` |
| Nền nhãn trạng thái | `--c-warn-weak` `#fdf0dc`, `--c-danger-weak` `#fbe7e4` | nhãn "Cần xem" / "Lỗi" (chữ warn 4.62:1, danger 5.53:1), cảnh báo tràn khung |
| Chữ | `--font-ui` (Be Vietnam Pro → Inter → system), `--font-mono` | cỡ `--fs-xs` 12 … `--fs-xl` 20; mặc định 14px |
| Khoảng cách | `--sp-1`…`--sp-6` (4, 8, 12, 16, 24, 32) | lưới 4px |
| Bo góc | `--radius` 4px | |

Font UI tự host qua `@fontsource/be-vietnam-pro` (400/500/600) — không gọi Google Fonts lúc chạy. Konva không đọc
được CSS variable: màu khung chọn / khung OCR ở `features/editor/canvas/colors.ts`, phải khớp `--c-accent`.

Quy tắc tương phản: chữ ≥ 4.5:1, icon/viền mang thông tin ≥ 3:1. Nút chỉ có icon có `aria-label`; tooltip ghi phím
tắt nếu có và mở được bằng phím (focus) chứ không chỉ rê chuột; vùng bấm ≥ 32px trên desktop. Trạng thái không chỉ truyền
bằng màu (cờ có ký hiệu + tên truy cập + tooltip).

## Màn chương

Toàn màn hình (ngoài app shell), `chapter-workspace.css`. Nguyên tắc (owner chốt 23/10/2026): giữ đủ tính năng nhưng
**mỗi lúc chỉ hiện thứ công cụ đang dùng cần đến** — 1 rail công cụ + 1 panel ngữ cảnh.

```
┌ thanh trên 52px: ‹ series · Ch.N · chip trạng thái · (lưu/khoá khi cần) ····· ↶ ↷ | Gốc · ⋯ · [nút chính] ┐
├ (băng cảnh báo — chỉ khi có)                                                                              ┤
├ rail 48px ┬ panel Văn bản 560px (chiếm cột) ┬ canvas (cụm giữa đáy ‹ n/M › · 62%) ┬ thumbnail 72px ┤
│            └ panel khối 272px: đè lên mép trái canvas, không chiếm cột                                    │
```

Khung 1280×800, không chọn gì: canvas rộng 1160px (1280 − rail 48 − cột trang 72), thanh trên tối đa 8 mục bấm được.

| Vùng | Nội dung |
|---|---|
| Thanh trên 52px | ‹ series (tên dài cắt "…", `title` đủ tên) · "Ch.N" bấm được (popover: đổi series, số chương, ngôn ngữ Dịch từ / Sang + Lưu) · **chip trạng thái** (nút: có trang cần xem → nhảy tới trang đó, không thì mở Hoạt động; chip nói cả lượt xuất đang chạy) · chỉ báo khoá/lưu **chỉ khi đang lưu / chưa lưu / lỗi / chỉ xem** · Hoàn tác / Làm lại (icon) · **Gốc** (bật/tắt, `aria-pressed`) · menu **⋯** (Chia đôi gốc / dịch, Xuất khi chương có trang lỗi, Dịch lại cả chương, Hoạt động kèm số việc đang chạy, Phím tắt) · nút chính. Đang chạy: nút chính là **Huỷ** + vạch tiến độ 2px ở đáy thanh. Chương có trang lỗi: nút chính "Chạy lại N trang". Không còn chữ "Export": luôn "Xuất" |
| Rail công cụ trái 48px | 5 nút chỉ icon 20px (nút 40×40): Chọn (V) · Chữ (T) · Tẩy chữ (B; Tẩy nét E là chế độ của Tẩy chữ, không có nút riêng) · Quét chữ (R) · ── · Văn bản. Tên + phím ở tooltip (rê chuột **và** focus bàn phím) + `aria-label`; nút đang mở panel của nó / công cụ có thanh phụ đang dùng: nền `--c-accent-weak` + `aria-pressed`; công cụ đang chọn mà panel thu: chỉ icon màu nhấn (`aria-current`). Nếu dùng thật thấy khó đoán icon → bật nhãn 11px, rail 64px |
| Panel khối 272px | Đóng mặc định, **đè lên mép trái canvas** (canvas không đổi bề ngang), tự mở khi chọn khối hoặc khi có nội dung phải xử lý (AI có bản mới, xung đột khi lưu), đóng khi bỏ chọn nếu hết nội dung. Rail Chọn chỉ mở khi có khối đang chọn hoặc có nội dung; thu panel khi còn nội dung → băng cảnh báo có nút Xem. Đầu panel "Khối i/N" + 3 icon (Dịch lại · Nhân đôi · Xoá); thân: Gốc, Dịch, cảnh báo ngắn "Tràn 12px", Font + Cỡ, nhóm "Kiểu chữ" thu gọn (Loại chữ, Tự khớp, nâng cao, Áp kiểu). Khối bị panel che thì canvas tự cuộn lộ ra. Không nhớ theo trình duyệt |
| Thanh phụ trên canvas | **Chữ** / **Tẩy chữ** (Tô ↔ Tẩy nét, cỡ bút, Bỏ nét, Xoá chữ vùng tô) / **Quét chữ** (Xoá chữ gốc; đang quét: n vùng + Huỷ) không có panel riêng: 1 dòng nổi giữa mép trên canvas |
| Panel Văn bản 560px | Một nút rail, 4 tab (`role="tablist"`, ←/→/Home/End): **Bản dịch** (bảng văn bản cả chương, 4 cột: Vị trí "trang·khối", Gốc, Dịch sửa tại chỗ, cờ — cờ "!" cần xem / "↻" AI có bản mới, có tên truy cập + tooltip; Loại khối ở panel khối) · **Tìm / Thay** · **Glossary** · **Hiệu đính · N** (N = gợi ý chờ duyệt, ẩn khi 0). Tab đã mở giữ nội dung (kết quả xem trước Tìm/Thay; hộp xác nhận hiệu đính đóng khi rời tab vì giá ước tính sẽ cũ); đóng mặc định, không nhớ qua tải lại. Ctrl/⌘+F mở tab Tìm / Thay và focus ô tìm. Chiếm cột bên cạnh canvas (không đè). Hiệu đính: hộp xác nhận 1 dòng "N trang · giá · thời gian" + nút Chạy + ⓘ (dữ liệu gửi lên nhà cung cấp AI) |
| Canvas | Trang active, mặc định **Vừa khung**; một cụm giữa đáy "‹ n/M › · 62%" (căn giữa phần canvas còn lộ khi panel khối đè nên không bị che); nút % đổi Vừa khung ↔ 100% (100% giữ khi đổi trang), zoom khác bằng Ctrl/⌘+cuộn; không còn thanh nổi cạnh khối — thao tác khối ở đầu panel khối |
| Cột thumbnail phải 72px | Chỉ ảnh 52×72 + số trang, không chữ, không đầu cột (tổng trang ở pager, nhảy trang cần xem ở chip). Trạng thái = viền + cờ ở góc, tên đầy đủ trong tooltip và `aria-label`: "×" (viền đỏ) lỗi · "!" (viền cam) cần xem / chờ AI · thanh % khi AI đang chạy · trang ẩn mờ + viền đứt; trang bình thường không cờ. Trang đang mở: outline màu nhấn + nút ⋯ luôn hiện. Thao tác trang là **một menu**: nút ⋯ (trang đang mở) hoặc chuột phải / Shift+F10 mở cùng menu — Dịch / Dịch lại trang, Quét lại trang, Bỏ chỉnh sửa tay (chỉ khi khác bản AI, không hỏi lại: Ctrl/⌘+Z hoặc toast Hoàn tác), Ẩn trang. Trang khác: chuột phải chỉ có Ẩn trang; trang ẩn bấm hoặc chuột phải → Khôi phục. Không có nút thùng rác khi rê chuột. Cột ảnh gốc (chưa cắt trang) cùng cỡ: cờ ở góc thay nhãn "Đang tải" / "Tải lỗi"…, nút xoá / khôi phục ở góc thumbnail |

- **Tên chương** ("Ch.N", tên truy cập "Chương N") bấm được → popover đổi series (select) / số chương / ngôn ngữ
  Dịch từ – Sang của series (`chapter-meta-popover.tsx`, `PATCH /series/:id` rồi `PATCH /chapters/:id`; trùng số →
  báo lỗi tại chỗ; đổi series → URL theo series mới).
- **Trạng thái chương ở 1 chỗ**: chip cạnh tên chương (`status.ts` `chapterChip`, `role="status"`, aria-live
  polite): "Đang tải ảnh 2/5", "Đang dịch 3/5", "Chờ duyệt · 2 cần xem", "Xong", kèm "· đang xuất" khi có lượt xuất.
  Cột thumbnail chỉ giữ trạng thái theo trang. Cạnh chip: chỉ báo khoá + lưu **chỉ hiện khi cần** (Đang lưu… / Chưa
  lưu / Lỗi lưu / Chỉ xem / Mất khoá); bình thường chỉ còn chữ cho trình đọc màn hình ("Bạn đang giữ khoá chương").
- **Băng cảnh báo** (`LockBand`, `role="alert"`): chỉ hiện khi người dùng phải biết/làm — mỗi mục là câu ngắn + nút
  ("Chương đang mở ở tab khác · Thử lại", "Thay đổi chưa lưu ở trang 3, 4 · Khôi phục · Bỏ", "Lỗi lưu, chưa ghi được",
  "AI hết hạn mức, trang 1, 2 tự thử lại", "n thay đổi chưa áp được · Xem"); lý do dài nằm trong tooltip (và đọc được bằng
  trình đọc màn hình). Trạng thái bình thường không chiếm dải.
- **Lỗi job viết cho người** (`job-error.ts`): thumbnail (title) / Hoạt động nói loại lỗi + việc cần làm
  ("Dịch lại trang" ở menu trang, "Chạy lại trang lỗi"); lỗi thô của provider (JSON dài) chỉ nằm trong "Chi tiết kỹ thuật" thu
  gọn ở Hoạt động.
- **Thông báo kết quả** (dịch lại, áp kiểu, lỗi thao tác): nổi trên canvas, không đẩy bố cục; info tự ẩn sau 6s.
  "Dịch chương" / "Chỉ xoá chữ + OCR" thành công không báo thêm (chip đã đổi); có ảnh bị loại → giữ thông báo tới khi
  chương xử lý xong.
- **Menu nổi** (`context-menu.tsx`, dùng chung cho chuột phải thumbnail, nút ⋯ của trang và "⋯" thanh trên): `role="menu"`,
  ↑/↓, Esc trả focus về nút mở; mục bật/tắt là `menuitemcheckbox`.
- **Menu Xuất** (`export-menu.tsx` + `export-panel.tsx`): popover `role="dialog"` ngay dưới nút Xuất (căn mép phải theo
  nút; mở từ mục Xuất trong ⋯ thì căn theo nút ⋯), không có lớp phủ — editor phía sau vẫn thấy. Đóng bằng Esc / bấm ra
  ngoài / bấm lại nút, trả focus về nút. Cao tối đa tới đáy cửa sổ, nội dung dài cuộn trong menu. Từ trên xuống: 1 dòng
  "N chỗ cần xem" (bấm mở hậu quả + "Xem N chỗ này") → nút **Tải chương (.zip|.cbz)** (tiến độ ngay tại nút) →
  "Tuỳ chọn" thu gọn kèm tóm tắt → "Lần trước · … + Tải lại" (hết hạn: nói rõ và nút Tải xuất lượt mới).

- **Nút chính** (1 nút, theo trạng thái chương, `primary-action.ts`): Tải ảnh → **Dịch chương** (= commit:
  ghép + cắt trang, xoá chữ, OCR rồi dịch + chèn chữ theo chuỗi lô, nối một mạch; khoá tới khi upload xong, không bao giờ
  tự chạy). Menu "⋯" của nút có "Chỉ xoá chữ + OCR (soát trước)": dừng ở "Chờ dịch" (soát ảnh sạch, sửa mask) rồi bấm "Dịch
  chương" tiếp; lựa chọn này không nhớ theo series. Trong lúc chạy nút chính là **Huỷ**, tiến độ ở chip ("Đang cắt trang", "Xoá chữ +
  OCR x/N", "Đang dịch · x/y trang · lô k/n") → Xuất. Chương có trang lỗi: nút chính "Chạy lại N trang", "Xuất" và
  "Dịch lại cả chương" nằm trong menu "⋯"; Xuất mở cùng menu dưới nút ⋯.
- **Drawer phải 420px** (`app/drawer.tsx`): Hoạt động (upload + job chương + lượt xuất, kèm "Chi tiết kỹ thuật" của lỗi) và
  Phím tắt. Cùng component có biến thể `modal` (hộp giữa màn) cho Glossary / Cài đặt dịch / Tạo series mới. Không dùng modal
  cho thao tác chính của màn chương. Chi tiết: [editor.md](./editor.md).
- **Home** (`/`): dải thả 56px một dòng ("Thả ảnh / ZIP" · chọn file; chưa có series nào thì vùng lớn; thả bất kỳ đâu trên
  trang cũng được). Đoán được series → tạo chương nháp + upload + mở màn chương, chờ bấm "Dịch chương" (không tự chạy);
  không đoán được / file lỗi → dòng "Vừa thả" một dòng (file, series, số chương, Tạo; "+ Series mới…" mở cùng modal
  tạo series, tạo xong chọn sẵn series đó và focus ô số chương; chưa có series nào thì ô chọn là nút "+ Series mới…").
  Dưới đó: ô tìm + "+ Series" (modal "Tạo series mới" 560px: Tên, Loại truyện, Dịch từ — mặc định tiếng Anh, Sang —
  mặc định tiếng Việt; Enter = Tạo series, tạo xong mở màn series) và hàng series
  một dòng (tên dài cắt "…" + `title`, chấm + trạng thái, "N ch"; bấm hàng để mở, icon Sửa → modal Cài đặt dịch,
  icon Xoá xác nhận tại chỗ rồi xoá cả series). Không có tiêu đề "Series · N". Nút Hoạt động của app shell chỉ hiện
  khi có chương đang tải ảnh; menu tài khoản giữ Glossary chung / Font / Cài đặt.
- **Series** (một cột): ‹ về home (không breadcrumb), tên, cặp ngôn ngữ, "Glossary · N" và icon Cài đặt (cả hai mở modal,
  `?tab=` giữ trạng thái modal); dải thả "Thả Ch.{next}" (series cố định, cũng tự tạo chương nháp); hàng chương một dòng
  (số chương, chấm + trạng thái, thời gian, icon Xoá xác nhận tại chỗ; bấm cả hàng để mở — **không** có icon Sửa; vạch
  2px chỉ khi đang chạy). Hàng danh sách không có nút "bước tiếp theo": dịch / xuất / chạy lại làm trong màn chương.
  **Cài đặt dịch** (modal): luôn hiện Tên, Dịch từ, Sang, Định dạng (Cuộn dọc / Từng trang — áp cho chương upload sau
  khi lưu), Font thoại; các nhóm thu gọn kèm tóm tắt: Giọng văn, Kính ngữ, Xưng hô, Font khác, Chữ bỏ qua, Ảnh tự bỏ (tự
  lưu). Hint dưới trường nằm trong ⓘ; **Lưu** dính ở footer, tách khỏi "Xoá series" (link đỏ, bấm mới hiện ô gõ tên).

## Thành phần

- **Nút**: `button` (viền), `.btn-primary` (1 nút chính mỗi vùng), `.btn-ghost` (thao tác phụ trong bảng), `.btn-danger` (chữ đỏ, không nền đỏ); `.btn-danger-solid` (nền đỏ) chỉ cho nút xác nhận xoá. Nút chỉ có icon: `.icon-btn` (34px, bắt buộc `aria-label`). Link dạng nút: `<Link className="btn">`.
- **Bảng**: `table.data`; số căn phải `.num` (tabular-nums). Sửa tại chỗ thay vì modal khi được.
- **Trạng thái**: `<span class="status" data-tone="ok|busy|warn|danger|idle">` — chấm màu + chữ. Nhãn chương/page ở `features/chapter/status.ts`.
- **Thông báo**: `.notice` (+ `.info`, `.danger`) — viền trái màu, nền surface. Lỗi API hiện message server.
- **Tiến độ**: `.bar > span` cao 3px.
- **Giải thích ngắn**: ⓘ (`app/info-tip.tsx`) thay cho dòng hint dưới trường — hiện khi rê chuột, focus bàn phím hoặc bấm; nội dung gắn vào nút qua `aria-describedby`.
- **Bố cục**: `.page` (+ `.page-narrow` 880px cho form), `.page-head` (tiêu đề + spacer + nút), `.crumbs`, `.grid-2`, `.section`.

## Cài đặt admin (`/settings`)

- Chỉ admin (`ADMIN_EMAILS`). Bố cục: thanh mục trái (nhóm "AI", "Hệ thống"; mục = link `?section=`) + 1 panel phải, tối đa 880px. Mục đang chọn = chữ `--c-accent-hover` + nền `--c-accent-weak`; không gradient, bo ≤ 4px, 1 màu nhấn.
- Mục AI: **Pipeline**, **Nhà cung cấp** (bảng: tên · loại · `••••last4` · số model · Kiểm tra · icon Sửa / Xoá có xác nhận tại chỗ; form thêm / sửa nằm trên bảng, model + giá USD/1M token, model reasoning có cảnh báo màu `--c-warn`), **Model tác vụ** (3 select OCR / Dịch / Hiệu đính, OCR + Hiệu đính chỉ model có vision).
- Mục Hệ thống: **Hạn mức & đăng ký**, **Người dùng**, **Font hệ thống** (bảng tên · dung lượng · đủ/thiếu dấu · icon Xoá, nút chọn file ở trên; trần 20 font / 100MB). Font hệ thống hiện thành nhóm "Font hệ thống" (trước "Font của bạn") ở picker font series và ô Font của editor; `/fonts` chỉ liệt kê font riêng và giới hạn 20 font không đếm font hệ thống.
- Thêm mục: khai báo trong `features/admin/admin-sections.ts` + panel trong `admin-layout.tsx`. Font cá nhân không nằm ở đây (`/fonts`, menu tài khoản).

## Ngôn ngữ

- Giao diện tiếng Việt, có dấu đầy đủ. Thuật ngữ kỹ thuật giữ nguyên khi người dùng quen (ZIP, CSV, glossary, SFX).
- Trạng thái page nói rõ giai đoạn: "GĐ1 · xoá chữ + OCR", "GĐ2 · đang dịch".
- Hành động có hậu quả nói rõ phạm vi: "Chạy lại trang lỗi", "Dịch lại cả chương (chỉnh sửa tay được giữ nguyên)".

## Việc còn mở

- Đã chốt: ngày 20/10/2026 owner duyệt giữ hướng A và bản thiết kế
  `plans/261020-1944-web-uiux-redesign-chapter-workspace/design/` (Main, Series, Chapter, Drawers).
- Đã chốt 23/10/2026: màn chương "rail công cụ + 1 panel" và bảng màu "Giấy ấm" thay bố cục 4 vùng / nền trắng +
  xanh — brief `plans/261023-0042-chapter-workspace-tool-rail-warm-theme/brief.md`, mockup
  `plans/261023-0042-chapter-workspace-tool-rail-warm-theme/design/chapter-workspace-mockup.dc.html`. Các điểm tự quyết
  khi làm ghi ở mục "Câu hỏi mở" của plan cùng thư mục.
- Đã chốt 06/11/2026: rút gọn UI theo wireframe — panel khối đè canvas tự mở khi chọn khối (không làm thẻ nổi), bỏ icon
  Sửa ở hàng chương (thay quyết định 21/10; icon Sửa ở hàng series giữ, mở cài đặt), rail 5 nút chỉ icon + tooltip, panel
  Văn bản 4 tab, Xuất thành menu dưới nút Xuất. Mục "Màn chương" ở trên mô tả bản này; plan
  `plans/261106-1519-ui-simplify-wireframe/`.
- Ngoài phạm vi đợt này: dark mode / chọn theme; bỏ cột phải "Cài đặt dịch" + "Glossary" ở trang series.
- Ngoài phạm vi: thumbnail do server sinh; sắp xếp tay thứ tự file khi upload (file tự xếp theo tên, natural sort).
