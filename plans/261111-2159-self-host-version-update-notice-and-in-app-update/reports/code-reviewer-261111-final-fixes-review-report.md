# Review cuối: các bản sửa N1–N5 (updater, runner, web, docs)

Điểm toàn tính năng: **9/10**. Critical 0 · High 0 · Medium 0 · Low 3 (+ nit). N1, N2, N3(a), N4, N5 sửa đúng; test của từng bản sửa đều đỏ nếu bỏ bản sửa. Không thấy hồi quy.

## Gate
`@mtl/api test:unit` 190/190 · `@mtl/web test` 486/486 · `typecheck` sạch · `lint` (472 file) sạch · e2e `update-notice` 13/13.

## Từng bản sửa
- **N1** `server.ts:172-183`: nhánh prerelease vẫn đòi đúng bằng `MTL_UPDATE_TARGET` và thêm `isNewer(version, info.current)` (`:179`). `runner.ts:70-71` kiểm `from` hợp lệ và `to > from`, reason `not_newer`.
  - Test `updater-server.test.ts:342-351` (target 0.1.0-rc.1 và 0.2.0-rc.9 trên app 0.2.0) và `updater-runner-plan.test.ts:255-256` đều đỏ với code cũ. Tag `latest` vẫn khớp, nên không check nào khác ném thay.
  - Smoke `FROM=0.3.0-rc.1 TO=0.3.0-rc.2`: `smoke.sh:82` đã đòi TO > FROM, `:127` đặt target = TO, và `isNewer(rc.2, rc.1)` đúng ở cả updater lẫn runner. Sau khi lên rc.2, target bằng bản đang chạy nên POST mới trả 422, đúng ý N1. Bước kiểm sau cập nhật (`:418-421`) không POST lại.
  - Runner không từ chối nhầm được. Nó chạy từ `info.selfImage` (`server.ts:191`), nên luôn cùng code với updater đã tạo nó. `MTL_UPDATE_FROM` lấy từ `info.current`, tức `MTL_VERSION` của app, đã qua `parseVersion` (`discovery.ts:205-206`). Bản `dev` hay chuỗi lạ dừng ở `dev_build` trước khi tạo runner.
- **N2** `runner-plan.ts:110-116`: service có trong snapshot mà thiếu trong file mới → `invalid_compose`. Chỉ runner gọi, ở bước download (`runner.ts:220`), trước pull và trước khi ghi đĩa.
  - Snapshot (`discovery.ts:109-123`) gồm mọi container có nhãn service và bind dưới thư mục, kể cả container đã dừng. Runner không mang nhãn compose nên không lọt vào.
  - Mọi tag từ v0.1.0-rc.1 đến v0.2.0 có cùng 4 service và không dùng profiles, nên hôm nay không báo nhầm. Test `:69-72` đỏ với code cũ.
  - Web: `invalid_compose` dùng câu chung "Cập nhật lỗi." kèm log và lệnh tay (`update-dialog.tsx:165-177`).
- **N3(a)** `update-model.ts:153-161` + `update-dialog.tsx:166`: hộp `landed` hết câu "App chưa chạy lại được". Unit test duyệt mọi reason (`update-model.test.ts:194`), e2e `:251` chặn câu cũ.
- **N5** `update-dialog.tsx:114-131`: 429 giờ hỏi lại status bằng `runningFor` (chỉ nhận run `running` cùng target). Không có run thì hiện câu `cooldown` với run null, nên không hiện lại log cũ. 409 `busy` vẫn theo dõi. E2e `:361` đỏ với code cũ (hộp kẹt "Đang kiểm tra…").
- **N4** `smoke.sh:17` đã bỏ mã quyết định. **Docs** `self-host.md:100,323-327` khớp code.

## Còn lại
1. **Low, N3(b) chưa làm.** `update-model.ts:204-207`: `failedRun` ẩn run lỗi khi `current === target`.
   - Kịch bản: `path_mismatch` hoặc `up_failed` ở bước check, sau khi app đã lên bản mới. Đóng hộp hay tải lại là mất cảnh báo "dữ liệu có thể chưa đúng". Trang cũng không tự tải lại nên vẫn chạy bundle web cũ.
   - Sửa: trả run khi `step ∈ {apply, check}` để hộp mở lại với `landed: true`, hoặc tối thiểu `location.reload()` khi đóng hộp landed.
2. **Low, orphan khi một bản bỏ service.** `self-host.md:327` yêu cầu cập nhật tay, nhưng lệnh tay (`self-host.md:122-126`, `update-model.ts:178-182`) không có `--remove-orphans`.
   - Container của service bị bỏ vẫn chạy image cũ trên DB đã migrate, đúng mối nguy mà N2 chặn.
   - Container đó vẫn nằm trong snapshot, nên mọi lần "Cập nhật ngay" sau đó đều trả `invalid_compose` với câu chung.
   - Sửa: mục 8 ghi rõ ghi chú phát hành phải dùng `docker compose up -d --remove-orphans`. Thêm `REASON_TEXT.invalid_compose`, ví dụ "Bản này cần cập nhật tay, xem ghi chú phát hành".
3. **Low, vệ sinh commit.** `apps/web/.claude/agent-memory/` vẫn untracked và không bị ignore. Cần loại ra trước khi commit.
- **Nit:**
  - `updater-runner-plan.test.ts:258` chỉ kiểm `toThrow(RunnerFail)`. Nên assert `reason === "not_newer"` cho hai dòng mới.
  - Comment `updater-server.test.ts:343` nói "an equal one would reinstall" nhưng không có ca rc bằng rc.
  - Comment tiếng Anh ở `update-dialog.tsx:120-121` lạc giữa file chú thích tiếng Việt.
