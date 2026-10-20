---
title: "Redesign UI/UX web: chương là editor gộp"
description: "Bỏ trang upload riêng và editor route-per-page; 3 màn (home, series, chương = editor gộp cuộn liên tục cả strip) + 2 drawer (Xuất, Hoạt động), dev auto-login."
status: in-progress
priority: P1
effort: 16.5d
branch: main
tags: [web, ux, editor, konva, router, redesign]
created: 2026-10-20
---

# Redesign UI/UX web: chương là editor gộp

## Mục tiêu
Owner chê UI "rất kém, khó dùng, không hình dung được workflow". Luồng hiện tại 7 bước (picker → series list → series → upload → chương → editor per-page). Đích: **thả strip → Dịch chương → sửa trong bảng/canvas → Xuất**, tất cả trong màn chương. Backend giữ nguyên; chỉ thêm 2 endpoint đọc (`recent-chapters`, `chapters/:id/states`), 2 trường additive (`page_counts`, `images`) và 1 route dev; không đổi schema.

Đầu vào: [`../reports/researcher-261020-1938-manga-translator-ux-reference-report.md`](../reports/researcher-261020-1938-manga-translator-ux-reference-report.md) mục 3; MVP [`../261019-1847-manga-translate-editor-mvp/plan.md`](../261019-1847-manga-translate-editor-mvp/plan.md).

## Quyết định owner (20/10/2026)
1. Đầu vào = 1 strip dài; ingest P3 tự cắt page. Canvas cuộn liên tục cả chương như 1 strip, virtualize theo page (chỉ mount page trong tầm nhìn ±1).
2. 1 người làm cả chương. Trạng thái page: chưa / đang xử lý / xong / lỗi + cờ cần xem (tràn box, AI có bản mới). Không proofread/QC.
3. Màn ≥24": mặc định hiện cùng lúc rail trang (trái) + canvas + inspector (phải) + bảng văn bản toàn chương (dưới, thu gọn được).
4. Sitemap bên dưới; bỏ trang upload và route editor per-page (redirect route cũ). Nút primary theo trạng thái: Tải ảnh → Dịch chương → Xuất. Xem Gốc/Dịch/Chia đôi + giữ `O`. Drawer Xuất, drawer Hoạt động. Picker workspace chỉ khi >1 workspace.
5. Dev auto-login: chỉ khi `NODE_ENV=development` **và** `DEV_AUTO_LOGIN_EMAIL` đặt; không bao giờ ở production (guard + test). Session better-auth hiện = **mặc định 7 ngày** (`expiresIn` 604800s, `updateAge` 1 ngày, `apps/api/src/auth.ts:25` không cấu hình `session`) — P1 ghi rõ thành cấu hình tường minh, không đổi hành vi.
6. Giữ backend/API; chỉ thêm endpoint thật cần; không đổi schema.
7. Giữ hướng visual A (`docs/design-guidelines.md`), sửa cho dễ dùng.

## Sitemap đích
```
/login                                  (dev: tự đăng nhập nếu bật)
/                                       Home: vùng thả lớn + dòng xác nhận inline · "Việc cần làm" (mọi chương mở, 1 nút bước tiếp) · danh sách series dạng hàng
/w/:ws/s/:series[?tab=chapters|glossary|settings]   Lưới chương + trạng thái; thả file vào hàng/ô "Chương mới"
/w/:ws/s/:series/c/:chapter[?page=<pageId>]          CHƯƠNG = editor gộp (rail | canvas | inspector / bảng văn bản)
   ├ drawer Xuất          (state cục bộ, không đổi route)
   └ drawer Hoạt động     (upload + job chương + export)
/w/:ws/glossary, /w/:ws/members         giữ nguyên (menu người dùng)
Redirect: /w/:ws → /, /w/:ws/series → /, /w/:ws/series/:s[/settings] → /w/:ws/s/:s[?tab=settings],
          /w/:ws/series/:s/upload → /w/:ws/s/:s, /w/:ws/series/:s/chapters/:c → /w/:ws/s/:s/c/:c,
          /w/:ws/series/:s/chapters/:c/edit/:p → /w/:ws/s/:s/c/:c?page=:p
```
Home → Series → Chương = 2 click (1 click qua nút ở "Việc cần làm").

## Quyết định kiến trúc chính (tech lead)
| Vấn đề | Chọn | Lý do |
|---|---|---|
| Sửa nhiều page trong 1 màn | Giữ `editorStore` 1 page = **page đang sửa (active)**; thêm `chapterStore` cache state mọi page (read-only) | `store.ts`/`save.ts`/`rebase.ts` + 8 file test giữ nguyên; Saver đã xử lý đổi `pageId` (`save.ts:122`). Đổi page = `flush()` → ghi cache → `load()` |
| Canvas liên tục | 1 Konva Stage cỡ khung nhìn; page xếp dọc theo `offsets[]`; mỗi page 1 `Group` + `TileLayer` với viewport cục bộ | Tái dùng `visibleTiles`/`TileLayer` nguyên vẹn; không canvas nào > khung nhìn (giới hạn Safari) |
| Khoá chương vs AI | Chỉ giữ khoá khi chương ổn định (`review/partial_failed/done`); bấm Dịch/Dịch lại = flush → nhả khoá → gọi API | AI chỉ ghi `state` khi chương **không khoá** (`apps/api/src/jobs/page-state-writer.ts:35`); giữ khoá lúc dịch → mọi trang thành "AI có bản mới", owner không thấy bản dịch |
| Bảng văn bản 1000+ dòng | `@tanstack/react-virtual` (dep mới duy nhất) | Cùng họ TanStack; tự viết windowing tốn hơn |
| Upload sống qua điều hướng | `upload-manager` (zustand vanilla, cấp module) | Thả ở home → điều hướng ngay sang màn chương, upload chạy tiếp |
| "Dịch chương" | = `POST /chapters/:id/commit` (ingest → prepare → translate tự chạy) | Khớp nút 3 trạng thái owner chốt, không thêm API |
| Tràn box | Tính ở client (`measure.ts` + font đã tải) | Không đổi schema/worker |

## Luồng dữ liệu màn chương
```
GET /chapters/:id            → chi tiết + khoá       (15s)
GET /chapters/:id/progress   → status page/job/version (2.5s khi chưa ổn định)  ─┐ version đổi
GET /chapters/:id/states  [mới] → state mọi page ─────────────> chapterStore.cache ◄┘ refetch
GET /chapters/:id/pages   [+images.original/clean] → URL ký 15' ─> rail thumb + TileLayer
click/hàng bảng/rail → activate(page): saver.flush → cache[prev]=base → editorStore.load(cache[next]) → IndexedDB recovery
sửa (canvas | bảng | inspector) → editorStore.apply → Saver (IndexedDB → PUT If-Match → 409 rebase / 423 read-only)
```

## Phases
| # | Phase | Ưu tiên | Effort | Phụ thuộc | Status |
|---|---|---|---|---|---|
| 1 | [Nền: dev auto-login, app shell, router mới + redirect](./phase-01-dev-login-app-shell-router.md) | P1 | 1.5d | — | Completed |
| 2 | [Home + series + upload inline](./phase-02-home-series-inline-upload.md) | P1 | 3.5d | 1 | Completed |
| 3 | [Màn chương gộp: layout, rail, canvas cuộn liên tục](./phase-03-chapter-workspace-continuous-canvas.md) | P1 | 4.5d | 2 | Completed |
| 4 | [Bảng văn bản + inspector + đồng bộ](./phase-04-text-table-inspector-sync.md) | P1 | 3d | 3 | Completed |
| 5 | [Drawer Xuất/Hoạt động, chế độ xem, phím tắt](./phase-05-drawers-view-modes-shortcuts.md) | P1 | 2.5d | 4 | Pending |
| 6 | [E2E luồng đầy đủ + dọn code chết + docs](./phase-06-full-flow-e2e-cleanup.md) | P1 | 1.5d | 5 | Pending |

Tuần tự P1→P6, mỗi phase để app chạy được (route cũ chỉ redirect khi màn thay thế đã có). File dùng chung qua nhiều phase (tuần tự, không song song): `apps/web/src/app/router.tsx` (P1, P2, P3), `apps/web/e2e/chapter-tools.spec.ts` + `editor.spec.ts` (P1, P3, P4, P5, P6), `apps/web/e2e/fake-worker.ts` (P3), `apps/web/e2e/helpers.ts` (P1, P6), `apps/web/src/features/chapter/chapter-workspace.tsx` + `chapter-topbar.tsx` + `editor/use-chapter-session.ts` (P3 tạo, P4–P5 sửa).

## Tiêu chí chấp nhận
- [ ] Từ home tới editor chương ≤ 3 click (e2e đếm click).
- [ ] Thả 1 strip ở home → tạo chương và mở thẳng màn chương, upload tiếp tục, nút đổi Tải ảnh → Dịch chương → Xuất.
- [ ] Không còn route upload riêng / editor per-page: URL cũ redirect đúng (e2e); `grep -rn "chapters/\$chapterId/edit\|/upload\"" apps/web/src` = 0 trong định nghĩa route.
- [ ] Canvas cuộn liên tục cả chương; chỉ ≤ 4 page có bitmap cùng lúc (vitest trên `visiblePages`); không lỗi console khi cuộn 20 page.
- [ ] Bảng văn bản: click dòng ↔ chọn block, sửa Dịch cập nhật canvas + autosave, Enter dòng sau, xuyên trang.
- [ ] Không mất sửa tay: 409 rebase, 423 read-only, crash → khôi phục IndexedDB (e2e cũ chuyển sang màn mới vẫn xanh).
- [ ] Dev auto-login chỉ chạy khi `NODE_ENV=development` + env bật; production khởi động lỗi nếu env bật (test API).
- [ ] Mọi e2e cũ cập nhật và xanh; e2e mới `full-flow.spec.ts` xanh; `pnpm typecheck`, `pnpm lint`, `pnpm test` xanh.

## Rủi ro chính
| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| Đổi page active chậm (await PUT) khi gõ xuyên trang | M×M | flush chỉ PUT khi dirty; đo p95 < 300ms local; history stash theo page |
| Bộ nhớ bitmap strip (800×12000×4 ≈ 38MB/page, chia đôi ×2) | M×H | Trần 4 page mount, `close()` khi unmount (TileLayer sẵn có), test Safari |
| Giữ khoá làm AI không ghi `state` | H×H | Chính sách khoá theo trạng thái chương (P3) + test e2e "dịch xong thấy bản dịch" |
| Find/replace ghi server làm version active page lệch | M×M | flush trước apply; reload active + cache sau apply (P4) |
| Phạm vi lớn, phase 3 vỡ | M×H | Phase 3 giữ panel cũ ở inspector để editor chạy được trước khi P4 thay |

## Rollback
Mỗi phase 1 PR. API chỉ thêm route đọc (xoá route = rollback, không migration). Web: revert PR phase; redirect route cũ làm trong cùng PR với màn thay thế nên revert không để link chết. Dev auto-login tắt bằng bỏ env.

## Câu hỏi mở
1. Sau khi upload xong có tự "Dịch chương" luôn (bớt 1 click) không? Mặc định plan: **không**, chờ bấm (đúng chuỗi nút owner chốt).
2. (Đã chốt) "Việc cần làm" tính theo workspace, chương mình giữ khoá đứng đầu; design Home/Series owner duyệt 20/10/2026.
3. Bỏ sắp xếp tay thứ tự file khi upload (chỉ natural sort) — owner có cần giữ không? Mặc định: bỏ (đầu vào 1 strip).
