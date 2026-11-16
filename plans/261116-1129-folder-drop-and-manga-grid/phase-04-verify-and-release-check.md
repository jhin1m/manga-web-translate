---
phase: 4
title: "Phase 4: Kiểm tra + phát hành"
status: todo
priority: P1
effort: "2h"
dependencies: [1, 2, 3]
---

# Phase 4: Kiểm tra + phát hành

## Overview
Gate toàn repo, image app có `sharp` chạy được trên amd64 + arm64, selfhost smoke + thử nâng cấp từ bản trước, user thử
trên Windows; cập nhật docs.

## Requirements
- Functional: toàn bộ tiêu chí ở `plan.md` đạt.
- Non-functional: RAM app container không tăng đáng kể khi trang chủ tạo thumbnail lần đầu (đo); không hỏng nâng cấp
  từ bản đang phát hành (migration `cover_key` chạy tự động lúc boot).

## Architecture
Theo quy trình release đã dùng (memory self-host Windows): tag `vX.Y.Z-rc.N` → CI build → `SMOKE_SKIP_BUILD=1
infra/selfhost-smoke.sh` trên image rc + thử nâng cấp (`infra/selfhost-update-smoke.sh`) → user thử Windows → tag
chính thức đúng commit đã thử → GitHub Release (lệnh PowerShell dùng `curl.exe`, mỗi lệnh một dòng).

## Related Code Files
- Modify: `README.md` (Tính năng: thả folder, lưới bìa), `docs/self-host.md` (nếu đổi RAM / hướng dẫn), ghi chú bản
  phát hành trong `docs/releases/`, `docs/project-roadmap.md`, có thể `infra/selfhost-smoke.mjs` (selector)
- Create: —
- Delete: —

## Implementation Steps
1. `pnpm typecheck && pnpm lint && pnpm test` (cần `pnpm infra:up`); `cd worker && uv run pytest` (không đổi worker,
   chạy để chắc).
2. `docker build -f infra/docker/app.Dockerfile` amd64 + arm64 (buildx) → `node -e "require('sharp')"` trong cả hai.
3. Chạy selfhost local: thả folder 3 chương, xem trang chủ / series, đổi bìa; `docker stats` đo RAM app khi tạo ~20
   thumbnail lần đầu.
4. Selfhost smoke + update smoke trên image rc.
5. Nhờ user thử Windows (Docker Desktop): Chrome, Edge, Firefox — thả folder, "Chọn folder…", lưới, bìa.
6. Docs + release notes; tag chính thức + GitHub Release sau khi user xác nhận.

## Success Criteria
- [ ] Gate xanh; image 2 arch load được `sharp`.
- [ ] Smoke + update smoke qua.
- [ ] User xác nhận trên Windows.
- [ ] Docs + release notes cập nhật, khớp hành vi thật.

## Risk Assessment
- `sharp` thiếu binary arm64 trong CI: kiểm `pnpm-lock` có `@img/sharp-linux-arm64`; pnpm `supportedArchitectures`
  nếu cần.
- Smoke dùng selector cũ: đã grep ở phase 3 bước 1.
- Rollback release: giữ tag cũ; người dùng `docker compose pull` bản trước (migration down tay nếu cần — cột nullable,
  để nguyên cũng không hại bản cũ).
