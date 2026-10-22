# Design guidelines (web)

Áp cho mọi màn của `apps/web` (màn chương gộp dùng lại cùng token). Token nằm ở
`apps/web/src/styles/tokens.css` — không hard-code màu/khoảng cách trong component nếu token đã có.

## Hướng thiết kế

Đã cân nhắc 3 hướng; **chọn A** cho MVP (owner đã duyệt 20/10/2026; bảng màu đổi sang "Giấy ấm" 23/10/2026 — xem
"Việc còn mở").

| Hướng | Mô tả | Hợp | Không hợp |
|---|---|---|---|
| **A. Bảng làm việc dày (đang dùng)** | Nền giấy ấm `#fbf9f4`, thang ấm trung tính, 1 màu nhấn cam đất `#c2501b`; bảng dày (13px), thanh trên 44px, trạng thái = chấm màu + chữ | Nhóm dịch xử lý hàng trăm trang/chương, cần quét nhanh trạng thái | Ít "cảm xúc" — chấp nhận, đây là công cụ |
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
| Trạng thái | `--c-ok` `#1d7a3e`, `--c-warn` `#a15c00`, `--c-danger` `#b42318`, `--c-info` = nhấn | |
| Nền nhãn trạng thái | `--c-warn-weak` `#fdf0dc`, `--c-danger-weak` `#fbe7e4` | nhãn "Cần xem" / "Lỗi" (chữ warn 4.62:1, danger 5.53:1), cảnh báo tràn khung |
| Chữ | `--font-ui` (Be Vietnam Pro → Inter → system), `--font-mono` | cỡ `--fs-xs` 12 … `--fs-xl` 20; mặc định 14px |
| Khoảng cách | `--sp-1`…`--sp-6` (4, 8, 12, 16, 24, 32) | lưới 4px |
| Bo góc | `--radius` 4px | |

Font UI tự host qua `@fontsource/be-vietnam-pro` (400/500/600) — không gọi Google Fonts lúc chạy. Konva không đọc
được CSS variable: màu khung chọn / khung OCR ở `features/editor/canvas/colors.ts`, phải khớp `--c-accent`.

Quy tắc tương phản: chữ ≥ 4.5:1, icon/viền mang thông tin ≥ 3:1. Nút chỉ có icon có `aria-label`; tooltip ghi phím
tắt nếu có; vùng bấm ≥ 32px trên desktop.

## Màn chương

Toàn màn hình (ngoài app shell), `chapter-workspace.css`. Nguyên tắc (owner chốt 23/10/2026): giữ đủ tính năng nhưng
**mỗi lúc chỉ hiện thứ công cụ đang dùng cần đến** — 1 rail công cụ + 1 panel ngữ cảnh.

```
┌ thanh trên 52px: ‹ series · Chương N · chip · Đã lưu ····· ↶ ↷ | Xem gốc · Hoạt động · ⋯ · [Huỷ][Xuất] [nút chính] ┐
├ (băng cảnh báo — chỉ khi có)                                                                                     ┤
├ rail công cụ 64px ┬ panel 288px (560: Bản dịch, Tìm) ┬ canvas (vừa khung, ‹ Trang n/M ›, Vừa khung|100%) ┬ thumbnail 112px ┤
```

| Vùng | Nội dung |
|---|---|
| Thanh trên 52px | ‹ series (tên dài cắt "…", `title` đủ tên) · tên chương · chip trạng thái · khoá/lưu · Hoàn tác / Làm lại (icon) · **Xem gốc** (bật/tắt, `aria-pressed`) · Hoạt động · menu **⋯** (Chia đôi gốc / dịch, Dịch lại cả chương, Chạy lại trang lỗi, Phím tắt) · Huỷ xử lý / Xuất phụ khi có · nút chính |
| Rail công cụ trái 64px | Chọn (V) · Chữ (T) · Mask (B) · Tẩy (E) · OCR (R) · ── · Bản dịch · Tìm. Icon 20px + nhãn 11px, nút 52×52. Nút đang mở panel của nó: nền `--c-accent-weak`; công cụ đang chọn mà panel thu: chỉ chữ màu nhấn |
| Panel ngữ cảnh 288px | Theo công cụ: **Chọn** (có khối: Gốc, Bản dịch, tràn khung, font/cỡ, "Kiểu chữ nâng cao" thu gọn, Dịch lại khối, Xoá khối; chưa có khối: trang + trạng thái + cờ + Dịch lại trang này / Ẩn trang này; chưa có page: ảnh gốc đang xem), **Chữ**, **Mask / Tẩy** (Tô ↔ Tẩy nét, cỡ bút, xoá chữ vùng đã tô), **OCR**. Bấm lại icon đang mở → thu panel, canvas rộng ra. Nhớ theo trình duyệt (`localStorage mtl.layout`) |
| Panel rộng 560px | **Bản dịch** (bảng văn bản cả chương: #, Tr., Gốc, Dịch sửa tại chỗ, Tình trạng) và **Tìm** (segmented "Tìm / Thay" \| "Glossary") |
| Canvas | Trang active, mặc định **Vừa khung**; nút 100% (giữ khi đổi trang); pager "‹ Trang n / M ›" góc dưới trái; thanh nổi cạnh khối đang chọn (Sửa chữ · Dịch lại khối · Nhân đôi · Xoá đỏ) — đặt trên khối, khối sát mép trên thì dưới |
| Cột thumbnail phải 112px | Chỉ ảnh 72×100 + số trang. Trạng thái = viền + nhãn ngắn khi có vấn đề: "Đã ẩn" (mờ, viền đứt) · "Lỗi" (viền đỏ) · "Chờ AI" / "Cần xem" (viền cam); trang bình thường không chữ (trạng thái ở `aria-label`). Trang đang mở: outline màu nhấn. Ẩn / khôi phục trang, xoá / khôi phục ảnh gốc: menu chuột phải (Shift+F10) hoặc nút panel Chọn. Có trang cần xem → nút lọc "Cần xem k" |

- **Tên chương** ("Chương N") bấm được → popover đổi series (select) / số chương (`chapter-meta-popover.tsx`,
  `PATCH /chapters/:id`; trùng số → báo lỗi tại chỗ; đổi series → URL theo series mới).
- **Trạng thái chương ở 1 chỗ**: chip cạnh tên chương (`status.ts` `chapterChip`, `role="status"`, aria-live
  polite): "Đang tải ảnh 2/5", "Đang dịch 3/5", "Chờ duyệt · 2 cần xem", "Xong". Cột thumbnail chỉ giữ trạng thái
  theo trang. Cạnh chip: chỉ báo nhỏ khoá + lưu (icon khoá + Đã lưu / Đang lưu…, hoặc "Chỉ xem").
- **Băng cảnh báo** (`LockBand`, `role="alert"`): chỉ hiện khi người dùng phải biết/làm — người khác giữ khoá (Thử
  lại), lỗi khoá, mất khoá, khôi phục thay đổi từ phiên trước, lỗi lưu, trang đang chờ AI tự thử lại (provider lỗi
  tạm / 429 hết hạn mức: "trang 1, 2 đang chờ, tự thử lại lúc HH:MM … muốn dừng thì bấm Huỷ xử lý"). Trạng thái bình
  thường không chiếm dải.
- **Lỗi job viết cho người** (`job-error.ts`): thumbnail (title) / panel Chọn / Hoạt động nói loại lỗi + việc cần làm
  ("Dịch lại trang này", "Chạy lại trang lỗi"); lỗi thô của provider (JSON dài) chỉ nằm trong "Chi tiết kỹ thuật" thu
  gọn ở panel Chọn.
- **Thông báo kết quả** (dịch lại, áp kiểu, lỗi thao tác): nổi trên canvas, không đẩy bố cục; info tự ẩn sau 6s.
  Bước 1 / Bước 2 thành công không báo thêm (chip đã đổi); Bước 1 có ảnh bị loại → giữ thông báo tới khi chương xử
  lý xong.
- **Menu nổi** (`context-menu.tsx`, dùng chung cho chuột phải thumbnail và "⋯"): `role="menu"`, ↑/↓, Esc trả focus về
  nút mở; mục bật/tắt là `menuitemcheckbox`.

- **Nút chính** (1 nút, theo trạng thái chương, `primary-action.ts`): Tải ảnh → **Bước 1 · Xoá chữ + OCR** (= commit:
  ghép + cắt trang, xoá chữ, OCR; khoá tới khi upload xong, không bao giờ tự chạy) → chương "Chờ dịch" (soát ảnh
  sạch, sửa mask) → **Bước 2 · Dịch** (dịch + chèn chữ) → "Xuất" khoá trong lúc chạy (tiến độ ở chip: "Bước 1 · OCR
  x/N", "Đang dịch x/N") → Xuất. Chương có trang lỗi: "Chạy lại trang lỗi";
  "Dịch lại cả chương" / "Chạy lại trang lỗi" (khi có) nằm trong menu "⋯".
- **Drawer phải 420px** (`app/drawer.tsx`): Xuất (cảnh báo "Trước khi xuất", định dạng, tải) và Hoạt động (upload +
  job chương + lượt xuất). Không dùng modal cho thao tác chính. Chi tiết: [editor.md](./editor.md).
- **Home** (`/`): vùng thả file lớn (đoán được series → tạo chương nháp + upload + mở màn chương, chờ bấm Bước 1; không
  đoán được / file lỗi → dòng xác nhận "Sau khi thả file"; chọn "+ Series mới…" thì có thêm select ngôn ngữ gốc) →
  hàng series (tên dài cắt "…" + `title`, không đè cột trạng thái; bấm hàng để mở, icon Sửa → tab Cài đặt,
  icon Xoá xác nhận tại chỗ rồi xoá cả series — chỉ admin/owner). **Series**: đầu trang +
  tab Chương / Glossary / Cài đặt dịch (`?tab=`) dùng chung; tab Chương = vùng thả cho chương kế (series cố định, cũng
  tự tạo chương nháp) + hàng chương (bấm cả hàng hoặc icon Sửa để mở, icon Xoá xác nhận tại chỗ). Hàng danh sách không
  có nút "bước tiếp theo" — dịch / xuất / chạy lại làm trong màn chương. Ngoài icon Xoá ở home, cuối tab Cài
  đặt cũng xoá được series (gõ tên để xác nhận, chỉ admin/owner). Tạo series (home) = tên + select ngôn ngữ gốc; tab Cài đặt sửa
  ngôn ngữ gốc / đích và định dạng truyện (Cuộn dọc / Từng trang — áp cho chương upload sau khi lưu).

## Thành phần

- **Nút**: `button` (viền), `.btn-primary` (1 nút chính mỗi vùng), `.btn-ghost` (thao tác phụ trong bảng), `.btn-danger` (chữ đỏ, không nền đỏ); `.btn-danger-solid` (nền đỏ) chỉ cho nút xác nhận xoá. Nút chỉ có icon: `.icon-btn` (34px, bắt buộc `aria-label`). Link dạng nút: `<Link className="btn">`.
- **Bảng**: `table.data`; số căn phải `.num` (tabular-nums). Sửa tại chỗ thay vì modal khi được.
- **Trạng thái**: `<span class="status" data-tone="ok|busy|warn|danger|idle">` — chấm màu + chữ. Nhãn chương/page ở `features/chapter/status.ts`.
- **Thông báo**: `.notice` (+ `.info`, `.danger`) — viền trái màu, nền surface. Lỗi API hiện message server.
- **Tiến độ**: `.bar > span` cao 3px.
- **Bố cục**: `.page` (+ `.page-narrow` 880px cho form), `.page-head` (tiêu đề + spacer + nút), `.crumbs`, `.grid-2`, `.section`.

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
  khi làm (panel Tìm 560px, "Loại" chỉ đọc, thumbnail 72×100…) ghi ở mục "Câu hỏi mở" của plan cùng thư mục.
- Ngoài phạm vi đợt này: dark mode / chọn theme; bỏ cột phải "Cài đặt dịch" + "Glossary" ở trang series.
- Ngoài phạm vi: thumbnail do server sinh; sắp xếp tay thứ tự file khi upload (file tự xếp theo tên, natural sort).
