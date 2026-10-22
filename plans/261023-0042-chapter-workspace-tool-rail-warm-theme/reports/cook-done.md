# Cook xong: màn chương "rail công cụ + 1 panel" + bảng màu Giấy ấm

Ngày: 23/10/2026 · nhánh `feat/chapter-workspace-tool-rail` (chưa push) · plan: [plan.md](../plan.md) (status completed,
6/6 phase completed).

## Đã làm (commit theo thứ tự)

| Commit | Nội dung |
|---|---|
| `eae27eb` style(web) | Token Giấy ấm (`tokens.css`, +`--c-canvas`, `--c-warn-weak`, `--c-danger-weak`), chữ màu nhấn → `--c-accent-hover`, màu Konva `canvas/colors.ts`; tên series dài cắt "…" + `title` (home, trang series, thanh trên màn chương) |
| `3bc39a6` feat(web) | Rail công cụ 64px + panel ngữ cảnh 288/560px (nhớ `localStorage mtl.layout`), Hoàn tác/Làm lại lên thanh trên; bỏ hàng công cụ, bảng dưới, tablist Khối chữ/Xoá chữ |
| `2a667a1` feat(web) | Cột thumbnail 112px (viền + nhãn Đã ẩn/Lỗi/Chờ AI/Cần xem, `aria-label` đủ trạng thái), menu chuột phải dùng chung (Shift+F10), "Ẩn trang"/"Xoá ảnh" qua menu + nút panel |
| `62f1192` feat(web) | Panel Chọn (có khối / chưa có khối / ảnh gốc), panel Chữ, OCR, Mask (Tô ↔ Tẩy nét); `Properties` → `BasicStyle` + `AdvancedStyle` ("Kiểu chữ nâng cao"); bảng văn bản 5 cột trong panel 560px; Tìm = segmented Tìm/Thay · Glossary |
| `a0f648c` feat(web) | Thanh nổi cạnh khối (Sửa chữ · Dịch lại khối · Nhân đôi · Xoá), nút Xem gốc, menu ⋯ (Chia đôi, Dịch lại cả chương, Chạy lại trang lỗi, Phím tắt), pager + Vừa khung/100%; `duplicateBox`, `blockBarPos`, `fitView` + test |
| `f625f86` fix(web) | Căn thẳng mục menu ⋯ |
| `7df18ee` test(web) | E2E theo bố cục mới (+ helper `openPanel`, `openFind`, `pageThumb`…), 3 e2e mới (thu/mở panel, thanh nổi, tên series dài); docs |
| `4fbced2` fix(web) | Sửa theo code review (xem dưới) |

Docs đã cập nhật: `docs/design-guidelines.md` (hướng A, Token, Màn chương, Việc còn mở), `docs/editor.md`,
`docs/export-and-batch-edit.md`, `docs/development-setup.md`, `README.md`.

## Code review (subagent, [báo cáo](./code-reviewer-261023-chapter-workspace-diff-report.md)) → đã sửa

- H1 xung đột khi lưu chỉ hiện ở panel Chọn → có thể mất khi đổi trang: nay ở đầu mọi panel + tự mở panel khi thu.
- H2 panel Tìm unmount khi chương chạy lại → mất "Hoàn tác": nay giữ mount sau lần mở đầu.
- M1 canvas không vừa lại khi panel thu/mở/đổi rộng sau khi đổi trang: thêm vừa lại theo khung mới.
- M2 menu toàn mục tắt không đóng được bằng bàn phím: focus chính menu.
- M3 rail không báo công cụ đang dùng khi panel thu: thêm `aria-current`.
- Low: ⋯ bấm lại không mở lại; phím trong menu không lọt ra phím tắt màn chương; T/B/E/R tắt khi chưa có page; hiện
  lại "N khối" ở panel Bản dịch; vòng focus thumbnail khác outline trang đang mở; số trang trên thumbnail ẩn không mờ;
  sửa câu docs. Tự phát hiện thêm: menu không nhận focus lúc mở (Esc không chạy), thanh nổi che núm xoay.
- Thêm e2e cho chỗ reviewer chỉ ra chưa phủ: Ctrl+F focus ô tìm, Esc đóng menu chuột phải, Vừa khung ↔ 100%.

## Kết quả kiểm tra (lần chạy cuối, sau commit `4fbced2`)

| Lệnh | Kết quả |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (Biome: 275 file, không lỗi/cảnh báo) |
| `pnpm test` | exit 0 — shared 17, web 179, db 3, api 176 test pass |
| `pnpm --filter @mtl/web e2e` | exit 0 — 29 passed (gồm `typeset-parity`) |

Infra dev (postgres, minio, files-proxy) đã chạy sẵn, không cần `pnpm infra:up`. Không test nào bị `skip`/`fixme`;
assertion cũ đổi selector theo bố cục mới, chỉ thay hành vi đã bỏ theo brief (bộ lọc "Đã xoá" → trang ẩn tại chỗ,
segmented Gốc/Dịch/Chia đôi → Xem gốc + ⋯).

## Còn dở / chưa kiểm

- Chưa soát tay ở Safari, màn 390px cho màn chương (màn chương không thiết kế cho mobile), và với chương thật nhiều
  trang (chỉ chụp màn hình qua Playwright 1568×724 / 1920×1080 với dữ liệu worker giả).
- E2E chưa phủ: "Hoàn tác" Tìm/Thay sau khi chương chạy lại (H2), danh sách xung đột hiện khi panel đang ở Bản dịch (H1),
  vị trí thanh nổi khi khối sát mép trên.
- `plans/.../reports/overnight-run.log` là log của script chạy đêm, không commit.

## Câu hỏi mở

Xem mục "Câu hỏi mở" trong [plan.md](../plan.md) (1–23). Quan trọng nhất cho owner:
1. Panel Tìm rộng 560px (brief ghi 288px).
2. "Loại" khối chỉ đọc; "Dịch lại khối" = luồng OCR lại hiện có (khối tự thêm thì tắt).
3. Thumbnail 72×100 → ở 1568×724 thấy ~5–6 trang.
4. Xung đột khi lưu: hiện trên mọi panel + tự mở panel (không ép sang công cụ Chọn) — reviewer hỏi có nên ép không.
5. Canvas vừa lại khi panel đổi rộng (giữ điểm đang ở mép trên) — chọn khối làm panel tự mở nên ảnh co nhẹ.
6. Núm xoay Transformer dời gần khung (20px) để thanh nổi không che.
