# Báo cáo: sửa các finding review của updater

Kết quả: `pnpm --filter @mtl/api test:unit` 186/186, `pnpm typecheck`, `pnpm lint` xanh. `docker compose config -q` OK; `MTL_UPDATER=0 docker compose config` ra `MTL_UPDATER: "0"` và `replicas: 0`.

## Đã làm
- M1 `server.ts`: bản prerelease chỉ được nhận khi bằng đúng `MTL_UPDATE_TARGET` lấy từ `Config.Env` của container app (`info.vars`), không từ request. Ngược lại trả 422 `not_newer`. Bản chính thức giữ luật cũ (mới hơn + kiểm ghim). Bản ghim vào rc vẫn nhận khi trùng target.
- M2 `runner-plan.ts` `checkBinds`: hai chiều. Bind đang chạy dưới thư mục project phải còn trong compose mới với cùng target và cùng source, thiếu hoặc lệch là `path_mismatch`. Service chưa có container (replicas 0) vẫn bị bỏ qua. Chiều mới sang cũ giữ nguyên.
- M3 `runner.ts`: `runUpdate(env, docker, overrides?)`, `RunnerDeps` = `compose`, `fetchCompose`, `chmod`, `chown`; production dùng mặc định, không đổi hành vi. Test mới `updater-runner.test.ts` (thư mục `mkdtemp` thật, Docker và compose giả).
- L1/L2: `chmod` và `chown` đều warn rồi chạy tiếp; áp cho cả `.bak` (cùng mode, uid, gid với file gốc) và file mới.
- L3: `POST /v1/update` tuần tự hoá trong tiến trình (cờ `starting`); request thứ hai nhận 409 `busy`. Runner kẹt ở `created` quá 60 giây coi như đã hỏng (state `failed`, reason `internal`), bị gỡ và tạo lại, `/v1/status` không còn báo `busy` mãi. Runner đang chạy hoặc đã thoát giữ nguyên ngữ nghĩa.
- L4: `docs/self-host.md` dòng `MTL_UPDATER` ghi chỉ nhận `0` hoặc `1`. Đoạn khôi phục `.bak` (~l.292) vẫn đúng, không sửa.
- Compose: thêm `MTL_UPDATER: ${MTL_UPDATER:-1}` vào `x-app-env`. `compose-vars.ts` giữ `MTL_UPDATER` là `fixed "1"` (runner chỉ chạy khi updater đang chạy, nên không bao giờ bị lật thành 0); test quét biến vẫn xanh nên không cần sửa file đó.

## Test (đều fail nếu thiếu bản sửa)
- `updater-server.test.ts`: rc trùng target nhận; rc khi target trống hoặc khác bị từ chối; ghim + rc trùng target nhận; runner `created` cũ bị thay; `created` mới vẫn `busy`; hai POST đồng thời cho 202 và 409.
- `updater-runner-plan.test.ts`: đổi ca "dời ra ngoài thư mục project" thành `path_mismatch`; thêm ca mount bị bỏ, ca không có container vẫn qua.
- `updater-runner.test.ts` (mới): thành công (`.bak` cũ, mode 0640 giữ, chown theo uid/gid gốc, file tạm sạch, thứ tự step); sáu ca lỗi (download, invalid_compose, image_not_allowed, path_mismatch, pull_failed, version_mismatch) thì compose nguyên byte, không `.bak`, không file thừa, không `up`; chmod/chown lỗi chỉ cảnh báo; `up` lỗi báo `up_failed`.

## Hình dạng HTTP / reason
Không đổi cấu trúc response hay danh sách reason. Thay đổi hành vi mà app client cần biết:
- Prerelease không khớp `MTL_UPDATE_TARGET` giờ trả 422 `not_newer` (trước đây 202).
- POST đồng thời trả 409 `busy`.
- `run.state` của runner kẹt `created` quá 60 giây là `failed` với reason `internal` (trước đây `running`).

## File đã sửa
`apps/api/src/updater/{server,runner,runner-plan}.ts`, `apps/api/test/unit/updater-{server,runner-plan}.test.ts`, `apps/api/test/unit/updater-runner.test.ts` (mới), `docker-compose.yml`, `docs/self-host.md` (một dòng). Không commit.

## Lưu ý
- Reason `not_newer` cho prerelease sai target hơi lệch nghĩa; chỉ `detail` nói rõ. Có thể thêm reason riêng sau nếu app muốn hiển thị khác.
- `lint` từng báo lỗi ở file web của agent khác giữa chừng, lần chạy cuối sạch.
