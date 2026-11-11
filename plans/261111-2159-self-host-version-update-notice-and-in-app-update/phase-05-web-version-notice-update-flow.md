---
phase: 5
title: "Web: nhãn phiên bản, chấm báo bản mới, luồng Cập nhật ngay"
status: completed
priority: P1
effort: "5h"
dependencies: [1]
---

# Phase 5: Web – phiên bản, thông báo, cập nhật

## Overview

Tối giản theo D15:
- Không có banner, không thêm gì lên thanh trên. Nhãn phiên bản và mục cập nhật nằm trong **menu tài khoản**.
- Có bản mới thì hiện một **chấm nhỏ** trên avatar. Mở menu một lần thì chấm của bản đó tắt.
- Màn chương (editor toàn màn hình, ngoài shell) không hiện gì.

Làm song song với phase 3 được: chạy theo kiểu `UpdateStatus` của phase 1, test bằng mock.

## Context (đã đọc)

- `apps/web/src/app/app-shell.tsx:32-59` `AppShell`, `:71-111` `AccountMenu` (`<details>`, các mục Glossary chung / Font /
  Cài đặt, dòng hạn mức). Bấm trong `.shell-menu-list` đóng menu (l.92).
- `apps/web/src/app/app-shell.css:29-82`: `.shell-avatar`, `.shell-menu-list`, `.shell-menu-email`.
- `apps/web/src/lib/api.ts:60-80` `api()` gửi `content-type: application/json` khi có body, lỗi HTTP → `ApiError`.
  `:83` `AppConfig = { local_mode }`. `:91-96` API cũ 404/401 thì coi là `{ local_mode: false }`. `:99-104`
  `appConfigQuery` cache vô hạn.
- `apps/web/src/app/drawer.tsx:13-18`: `Drawer` có `variant="modal"`, dùng cho hộp giữa màn.
- `apps/web/src/app/drawer.css:116` `.count-badge`. Token màu ở `apps/web/src/styles/tokens.css`.
- Design guidelines (chỉ đọc): một màu nhấn, `.notice`, ⓘ thay hint, "Chi tiết kỹ thuật" thu gọn cho lỗi thô, cấm
  animation không mang thông tin và cấm chữ marketing.
- E2E chạy API ở chế độ nhiều người dùng (`apps/web/playwright.config.ts:19-29`), nên route update trả 404. Spec mới
  mock bằng `page.route`.
- **Không đụng** `apps/web/src/features/chapter/**`. Plan khác đang có thay đổi chưa commit ở đó. `app-shell.tsx` chỉ
  import `ShellActivity` từ đó và không đổi dòng import này.

## Files

| Thao tác | File |
|---|---|
| Sửa | `apps/web/src/lib/api.ts` (`AppConfig.version?: string`) |
| Sửa | `apps/web/src/app/app-shell.tsx` (`AccountMenu`: dòng phiên bản, mục cập nhật, chấm avatar) |
| Sửa | `apps/web/src/app/app-shell.css` (chấm, dòng phiên bản) |
| Tạo | `apps/web/src/features/update/api.ts` (`updateStatusQuery`, `startUpdate`) |
| Tạo | `apps/web/src/features/update/update-model.ts` (thuần: reducer theo dõi, text theo bước và lý do, lệnh tay theo OS) |
| Tạo | `apps/web/src/features/update/update-model.test.ts` |
| Tạo | `apps/web/src/features/update/update-dialog.tsx` (xác nhận, đang chạy, lỗi) |
| Tạo | `apps/web/src/features/update/manual-update.tsx` (khối lệnh tay + nút Chép) |
| Tạo | `apps/web/src/features/update/update.css` |
| Tạo | `apps/web/e2e/update-notice.spec.ts` |

## Hành vi

1. **Nhãn phiên bản**: dòng cuối menu tài khoản là `MTL v0.3.0` (chữ nhỏ, muted). Khi `version === "dev"` thì hiện
   `MTL dev`. API cũ không có `version` thì ẩn dòng này.
2. **Lấy trạng thái**: `useQuery(["update-status"], GET /api/admin/update)`, chỉ bật khi `local_mode && me.is_admin`.
   `staleTime` 10 phút, `retry: 0`, không refetch khi focus. 404 hoặc lỗi thì coi như không có gì, không báo lỗi.
3. **Có bản mới** (`update_available`):
   - Chấm 8px màu nhấn ở góc avatar. `aria-label` của summary thành "Tài khoản · có bản mới v0.4.0". Chấm ẩn khi
     `localStorage["mtl.update.seen"] === latest.version`. Mở menu thì ghi key này. Đang ghim (`pinned_tag`) mà đích là
     bản chính thức (D7) thì không có chấm. Ghim rc mà đích là rc (người phát hành thử) thì vẫn có chấm.
   - Trong menu, trên dòng phiên bản: "Có bản mới **v0.4.0**", kèm link "Xem thay đổi" (`latest.url`, `target="_blank"`,
     `rel="noopener noreferrer"`). Dưới đó là một nút:
     - `updater.ready` → **Cập nhật ngay** (mở hộp xác nhận).
     - Không ready, hoặc đang ghim → **Cách cập nhật** (mở hộp có lệnh tay và một câu lý do theo `reason`).
4. **Hộp xác nhận** (`Drawer variant="modal"`, tiêu đề "Cập nhật lên v0.4.0"):
   - 3 dòng: "App dừng vài phút để sao lưu dữ liệu rồi cập nhật." · "Việc đang chạy sẽ dừng (chờ tối đa 90 giây), trang
     đang xử lý có thể phải chạy lại." · "Sau khi cập nhật không quay lại bản cũ được."
   - Nút **Cập nhật** (`.btn-primary`) và Huỷ. Bấm Cập nhật thì gọi `POST /api/admin/update {version}`.
   - 409 `stale` → refetch status, báo "Đã có bản khác, mở lại menu". 429/409 `busy` → chuyển sang trạng thái đang chạy.
     Lỗi khác → trạng thái lỗi.
5. **Đang chạy**: hộp không đóng được bằng Esc hay bấm ra ngoài. Hiện một dòng theo bước và thời gian đã chạy (`m:ss`).
   Không có thanh tiến độ giả.
   - `preflight` → "Đang kiểm tra…".
   - `download`, `pull`, `verify` → "Đang tải bản mới. Trong lúc này app vẫn chạy."
   - `apply`, `check`, hoặc app không trả lời → "Đang khởi động lại: sao lưu dữ liệu, cập nhật, chạy lại worker…"
   - Theo dõi (thuần, trong `update-model.ts`):
     - App còn trả lời: gọi `GET /api/admin/update` mỗi 2s. `run.state = failed` → lỗi.
       `current === target` → xong.
     - Lỗi mạng hoặc 5xx: chuyển sang gọi `GET /api/config` mỗi 3s. Khi `version === target` → xong.
       App sống lại mà vẫn là bản cũ → gọi lại status để lấy lỗi.
     - Chỉ đếm giờ lúc app **không trả lời**. Quá 20 phút → lỗi `timeout`. Lúc tải image app vẫn chạy và runner vẫn báo
       bước, nên không giới hạn (mạng chậm tải ~1,5 GB vẫn được).
   - Xong → hiện "Đã cập nhật lên v0.4.0" rồi `location.reload()`.
   - Mở lại trang giữa chừng: status có `run.state = running` thì tự mở hộp ở trạng thái đang chạy.
6. **Lỗi**: một câu theo `reason` (bảng dưới), rồi "Xem log: `docker logs <project>-update`" (tên project lấy từ
   `updater.project`, thiếu thì `mtl-local`). "Chi tiết kỹ thuật" thu gọn chứa `log_tail`. Sau đó là khối lệnh tay và nút
   Đóng. Lần cập nhật lỗi mà `current !== run.target` thì menu có dòng "Cập nhật v0.4.0 lỗi", bấm vào mở lại hộp lỗi.
7. **Khối lệnh tay** (`manual-update.tsx`): "Chạy trong thư mục chứa `docker-compose.yml`, từng dòng một:". Dòng đầu
   theo OS (`navigator.userAgent` có `Windows` → `curl.exe`), rồi `docker compose pull`, `docker compose up -d`. Có nút
   Chép (`navigator.clipboard`, localhost là secure context). Đang ghim thì thêm một dòng: "Bỏ dòng `MTL_TAG` trong
   file `.env` trước."

| reason | Câu hiển thị |
|---|---|
| `unavailable` | Bản cài này chưa có bộ cập nhật (file compose cũ, hoặc đã tắt bằng `MTL_UPDATER=0`). |
| `no_socket` | Bộ cập nhật không truy cập được Docker (Docker rootless hoặc thiếu socket). |
| `docker_too_old` | Docker quá cũ cho bộ cập nhật. Cập nhật Docker Desktop, hoặc cập nhật tay. |
| `pinned` | Bạn đang ghim phiên bản bằng `MTL_TAG`. |
| `custom_compose` | Bạn dùng file compose tuỳ chỉnh hoặc file override. |
| `project_not_found`, `path_mismatch` | Không xác định chắc được thư mục dữ liệu, nên dừng để an toàn. |
| `download_failed`, `pull_failed` | Không tải được bản mới. Kiểm tra mạng rồi thử lại. App vẫn chạy bản cũ. |
| `version_mismatch` | Bản mới vừa phát hành chưa sẵn sàng. Thử lại sau vài phút. |
| `up_failed`, `timeout` | App chưa chạy lại được. Xem log `app` và mục Sự cố của hướng dẫn. |
| khác | Cập nhật lỗi. |

## Tests

`update-model.test.ts` (vitest):
- Reducer: còn trả lời → running theo bước. Mất kết nối → restarting. `version` mới → done. App sống lại bản cũ kèm
  `run.failed` → failed. Quá 20 phút không trả lời → timeout. Lúc `pull` kéo dài 1 giờ mà app vẫn trả lời → không timeout.
- `curlLine("Windows …")` → `curl.exe -fsSLO …`, macOS/Linux → `curl -fsSLO …`. URL là `composeUrl("main")`.
- Mỗi `UpdateReason` có câu hiển thị, không có `undefined`.

`apps/web/e2e/update-notice.spec.ts`. Mock `/api/config` (`local_mode: true, version: "0.3.0"`) và
`/api/admin/update` bằng `page.route`:
1. Có bản mới: avatar có chấm. Mở menu thì thấy "v0.3.0", "Có bản mới v0.4.0", link `…/releases/tag/v0.4.0`. Đóng rồi
   mở lại trang thì không còn chấm.
2. `updater.ready = false, reason = unavailable` → nút "Cách cập nhật", hộp có 3 dòng lệnh.
3. Luồng thành công: Cập nhật ngay → xác nhận → POST (mock 202) → status `pull` → status abort (mất mạng) → `/api/config`
   trả `0.4.0` → trang reload (kiểm request reload).
4. Luồng lỗi: status `run.state = failed, reason = pull_failed` → hiện câu lỗi, `docker logs mtl-local-update`, log tail
   trong "Chi tiết kỹ thuật".
5. Không có bản mới: không chấm, menu chỉ có dòng phiên bản.

## Done

- `pnpm --filter @mtl/web test`, `pnpm --filter @mtl/web e2e` (spec mới + toàn bộ, trừ lỗi có sẵn
  `block-panel.spec.ts:317`), `pnpm lint`, `pnpm typecheck` xanh.
- Thanh trên không thêm phần tử nào. Đếm phần tử bấm được ở `.shell-top` trước và sau bằng nhau.
- Ảnh chụp menu (có và không có bản mới) lưu vào `plans/…/reports/` để chủ dự án duyệt.

## Risks

| Rủi ro | K×T | Giảm thiểu |
|---|---|---|
| Web bản mới chạy trên API cũ (rollback) | Thấp×Thấp | Thiếu `version` hoặc route 404 thì ẩn hết |
| Reload trước khi app sẵn sàng | Thấp×TB | Chỉ reload khi `/api/config` trả version mới. API chỉ listen sau backup + migrate (`apps/api/src/index.ts:10-14`) |
| Chấm làm phiền người không muốn cập nhật | TB×Thấp | Xem một lần là tắt, chỉ hiện lại khi có bản mới hơn |
| Nhiều tab cùng mở | TB×Thấp | Tab khác mất kết nối thì hiện màn "Không kết nối được máy chủ" có sẵn, bấm Thử lại |

## Rollback

Revert phase: menu quay về như cũ. API và updater vẫn chạy, chỉ là không có UI gọi tới.
