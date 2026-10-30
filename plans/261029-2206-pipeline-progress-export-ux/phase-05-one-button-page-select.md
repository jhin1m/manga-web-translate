---
title: "Phase 5: 1 nút Dịch chương + chọn trang + nhãn theo lô"
status: completed
effort: 8h
---

# Phase 5: 1 nút "Dịch chương" + chọn trang + nhãn theo lô (web)

## Overview

Thay "Bước 1 · Xoá chữ + OCR" / "Bước 2 · Dịch" bằng 1 nút **"Dịch chương"** (commit → cắt → xoá chữ → chuỗi dịch);
menu ⋯ giữ "Chỉ xoá chữ + OCR (soát trước)" (dừng ở "Chờ dịch"). Chọn trang: "Dịch trang này" ở panel Chọn, Shift/
Ctrl-click thumbnail → "Dịch N trang". Thumbnail + chip hiện "Chờ lượt · lô k/n", "Đang dịch", "Đang đặt chữ";
thanh trên "Đang dịch · x/y trang". Nối các phần P1/P2 hoãn: nhãn bước VI ở ExportRow, toast "Tải xuống" khi drawer
Xuất đã đóng. Chỉ web — API đã có ở P3 (commit `target`, `POST /translate {page_ids}`, progress `run`).

## Context

- `apps/web/src/features/chapter/primary-action.ts:20-108` (STEP1 "Bước 1 · Xoá chữ + OCR", prepared → "Bước 2 · Dịch");
  render ở `chapter-topbar.tsx:41-124` + `more-menu.tsx:36-38`.
- `apps/web/src/features/chapter/status.ts:27-65` `chapterChip` ("Bước 1 · …", "Đang dịch 3/5").
- `apps/web/src/features/chapter/next-action.ts:82-98` (home/series: "Bước 1", "Bước 2 · Dịch").
- `apps/web/src/features/chapter/page-status.ts` (P2 đã dùng `stageLabel`); `page-rail.tsx:18-29,102-103` (click =
  `onPick`); `select-panel.tsx:86-99` `RetranslatePage`.
- `apps/web/src/features/chapter/chapter-workspace.tsx:369-400` `action` (commit / translate / retranslate-page …),
  `:993-1005` ExportDrawer; `notify` toast có sẵn trong file.
- `apps/web/src/features/chapter/api.ts:121-128` `commitChapter` (body `{}`), `translatePrepared`, `retranslate(ch,
  pageIds?)`; kiểu `Progress`/`ProgressPage` `:34-54`.
- API (P3): commit `{target}`, progress `chapter.run {target,total,remaining,batch,batches}`, `pages[].translate_queued`,
  `pages[].run_batch`; 409 `translate_running`.
- e2e dùng nhãn cũ: `apps/web/e2e/click-budget.spec.ts:43-71`, `full-flow.spec.ts:42-63`, `upload-chapter.spec.ts:51-132`.

## Requirements

- `primaryAction`: `draft` → "Dịch chương" (command `commit`, gửi `target:"translated"`), menu ⋯ "Chỉ xoá chữ + OCR (soát
  trước)" (command `prepare_only`, gửi `target:"prepared"`); `prepared` → "Dịch chương" (command `translate`), menu
  "Chạy lại trang lỗi" nếu có; `partial_failed` chưa có page: giữ command `commit` (gửi `target:"translated"`), đổi
  nhãn "Chạy lại bước 1" → "Cắt lại trang"; các trạng thái khác giữ. Không còn chữ "Bước"/"bước" trong nhãn UI chương.
- `chapterChip`: đang cắt "Đang cắt trang"; đang xoá chữ "Xoá chữ + OCR x/y"; có `run` → "Đang dịch · x/y trang"
  (x = `total − remaining`, y = `total`) + " · lô k/n" khi `batches > 1`.
- `next-action.ts`: nhãn hành động "Dịch chương" thay "Bước 1"/"Bước 2 · Dịch"; mô tả bỏ chữ "Bước".
- Thumbnail (`thumbMark`): trang `translate_queued` chưa vào job chạy → "Chờ lượt · lô k" (k = `run_batch`); job dịch
  running stage `translate` → "Đang dịch", `typeset` → "Đang đặt chữ"; xong → yên (như cũ).
- Chọn trang: Shift-click = chọn dải từ trang neo, Ctrl/⌘-click = bật/tắt 1 trang; chỉ trang hiện, không bận, đã qua
  Bước 1 (`prepared|ready|failed` có OCR — server kiểm lại). Có ≥ 1 trang chọn → thanh trên rail "Dịch N trang" + "Bỏ
  chọn"; Esc bỏ chọn. Gọi `retranslate(chapterId, ids)`; 409 `translate_running` → toast "Đang có lượt dịch".
- Panel Chọn: trang `prepared` → nút "Dịch trang này"; trang `ready` → "Dịch lại trang này" (như cũ). Ẩn khi trang bận.
- ExportRow: in `stageLabel` (P2) thay vì để trống. Toast "Đã xuất xong — Tải xuống" khi lượt xuất mới xong mà drawer
  Xuất đã đóng (dùng `useExports` sẵn ở workspace `:748`).
- Drawer Hoạt động: nhãn job `chapter.translate` → "Dịch lô trang".

## Architecture

```
Nút "Dịch chương" ─▶ action("commit") ─▶ commitChapter(ch, "translated") ─▶ (server) ingest → prepare → chuỗi
Menu ⋯ "Chỉ xoá chữ + OCR" ─▶ commitChapter(ch, "prepared") ─▶ dừng ở prepared ─▶ nút "Dịch chương" ─▶ translatePrepared
Rail Shift/Ctrl-click ─▶ pageSelection (state ở workspace) ─▶ "Dịch N trang" ─▶ runAi(retranslate(ch, ids))
poll /progress ─▶ chapter.run + pages[].run_batch ─▶ chapterChip / thumbMark
```

```ts
// apps/web/src/features/chapter/page-selection.ts (mới, thuần)
export type Selection = { ids: ReadonlySet<string>; anchor: string | null };
export const EMPTY_SELECTION: Selection;
export function selectablePage(p: Pick<ProgressPage, "status" | "skipped" | "translate_queued" | "job">): boolean;
export function clickSelect(sel: Selection, pages: ProgressPage[], id: string, mod: { shift: boolean; toggle: boolean }): Selection;
export function selectionIds(sel: Selection, pages: ProgressPage[]): string[];   // theo ord, đã lọc selectable
// primary-action.ts
export type ChapterCommand = "upload" | "commit" | "prepare_only" | "translate" | "retry" | "retranslate" | "cancel" | "export";
// api.ts
export const commitChapter = (ch: string, target: "prepared" | "translated") => …;
export type ChapterRun = { target: "prepared" | "translated"; total: number; remaining: number; batch: number; batches: number };
// Progress.chapter.run: ChapterRun | null ; ProgressPage.translate_queued: boolean ; ProgressPage.run_batch: number | null
```

## File sở hữu

| Thao tác | Đường dẫn |
|---|---|
| Sửa | `apps/web/src/features/chapter/primary-action.ts`, `apps/web/src/features/chapter/primary-action.test.ts` |
| Sửa | `apps/web/src/features/chapter/status.ts`, `apps/web/src/features/chapter/status.test.ts` |
| Sửa | `apps/web/src/features/chapter/next-action.ts`, `apps/web/src/features/chapter/next-action.test.ts` |
| Sửa | `apps/web/src/features/chapter/page-status.ts`, `apps/web/src/features/chapter/page-status.test.ts` |
| Tạo | `apps/web/src/features/chapter/page-selection.ts`, `apps/web/src/features/chapter/page-selection.test.ts` |
| Sửa | `apps/web/src/features/chapter/page-rail.tsx` |
| Sửa | `apps/web/src/features/chapter/select-panel.tsx` |
| Sửa | `apps/web/src/features/chapter/chapter-workspace.tsx` |
| Sửa | `apps/web/src/features/chapter/chapter-workspace.css` (trạng thái chọn thumbnail, thanh "Dịch N trang") |
| Sửa (nếu cần render command mới) | `apps/web/src/features/chapter/chapter-topbar.tsx`, `apps/web/src/features/chapter/more-menu.tsx` |
| Sửa | `apps/web/src/features/chapter/api.ts` |
| Sửa (chỉ ExportRow: `stageLabel`) | `apps/web/src/features/chapter/export-panel.tsx` |
| Sửa (chỉ `JOB_LABEL`) | `apps/web/src/features/chapter/activity-drawer.tsx` |
| Sửa (chỉ chuỗi "Bước 1" dòng 4, 103 → "Xoá chữ + OCR") | `apps/web/src/features/pipeline/pipeline-settings.tsx` |
| Sửa (chỉ title dòng 28, 134 "sau Bước 2" → "khi chương đã dịch") | `apps/web/src/features/chapter/proofread-panel.tsx` |
| Sửa | `apps/web/e2e/click-budget.spec.ts`, `apps/web/e2e/full-flow.spec.ts`, `apps/web/e2e/upload-chapter.spec.ts` |

## Không được đụng

`apps/api/**`, `worker/**`, `packages/**` (nếu thiếu API → dừng, báo controller, không tự sửa), `use-chapter-session.ts`
(P4 đã xong), `export-options.ts`, `export-warnings.ts`, `stage-labels.ts` (chỉ import).

## Test viết trước (đỏ trước khi code)

`apps/web/src/features/chapter/primary-action.test.ts`
- "draft chapter offers one Dịch chương button with a prepare-only menu" — `{command:"commit",label:"Dịch chương"}`, menu `[{command:"prepare_only",label:"Chỉ xoá chữ + OCR (soát trước)"}]` (**tiêu chí 5**).
- "prepared chapter translates with the same label" — `{command:"translate",label:"Dịch chương"}`.
- "no step labels remain" — với mọi trạng thái, `label`, `title` và `menu[].label` không khớp `/[Bb]ước/`.

`apps/web/src/features/chapter/status.test.ts`
- "running translate shows pages done and batch" — `run:{total:33,remaining:29,batch:2,batches:9}` → `"Đang dịch · 4/33 trang · lô 2/9"`; `batches:1` → không có " · lô".

`apps/web/src/features/chapter/page-status.test.ts`
- "queued page waits for its batch" — `translate_queued:true`, job null, `run_batch:3` → `thumbMark` `{tone:"busy",label:"Chờ lượt · lô 3",progress:null}`.
- "typesetting stage reads Đang đặt chữ" — job `chapter.translate` running stage `typeset` → label bắt đầu `"Đang đặt chữ"`.

`apps/web/src/features/chapter/page-selection.test.ts` (**tiêu chí 6**)
- "ctrl-click toggles single pages" — 3 lần toggle p2, p5, p7 → `selectionIds` = `[p2,p5,p7]`; toggle p5 lần nữa → `[p2,p7]`.
- "shift-click selects the range from the anchor" — anchor p2, shift p5 → `[p2,p3,p4,p5]`.
- "busy, hidden and not-yet-prepared pages are never selected" — dải chứa trang `translating`, `skipped`, `pending` → bị lọc.

`apps/web/src/features/chapter/next-action.test.ts` — cập nhật assert nhãn "Dịch chương".

Lệnh hẹp: `pnpm --filter @mtl/web exec vitest run src/features/chapter/primary-action.test.ts src/features/chapter/status.test.ts src/features/chapter/page-status.test.ts src/features/chapter/page-selection.test.ts src/features/chapter/next-action.test.ts`

## Implementation Steps

1. Viết/cập nhật 5 file test → đỏ.
2. `api.ts` kiểu `ChapterRun`, field page mới, `commitChapter(ch, target)`.
3. `primary-action.ts`, `status.ts`, `next-action.ts`, `page-status.ts`, `page-selection.ts` → test xanh.
4. `chapter-workspace.tsx`: action `commit` gửi `translated`, thêm `prepare_only`, `translate-pages` (dùng selection),
   state selection + Esc; truyền `selection`/`onSelect` vào `PageRail`; toast xuất xong khi `drawer !== "export"`
   (theo dõi id lượt `succeeded` mới nhất bằng ref, bỏ qua lượt đã có lúc mount).
5. `page-rail.tsx`: click có `shiftKey`/`ctrlKey|metaKey` → `onSelect`, click thường → `onPick` + bỏ chọn; `aria-selected`;
   thanh "Dịch N trang · Bỏ chọn" ở đầu rail. `chapter-workspace.css` style.
6. `select-panel.tsx`: "Dịch trang này" cho trang `prepared` (dùng lại handler `retranslate-page`).
7. `export-panel.tsx` ExportRow + `activity-drawer.tsx` JOB_LABEL.
8. e2e: đổi nhãn nút; `full-flow`/`upload-chapter` bấm "Dịch chương" rồi chờ "Xong" (fake worker chạy hết chuỗi);
   thêm 1 bước menu ⋯ "Chỉ xoá chữ + OCR" ở `upload-chapter.spec.ts` (dừng ở "Chờ dịch" rồi "Dịch chương").
9. `pnpm --filter @mtl/web test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @mtl/web exec playwright test`.

## Success Criteria

- [x] Test unit xanh; e2e xanh; `grep -n "Bước 1\|Bước 2"` trên các file P5 sở hữu (bảng trên) rỗng — gồm cả comment; file ngoài bảng (VD `source-rail-model.ts`) chỉ còn comment, không chuỗi hiển thị.
      — Unit toàn repo xanh; e2e 36/36 (2 lần liền). Chuỗi hiển thị cuối ở `source-viewer.tsx`, `source-rail.tsx` đã đổi
      ("bỏ qua ảnh này khi cắt trang"). e2e từng chập chờn do rate limit better-auth `/get-session` (đo trace: HEAD và bản
      mới cùng 124 lần gọi, từng test giống hệt; bộ đếm 100 chỉ reset sau ≥ 10s lặng) → `apps/api/src/auth.ts` bỏ giới hạn
      `/get-session` (test `signup.test.ts` "never rate limits session reads").
- [x] Kiểm tay: chương mới bấm "Dịch chương" 1 lần → tự chạy tới "Chờ duyệt"; thumbnail "Chờ lượt · lô 3" → "Đang dịch"
      → yên; chip "Đang dịch · x/y trang · lô k/n".
      — e2e `full-flow` (1 click → 3 trang Xong, Chờ duyệt); nhãn thumbnail/chip phủ bằng unit `page-status.test.ts`, `status.test.ts`. Chưa kiểm tay trên trình duyệt với chương 33 trang.
- [x] Menu ⋯ "Chỉ xoá chữ + OCR" dừng ở "Chờ dịch"; chọn 3 trang → "Dịch 3 trang" → chỉ 3 trang đổi trạng thái.
      — e2e `upload-chapter` (Ctrl-click + Shift-click → 3 trang Xong, 6 trang vẫn Chờ dịch).
- [x] Đóng drawer Xuất khi đang xuất → xong có toast "Tải xuống".
      — e2e `full-flow` (lượt xuất chờ trong hàng, Esc đóng drawer, worker xuất → thông báo "Đã xuất xong" + nút "Tải xuống").

## Risk + rollback

| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| Đảo quyết định 22/10 (2 bước) gây bất ngờ | L×M | User chủ động đổi 29/10; menu ⋯ giữ đường soát trước |
| Shift/Ctrl-click xung đột chọn văn bản/kéo | M×L | `preventDefault` khi có modifier; chỉ trên thumbnail |
| e2e phụ thuộc thời gian chuỗi | M×M | Chờ theo nhãn trạng thái (`toHaveText` timeout 30s) như spec hiện có |
| Toast xuất lặp lại sau reload | L×L | Ref bỏ qua lượt đã `succeeded` lúc mount |

Rollback: revert phase (chỉ web). API P3 vẫn tương thích web cũ (commit không body → mặc định theo `ingest_mode`).

## Docs (controller làm cuối)

`docs/editor.md`: mở đầu (luồng "Dịch chương" thay 2 bước), mục "Ảnh gốc trước Bước 1…" đổi tên bước, mục "Drawer Xuất /
Hoạt động" (toast tải, nhãn bước), thêm đoạn chọn trang (Shift/Ctrl-click, "Dịch N trang", "Dịch trang này").
`docs/job-queue-worker.md` câu "Bước 1/Bước 2" trong sơ đồ → nhãn mới.
