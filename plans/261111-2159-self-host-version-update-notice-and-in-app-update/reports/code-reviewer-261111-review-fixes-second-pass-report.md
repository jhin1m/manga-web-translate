# Review lần 2: các bản sửa sau review đầu (updater, compose, API, web)

Điểm: **8.5/10**. Critical 0 · High 0 · Medium 1 · Low 4. Trong 15 finding lần đầu, 13 đã sửa hẳn. M2 phía web mới sửa
một phần (N3), L5 còn sót (N4). Bản sửa M1 phía updater sinh ra một hồi quy nhỏ (N1).

## Gate
- `@mtl/api test:unit` 186/186, `@mtl/web test` 485/485, `typecheck` + `lint` (472 file) sạch, e2e `update-notice` 12/12.
- Probe trong scratch, không sửa repo: bỏ mutex khỏi một bản sao `server.ts` thì test `updater-server.test.ts:406` đỏ
  (test kiểm thật). Probe của N1 và N2 xanh, tức hai lỗi đó có thật.

## Từng finding lần đầu (bằng chứng; test có đỏ khi bỏ bản sửa không)
- **Updater M1**: `server.ts:172-177`. Test `updater-server.test.ts:335-350` sẽ đỏ. Bản sửa này gây ra N1.
- **Updater M2**: `runner-plan.ts:126-130`. Test `updater-runner-plan.test.ts:69-93` sẽ đỏ. Service replicas 0 (không có
  container) vẫn được bỏ qua (`:111`). Còn hở N2.
- **Updater M3**: `runner.ts:120-131,179` và `updater-runner.test.ts`. Sáu ca lỗi đều kiểm compose còn nguyên byte, không
  có `.bak`, không gọi `up`. Đạt.
- **Updater L3**: mutex ở `server.ts:152-160` luôn được nhả trong `finally`. Runner kẹt `created` quá 60s bị coi là hỏng
  (`:72-75`) và được gỡ bằng `force:false` (`:185`), nên Docker không gỡ runner đang chạy. Nếu runner kịp start thì lần
  `create` sau nhận 409 và trả `busy`. Test `:387-410`. Đạt.
- **Updater L1/L2** (`runner.ts:259-267`, test `updater-runner.test.ts:141,245`) và **L4** (`self-host.md:174`). Đạt.
- **Web H1**: sửa ở `app-shell.tsx:40`. Bản host gặp 401 vẫn về màn đăng nhập (`api.ts:53,75` → `refetchSession` →
  `layout.tsx:55`). `AuthGate` không gỡ được hộp: `appConfigQuery` staleTime ∞ (`api.ts:105`), không chỗ nào invalidate,
  poll gọi `api()` trực tiếp. Test e2e `:182` sẽ đỏ.
- **Web M1, L1–L4** (`update-dialog.tsx:199,202,124-127,141-142`, `updater-client.ts:73-77`, `manual-update.tsx:26-30`): đạt, có test.
- **`MTL_UPDATER`**: tắt thì không gọi mạng (`updater-client.ts:65,94`); `compose-vars.ts:27` cố định `"1"` là khớp.
- **Theo dõi + hợp đồng**: timer dọn ở `update-dialog.tsx:90,97,104`; sau khi lên bản đích luôn kết thúc (30s/10 phút,
  `update-model.ts:73-74`). Status + `{error, reason}` không lệch; 422 `not_newer` đi qua `updater-client.ts:109-114`.
- **Smoke `FROM=rc.1 TO=rc.2`**: vẫn chạy. `smoke.sh:127` đặt target vào `Config.Env` của app nên khớp `server.ts:175`.
  Kiểm ghim chỉ áp cho bản chính thức (`server.ts:180`, `admin-update.ts:63`).

## Medium
**N1. Nhánh prerelease bỏ mất điều kiện "mới hơn bản đang chạy".** `server.ts:172-177`; trước bản sửa mọi bản đều qua
`isNewer` (`:179`). Runner cũng không kiểm `to > from` (`runner.ts:62-75`).
- Probe: target `0.1.0-rc.1`, app `0.2.0`. POST `0.1.0-rc.1` trả 202, runner tạo với `MTL_UPDATE_FROM=0.2.0`.
- Hạ cấp: target được runner khôi phục (`compose-vars.ts:21`) hoặc nằm lại trong `.env`; lên bản chính thức bằng tay xong
  thì target < current. App bị chiếm (mô hình của M1) gửi target cũ → rc cũ gặp schema mới → app không khởi động, phải
  khôi phục backup. Target == current (bình thường sau rc→rc) → kích cài lại mỗi 60s. UI không đi đường này
  (`update-check.ts:129`), nên đây là lỗ ở lớp phòng thủ chiều sâu.
- Sửa: thêm `|| !isNewer(version, info.current)` vào `server.ts:175`, chặn tương tự trong `readRunnerEnv`, thêm test cho
  target < current và target == current → 422.

## Low
- **N2. Kiểm bind hai chiều bỏ sót service bị bỏ khỏi file mới.** `runner-plan.ts:110-112` chỉ duyệt `config.services`;
  comment `:103-106` hứa nhiều hơn code làm. Probe: `jobs` đang mount `${dir}/data/files` mà file mới không có `jobs` →
  `null`. Runner không dùng `--remove-orphans`, `diffSnapshots` cũng cho qua, nên container image cũ vẫn chạy trên DB vừa
  migrate. Sẽ thành lỗi thật khi một bản sau đổi tên hoặc bỏ service. Sửa: service có trong `running` mà thiếu trong
  `config.services` → `path_mismatch`, kèm test.
- **N3. M2 web sửa một phần.** (a) Hộp "đã lên bản" ghi `update-dialog.tsx:158` "App đã chạy bản vX" ngay trên `:162`
  `reasonText(up_failed|timeout)` = "App chưa chạy lại được"; e2e `:280-281` khoá cả hai câu. Với `path_mismatch` hộp ghi
  "dừng để an toàn" trong khi dữ liệu đang mount chỗ khác. (b) Đóng hộp hay tải lại là mất dấu: `failedRun`
  (`update-model.ts:193-196`) ẩn run lỗi khi `current === target`. Sửa: câu riêng cho `landed`; `failedRun` trả run khi
  `step ∈ {apply, check}`.
- **N4. L5 sót.** `infra/selfhost-update-smoke.sh:17` vẫn có "(D7 allows it…)", và lý do trong câu đã cũ.
- **N5 (có từ trước, lần đầu chưa báo).** Lỗi nhanh (vd `download_failed`) rồi thử lại trong 60s: app trả 429
  (`admin-update.ts:67`) vì mốc giữ nguyên sau 202. `update-dialog.tsx:119` gọi `begin(null)`, hộp hiện lại lỗi cũ như
  lỗi mới. Sửa: 429 mà run không `running` thì báo "đợi 1 phút".

## Câu hỏi mở
- `apps/web/.claude/agent-memory/` chưa track, cần loại trước khi commit. Bản sau thêm bind mới cho service có sẵn sẽ luôn
  `path_mismatch` (`updater-runner-plan.test.ts:79`): chấp nhận "bản đó chỉ cập nhật tay"?
