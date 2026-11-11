# Báo cáo tiến độ: phiên bản + cập nhật trong app (11/11/2026, 23:50)

## Tóm tắt
- Phase 1-7: completed (đã đối chiếu `status` trong từng file phase). Phase 8: pending, chưa bắt đầu.
- 7/8 phase xong (~28.5h/31.5h kế hoạch, chưa tính thời gian user ở phase 8).
- Review: 2 vòng + sửa, vòng cuối đang chạy.

## Bằng chứng
- Gate xanh: lint, typecheck, api 705 (+1 skip), web 486, shared 114, db 8, worker 414.
- E2E đạt, trừ `block-panel.spec.ts:317` (đỏ sẵn trên HEAD) và `series-suggestions.spec.ts:18` (chập chờn, riêng thì qua).
- Chi tiết: `reports/tester-261111-full-gate-report.md`.

## Thay đổi phạm vi / quyết định khi review
- Prerelease chỉ nhận khi bằng `MTL_UPDATE_TARGET` và mới hơn bản đang chạy.
- Bind kiểm hai chiều; service thiếu trong compose mới → `invalid_compose`.
- `MTL_UPDATER` truyền vào app; tắt thì không gọi mạng tới `updater`.
- POST updater tuần tự; runner kẹt `created` > 60s thì thay.
- Web theo dõi tới khi run xong (cap 10 phút); màn lỗi `AppShell` chỉ khi không có dữ liệu.

## Blocker / rủi ro
- Phase 8 chặn bởi: commit + push chưa làm (owner: lead), máy Windows của user (owner: user).
- Chưa kiểm thật: Actions (`github-release`), amd64, Docker Desktop/Windows/Linux, compose v5.7.0 (research v5.1.2), `pg_dump` local (1 test skip).
- Các mục "Done" cần xác nhận thật (phase 2, 4, 6, 7) đã ghi chú trỏ sang phase 8.
- Working tree lẫn file plan khác (chapter/**, docs/editor.md, docs/design-guidelines.md...): add theo đường dẫn, không `add -A`.

## Bước tiếp theo (owner / định nghĩa xong)
1. Lead: xử lý review cuối, commit + push main / CI xanh.
2. Lead: tag rc.1, rc.2 / image GHCR đúng `MTL_VERSION`, không có Release.
3. Lead: chạy `infra/selfhost-update-smoke.sh` / in `UPDATE SMOKE OK` + báo cáo.
4. User: checklist Windows C, D, E1 / báo đạt.
5. Lead: thay fixture Windows thật, sửa docs, tag `v0.3.0` / đúng 1 Release Latest, journal.

## Câu hỏi chưa giải quyết
- Có máy Linux rootful để chạy smoke không? Không thì docs ghi "Linux chưa kiểm".
- Phase 8 mới chỉ chờ commit: cần user xác nhận thời điểm thử trên Windows.
