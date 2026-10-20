# Cook report — Redesign P5: drawer Xuất/Hoạt động, chế độ xem, phím tắt

Plan: `plans/261020-1944-web-uiux-redesign-chapter-workspace/phase-05-drawers-view-modes-shortcuts.md` (status → completed; plan.md không sửa theo yêu cầu).
Branch: `feat/redesign-p5-drawers-view-modes` (chưa merge).

## Đã làm
- **Phím tắt**: `editor/shortcuts.ts` (bảng thuần `resolveKey`, `SHORTCUT_HELP`) + `use-shortcuts.ts` (1 listener keydown/keyup chỉ gắn ở màn chương). OCR `O`→`R`; giữ `O` = tạm xem gốc (repeat bỏ qua, nhả khớp cả `code=KeyO`, blur = nhả); `\` đổi Gốc↔Dịch; A/D/PageUp/PageDown/←/→ trang; Alt+↑/↓ khối xuyên trang; Ctrl/Cmd+S (cả trong ô, cả khi drawer mở) lưu ngay; Ctrl/Cmd+F mở tab Tìm/Thay + focus ô tìm (chương chưa xong → để trình duyệt xử lý); Enter/Delete/Esc; `?` bảng phím. Listener cũ trong `chapter-workspace.tsx` đã gỡ.
- **Chế độ xem**: `chapterStore.viewMode` + `holdOriginal`, `effectiveMode`; `editorStore.showOriginal` suy ra qua subscribe. Segmented `view-mode-switch.tsx`. Chia đôi: cột Gốc vẽ ở x = −(rộng+gap) → cột Dịch giữ toạ độ strip, mọi lớp sửa không đổi; `contentBox` + `clampView(x0)`; cột Gốc chỉ kéo canvas; trần mount 2 page; đổi chia đôi giữ điểm giữa khung.
- **Drawer** `app/drawer.tsx` (+css): phải 420px, scrim xám không blur, role=dialog + aria-labelledby, Esc (capture)/scrim/Đóng, focus vào/trả focus, Tab vòng.
- **Xuất**: `ExportDialog.tsx` → `export-panel.tsx` (`ExportPanel`, `useExports`, `ExportRow`, giữ `EXPORT_POLL_MS`), `export-drawer.tsx`, `export-warnings.ts` (+test): trang lỗi/chưa xong, khối tràn, khối trống (bỏ SFX), trang AI có bản mới → "Xem các khối này" mở bảng lọc "Chỉ khối cần xem". Định dạng ZIP PNG/CBZ, "Cắt lại theo slice gốc" (= layout), tên file `{series}-ch{số}.{ext}` + hạn link. Lưu trước khi gửi job.
- **Hoạt động**: `activity-drawer.tsx` — Upload (mọi chương của tab, thử lại), job chương (trang đang xử lý/lỗi theo `error_class`, "Chạy lại trang lỗi"), xuất gần đây (tải, huỷ); nút + số việc ở topbar chương và app shell (home/series: chỉ Upload).
- **"Xuất lại"** ở Việc cần làm/danh sách chương → `?drawer=export` mở thẳng drawer Xuất (tham số bỏ khỏi URL ngay).
- `lock-banner.tsx` tách từ `Modal.tsx`; `Modal.tsx` + CSS `dialog.modal` xoá (`grep -w Modal apps/web/src` = 0). `withFlush` (hết người gọi) bỏ.
- Docs: `docs/editor.md` (chế độ xem, bảng phím tắt, drawer).

## Kiểm chứng
- `pnpm typecheck`, `pnpm lint` xanh; `pnpm test`: shared 8, web 109 (gồm mới: shortcuts 4, export-warnings 2, strip-layout split 1), db 3, api 143 — 0 fail.
- Worker `uv run pytest`: 132 passed, 2 skipped.
- E2E (cổng 5181/8797, `.env` có DEV_AUTO_LOGIN_*): 14/14 xanh. Mới: drawer "Xuất chương" (+`?drawer=export`, tên file, Esc → focus nút Xuất), segmented Gốc/Dịch/Chia đôi 4 lần không lỗi, giữ O, chia đôi sửa ô Dịch vẫn lưu, Hoạt động liệt kê `chapter.translate` khi chương processing, Hoạt động ở home liệt kê chương đang upload kèm tiến độ.
- Code review (score 8/10, 0 critical): 2 major đã sửa — viewport tile cột Gốc thiếu dịch x; màn chương render lại mỗi tick upload (selector trả số). Minor đã sửa: Ctrl+S khi drawer mở, Ctrl+F khi chưa có tab Tìm không chặn trình duyệt, nhả O theo `code`, "Xem các khối này" refresh dữ liệu, dead `withFlush`. Báo cáo: `code-reviewer-261020-2209-…`, `tester-261020-2209-…`.

## Lệch so với design / còn mở
- Design drawer Xuất có "Phạm vi: trang chọn trong rail" và định dạng "PNG từng trang": API export chỉ nhận `format png_zip|cbz` + `layout` cho cả chương; owner chốt giữ backend → không làm, chỉ hiện "Cả chương (N trang)".
- Chia đôi: trần mount 2 page/cột → zoom rất nhỏ có thể thấy trang trắng ở rìa (đánh đổi bộ nhớ theo plan).
- Chế độ xem reset về "Dịch" khi đổi chương (store reset theo chương) — chưa hỏi owner có muốn nhớ.
- Badge Hoạt động tính cả job `paused_budget`; màn chương gọi thêm `GET /exports` 1 lần khi mở (cho số việc).
- Cảnh báo "Several Konva instances" chỉ ở spec typeset-parity, có từ trước.
- Không chạy `/ak:journal` và không sync plan.md (theo giới hạn phạm vi của yêu cầu).
