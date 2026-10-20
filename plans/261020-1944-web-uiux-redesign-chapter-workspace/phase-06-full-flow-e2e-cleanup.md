---
phase: 6
title: "E2E luồng đầy đủ + dọn code chết + docs"
status: pending
priority: P1
effort: 1.5d
dependencies: [5]
---

# Phase 6: E2E luồng đầy đủ + dọn code chết + docs

## Overview
Khoá kết quả redesign bằng e2e luồng chính "thả strip → dịch (worker giả) → sửa → xuất" và e2e đếm click; bật dev auto-login trong môi trường e2e để kiểm cả phía web; dọn code/CSS chết; cập nhật docs. Kết thúc bằng buổi owner chạy thử theo danh sách việc.

## Requirements
- E2E chạy trên viewport 1920×1080 (màn ≥ 24" owner chốt).
- E2E API bật `DEV_AUTO_LOGIN_EMAIL/PASSWORD` = owner seed (`apps/web/e2e/seed.ts:15-16`), `NODE_ENV=development` (đã có ở `playwright.config.ts`), `BETTER_AUTH_URL=http://localhost:5180` → auto-login hoạt động; spec cũ dùng `/login` vẫn chạy (route login tường minh).
- Không còn file/CSS/export không dùng sau P1–P5.
- Docs phản ánh luồng mới.

## Architecture
```
full-flow.spec.ts
 goto "/" (auto-login) ─ setInputFiles(drop-zone, strip.png) ─ click "Tạo" ─> /w/:ws/s/:s/c/:c
 ─ chờ upload xong ─ click "Dịch chương" ─ runFakeWorker(pagesPerSource=3) ─ rail 3 trang "xong"
 ─ click dòng trang 2 ─ fill Dịch ─ "Đã lưu" ─ API GET page khớp
 ─ click "Xuất" (primary) ─ drawer: không cảnh báo ─ Xuất ─ "Tải xuống" 302
click-budget.spec.ts
 "/" → click "Mở" ở thẻ Tiếp tục (1)            → màn chương có canvas
 "/" → click thẻ series (1) → click "Mở" hàng chương (2) → màn chương có canvas
routes-redirect.spec.ts (gom case redirect P1–P3)
```

## Related Code Files
Create:
- `apps/web/e2e/full-flow.spec.ts`
- `apps/web/e2e/click-budget.spec.ts`
- `apps/web/e2e/routes-redirect.spec.ts` (chuyển các case redirect đã thêm rải rác ở P1–P3 về đây)

Modify:
- `apps/web/e2e/env.ts` (`E2E_ENV` thêm 2 biến auto-login), `apps/web/playwright.config.ts` (`viewport: {width:1920, height:1080}`)
- `apps/web/e2e/helpers.ts` (`login()` thành: goto "/" → chờ home; giữ đường `/login` cho spec cần form)
- `apps/web/e2e/upload-chapter.spec.ts`, `editor.spec.ts`, `chapter-tools.spec.ts` (bỏ case redirect đã gom)
- `apps/web/src/features/editor/editor.css`, `apps/web/src/styles/tokens.css` (xoá class chết: `.editor` grid cũ, `.ed-top`, `.ed-strip`, `.ed-regions` và class trang upload/series cũ — xác nhận bằng `rg` từng class trước khi xoá)
- `apps/web/src/features/chapter/status.ts` (giữ `CHAPTER_STATUS`; `PAGE_STATUS` chỉ giữ nếu `page-status.ts` còn dùng nhãn GĐ1/GĐ2 trong tooltip, không thì xoá)
- `docs/development-setup.md` (mục Web: router mới, màn chương gộp, dev auto-login, session 7 ngày, e2e mới)
- `docs/editor.md` (màn chương: page active + cache, chính sách khoá theo trạng thái chương, chia đôi, phím tắt mới)
- `docs/design-guidelines.md` (layout màn chương 4 vùng, drawer, nút primary theo trạng thái; mục "Việc còn mở": ghi owner giữ hướng A ngày 20/10/2026)
- `docs/export-and-batch-edit.md` (Xuất = drawer, Tìm/Thay + Glossary = tab bảng dưới)

Delete (xác nhận lại đã xoá ở P2–P5, nếu sót thì xoá ở đây): `features/upload/upload-page.tsx`, `features/series/{series-list-page,series-settings-page}.tsx`, `features/chapter/{chapter-page,Modal}.tsx`, `features/editor/EditorPage.tsx`, `features/editor/canvas/Stage.tsx`, `features/editor/panels/{Toolbar,PageStrip,RegionTable}.tsx`.

## Implementation Steps
1. Bật auto-login trong env e2e; sửa `helpers.login`.
2. Viết `full-flow.spec.ts` (bắt `pageerror` → mảng rỗng cuối test), `click-budget.spec.ts` (đếm bằng biến tăng sau mỗi `click()` có điều hướng, assert ≤ 3), gom `routes-redirect.spec.ts`.
3. Dọn: `rg` mỗi export/class nghi chết → xoá; `pnpm lint` (biome `noUnusedImports`/`noUnusedVariables`).
4. Docs (đọc file hiện tại trước, sửa đúng mục, kiểm link).
5. Chạy toàn bộ: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @mtl/web e2e` (gồm `typeset-parity`).
6. Owner chạy thử với 1 chương thật (worker Mac) theo danh sách: thả strip ở home → Dịch chương → sửa 5 dòng trong bảng (1 dòng xuyên trang) → chỉnh 1 box trên canvas → giữ O so gốc → Xuất CBZ. Ghi phản hồi vào PR; lỗi chặn → mở task mới, không mở rộng phase.

## Success Criteria
- `full-flow.spec.ts` xanh: chương tạo từ 1 file ở home; URL màn chương có trước khi upload xong; nút primary lần lượt có nhãn "Dịch chương" → (disabled) "Đang dịch" → "Xuất"; 3 trang "xong"; bản dịch sửa có trong `GET /api/w/:ws/pages/:id`; drawer Xuất không có dòng cảnh báo; link tải trả 302; 0 `pageerror`.
- `click-budget.spec.ts` xanh: đường "Tiếp tục" = 1 click, đường series = 2 click (≤ 3).
- `routes-redirect.spec.ts` xanh cho 6 path cũ trong `plan.md` (Sitemap).
- `rg -n "series/\\\$seriesId/upload|chapters/\\\$chapterId/edit" apps/web/src` chỉ còn trong định nghĩa route redirect của `router.tsx`.
- Mọi e2e cũ (`upload-chapter`, `editor`, `chapter-tools`, `typeset-parity`) xanh; `pnpm typecheck`, `pnpm lint`, `pnpm test` xanh.
- Owner hoàn thành danh sách bước 6 không cần hỏi "bấm đâu" (ghi nhận trong PR).

## Risk Assessment
| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| E2E chập chờn do polling 2.5s + debounce lưu 2s | M×M | `expect.poll`/timeout 10–30s như spec hiện có; worker giả chạy trong test |
| Bật auto-login trong e2e che lỗi form login | L×M | Giữ 1 case `/login` bằng form trong `helpers` (spec `upload-chapter`) |
| Xoá CSS dùng chung nhầm | M×L | `rg` từng class trước khi xoá; e2e screenshot `trace` khi fail |
| Worker giả không phản ánh cắt strip thật | M×M | Bước 6 owner chạy worker Mac thật; ingest thật đã có test ở P3 MVP |
Rollback: revert PR (chỉ test/docs/xoá code chết).
