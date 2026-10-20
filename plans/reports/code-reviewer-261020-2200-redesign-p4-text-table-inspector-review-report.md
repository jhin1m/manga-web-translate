# Code Review: Redesign P4 — text table + inspector + sync

Scope: uncommitted working tree on `feat/redesign-p4-text-table-inspector` (web only, ~870+/264-, plus new `text-table/`, `bottom-panel.tsx`, `inspector.tsx`). API unchanged (verified: no `apps/api` diff). Static review; did not re-run the suites (implementer reports typecheck/lint/test/e2e green).

Score: **7.5 / 10**. The structure is solid and follows existing patterns: it reuses `ChapterSession`, `TextField`, `useBatchFlow`, the session lock, and the `restoreOther`-style PUT/409 loop. One High bug breaks the main editing flow when a filter is on. There are a few Medium correctness/perf issues.

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| rows.test: active page from doc, others from cache, box-only row, flags, order | Met | `rows.test.ts:25-69` |
| measure.test: exact fit vs 1px under | Met | `measure.test.ts:75-84` |
| E2E row click on page 2 → rail + inspector "Trang 2" | Met | `editor.spec.ts` new test |
| E2E edit → "Đã lưu" ≤10s → GET has new text | Met | same |
| E2E Enter at last row p1 → p2 focused, saves to p2, no PUT on p1 | Met | same (`puts` watcher) |
| E2E overflow flag + "Cần xem" filter | Met | overflow test |
| chapter-tools via tabs, no dialog, table updates without reload, no 423 | Met | `chapter-tools.spec.ts` (`watchLocked`, `dialog` count 0) |
| `rg RegionTable|FindReplaceDialog|ApplyGlossaryDialog apps/web/src` = 0 | Met | grep empty |
| "Không chọn gì → thông tin trang" | Partial | see M2 (deselect on canvas leaves stale block) |

## Critical
None.

## High

### H1. With the "Chỉ khối cần xem" filter on, the row you are typing in disappears (textarea unmounts, focus and keystrokes are lost)
- `text-table.tsx:53-56` (`filterRows`), `chapter-workspace.tsx:128`, `rows.ts:65-67`
- Scenario: turn on "Chỉ khối cần xem", focus a row flagged only `Trống` (empty translation), type 1 character. `setRegionTranslation` rebuilds `doc`, and `pageRows` drops `empty`. `needsAttention` turns false, so the row leaves `rows`, and `rangeExtractor` cannot keep it because `indexOf` no longer has the key. The textarea unmounts mid-word, and the rest of the typing goes to `<body>`. There, the global keydown handler treats letters as tool shortcuts (`t`, `b`, `e`, `o`, `v`) and Backspace as **delete selected box** (`chapter-workspace.tsx:186`). Shortening an overflowing translation until it fits does the same thing. The "fix what needs review" workflow is exactly what this filter is for, so users will hit this.
- Fix: keep the focused or current row in the filtered list until blur or until a different row is picked. For example, pass `keep: string | null` into `filterRows` and use `rows.filter(r => r.key === keep || match(r))`. Lift `focusedKey` up, or use `current`. Add an e2e test: filter on, type into the `Trống` row, assert it stays focused.

## Medium

### M1. Every keystroke now re-renders the whole workspace (canvas Stage, rail, topbar, both tool panels)
- `chapter-workspace.tsx:125` (`useChapterRows` subscribes to `editorStore.doc` at the workspace root), `:160-164` (new `Set` every render → `PageRail` re-renders all thumbnails), `ChapterCanvas` is not memoised (`ChapterCanvas.tsx:51`).
- Before P4 the root did not subscribe to `doc`. Now each keystroke reconciles the Konva tree plus N rail items, and does O(rows) work three or more times (`allRows.find`, `overflowPages`, `activeOverflow`, `filterRows`). The row memo works, but the gain is lost one level up. With 1000+ rows and a long chapter this costs per-keystroke latency, which the plan explicitly lists as a risk.
- Fix: move `useChapterRows`, filtering and `TextTable` into a child (for example `TranslationTab`) that owns the `doc` subscription. Derive `overflowPages` in a separate memo keyed on `(cache, active doc)` that returns the **same Set instance** when membership is unchanged. Wrap `PageRail` and `ChapterCanvas` in `memo` (or check they read from stores themselves).

### M2. Inspector keeps showing the old block after you deselect on the canvas
- `chapter-workspace.tsx:146-153`. The subscriber returns early when `!s.selection`, so `current` is never cleared. Esc or a click on empty canvas leaves the inspector on "Khối n" with its Bản dịch field, and "Áp kiểu…" still acts on `row.boxId` even though nothing is selected. `Properties` meanwhile renders for `selection = null`. This contradicts the criterion "Không chọn gì → thông tin trang".
- Fix: when `prev.selection && !s.selection`, call `setCurrent(null)`. Leave `pick` alone: it calls `select(null)` for regions without a box, and `prev.selection` is usually also null there. Otherwise track the source of the change.

### M3. Safari: Enter that commits IME text jumps to the next row
- `text-table.tsx:142`. Only `nativeEvent.isComposing` is checked. In WebKit the composition-ending Enter can arrive with `isComposing === false` and `keyCode === 229`. That includes the macOS Vietnamese Telex input with marked text. The user presses Enter to commit a word and lands on the next row (often another page, which triggers activate).
- Fix: `if (e.nativeEvent.isComposing || e.keyCode === 229) return;`. Alternatively track a composing ref, as `TextField` already does, and expose it.

### M4. A cell focused while read-only keeps its stale draft after the page activates with a newer version (risk of silent overwrite)
- `TextField.tsx:16-18` combined with focus-before-activate in `text-table.tsx:200-203`. `onFocus` sets `focused = true`, so `value` → `draft` sync stops. Then `doActivate` may load a newer version (`latest.version > loaded.version`), or `refreshAi` may `s.load(d)` a newer server state (`use-chapter-session.ts:120-140`). The textarea still shows the old cache text, and the first keystroke sends `old + char` through `setRegionTranslation`. That overwrites the newer AI or find/replace text on that region.
- Fix: in `TextField`, keep resyncing while the field is not dirty, e.g. track `lastPushed` and resync when `draft === lastPushed`. Or reset the draft when `readOnly` flips true→false (key the field by `readOnly`, or use an effect on `readOnly`).

### M5. "Áp kiểu cho khối cùng loại": chapter-wide write with no undo, no confirmation, and fragile behaviour on partial failure
- `chapter-workspace.tsx:245-280`, `use-chapter-session.ts:212-229`.
  - There is no confirm before writing every page, and there is no undo outside the active page. One misclick can restyle hundreds of boxes across the chapter with no way back. Add a confirm that shows the count (boxes/pages) first, or record pre-images so the action can be reverted.
  - Partial failure: a 423 (lock lost), a network error, or a second 409 on page k aborts the loop. `onError` shows only the raw error, so the user cannot tell that pages 1..k-1 were already changed. Catch per page, collect `{ok, failed}`, and report both.
  - Race: if the user activates a page the loop has not reached yet, `updateOther` throws the developer string `"page đang sửa — dùng editor.apply"` and aborts the rest. Skip the page that is currently active, using `editorStore.getState().pageId`, not the `s` captured at the start. Better still, disable page activation while `applyKind.isPending`.
  - The race in the other direction (PUT lands after activation) is handled correctly: `doActivate` picks the newer cache version, and otherwise `syncActive` reloads or the Saver rebases. No change needed.

## Low

- **L1** `rows.ts:66`: the server flag `empty` is copied unchanged. Once the user fills in a translation, the row still shows "Trống" and stays in "Cần xem". Drop `empty` when `translation.trim()` is non-empty, or compute it only on the client.
- **L2** `rows.ts:75`, `inspector.tsx:49`: a region with several linked boxes maps to `linked[0]`. If you select the second box on the canvas, the inspector's overflow warning and "Áp kiểu" source use the first box, while `Properties` edits the selected one. Use the selected box when it belongs to the row.
- **L3** `text-table.tsx:21,182`, `chapter-workspace.css:412`: rows are fixed at 40px and textareas at 30px. Multi-line translations (Alt+Enter) are clipped to one visible line. Add a measured row height or expand the cell on focus.
- **L4** `text-table.tsx:119-123`: the effect depends on `indexOf`, which changes on every keystroke. While typing in the **inspector** field, the table snaps back to `current` on each key if the user had scrolled it away. Only scroll when `current` changes, e.g. with a `lastScrolled` ref.
- **L5** `inspector.tsx:108,112`: `busy.ocr` is the global `ocr.pending.length`, so any pending OCR-select box shows "Đang OCR…" on every block. "OCR lại" replaces a manual translation without asking. It is undoable, but a confirm is cheap.
- **L6** `bottom-panel.tsx:64`: while the panel is collapsed, `scrollToIndex` from a canvas pick does nothing, and reopening does not scroll to `current`.
- **L7** `actions.ts:13-18`: the "Áp kiểu" style object omits `letter_spacing`, which `BoxStyle` does not expose either. Document the gap or add the field.
- **L8** `chapter-workspace.tsx:222-223`: `ord` is computed before the `!id` guard. Harmless.

## Deviations (verdict)
- "Dịch lại khối" → "Dịch lại trang này" + "OCR lại": **acceptable**. The API's `retranslate` only takes page ids, and the plan text itself specifies "Dịch lại trang này". "OCR lại" reuses the existing ocr-region job and is one undo step. See L5.
- "Áp kiểu…" via `updateOther`: **acceptable mechanism**, because it mirrors `restoreOther` and the 409 retry is tested. The UX safety is not acceptable as-is; see M5.
- Non-active rows read-only until activation: matches the plan's risk table ("ô đích disabled tới khi active xong"). Keystrokes typed during activation are dropped silently; acceptable. See M4 for the correctness edge.
- Properties lost its "Chữ" field: acceptable, since the inspector "Bản dịch" covers it and canvas inline editing (Enter) remains. The one capability lost is editing the 2nd+ linked box's text independently of the region (L2).
- Ingest-failed → "Chạy lại cắt trang" = commit: correct. The API comment at `chapters.ts:188` allows re-commit for an ingest-failed chapter with no pages, and the 0-source-file fallback to "Tải ảnh" is sensible. Minor: the success notice reads "Bắt đầu dịch N ảnh" rather than mentioning re-cut.

## Regression checks (b)
- Autosave/undo/lock/409/423/IDB recovery: `ChapterSession` core paths are unchanged. Only `updateOther` and `withFlush` were added. Tool panels use the session lock, not their own `useChapterLock` (P3 risk respected). `beforeWrite` flushes before preview, apply and undo.
- Activation: `pick` goes through `session.activate` (serialized, last-wins, errors routed to `onError`). There is a stale guard after the await (`s.pageId !== row.pageId`). OK.
- Global keydown still ignores textarea, input and select. Esc in a cell only blurs and keeps the selection. The interaction with H1 (focus lost → letters become tool shortcuts, Backspace deletes the box) is the real hazard.
- Hook deps: `pick`, `flush`, the subscribe effect and the virtualizer options look correct. `Inspector` calls its hooks before the early return.

## Recommended actions (order)
1. H1: keep the focused row in the filtered list.
2. M2: clear `current` on deselect.
3. M3: add the `keyCode 229` guard.
4. M5: confirm before the chapter-wide write, report per page, re-check the live active page.
5. M1: move the `doc` subscription out of the workspace root and memo the rail/canvas.
6. M4: resync `TextField` when not dirty.

## Unresolved questions
- Is "Áp kiểu…" meant to touch hidden boxes and auto-fit boxes? Right now it copies `font_size` even when the source box is `auto_fit`.
- Should the `empty` region flag from the server mean "no OCR text" (keep) or "no translation" (client-derived)? This determines L1.

Status: DONE_WITH_CONCERNS
Summary: Every listed P4 acceptance criterion has a test or e2e, except "no selection → page info": deselecting on the canvas leaves the old block in the inspector (M2). There are no API or contract breaks. One High bug: with the "Chỉ khối cần xem" filter on, the row being typed in disappears and focus falls to body, where Backspace deletes the box. There are also Medium issues with workspace re-renders per keystroke, the Safari IME Enter, a stale draft after activation, and the un-undoable chapter-wide "Áp kiểu".
