# P6 WEB report

## File
- Mới: features/chapter/{ExportDialog,FindReplace,Modal}.tsx, text-utils.ts(+test), features/glossary/ApplyGlossary.tsx, e2e/typeset-parity.spec.ts, e2e/fixtures/typeset-parity.json, scripts/typeset-parity.ts, worker/scripts/typeset_parity.py
- Sửa: chapter/api.ts (kiểu + hàm export/find-replace/glossary-apply/undo/cancelJob), chapter-page.tsx (3 nút + dialog), app/router.tsx (React.lazy EditorPage), canvas/TextBoxNode.tsx (drawBoxText layout khi lines rỗng, chỉ vẽ), styles/tokens.css (dialog.modal, mark.hit), .github/workflows/ci.yml
- Ngoài danh sách (file hỗ trợ mới): Modal.tsx (dialog native + LockBanner), text-utils.ts.

## Bundle (vite build)
- Trước: ~907 kB một chunk. Sau: index 437.2 kB (gzip 137) + EditorPage 490.9 kB (gzip 150), editor tải lazy.

## Parity (10 page_state, 40 box, 71 dòng, 8 font, cỡ .5, stroke 0/1.5/2/3.5, 3 căn lề, dấu chồng)
- Lệch bbox mực tối đa 1px; khớp tuyệt đối 20/71; vượt ngưỡng 0. Chạy ổn định, fixture sinh lại giống hệt (`--check` khớp).
- Spec dùng module thật drawBoxText + loadFonts qua Vite dev; Konva dựng từ bản UMD (cảnh báo "Several Konva instances" vô hại).

## Kiểm
- tsc web xanh; vitest web 52/52; biome xanh cho file của tôi (`pnpm lint` còn 1 lỗi format ở apps/api/test/export.test.ts, file của người khác); build xanh; e2e 3/3 (editor, upload, parity).

## Còn lại / lưu ý
- UI export/find-replace/glossary-apply chưa có e2e với API thật (chỉ typecheck + logic thuần có test); nên smoke tay khi API xong.
- CI: thêm setup-uv + `uv sync` + playwright chromium + `e2e typeset-parity` (sau pnpm test). Spec cần DB e2e (global-setup) — CI infra:up đã có Postgres nhưng chưa xác minh DB `mtl_test_e2e` tồn tại trên runner. `--check` fixture KHÔNG đưa vào CI (số float raqm/FreeType có thể lệch nhẹ giữa macOS/Linux); chạy local.
- Parity xoay chưa nằm trong gate. Parity trên Linux CI chưa chạy thử.
