# Báo cáo sửa review: cập nhật trong app (API + web)

Trạng thái: xong. Không commit.

## Đã sửa
- **H1** `app-shell.tsx`: chỉ chặn bằng màn lỗi khi `q.error && !q.data`. `api()` gọi `onSessionLost` cho 401 (better-auth refetch phiên, AuthGate về đăng nhập), 403 `user_disabled` thì đăng xuất; hai đường này không phụ thuộc màn lỗi nên không đổi.
  Test e2e dùng `page.clock` + `visibilitychange` làm `/api/me` lỗi giữa lúc theo dõi. Đã kiểm chứng: bỏ sửa thì test đỏ.
- **M1** `update-dialog.tsx`: lúc POST đang bay, Drawer nhận `noop` (Esc, scrim), CSS ẩn nút Đóng (`.update-pending`), nút hiện "Đang gửi…" và có dòng trạng thái.
- **M2** `update-model.ts`: hàm `settle`. Khi app đã lên bản đích, tiếp tục hỏi status mỗi 2s cho tới khi run của bản đích kết thúc.
  - `succeeded`: tải lại.
  - `failed`: hộp lỗi "Đã lên vX, bước cuối lỗi" kèm lý do, lệnh `docker logs`, chi tiết kỹ thuật và lệnh cập nhật tay.
  - Run mất hoặc updater im quá 30s: tải lại.
  - Run còn `running` quá 10 phút: tải lại.
  - Sự kiện `status`/`config` giờ có `now`; `Tracking.landedAt`; type `Failure.landed`.
- **L1**: POST lỗi (trừ 429, 409 busy, 409 stale) thì hỏi lại status một lần. Run `running` đúng bản đích thì chuyển sang theo dõi. Không đổi API mapping timeout, vì thông báo `timeout` ("App chưa chạy lại được") sẽ sai khi không có run.
- **L2** `updater-client.ts`: `status()` non-2xx giữ `reason`/`error` nếu thuộc `UPDATE_REASONS` (vd 503 `not_ready`); 401 vẫn `internal`.
- **L3**: `role="status"` chỉ bọc câu theo bước; đồng hồ nằm ngoài.
- **L4** `manual-update.tsx`: không có `navigator.clipboard` hoặc `writeText` lỗi thì chọn sẵn khối lệnh và hiện "Hãy chọn và chép tay".
- **L5**: bỏ "(D7)" ở `update-model.ts`; không còn mã plan/quyết định nào khác trong code của tính năng.
- **Mục 9** `env.ts`: `MTL_UPDATER` (`flag01On`, mặc định bật, `0|false` tắt). Tắt thì `updaterStatus()` trả `{ready:false, reason:"unavailable", project:null, run:null}` và `startUpdate()` trả 503 `unavailable`, không gọi mạng, không tạo token.

## Test thêm hoặc sửa
- `update-model.test.ts`: các ca settle (chờ run, succeeded, failed landed, cap running, grace run mất, config-only, run của target khác).
- `admin-update.test.ts`: 503 `not_ready` giữ reason, reason lạ thành `internal`, `MTL_UPDATER=0` cho GET và POST (updater giả không nhận request nào).
- `env-local.test.ts`: `MTL_UPDATER` mặc định, rỗng, `0|false`, giá trị sai.
- `update-notice.spec.ts`: thêm 5 ca (H1, M2 lỗi sau khi lên bản, M1, L1, L4); sửa ca "update now" để mock trả run `succeeded` sau khi lên bản mới.

## Kết quả
- `@mtl/web test` 485/485. `@mtl/api test:unit` 186/186.
- DB tests `admin-update`, `admin-access`, `local-mode`, `tenant-isolation`: 49 passed, 1 skipped. Lệnh: `cd apps/api && pnpm vitest run test/<file>`.
- `pnpm typecheck` và `pnpm lint` xanh.
- `update-notice.spec.ts`: 12/12.
- E2e đầy đủ: 112 passed, 1 failed là `block-panel.spec.ts:317` (đã biết).
- Lưu ý: `pnpm --filter @mtl/web e2e -- <file>` bỏ qua tên file và chạy cả bộ; dùng `pnpm exec playwright test <file>` trong `apps/web`.
- Một lần chạy đầy đủ trước đó `series-suggestions.spec.ts:18` đỏ (focus nút Nhận). Chạy lại riêng và ở lần đầy đủ sau thì xanh: flaky, ngoài phạm vi.

## Lưu ý
- Lần `biome check --write` rộng trên `apps/api/src` và `apps/api/test` báo sửa 4 file mà tôi không kiểm được là file nào. `git status` các file đã tracked không thêm file lạ ngoài danh sách ban đầu. Nên rà `git diff` các file của agent khác.
- `failedRun` (mục menu "Cập nhật vX lỗi") giữ nguyên: sau khi tải lại, lỗi bước cuối không còn hiện ở menu (chỉ hiện trong hộp theo dõi).
