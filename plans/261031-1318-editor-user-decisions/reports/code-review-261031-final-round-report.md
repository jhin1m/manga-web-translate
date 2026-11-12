# Code review: final round (983d71c, c8f0791, 6ca2388)

## Scope
- Commits: `983d71c` (bulk undo follow-ups), `c8f0791` (parity coverage, no-op relayout, overlay font, rollback SQL), `6ca2388` (wheel flip busy/reverse/cap, e2e).
- Also skimmed: `git diff fix/editor-bug-hunt..HEAD --stat` (55 files) for cross-feature interactions and for debug or test-only code left in production.
- Read-only. No tests were run because a tester is running the suites at the same time. Konva 10.9 `Global.js` (`isDragging`/`isTransforming`), react-konva's entry (`import 'konva'`), the DB index `page_state_history_page_idx (page_id, version)` and `claim-inputs.ts` (export inputs are built when a worker claims the job) were checked against the source.

## Status of earlier findings
| Earlier finding | Status |
|---|---|
| bulk-undo R1 (undo reads the whole history) | Partly fixed. See L2: the filter is a cross product, not exact pairs |
| bulk-undo R2 (`restored > 0` gate) | Fixed (`skipped.length === 1`), and the unit test now covers the single-page batch |
| bulk-undo R3 (toast Hoàn tác lost on server errors) | Fixed (button comes back on every error except 404) |
| bulk-undo R4 (panel button gives no feedback while busy) | Fixed (`hooks.busy` is ORed into `busy`, so the buttons are disabled) |
| bulk-undo R5 (test depends on order) | Fixed (the test uses its own chapter and lock, and the variable is renamed) |
| vertical-center Low A (font coverage) | Fixed (wrapBox keeps the font of index i, round 0 is always middle, the spec checks the manifest against `excluded_fonts`) |
| vertical-center Low B (rollback SQL) | Fixed (steps in order, `WITH ORDINALITY` + `ORDER BY`, `@?` WHERE, 3 full statements, labeled untested) |
| vertical-center Low C ("đã cùng kiểu" unreachable) | Fixed (relayout only assigns when the value differs; store.apply with 0 patches returns early; editMany null leads to the message) |
| vertical-center Low D (overlay font for auto_fit) | Fixed (a single `drawnBox` drives font, line height and dy) |
| wheel R1 (`held` ref gets stuck) | Fixed (the ref is gone; busy = `buttons` / `Konva.isDragging()` / `Konva.isTransforming()`; the value import does not grow the bundle because react-konva already imports full `konva`) |
| wheel R2 (lock unbounded, reverse scroll swallowed) | Fixed as suggested. See L1 for a side effect of the cap |
| wheel R3 (e2e depends on API timing) | Fixed (inertia wheels are sent before awaiting the pager; the lock is set synchronously on the flip event) |

## Findings (ranked)

### L1. Low: the 1.5s lock cap lets a long trackpad fling flip a second page on pages that fit the frame, and the docs still promise "locked until inertia stops"
- `apps/web/src/features/editor/wheel-page-flip.ts:75` (cap) and `:84` (accumulator).
- Once `lockCap` passes, the next momentum event goes to the accumulator: `idle` is false and `sign(acc)=0 !== dir`, so `acc = dy`, and it then keeps summing. The page fits the frame (`fits`), so `atTop` and `atBottom` are always true.
- Scenario: a hard macOS fling (momentum often runs 2-3s) on a page that fits the frame. Page 2 opens and 1.5s later the momentum tail adds up to 160px or more, so page 3 opens with no new user gesture. That is the double flip the lock was meant to stop. On a tall page the tail scrolls the new page away from its top, which is expected once the cap ends.
- Doc drift: the `wheel-page-flip.ts:1-8` header ("bỏ qua sự kiện cho tới khi hết COOLDOWN VÀ quán tính đã dứt… không lật liền nhiều trang") and `docs/editor.md:265-266` ("khoá … tới khi quán tính dứt … wheel bị nuốt … trang mới luôn vào đúng đầu/cuối") do not mention the reverse-scroll exception or the cap.
- Fix (keeps the cap's purpose, so continuous mouse scrolling is no longer frozen): after the cap, stop swallowing events but do not arm a flip until there is a pause. For example, while `i.t >= s.lockUntil && s.lockDir !== 0 && !idle`, return `{ state: { ...s, acc: 0, last: i.t }, flip: 0, locked: false }`. Clear `lockDir` once `idle`. Add a unit case: flip, continuous events past the cap at a fit-page edge, then expect no flip until a 300ms gap. Update both docs.
- I suggested the cap in the earlier review without this guard, so this is a follow-up to my own suggestion, not a regression found in the author's design.

### L2. Low (perf, inaccurate comment): the narrower history query is a cross product, not exact (page, version) pairs
- `apps/api/src/lib/batch-edit.ts:152-168`: `inArray(pageId, ids) AND inArray(version, versions)` returns every row of any moved page whose version is in the union of the needed versions.
- Scenario: a 200-page chapter where page versions differ (pages edited different amounts, e.g. versions spread over 3..40). Each page's ≤50-row window overlaps many of the needed versions, so the query can still load about 20-40 full JSONB states per page instead of 1. In the worst case this is close to the old full read. The results are correct, because the Map is keyed `page:version`. The comment "Chỉ lấy đúng các bản ghi (page, version h.version+1)" overstates what the query does.
- Fix: use a row-value IN on the existing `(page_id, version)` index: ``sql`(${pageStateHistory.pageId}, ${pageStateHistory.version}) in (${sql.join(moved.map((h) => sql`(${h.pageId}::uuid, ${h.version + 1}::bigint)`), sql`, `)})` ``. If the cross product is kept, change the comment instead.

### Info (no action needed)
- `use-chapter-session.ts:412` `skipped.length === 1`: a single-page batch that another tab already undid is also restored in place in a stale tab. This is harmless. The target is the `before` state, which the server already holds, and the save takes 409 → rebase → no-op (or a normal conflict if the other tab edited further). The multi-page "already undone" case is still left untouched.
- The `docs/deployment-guide.md` rollback SQL is correlated on the target row's `state`/`ai_state`. NULL `ai_state`/history `state` rows are excluded by `@?`, which returns NULL for them. The order of steps is safe because the old API's `z.object` strips unknown `valign` from writes. The text labels the SQL as untested; run it in a scratch DB before relying on it.
- Debug or test-only code in production: none found. The diff adds no `console.*`, `window.__*` hooks or `import.meta.env` branches under `apps/web/src` or `apps/api/src`. The e2e reads `editorStore` through a dev-server module import (`/src/features/editor/store.ts`), with no production export added for it. This only works with `vite` dev, which `playwright.config.ts` always uses (noted before).

## Cross-feature checks
- **No-op relayout × editMany / batch recording:** `editMany` pushes a page only when `next !== cur.state`. Re-applying the same style now skips the page, so no empty batch or mark is created, and the caller (`chapter-workspace.tsx:612`) shows "đã cùng kiểu". `store.apply` returns early on 0 patches, so no empty undo step is created. A real change of a layout field still relayouts and writes (unit test).
- **valign × bulk undo content comparison:** both sides compare stored JSON. The server uses `isDeepStrictEqual` on jsonb (no undefined keys). The client `same()` compares by key count, and `setStyle` with the valign a box already resolves to writes nothing, so a missing key and `"top"` are never mixed by a no-op. No false "đã sửa" was found.
- **Wheel flip × per-page undo history:** a flip goes through `session.activate`, which stashes the history. Batch marks in the stash are settled by `afterBatchUndo` (it loops over the stash). Drags and transforms are blocked by `busy`, so a flip cannot carry a drag of a same-id box onto another page. A reverse scroll during a pending flip only sets the old or new page's view, and `pageStartView` / the bottom-landing clamp then overwrite it.
- **Shared undo busy:** `acquireUndo`/`releaseUndo` set the ref (synchronous guard) and the state (UI) together. The panel undo releases through `undoM.onSettled → hooks.end`, and toast/Cmd+Z release through `undoKind.onSettled`. No path leaves `undoing` stuck.

## Verdict
No blocker and no Medium findings. L1 and L2 are optional follow-ups. L1 is the more user-visible one (rare double flip on fit pages, stale docs).

## Unresolved questions
- L1: should the post-cap tail be allowed to scroll a tall page (current behaviour) but never flip? The proposed guard does exactly that. Confirm this is wanted.
