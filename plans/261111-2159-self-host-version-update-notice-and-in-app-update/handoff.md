# Bàn giao sang session mới (11/11/2026, 23:50)

## Trạng thái

- **v0.2.0 đã phát hành** (commit `508a3b9`, `f771899`). Plan trước `261111-1925-series-memory-glossary-pronoun-suggestions` đã completed.
- **Plan này: phase 1-7 đã triển khai, review 2 vòng + sửa.** Review cuối đang chạy: xem `reports/` xem đã có báo cáo chưa, xử lý finding trước khi commit.
- **Phase 8 (cổng phát hành) chưa bắt đầu.** Cần commit + push, rồi máy Windows của user.
- **Chưa commit gì.** Toàn bộ code của plan nằm trong working tree.
- Gate xanh: lint, typecheck, `pnpm test` (api 705 + 1 skip, web 486, shared 114, db 8), worker pytest 414, web e2e.
  Ngoại lệ: `block-panel.spec.ts:317` đỏ sẵn trên HEAD sạch (không do plan này), `series-suggestions.spec.ts:18` chập chờn, chạy riêng thì qua.
- Báo cáo: `reports/` (phase `fullstack-developer-261111-phase-0*`, review `code-reviewer-261111-*`, sửa `*-review-fixes-report.md`, gate `tester-261111-full-gate-report.md`).

## File chưa commit: của plan này (commit cùng nhau)

Sửa:
- `.github/workflows/release.yml`, `README.md`, `docker-compose.yml`
- `apps/api/src/{app,env}.ts`, `apps/api/src/routes/admin.ts`
- `apps/api/test/{local-mode,tenant-isolation}.test.ts`, `apps/api/test/unit/env-local.test.ts`
- `apps/web/src/app/{app-shell.css,app-shell.tsx}`, `apps/web/src/lib/api.ts`
- `docs/project-roadmap.md`, `docs/self-host.md`
- `infra/docker/{app-entrypoint.sh,app.Dockerfile}`
- `packages/shared/{package.json,src/index.ts}`

Mới:
- `apps/api/src/lib/{update-check,updater-client}.ts`, `apps/api/src/routes/admin-update.ts`, `apps/api/src/updater/`
- `apps/api/test/admin-update.test.ts`, `apps/api/test/unit/{update-check,updater-*}.test.ts`, `apps/api/test/unit/fixtures/`
- `apps/web/e2e/update-notice.spec.ts`, `apps/web/src/features/update/`
- `docs/releases/` (v0.3.0.md)
- `infra/selfhost-update-smoke.sh`
- `packages/shared/src/update.ts`, `packages/shared/test/update.test.ts`
- `plans/261111-2159-self-host-version-update-notice-and-in-app-update/`

Lưu ý: `git status --short` là nguồn đúng. `app-shell.tsx` chỉ nằm trong plan này (dòng import `ShellActivity` không đổi). Nên `git add` theo từng đường dẫn, không dùng `git add -A`.

## File chưa commit: của plan khác (KHÔNG commit cùng)

- `apps/web/src/features/chapter/**` (chapter-meta-popover, chapter-topbar, chapter-workspace.css, lang-pair-fields, more-menu, primary-action(.test), tool-icons)
- `apps/web/e2e/chapter-topbar.spec.ts`
- `docs/editor.md`, `docs/design-guidelines.md`
- `apps/web/.claude/`, `qa-before-delete.png`
- `plans/reports/research-261031-2126-koharu-features-to-adopt-report.md`, `plans/reports/research-261031-2132-koharu-editor-pipeline-ideas-report.md`
- Các thư mục plan khác: `plans/261030-2356-editor-bug-hunt-overnight/`, `plans/261031-1318-editor-user-decisions/`, `plans/261106-1519-ui-simplify-wireframe/`, và plan chưa track khác trong `git status`.

## Phase 8: bước tiếp theo, theo thứ tự

**Đã xong (12/11/2026, 00:50):**
- Review cuối 9/10, đã sửa các lỗi low.
- Commit `f1c0e3d..c7501d3` đã push lên main. CI `main` xanh.
- Tag `v0.3.0-rc.1` và `v0.3.0-rc.2` (cùng commit `c7501d3`). Release workflow xanh. Image có amd64 và arm64, label và
  `MTL_VERSION` đúng, có `docker-compose` v5.7.0. Không tạo Release cho rc.
- Smoke `UPDATE SMOKE OK` trên macOS OrbStack, xem `reports/update-smoke-0.3.0-rc.1-to-0.3.0-rc.2-report.md`. Script
  smoke đã sửa ca hai tag cùng commit.

Các commit sau `c7501d3` chỉ đổi script smoke, docs và plan, không đổi image. Nếu sửa code app/updater thì phải cắt rc mới
và smoke lại trước khi tag chính thức.

6. Test bootstrap thủ công: 0.2.0 → rc (cập nhật tay một lần, vì 0.2.0 không có updater). Theo lệnh ở `docs/self-host.md`
   mục Cập nhật, với `MTL_TAG=0.3.0-rc.2` và compose của tag `v0.3.0-rc.2`. Kiểm dữ liệu còn, `updater` running, menu
   hiện `v0.3.0-rc.2`.
7. User chạy checklist Windows (phase 8 mục C, D, E1; lệnh PowerShell 5.1, dùng `curl.exe`, mỗi lệnh một dòng). Chờ user báo đạt.
8. Thay fixture Windows giả bằng `docker inspect` thật (`apps/api/test/unit/fixtures/`), chạy lại unit test discovery; sửa `docs/self-host.md` (dòng 21 và phần Windows) theo đúng phạm vi đã kiểm.
9. Tag `v0.3.0` đúng commit đã thử. Kiểm đúng 1 Release "Latest", tiêu đề từ `docs/releases/v0.3.0.md`. Chạy lại smoke với đích chính thức nếu có bản kế tiếp.
10. Journal (`/ak:journal`).

Không gắn tag `v0.3.0` khi user chưa báo checklist Windows đạt. Quyết định đã chốt: Windows không qua mount cùng đường dẫn thì vẫn phát hành, nút tự lùi về lệnh tay.

## Khoảng trống đã biết

- `pg_dump` không có trên máy dev: 1 test api bị skip.
- Compose trong image là v5.7.0, research kiểm trên v5.1.2. Smoke thật là bằng chứng cho v5.7.0.
- Docker Desktop Mac/Windows/Linux chưa thử cập nhật trong app (mới có OrbStack qua research). Linux ghi "chưa kiểm" trong docs nếu không có máy.
- amd64 chưa thử (máy dev là arm64).
- Job `github-release` chưa chạy trên Actions thật.
- Đường `latest` (bản chính thức) chưa smoke: chỉ khác giá trị `MTL_TAG`, unit test khoá giá trị.
