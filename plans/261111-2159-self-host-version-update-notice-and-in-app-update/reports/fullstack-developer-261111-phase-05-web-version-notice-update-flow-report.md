# Báo cáo phase 5: Web – phiên bản, chấm báo bản mới, luồng Cập nhật ngay

Trạng thái: hoàn thành (phase file `status: completed`).

## File
- Sửa: `apps/web/src/lib/api.ts` (`AppConfig.version?`), `apps/web/src/app/app-shell.tsx` (`AccountMenu`), `apps/web/src/app/app-shell.css`.
- Tạo: `apps/web/src/features/update/{api.ts, update-model.ts, update-model.test.ts, update-dialog.tsx, manual-update.tsx, update.css}`, `apps/web/e2e/update-notice.spec.ts`.
- Ảnh duyệt UI: `reports/menu-co-ban-moi.png`, `reports/menu-khong-ban-moi.png`, `reports/hop-xac-nhan.png`.
- Không đụng `features/chapter/**` và các file ngoài bảng Files. Import `ShellActivity` giữ nguyên. Không commit.

## Hành vi
- Chỉ hiện khi `local_mode` và là admin; route 404/lỗi thì không hiện gì. Thanh trên không thêm phần tử (e2e đếm `.shell-top > *` = 3 trước và sau).
- Dòng `MTL v0.3.0` / `MTL dev` cuối menu (ẩn nếu API cũ không có `version`).
- Có bản mới: chấm 8px ở avatar (`aria-label` "Tài khoản · có bản mới vX"), mở menu thì ghi `localStorage["mtl.update.seen"]` (try/catch). Ghim + đích chính thức: không chấm, nút "Cách cập nhật". Ghim + đích rc: vẫn có chấm.
- Mục menu: "Có bản mới vX · Xem thay đổi" (link Release, `noopener noreferrer`), nút "Cập nhật ngay" (updater ready) hoặc "Cách cập nhật". Lần lỗi gần nhất: dòng "Cập nhật vX lỗi" mở hộp lỗi.
- Hộp (`Drawer variant="modal"`, đặt ngoài `<details>` để không bị unmount khi menu đóng): xác nhận 3 dòng, đang chạy (không đóng được: Esc/scrim/nút Đóng vô hiệu, ẩn Đóng bằng CSS `:has`), lỗi (câu theo reason, `docker logs <project>-update`, "Chi tiết kỹ thuật" chứa log_tail, lệnh tay), xong rồi `location.reload()` sau 0,8s.
- Theo dõi (reducer thuần trong `update-model.ts`): status mỗi 2s; mất kết nối thì `/api/config` mỗi 3s; version == đích thì xong; app sống lại bản cũ thì hỏi lại status; timeout 20 phút chỉ tính lúc mất kết nối. Mở lại trang khi run đang chạy thì tự mở hộp tiến độ.
- POST: 429 hoặc 409 `busy` -> đang chạy; 409 `stale` -> refetch + "Đã có bản khác, mở lại menu."; lỗi khác -> hộp lỗi. Mã lý do đọc từ `body.reason` hoặc `body.error`.
- Lệnh tay: `curl.exe` trên Windows, `curl` nơi khác; từng dòng một; nút Chép; ghim thì thêm dòng bỏ `MTL_TAG`.

## Test
- Vitest `update-model.test.ts`: 18 ca xanh (reducer, timeout, không timeout khi pull 1 giờ, `curl.exe`/`curl`, mọi `UpdateReason` có câu, chấm/ghim). `@mtl/shared/update` resolve được trong Vite và vitest.
- E2E `update-notice.spec.ts`: 7 ca xanh (chấm + link + tắt sau khi xem, Cách cập nhật 3 dòng lệnh, luồng thành công tới reload, lỗi + log + chi tiết, lỗi POST, không bản mới, 404/dev).
- E2E toàn bộ: 106 pass, 1 fail có sẵn `block-panel.spec.ts:317`.
- `pnpm --filter @mtl/web test` và `typecheck` xanh. `biome check apps/web packages/shared` sạch.
- `pnpm lint` toàn repo đỏ 3 lỗi format/import trong `apps/api/src/updater/{discovery,runner,server}.ts` (phase 4, ngoài phạm vi).

## Lệch so với phase file
- Spec e2e đăng nhập thật rồi mới mock `/api/config` (API e2e là nhiều người dùng, `/api/me` cần phiên).
- Chromium e2e có UA Windows nên spec chấp nhận cả `curl` lẫn `curl.exe` (logic OS đã test ở vitest).
- Bảng reason: mã không có trong bảng (`not_ready`, `internal`...) rơi về "Cập nhật lỗi."; `stale` có câu riêng theo mục 4.

## Chưa giải quyết
- Chưa chạy với API phase 3 thật (đang song song); body lỗi giả định `{error|reason: <mã>}`. Cần kiểm lại khi phase 3 xong.
