# Brief: màn chương "rail công cụ + 1 panel" và bảng màu Giấy ấm

Owner duyệt ngày 23/10/2026, sau khi so app với translatemanga.net/edit-manga ("tối giản quá") và toriitranslate.com/image
("phức tạp quá"). Đích: **ở giữa hai bên — giữ đủ tính năng, nhưng mỗi lúc chỉ hiện thứ công cụ đang dùng cần đến.**

- Mockup bấm thử (đã duyệt): https://claude.ai/artifact/PBYU67sTzuDXXZsYh2ggyd
- Bản sao trong repo: [`design/chapter-workspace-mockup.dc.html`](./design/chapter-workspace-mockup.dc.html) (định dạng
  Design Component; đọc markup + `renderVals()` để lấy bố cục, nhãn, kích thước, màu — không chạy được ngoài canvas).

## Vấn đề hiện tại (đã đo trên app local, màn 1568×724)

- Màn chương hiện 5 vùng: thanh trên, hàng công cụ, rail trang 196px, inspector 320px, bảng dưới → ảnh còn ~50% rộng ×
  ~55% cao, ảnh mặc định 100% nên bị tràn.
- 4 nhóm tab/chế độ hiện cùng lúc: Gốc/Dịch/Chia đôi · Chọn/Chữ/Mask/Tẩy/OCR vùng · Khối chữ/Xoá chữ · Bản dịch/Tìm Thay/Áp
  glossary.
- Rail trang: mỗi hàng thumbnail + "Trang N" + "Chờ dịch" (bị xuống 2 dòng) + icon xoá, chỉ thấy ~9/32 trang.
- Inspector gần như trống khi chưa chọn khối.
- Home: tên series dài đè lên cột trạng thái "Ch.1 · Chưa xử lý" (lỗi hiển thị).

## Quyết định đã chốt

### Bố cục màn chương (thay bố cục 4 vùng trong `docs/design-guidelines.md`)

```
┌ thanh trên 52px: ‹ series · Chương N · chip trạng thái · Đã lưu ······ hoàn tác · làm lại | Xem gốc · Hoạt động · ⋯ · [nút chính] ┐
├ rail công cụ 64px ┬ panel ngữ cảnh 288px (560px cho Bản dịch) ┬ canvas (ảnh vừa khung) ┬ cột thumbnail 112px ┤
```

1. **Rail công cụ trái (64px, icon + nhãn 11px):** Chọn (V) · Chữ (T) · Mask (B) · Tẩy (E) · OCR (R) · ── · Bản dịch ·
   Tìm. Mỗi icon mở đúng 1 panel; bấm lại icon đang mở → thu panel (canvas rộng ra). Công cụ vẫn là công cụ đang chọn khi
   panel thu.
2. **Panel ngữ cảnh** thay cho: hàng công cụ trên canvas, inspector phải, tab Khối chữ/Xoá chữ, bảng dưới.
   - Chọn + có khối: Gốc (chỉ đọc) · Bản dịch (textarea) · cảnh báo tràn khung · Loại · Font · Cỡ chữ · "Kiểu chữ nâng cao"
     (`<details>` thu gọn: căn lề, giãn dòng, màu, viền, …) · Dịch lại khối · Xoá khối.
   - Chọn + chưa có khối: Trang N · trạng thái · ghi chú lỗi/cần xem · Dịch lại trang này · Ẩn trang.
   - Chữ / Mask / Tẩy / OCR: chỉ thiết lập của công cụ đó (nội dung hiện có ở `MaskPanel`, v.v.).
   - Bản dịch: bảng văn bản cả chương hiện có (`text-table`) trong panel rộng 560px; bấm dòng → mở trang + chọn khối.
   - Tìm: segmented "Tìm / Thay" | "Glossary" (gộp FindReplace + áp glossary hiện có).
3. **Thanh nổi cạnh khối đang chọn:** Sửa chữ · Dịch lại khối · Nhân đôi · Xoá (đỏ). Đặt trên khối, khối sát mép trên thì
   đặt dưới.
4. **Canvas:** mặc định "Vừa khung" (fit), có nút 100%. Điều hướng trang ‹ Trang N / M › nổi góc dưới trái.
5. **Cột thumbnail phải (112px):** chỉ ảnh + số trang. Trạng thái = viền: cần xem viền cam + nhãn "Cần xem", lỗi viền đỏ +
   "Lỗi", trang ẩn mờ + "Đã ẩn"; trang bình thường không có chữ. Trang đang mở: outline màu nhấn. Xoá/ẩn trang → menu
   chuột phải hoặc nút trong panel (không còn icon xoá thường trực trên mỗi hàng). Giữ các tính năng rail hiện có
   (xoá/khôi phục ảnh trước Bước 1, credit, "Có thể là credit") — chỉ đổi cách trình bày.
6. **Thanh trên:** Gốc/Dịch/Chia đôi → 1 nút bật/tắt "Xem gốc" (giữ phím `O` vẫn chạy). Chia đôi, Dịch lại cả chương,
   Chạy lại trang lỗi, Phím tắt → menu "⋯". Hoàn tác/Làm lại thành icon trên thanh trên. Giữ nguyên chip trạng thái,
   băng cảnh báo, nút chính theo trạng thái (`primary-action.ts`), drawer Xuất/Hoạt động.
7. **Không bỏ tính năng nào** — chỉ dời chỗ; mọi tính năng mở được trong ≤1 cú bấm. Phím tắt hiện có giữ nguyên.

### Bảng màu: "Giấy ấm" (áp toàn app, sửa `apps/web/src/styles/tokens.css`)

| Token hiện có | Giá trị mới |
|---|---|
| `--c-bg` | `#fbf9f4` |
| `--c-surface` | `#f3efe6` |
| `--c-surface-2` | `#ebe5d8` |
| `--c-line` | `#e3dccd` |
| `--c-line-strong` | `#cbc1ad` |
| `--c-fg` | `#2a2620` |
| `--c-fg-muted` | `#6b6357` |
| `--c-fg-subtle` | chỉnh cho đạt ≥ 4.5:1 trên `--c-bg` nếu dùng cho chữ, hoặc chỉ dùng cho viền/icon |
| `--c-accent` | `#c2501b` (chữ trắng trên nền này ≈ 4.7:1) |
| `--c-accent-hover` | `#a8430f` (dùng cho chữ nhấn trên `--c-accent-weak`) |
| `--c-accent-weak` | `#f6e3d6` |
| `--c-focus`, `--c-info` | theo `--c-accent` |
| canvas (nền vùng ảnh, token mới nếu chưa có) | `#e7e1d4` |
| `--c-ok` / `--c-warn` / `--c-danger` | giữ `#1d7a3e` / `#a15c00` / `#b42318`; nền nhãn cam `#fdf0dc`, đỏ `#fbe7e4` |

Ảnh trang, bóng thoại, chữ chèn trên ảnh không đổi theo theme. Không thêm dark mode trong đợt này.

### Lỗi kèm theo (sửa trong đợt này)

- Home: tên series dài phải cắt bằng "…" (có `title` hiện tên đầy đủ), không đè cột trạng thái. Kiểm tra cùng lỗi ở hàng
  chương của trang series.

## Ngoài phạm vi / chưa chốt (không làm, ghi vào "Câu hỏi mở" của plan)

- Bỏ cột phải "Cài đặt dịch" + "Glossary" ở trang series (trùng tab) — chưa được owner duyệt.
- Dark mode / cho người dùng chọn theme.
- Thay đổi backend, schema, API.

## Ràng buộc

- Đọc `docs/design-guidelines.md`, `docs/editor.md`, `docs/development-setup.md` trước khi làm. Cập nhật
  `docs/design-guidelines.md` (mục Màn chương, Token) và `docs/editor.md` cho khớp bố cục mới.
- Danh sách cấm trong design-guidelines vẫn áp dụng (không gradient, không glass, không emoji, 1 màu nhấn, bo góc ≤ 8px).
- Icon chỉ-có-icon phải có `aria-label`; tooltip có phím tắt; vùng bấm ≥ 32px trên desktop.
- Không đặt mã plan/phase trong comment, tên test, commit message.
- Kiểm tra: `pnpm typecheck && pnpm lint && pnpm test` (cần `pnpm infra:up`), `pnpm --filter @mtl/web e2e`. E2E chạy
  viewport 1920×1080 và có thể đang kiểm tra bố cục 4 vùng cũ → sửa test theo bố cục mới, không xoá test để cho qua.
