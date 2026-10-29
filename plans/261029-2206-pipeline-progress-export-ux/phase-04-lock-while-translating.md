---
title: "Phase 4: Giữ khoá + AI ghi khi chương đang dịch"
status: todo
effort: 6h
---

# Phase 4: Giữ khoá + AI ghi khi chương đang dịch (rủi ro cao nhất)

## Overview

Editor giữ khoá cả khi chương `processing`; trang đang trong lượt dịch / Bước 1 chỉ xem, trang xong sửa bình thường.
AI ghi `state` khi `state_origin='ai'` **kể cả lúc chương bị khoá**; trang đã sửa tay vẫn `ai_update_available`.
`runAi` thôi nhả khoá. Server chặn ghi vào trang bận (409 `page_busy`) và thao tác hàng loạt khi chương đang chạy
(409 `chapter_busy`). Phụ thuộc P3 (`pages.translate_queued`).

## Context

- `apps/api/src/jobs/page-state-writer.ts:17-48` — `apply = stateOrigin==='ai' && !chapterLocked` (`:35`).
- `apps/api/src/jobs/queue.ts:333-342` — `isChapterLocked(ch)` truyền vào `writeAiState`.
- `apps/api/src/lib/chapter-lock.ts:1-7` (comment luật cũ), `:56-59` `assertChapterLock`.
- `apps/api/src/routes/page-state.ts:146-180` PUT state (`If-Match`, version trong WHERE → 409 `version_conflict`),
  `:204-216` reinpaint.
- `apps/api/src/routes/find-replace.ts:164-171` find-replace apply, `:174-183` undo, `:193-200` glossary apply.
- `apps/api/src/routes/pages.ts:92-97` đã 409 `chapter_busy` khi ẩn trang lúc chương chạy.
- Web: `apps/web/src/features/editor/use-chapter-session.ts:167-177` `runAi` (flush → pause → unlock → gọi API),
  `:382-414` `lockEnabled = settled && pageIds.length>0 && !paused` + đồng bộ `readOnly`, `:463-484` logic `paused`;
  `apps/web/src/features/editor/store.ts:21` `ReadOnlyReason`; `apps/web/src/features/chapter/chapter-topbar.tsx:177-190`
  nhãn "Chỉ xem"; `apps/web/src/features/chapter/chapter-workspace.tsx:132-138` gọi `useChapterSession`, `:578`
  `pagesEditable`.
- Test hiện có: `apps/api/test/ai-write-rules.test.ts:72` "does not apply while the chapter is locked by an editor"
  (sẽ đảo); `apps/web/src/features/editor/__tests__/chapter-session.test.ts:117` "runAi … unlocks" (sẽ đổi).

## Requirements

- AI ghi: `state_origin='ai'` → ghi `state` (bất kể khoá); `user` → `ai_update_available=true` như cũ. Bỏ tham số
  `chapterLocked`.
- Trang **bận** = `status ∈ {pending, preparing, translating}` HOẶC `translate_queued`. PUT state / reinpaint trang bận
  → 409 `{error:"page_busy"}` (sau `assertChapterLock`).
- Find-replace apply/undo, glossary apply khi chương `ingesting|processing` → 409 `chapter_busy` (trước đây bị chặn
  gián tiếp vì web không giữ được khoá lúc chạy).
- Web giữ khoá khi chương có trang và không ở `draft|ingesting` (`lockable`); bỏ cơ chế `paused` (YAGNI vì `runAi`
  không nhả khoá nữa). `runAi` = flush → gọi API.
- Trang active bận → `readOnly = "page_busy"`; hết bận → mở lại (và `syncActive` nạp bản AI nếu chưa sửa). Topbar:
  "Chỉ xem" · "Trang này đang dịch — sửa được khi xong".
- Ẩn/khôi phục trang chỉ khi chương ổn định (`pagesEditable = settled && lockHeld`) khớp 409 server.
- Rail công cụ / Tìm-Thay vẫn chỉ mở khi chương ổn định (`canTools` giữ nguyên).

## Architecture

```
Tab editor ─POST /lock (mỗi 60s)─▶ chapters.locked_by    (cả lúc processing)
User sửa trang p (đã ready, không cờ) ─PUT /pages/p/state If-Match v─▶ assertChapterLock ▶ assertPageNotBusy ▶ UPDATE … WHERE version=v
AI lô k complete ─▶ writeAiState(p'∈ lô k): origin 'ai' → state=ai_state, version+1 ; origin 'user' → ai_update_available
Va chạm: user PUT trên trang AI vừa ghi → version lệch → 409 version_conflict → Saver rebase (rebase.ts) như hiện tại
Web: progress poll → busyPageIds = pages bận → session: active ∈ busy ? readOnly "page_busy" : null
```

```ts
// apps/api/src/jobs/page-state-writer.ts
export async function writeAiState(tx: DbLike, opts: { userId: string; pageId: string; aiState: PageState; actor: string }): Promise<AiWriteOutcome>;
// apps/api/src/lib/chapter-lock.ts
export const PAGE_BUSY_STATUSES: readonly PageStatus[] = ["pending", "preparing", "translating"];
export const isPageBusy = (p: { status: string; translateQueued: boolean }) => boolean;
export const pageBusyError = () => HTTPException(409, {error:"page_busy"});
export function assertChapterIdle(ch: { status: string }): void;   // 409 chapter_busy khi ingesting|processing
// apps/web/src/features/editor/use-chapter-session.ts
useChapterSession(opts: { chapterId: string; lockable: boolean; settled: boolean; pageIds: string[];
  busyPageIds: ReadonlySet<string>; refetchProgress(): Promise<boolean | undefined> });
// apps/web/src/features/editor/store.ts
type ReadOnlyReason = "lock_denied" | "lock_lost" | "loading" | "recovery" | "processing" | "page_busy" | null;
```

## File sở hữu

| Thao tác | Đường dẫn |
|---|---|
| Sửa | `apps/api/src/jobs/page-state-writer.ts` |
| Sửa (chỉ nhánh `chapter.translate` của `applyResult`, bỏ `isChapterLocked`) | `apps/api/src/jobs/queue.ts` |
| Sửa | `apps/api/src/lib/chapter-lock.ts` |
| Sửa | `apps/api/src/routes/page-state.ts` (PUT state, reinpaint) |
| Sửa | `apps/api/src/routes/find-replace.ts` (3 route ghi) |
| Sửa | `apps/api/test/ai-write-rules.test.ts` |
| Sửa (chỉ ca liên quan khoá/AI nếu vỡ) | `apps/api/test/page-state.test.ts`, `apps/api/test/find-replace.test.ts` |
| Sửa | `apps/web/src/features/editor/use-chapter-session.ts` |
| Sửa | `apps/web/src/features/editor/store.ts` (`ReadOnlyReason`) |
| Sửa | `apps/web/src/features/editor/__tests__/chapter-session.test.ts` |
| Sửa | `apps/web/src/features/chapter/chapter-topbar.tsx` (nhãn `page_busy`, bỏ nhánh "Đang dịch — sửa được khi xong" theo `lockEnabled`) |
| Sửa (chỉ chỗ gọi `useChapterSession` ~132-138 và `pagesEditable` ~578) | `apps/web/src/features/chapter/chapter-workspace.tsx` |

## Không được đụng

`translate-chain.ts`, `enqueue.ts`, `progress.ts`, `routes/chapters.ts` (P3 xong), `lib/batch-edit.ts` (áp theo series
tự lấy khoá từng chương — tab giữ khoá lúc chạy làm chương đó 423 như hành vi hiện có khi có tab mở), mọi file P1/P2 ngoài
danh sách, `primary-action.ts`, `page-rail.tsx`, `select-panel.tsx`, `page-status.ts` (P5), `worker/**`, `packages/**`.

## Test viết trước (đỏ trước khi code)

`apps/api/test/ai-write-rules.test.ts`
- Đảo ca `:72` thành "applies AI state on an untouched page even while an editor holds the chapter lock" — khoá chương
  rồi `writeAiState` → `state` = bản AI, `ai_update_available=false`, version +1.
- "still never overwrites a hand-edited page while locked" — origin `user` + khoá → `ai_update_available=true`, `state` giữ.
- "PUT on a page waiting in the translate run returns 409 page_busy" — đặt `translate_queued=true` → PUT (đang giữ khoá) → 409 `page_busy`; reinpaint cùng trang → 409 `page_busy`.
- "PUT on a finished page succeeds while the next batch is still queued" — chuỗi: lô 1 complete, lô 2 `queued`; tab giữ
  khoá; PUT trang lô 1 với `If-Match` = version sau AI → 200 (**tiêu chí 2**).
- "a stale If-Match after the AI wrote the page gets 409 version_conflict" — đọc version v, AI ghi (v+1), PUT If-Match v → 409 `version_conflict` kèm `version: v+1`.
- "batch edits are refused while the chapter is processing" — chương `processing`, giữ khoá → find-replace apply 409 `chapter_busy`; glossary apply 409; undo 409.

`apps/web/src/features/editor/__tests__/chapter-session.test.ts`
- Đổi ca `:117` thành "runAi flushes then calls the API and keeps the lock" — thứ tự `["flush","api"]`, không có `unlock`/`pause`.
- "the active page becomes read-only while busy and editable again when done" — `busyPageIds` chứa page active → `readOnly==="page_busy"`; bỏ ra → `readOnly===null`.

Lệnh hẹp: `pnpm --filter @mtl/api test -- ai-write-rules` ·
`pnpm --filter @mtl/web exec vitest run src/features/editor/__tests__/chapter-session.test.ts`

## Implementation Steps

1. Viết/đảo test API + web → đỏ.
2. `page-state-writer.ts`: bỏ `chapterLocked`, cập nhật comment đầu file (luật mới). `queue.ts`: bỏ `isChapterLocked`
   và đọc `ch` nếu không còn dùng. `chapter-lock.ts`: comment + `isPageBusy`, `pageBusyError`, `assertChapterIdle`.
3. `page-state.ts`: sau `assertChapterLock` đọc lại page (`status`, `translateQueued`) → `pageBusyError`.
   `find-replace.ts`: `assertChapterIdle(ch)` ở 3 route ghi. Test API xanh.
4. Web: `store.ts` thêm `page_busy`; `use-chapter-session.ts` nhận `lockable`, `busyPageIds`; `lockEnabled = lockable &&
   pageIds.length>0`; xoá `paused`/`left`/`onPause`; `runAi` = `await saver.flush(); return fn()`; effect `page_busy`
   theo page active (không đè `lock_denied|lock_lost|recovery|loading`).
5. `chapter-workspace.tsx`: `lockable = !!status && !["draft","ingesting"].includes(status)`; `busyPageIds` từ
   `pages` (`pageLevelOf(p)==="busy"` hoặc `p.translate_queued`); `pagesEditable = settled && …`.
   `chapter-topbar.tsx`: nhãn `page_busy`.
6. `pnpm test`, `pnpm typecheck`, `pnpm lint`; e2e editor (`pnpm --filter @mtl/web exec playwright test e2e/editor.spec.ts`) nếu môi trường có.

## Success Criteria

- [ ] Test API + web mới/đảo xanh; toàn bộ `pnpm test` xanh.
- [ ] `grep -rn "chapterLocked" apps/api/src` rỗng.
- [ ] Kiểm tay: chương 9+ trang đang chạy chuỗi — sửa chữ trang 1 (đã xong) lưu được ("Đã lưu"), trang đang chờ lượt
      hiện "Chỉ xem · Trang này đang dịch"; khi lô của nó xong, trang tự hiện bản AI (nếu chưa sửa) và sửa được.
- [ ] Sửa tay trang X rồi "Dịch lại trang X" → bản AI vào "AI có bản mới", không đè bản tay.

## Risk + rollback

| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| AI ghi đè sửa tay | L×H | Chỉ ghi khi origin `ai`; PUT đầu tiên đổi origin `user` trong cùng UPDATE có điều kiện version; trang bận 409 |
| PUT đua với AI complete | M×M | Version trong WHERE + `FOR UPDATE` ở `writeAiState` → đúng 1 bên thắng, bên kia 409 → rebase |
| Sửa trang ngay trước khi nó vào lượt ("Dịch N trang" kèm trang đang sửa) | M×M | Web `runAi` flush trước khi gọi API; sau đó trang có cờ → 409 cho PUT muộn; Saver giữ thay đổi trong IndexedDB + rebase |
| Find/replace chạy giữa chuỗi đổi origin nhiều trang | L×M | 409 `chapter_busy` khi chương `processing` |
| Tab giữ khoá lâu hơn → series ignore-apply gặp 423 nhiều hơn | L×L | Hành vi đã có khi tab mở; ghi docs |
| Bỏ `paused` làm hỏng luồng "Dịch lại" cũ | M×M | Test session + e2e editor; `runAi` vẫn flush trước |

Rollback: revert phase (api + web cùng lúc). Không có migration. Dữ liệu không đổi dạng.

## Docs (controller làm cuối)

`docs/editor.md` mục "Khoá chương theo trạng thái": khoá giữ khi chương có trang (trừ đang cắt), trang bận chỉ xem,
`runAi` không nhả khoá, 409 `page_busy`. `docs/job-queue-worker.md` + comment `page-state-writer.ts`: luật AI ghi mới.
`docs/export-and-batch-edit.md` mục Find/replace: 409 `chapter_busy` khi chương đang chạy.
