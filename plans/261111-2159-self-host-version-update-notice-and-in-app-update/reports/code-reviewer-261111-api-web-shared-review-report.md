# Review: phiên bản + cập nhật trong app (shared, API, web)

Điểm: **7/10**. Critical 0 · High 1 · Medium 2 · Low 5. Gate đã chạy: `@mtl/shared test` 114/114, `@mtl/api test:unit`
169/169, `@mtl/web test` 480/480, typecheck + lint xanh. Test DB (`admin-update.test.ts`) và e2e chưa chạy (tester khác).

## High

**H1. Màn lỗi tài khoản gỡ mất hộp theo dõi khi app đang khởi động lại.** `apps/web/src/app/app-shell.tsx:38` (`if (q.error)`),
`:17` (`meQuery` staleTime 60s), `apps/web/src/app/router.tsx:32` (`refetchOnWindowFocus: true`, `retry: 1`).
Kịch bản: bấm Cập nhật, tới bước `apply` (app tắt để sao lưu + migrate), người dùng chuyển tab (vd mở "Xem thay đổi")
rồi quay lại. `me` đã cũ nên tự hỏi lại, lỗi 2 lần. TanStack v5 đặt `status: "error"` và `error` nhưng **vẫn giữ data**
(đã chạy thử với `@tanstack/query-core@5.104.4`: sau focus khi app tắt thì `status=error`, data còn). AppShell trả màn
"Không tải được tài khoản", nên `AccountMenu` và `UpdateDialog` bị gỡ: hết polling, không `location.reload()`. App chạy lại
thì shell hiện lại với bundle cũ. Status cache (staleTime 10 phút) vẫn ghi "Có bản mới / Cập nhật ngay", dòng phiên bản
vẫn là bản cũ (`appConfigQuery` cache vô hạn). Đây đúng là trường hợp mà bước reload sinh ra để chặn.
Sửa: AppShell chỉ chặn khi `q.error && !q.data` (401 và `user_disabled` đã có `onSessionLost` lo), hoặc chuyển phần theo dõi
ra ngoài cổng lỗi (layout gốc hoặc store của module). Thêm ca e2e: phát `visibilitychange` trong pha mất kết nối.

## Medium

**M1. Hộp xác nhận vẫn đóng được khi POST đang chạy.** `apps/web/src/features/update/update-dialog.tsx:172-175`.
Lúc `pending`, footer có `disabled` nhưng Esc, bấm nền mờ và nút Đóng vẫn gọi `props.onClose`. POST có thể mất tới ~20s
(GitHub tối đa 5s + updater tối đa 15s). Nếu đóng trong lúc đó, `begin()` chạy trên component đã gỡ nên không làm gì.
`closeDialog` có invalidate status, nhưng GET trả về trước khi runner được tạo, nên `running` = null và hộp không tự mở lại
(`app-shell.tsx:102`). Kết quả: cập nhật vẫn chạy, app tắt mà không có gì theo dõi.
Sửa: `onClose={pending ? noop : props.onClose}` và ẩn nút Đóng khi `pending` (dùng cách `:has()` giống `update.css`).

**M2. Lỗi xảy ra sau `apply` không hiện ra.** `apps/web/src/features/update/update-model.ts:53-54` coi là xong khi
`current === target` trước khi xét `run.failed`. `:162-165` `failedRun` bỏ qua run lỗi khi `current === run.target`.
Runner vẫn có thể lỗi sau khi app đã lên bản mới: `up --wait` lỗi vì worker/jobs không healthy (`up_failed`/`timeout`,
`apps/api/src/updater/runner.ts:245-248`), `path_mismatch` sau cập nhật ("thư mục dữ liệu được mount khác trước",
`runner.ts:252-259`), hoặc `version_mismatch`. UI báo "Đã cập nhật lên vX" rồi reload, menu không hiện gì, trong khi
worker có thể không chạy hoặc dữ liệu đang mount ở chỗ khác.
Sửa: `failedRun` trả run khi `state === "failed"` và (`current !== target` hoặc `step` ∈ {`apply`, `check`}). Thêm câu riêng
cho trường hợp này: "Đã lên vX nhưng bước cuối lỗi, xem log".

## Low

- **L1** `apps/api/src/lib/updater-client.ts:108-110`: mọi exception trong `startUpdate`, kể cả `TimeoutError` sau 15s, đều
  thành 503 `unavailable`. Nếu updater đã tạo runner nhưng trả lời chậm, web báo "Bản cài này chưa có bộ cập nhật…" trong
  khi app sắp tắt. Sửa: tách timeout ra một mã mà web hiểu là "bắt đầu theo dõi" (vd 409 `busy`, web sẽ gọi `begin(null)`).
- **L2** `updater-client.ts:71`: mọi status không phải 2xx của `/v1/status` đều thành `internal` và mất `reason` trong
  body. Ví dụ `server.ts:218` trả 503 `not_ready`. Cách này lệch với `startUpdate` (`:102`), vốn giữ lại reason. Sửa: dùng
  lại `[body.reason, body.error].find(isReason)`.
- **L3** `update-dialog.tsx:121-127`: `role="status"` bọc cả đồng hồ cập nhật mỗi giây, nên trình đọc màn hình đọc lại mỗi
  giây. Sửa: chỉ để vùng live ở `progressText`, đưa đồng hồ ra ngoài.
- **L4** `manual-update.tsx:11`: trên origin không an toàn (host LAN qua `MTL_ALLOWED_HOSTS`, vd `http://nas.local:8080`)
  thì `navigator.clipboard` là `undefined`. Lỗi TypeError ném đồng bộ, `.catch` không bắt được. Sửa: kiểm
  `navigator.clipboard?.writeText` trước khi gọi.
- **L5** `update-model.ts:142`: comment có "(D7)", tức mã quyết định của plan nằm trong code. Trái quy tắc Stable Code
  Artifacts. Bỏ mã này, chỉ giữ câu giải thích.

## Đã kiểm, đạt (có bằng chứng)

- Semver (`packages/shared/src/update.ts:11-54`): prerelease nhỏ hơn bản chính, id số so theo số (`rc.2 < rc.10`), số nhỏ
  hơn chữ, `0.10 > 0.9`, `dev` và chuỗi rác cho `null`. Có test cho từng ca.
- `update-check.ts`: lười. Cache 24h/6h (`:11-12,:98-102`), gộp request (`:96`), timeout 5s (`:82`). Draft hoặc prerelease
  tính là lỗi (`:40`). Bản dev và `disabled` không fetch lần nào (`:114,:117`). Override có trước (`:115`). URL dựng từ tag,
  không dùng `html_url` (`:47`). UA `mtl-selfhost`, không gửi token (`:80`).
- `admin-update.ts`: 404 ngoài local mode (`:31,:49`). Thứ tự kiểm: 415 (`:51`), 400 (`:54-55`), kiểm lại có `fresh` rồi 409
  stale (`:60-61`), 422 pinned (`:63`), 429 (đặt mốc trước `await`, lỗi thì trả lại mốc cũ, `:66-74`), giữ nguyên
  status/reason của updater, 202. Route nằm trong `adminApi()` nên có requireUser + requireAdmin. Token tạo bằng
  `readOrCreateSecret` (0600, `wx`). `/api/config` giữ `local_mode` và thêm `version`. 2 test cũ sửa đúng, không nới lỏng.
- Bảo mật: `localGuard` chặn `Origin: null` và Origin rác (`local-guard.ts:50-55`). So `URL.host` có cổng, cổng mặc định
  được chuẩn hoá. Thiếu Origin thì còn chặn `Sec-Fetch-Site: cross-site`. Bắt buộc JSON nên request khác origin phải qua
  preflight, mà API không mở CORS. Không có SSRF: URL là hằng số, version đã kiểm semver, app bỏ chữ `v` trước khi gửi
  (`:56`), khớp với yêu cầu của updater (`server.ts:237`). Có `redirect: "error"`. Token không bị log (chỉ log `err.code`).
  Body lỗi chỉ có `{error, reason}`, không có `detail`.
- Web: status mỗi 2s, `/api/config` mỗi 3s. Chỉ đếm timeout khi mất kết nối (`update-model.ts:68-79`). Timer được dọn khi
  gỡ component. `localStorage` có try/catch. Chấm tắt theo từng phiên bản. Ẩn khi không phải local mode hoặc route 404.
  Lệnh Windows dùng `curl.exe`, mỗi lệnh một dòng. Thanh trên không thêm phần tử nào. Dùng `Drawer modal`, token CSS và lớp
  `.notice` có sẵn. Chữ tiếng Việt có đủ dấu.

## Câu hỏi chưa giải quyết

1. Thư mục `apps/web/.claude/agent-memory/**` (chưa track) là sản phẩm phụ của agent, không thuộc tính năng này. Cần
   loại ra trước khi commit.
2. Khi không có service updater (`MTL_UPDATER=0`), tên một nhãn `updater` có thể được phân giải qua search domain của máy
   chủ, và app sẽ gửi Bearer token tới host đó ở cổng 8090. Ảnh hưởng thấp, vì token chỉ dùng được trong mạng `internal`.
   Có chấp nhận rủi ro này không?
