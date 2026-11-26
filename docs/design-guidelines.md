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
| Thanh trên 52px | ‹ series (tên dài cắt "…", `title` đủ tên) · "Ch.N" bấm được (popover: đổi series, số chương + Lưu) · **chip ngôn ngữ** "🌐 Hàn → Việt" (viền + icon, bấm → popover riêng ngôn ngữ gốc / Dịch sang + Lưu) · **chip trạng thái** (nút: có trang cần xem → nhảy tới trang đó, không thì mở Hoạt động; chip nói cả lượt xuất đang chạy) · chỉ báo khoá/lưu **chỉ khi đang lưu / chưa lưu / lỗi / chỉ xem** · Hoàn tác / Làm lại (icon) · **Gốc** (bật/tắt, `aria-pressed`) · menu **⋯** (Chia đôi gốc / dịch, Xuất khi chương có trang lỗi, Dịch lại cả chương (không OCR lại; tooltip chỉ sang Quét lại trang), Hoạt động kèm số việc đang chạy, Phím tắt) · nút chính. Đang chạy: nút chính là **Huỷ** + vạch tiến độ 2px ở đáy thanh. Chương có trang lỗi: nút chính "Chạy lại N trang". Không còn chữ "Export": luôn "Xuất" |
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
  mặc định tiếng Việt; Enter = Tạo series, tạo xong mở màn series), thanh xem danh sách (xem dưới) và lưới thẻ series
  (ảnh bìa tự động hoặc bìa riêng, chưa có ảnh thì ô chữ cái đầu; tên dài cắt "…" + `title`, chấm + trạng thái, "N ch";
  bấm thẻ để mở, icon Sửa → modal Cài đặt dịch, icon Xoá hiện sẵn, xác nhận phủ ngay trên thẻ rồi xoá cả series). Không có tiêu đề "Series · N". Nút Hoạt động của app shell chỉ hiện
  khi có chương đang tải ảnh; menu tài khoản giữ Font / Cài đặt.
- **Series** (một cột): ‹ về home (không breadcrumb), tên, cặp ngôn ngữ, "Glossary · N" và icon Cài đặt (cả hai mở modal,
  `?tab=` giữ trạng thái modal); dải thả "Thả Ch.{next}" (series cố định, cũng tự tạo chương nháp); lưới thẻ chương
  (ảnh trang đầu, "Ch.N" + tên chương nếu có, chấm + trạng thái, thời gian, icon Xoá xác nhận tại chỗ; bấm cả thẻ để mở
  — **không** có icon Sửa; vạch tiến độ dưới ảnh chỉ khi đang chạy). Thẻ không có nút "bước tiếp theo": dịch / xuất / chạy lại làm trong màn chương.
- **Thanh xem danh sách** (home cạnh ô tìm; màn series canh phải trên danh sách chương): "Sắp xếp theo" (home: Hoạt
  động gần nhất · Tên · Ngày tạo · Số chương; series: Số chương · Cập nhật · Ngày tạo), nút đảo chiều có nhãn theo nghĩa
  ("A→Z", "Mới trước", "Tăng dần"…; đổi tiêu chí thì về chiều mặc định của tiêu chí), cặp icon Lưới / Danh sách.
  Danh sách = cùng thẻ bỏ ảnh, một hàng (tên cắt "…", chấm + trạng thái, số chương / thời gian, icon), xác nhận xoá mở
  thành dòng dưới hàng, vạch tiến độ 3px dưới hàng chương đang chạy; ≤ 480px tên lên dòng riêng. Mỗi màn nhớ lựa chọn
  riêng trong localStorage; mặc định lưới + thứ tự cũ (series: hoạt động mới trước; chương: số tăng dần).
  **Cài đặt dịch** (modal 620px): bốn nhóm luôn hiện, cùng khung `SetGroup` (tiêu đề + thẻ trắng) với trang Cài đặt, hàng
  nhãn | ô (ô chữ dài và bảng xếp dọc; màn ≤ 640px xếp dọc hết): **Series** (Tên, Ảnh bìa, Ngôn ngữ "Dịch từ → Sang",
  Định dạng — áp cho chương upload sau), **Hướng dẫn cho AI** (mô tả "AI đọc mục này mỗi lần dịch…"; Giọng văn, Kính ngữ,
  bảng Xưng hô, dòng "Glossary: N thuật ngữ · Mở" mở modal glossary), **Font chữ** (thoại, dẫn truyện, suy nghĩ, ghi
  chú), **Bỏ qua khi dịch** (Chữ bỏ qua, Ảnh tự bỏ). Mục AI ghi có chip "AI". Không có nút Lưu: ô chọn lưu khi đổi, ô
  chữ (Tên, Giọng văn, Chữ bỏ qua) chỉ lưu khi rời ô, không lưu giữa lúc gõ (tên trống / "Chữ bỏ qua" sai không lưu);
  xưng hô lưu các hàng đủ ô khi rời hàng, Xoá hàng lưu ngay; hàng thiếu ô báo đỏ tại hàng, ở lại trên form, không chặn
  lưu và bị bỏ khi đóng modal. Đóng modal thì lưu nốt; mỗi lượt chỉ gửi trường vừa đổi. Footer: "Xoá series"
  (link đỏ, bấm mới hiện ô gõ tên) trái, trạng thái "Đang lưu… / Đã lưu / lỗi" phải. Hint nằm trong ⓘ.

## Thành phần

- **Nút**: `button` (viền), `.btn-primary` (1 nút chính mỗi vùng), `.btn-ghost` (thao tác phụ trong bảng), `.btn-danger` (chữ đỏ, không nền đỏ); `.btn-danger-solid` (nền đỏ) chỉ cho nút xác nhận xoá. Nút chỉ có icon: `.icon-btn` (34px, bắt buộc `aria-label`). Link dạng nút: `<Link className="btn">`.
- **Bảng**: `table.data`; số căn phải `.num` (tabular-nums). Sửa tại chỗ thay vì modal khi được.
- **Trạng thái**: `<span class="status" data-tone="ok|busy|warn|danger|idle">` — chấm màu + chữ. Nhãn chương/page ở `features/chapter/status.ts`.
- **Thông báo**: `.notice` (+ `.info`, `.danger`) — viền trái màu, nền surface. Lỗi API hiện message server.
- **Tiến độ**: `.bar > span` cao 3px.
- **Giải thích ngắn**: ⓘ (`app/info-tip.tsx`) thay cho dòng hint dưới trường — hiện khi rê chuột, focus bàn phím hoặc bấm; nội dung gắn vào nút qua `aria-describedby`.
- **Bố cục**: `.page` (+ `.page-narrow` 880px cho form), `.page-head` (tiêu đề + spacer + nút), `.crumbs`, `.grid-2`, `.section`.

## Cài đặt (`/settings`)

- Mọi người dùng đăng nhập vào được; người thường chỉ thấy nhóm "Chung" (mục **Font**), nhóm "AI" và "Hệ thống" chỉ admin (`ADMIN_EMAILS`). Mỗi mục ở thanh trái và tiêu đề nhóm có icon. Bố cục: thanh mục trái (mục = link `?section=`) + 1 panel phải, tối đa 820px. Mục đang chọn = chữ `--c-accent-hover` + nền `--c-accent-weak`; không gradient, 1 màu nhấn.
- Khung chung (`features/admin/settings-ui.tsx`): `SectionHead` (tiêu đề + mô tả + vùng phải cho trạng thái / nút), `SetGroup` (tiêu đề nhỏ + mô tả + thẻ `.set-card` nền trắng, viền `--c-line`, bo 6px), `SetRow` (nhãn + giải thích bên trái, ô điều khiển bên phải; màn < 720px xếp dọc). Giải thích nằm dưới nhãn, gắn vào ô qua `aria-describedby`.
- Mục AI: **Pipeline** chia theo bước xử lý trang (Phát hiện chữ → Đọc chữ (OCR engine theo ngôn ngữ + model AI đọc chữ) → Xoá chữ → Dịch → Hiệu đính); model AI của từng bước nằm ngay trong bước đó (`<optgroup>` theo nhà cung cấp, bước cần ảnh chỉ hiện model vision, "Tự động (model)" = để trống: lúc tạo job lấy model đầu tiên phù hợp theo thứ tự thêm nhà cung cấp / model, không có thì worker dùng key .env). Tự lưu: select lưu khi đổi, ô số lưu khi rời ô / Enter nếu hợp lệ; trạng thái "Đang lưu… / Đã lưu / lỗi" ở đầu mục; "Về mặc định" hỏi lại tại chỗ và giữ model AI. `?section=tasks` cũ rơi về Pipeline. **Nhà cung cấp**: danh sách thẻ (tên · chip loại · `••••last4` · chip model kèm "vision" · Kiểm tra · icon Sửa / Xoá có xác nhận tại chỗ); form sửa mở ngay trong thẻ, form thêm ở đầu danh sách. Form thêm chỉ cần chọn nhà cung cấp (nút Anthropic · OpenAI · Google Gemini · DeepSeek · Khác) + dán key: tên và model gợi ý đầu tiên (kèm giá, cờ vision) điền sẵn, chỉnh ở mục thu gọn "Tuỳ chỉnh tên, model và giá"; "Khác" (endpoint tương thích OpenAI) không có gợi ý nên hiện base URL và mở sẵn mục tuỳ chỉnh; model + giá USD/1M token có dòng tiêu đề cột, model reasoning có cảnh báo màu `--c-warn`.
- Mục Hệ thống (ẩn ở chế độ local): **Người dùng**. Hạn mức chi phí và đăng ký không có trên UI — chỉ cấu hình trong `.env`.
- Thêm mục: khai báo trong `features/admin/admin-sections.ts` + panel trong `admin-layout.tsx`.

## Mục Font (`/settings?section=fonts`, menu tài khoản › Font)

- Chỗ duy nhất quản lý font, một mục của Cài đặt (dùng chung khung `SectionHead` / `SetGroup` / `SetRow`). Đường dẫn cũ
  `/fonts` chuyển hướng về đây.
- **Thêm font**: "Chọn font trong máy" (Local Font Access API `queryLocalFonts`, chỉ Chrome / Edge máy tính, trang https hoặc localhost; trình duyệt hỏi quyền lần đầu) mở danh sách có ô tìm, ô tích và dòng xem trước bằng chính font đó; font đã thêm bị khoá, số font tích được ≤ chỗ còn trống. Font chọn được upload như font riêng vì worker vẽ ảnh xuất bằng đúng file font. Chỉ TTF / OTF ≤ 10MB; font trong bộ TTC báo không hỗ trợ. Trình duyệt khác chỉ có ô "Tải file" (nhiều file một lần). Admin bản nhiều người có thêm "Cho mọi người dùng" → upload thành font dùng chung.
- **Font đã thêm**: một bảng chung cho font dùng chung (nhãn "Dùng chung", chỉ admin xoá, hỏi lại tại chỗ) và font riêng; mô tả đếm `n / giới hạn` font riêng (bản nhiều người 20, local 200 — `userFontLimit` ở `@mtl/shared`).
- **Font có sẵn**: lưới font gói sẵn (manifest), tên + dòng xem trước; font thiếu dấu có nhãn cảnh báo.
- Trong ô chọn font (editor, cài đặt series) font tải lên nằm ở 2 nhóm "Font dùng chung" rồi "Font của bạn".

## Ngôn ngữ

- Giao diện hai ngôn ngữ: tiếng Việt (bản gốc, có dấu đầy đủ) và English. Thuật ngữ kỹ thuật giữ nguyên khi người dùng
  quen (ZIP, CSV, glossary, SFX). Bản English dùng thuật ngữ scanlation: clean (xoá chữ), Script (panel Văn bản),
  Proofread (hiệu đính), slice (cắt trang), band (dải); công cụ Tẩy chữ là **Clean** với hai chế độ Brush / Eraser.
- Trạng thái page nói rõ giai đoạn: "GĐ1 · xoá chữ + OCR", "GĐ2 · đang dịch".
- Hành động có hậu quả nói rõ phạm vi: "Chạy lại trang lỗi", "Dịch lại cả chương (chỉnh sửa tay được giữ nguyên)".

## i18n (chữ giao diện theo ngôn ngữ)

Từ điển tự viết trong `apps/web/src/i18n/`, không dùng thư viện. Người dùng đổi ngôn ngữ ở cột trái `/settings`
(ô "Ngôn ngữ giao diện"); trình duyệt không phải tiếng Việt và chưa chọn gì thì tự vào English. Lựa chọn lưu ở
localStorage `mtl.locale` và đồng bộ lên `user.ui_locale` (`PUT /api/me/locale`) để AI viết `style_note` / lý do hiệu
đính theo ngôn ngữ đó.

- **Chuỗi mới** ghi vào cả `messages/vi.json` và `messages/en.json`. Test parity bắt hai file cùng key, cùng tập
  placeholder `{name}` và không chuỗi rỗng. `vi` là bản gốc, đóng gói sẵn và là fallback khi key thiếu.
- **Key** phẳng, theo feature + file: `chapter.topbar.chipAria`, `series.newSeriesDialog.title`, `errors.<mã>`. Bảng tra
  theo mã giữ mã nguyên văn ở cuối key (`chapter.jobError.class.rate_limited`) và đi qua map `Record<mã, MessageKey>`;
  không ghép key động. `MessageKey = keyof vi.json` nên gõ sai key là lỗi typecheck.
- **Hàm** (`i18n/t.ts`): `t(key, params)`; `tp(key, count, params)` cho số nhiều (cặp `<key>.one` / `<key>.other`,
  bản `vi` cũng có cả hai); `tNode(key, nodes)` khi câu chứa phần tử JSX (nút, `<b>`), để từng ngôn ngữ tự đặt thứ tự
  từ; `useT()` trong component để vẽ lại khi đổi ngôn ngữ. Số / ngày dùng `fmtNumber`, `fmtDate`, `collator` ở
  `i18n/format.ts`, không ghim `"vi-VN"`.
- **Hằng module-level** có chữ sẽ giữ ngôn ngữ cũ. Gọi `t()` lúc render, đổi hằng thành hàm, hoặc giữ shape và đổi nhãn
  thành getter (`get label() { return t(...) }`) khi test hay file khác đọc hằng đó. `useMemo` tính sẵn chữ thì thêm
  `locale` vào deps.
- **Guard** `no-hardcoded-vietnamese.test.ts` chặn chữ có dấu tiếng Việt viết thẳng trong `apps/web/src` và
  `packages/shared/src` (bỏ comment, `*.test.*`, `i18n/messages/`). Chỉ dữ liệu được vào `ALLOWLIST`, theo dòng
  (`line`) và kèm `reason`: mẫu chữ xem trước font, regex tên file, tên bản địa "Tiếng Việt", `LANG_NAMES` cho prompt.
  Guard không bắt chữ không dấu (ví dụ `title="Font"`), nên soát tay khi thêm chữ ASCII.
- **Lỗi API**: route ném `apiError(status, "<mã>", params)` (`apps/api/src/lib/api-error.ts`). Body là
  `{ error, variant?, message, params }`, trong đó `message` là câu tiếng Việt cũ cho client cũ. Mã mới thêm vào
  `API_ERROR_MESSAGES_VI` (`packages/shared/src/api-errors.ts`) và `errors.<error>[.<variant>]` ở cả hai JSON;
  `api-error-keys.test.ts` bắt câu `vi.json` trùng câu API. Web (`errorMessage`, `apiErrorText` ở `lib/api.ts`) dịch theo
  mã; mã lạ ở locale khác `vi` hiện `errors.unknown` kèm mã.
- **Lỗi job** hiện nhãn theo `error_class` (`features/chapter/job-error.ts`); chi tiết thô của worker là tiếng Anh kỹ
  thuật và chỉ nằm ở `title` / "Chi tiết kỹ thuật".
- **Thêm locale**: tạo `messages/<code>.json` đủ key, thêm một dòng vào `LOCALES` (`i18n/locales.ts`, `load: () =>
  import(...)`) và mã đó vào `UI_LOCALES` (`packages/shared/src/ui-locale.ts`; test web bắt hai danh sách khớp). Không
  cần nâng worker: payload job chỉ kiểm dạng mã ngôn ngữ (`ui_lang`, regex trong `packages/shared/src/job.ts`), mã
  worker chưa biết tên thì đi nguyên vào prompt. `PUT /api/me/locale` vẫn chỉ nhận mã trong `UI_LOCALES`.
- **E2E**: Playwright ghim `locale: "vi-VN"` nên spec cũ chọn theo chữ Việt. Spec tiếng Anh đặt
  `test.use({ locale: "en-US" })` (`i18n-en-smoke.spec.ts`, `settings-language.spec.ts`).
- **Bố cục**: chữ English thường dài hơn. Nhãn trong ô hẹp được xuống dòng thay vì cắt "…" (trạng thái trên thẻ, cột
  bảng), thanh công cụ nổi rộng theo nội dung tới mép canvas rồi mới xuống dòng.

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
- Cập nhật 16/11/2026: danh sách một dòng ở Home và màn series đổi thành lưới thẻ có ảnh (quy tắc giữ nguyên: icon Xoá /
  Sửa hiện sẵn, xác nhận xoá tại chỗ, không giấu sau chuột phải). Cài đặt series có mục "Ảnh bìa" (tải bìa riêng hoặc
  về ảnh tự động); plan `plans/261116-1129-folder-drop-and-manga-grid/`.
- Cập nhật 19/11/2026: thêm thanh xem danh sách (sắp xếp + Lưới / Danh sách) ở Home và màn series; plan
  `plans/261119-0804-list-sort-view-toggle/`.
- Cập nhật 25/11/2026: bỏ glossary chung; Cài đặt series thành 4 nhóm luôn hiện (Giọng văn, Kính ngữ, Xưng hô gộp vào
  "Hướng dẫn cho AI") và tự lưu, bỏ nút Lưu; plan `plans/261125-1730-remove-global-glossary-series-settings-redesign/`.
- Ngoài phạm vi đợt này: dark mode / chọn theme; bỏ cột phải "Cài đặt dịch" + "Glossary" ở trang series.
- Ngoài phạm vi: thumbnail do server sinh; sắp xếp tay thứ tự file khi upload (file tự xếp theo tên, natural sort).
