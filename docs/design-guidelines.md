# Design guidelines (web)

Áp cho mọi màn của `apps/web` (Phase 4 dựng nền, Phase 5 editor dùng lại). Token nằm ở
`apps/web/src/styles/tokens.css` — không hard-code màu/khoảng cách trong component nếu token đã có.

## Hướng thiết kế

Đã cân nhắc 3 hướng; **chọn A** cho MVP. Owner chưa duyệt — xem "Việc còn mở".

| Hướng | Mô tả | Hợp | Không hợp |
|---|---|---|---|
| **A. Bảng làm việc dày (đang dùng)** | Nền trắng, thang xám trung tính, 1 màu nhấn xanh `#1f4fd1`; bảng dày (13px), thanh trên 44px, trạng thái = chấm màu + chữ | Nhóm dịch xử lý hàng trăm trang/chương, cần quét nhanh trạng thái | Ít "cảm xúc" — chấp nhận, đây là công cụ |
| B. Tài liệu thoáng | Cột giữa 720px, chữ 15–16px, nhiều khoảng trắng, thẻ thay bảng | Người mới, ít dữ liệu | Lưới 150 trang + glossary vài trăm dòng phải cuộn rất dài |
| C. Tối kiểu IDE | Nền tối `#16161a`, panel chia cột, phím tắt nổi bật | Editor (Phase 5) làm việc lâu với ảnh | Màn quản lý (series, glossary) khó đọc bảng dày; ảnh manhwa nền trắng chói trên nền tối |

Phase 5 có thể đổi riêng vùng canvas của editor sang nền xám trung tính để nhìn ảnh, nhưng giữ cùng token chữ/nhấn.

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
| Màu nền | `--c-bg`, `--c-surface`, `--c-surface-2` | surface cho header bảng, hover, vùng thả file |
| Viền | `--c-line`, `--c-line-strong` | input dùng `line-strong` |
| Chữ | `--c-fg`, `--c-fg-muted`, `--c-fg-subtle` | |
| Nhấn | `--c-accent`, `--c-accent-hover`, `--c-accent-weak` | nút chính, link, tab đang chọn, thanh tiến độ |
| Trạng thái | `--c-ok`, `--c-warn`, `--c-danger`, `--c-info` | |
| Chữ | `--font-ui` (Be Vietnam Pro → Inter → system), `--font-mono` | cỡ `--fs-xs` 12 … `--fs-xl` 20; mặc định 14px |
| Khoảng cách | `--sp-1`…`--sp-6` (4, 8, 12, 16, 24, 32) | lưới 4px |
| Bo góc | `--radius` 4px | |

Font UI tự host qua `@fontsource/be-vietnam-pro` (400/500/600) — không gọi Google Fonts lúc chạy.

## Thành phần

- **Nút**: `button` (viền), `.btn-primary` (1 nút chính mỗi vùng), `.btn-ghost` (thao tác phụ trong bảng), `.btn-danger` (chữ đỏ, không nền đỏ). Link dạng nút: `<Link className="btn">`.
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

- Owner duyệt hướng A (hoặc chọn B/C) trước khi Phase 5 làm editor.
