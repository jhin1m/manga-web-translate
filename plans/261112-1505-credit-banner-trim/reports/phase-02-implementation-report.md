# Phase 2 report: web trim UI

Status: completed. Commits `dba228e` (src), `ed411fc` (e2e + fake worker); not pushed.

## Files (all under apps/web)
- New: `src/features/chapter/source-trim-overlay.tsx` (shade + 2 slider handles, pointer + keyboard), `e2e/trim-source.spec.ts`.
- Modified: `source-rail-model.ts` (+test: `SourceItem.trim`, `clampTrim`, `trimLabel`, tone `trim`), `api.ts` (`trim` on types, `setSourceTrim`), `use-source-images.ts` (`useSetSourceTrim`), `source-rail.tsx` (menu items, flag), `source-viewer.tsx` (trim mode, foot bar), `chapter-workspace.tsx|css`, `e2e/fake-worker.ts`.

## Decisions
- Trim mode only via thumbnail menu "Cắt mép ảnh n…" / "Bỏ cắt"; no new fixed buttons. Skipped images get no trim items.
- `clampTrim(top, bottom, h, edge)`: ints >= 0, kept part >= MIN_TRIM_KEEP_PX; overflow pulls back the dragged edge. Image shorter than the minimum => 0/0.
- Overlay positions are percentages of natural height inside a frame div that wraps only the `<img>` (captions outside), so no resize observer; pointer y converted via frame rect.
- Esc/Enter are a capture-phase window listener while trimming (works even if focus is on the body after clicking the image); Enter on the Huỷ/Xong buttons clicks them. Arrows stop propagation so global shortcuts (change image) don't fire.
- Stepping to another image or picking a thumbnail exits trim mode (draft discarded). Focus returns to the thumbnail on Xong/Huỷ.
- Unchanged draft on Xong => no PATCH. top+bottom == 0 => sends `trim: null`.
- Flag: glyph "✂", label "Đã cắt mép" (by user) or "Credit · tự cắt" (by credit); priority skip > upload > trim > credit hint. Accessible name follows the rail convention "Ảnh n · Đã cắt mép".
- `height` is sent when saving; for "Bỏ cắt" it is omitted (API stores null without it). Undo of a clear relies on the server-stored height.
- Errors: `trim_too_large` gets a Vietnamese message; others use `errorMessage` (same as skip, covers 409/423). Optimistic write rolls back to previous trim on error.
- fake worker: VERSION 0.10.0 -> 0.12.0 (API MIN is 0.12.0; every worker-driven e2e would 426 otherwise); page height = source height - trim only when a trim exists (untrimmed keeps fixed 1000, other specs unchanged).

## Tests
- web unit: 494 passed (new: clampTrim x6, trim labels x2). typecheck + lint clean. api 718 passed.
- e2e: `trim-source.spec.ts` passes (mouse drag + Esc, keyboard + clamp + Enter, reload, Bỏ cắt + Hoàn tác, Dịch chương => heights [1000, H-53]). Also green: upload-chapter, full-flow, chapter-tools. Full e2e suite: 112 passed, 1 failed: `block-panel.spec.ts:317` (double-click under collapsed panel) — fails the same way with my `src` changes stashed, so pre-existing/unrelated. `trim-source` deletes its series at the end (a leftover series breaks the single-series auto-pick in upload-chapter specs).

## Not verified
- Safari / real touch devices (pointer events + `touch-action: none` only exercised via Chromium mouse).
- 720x15000 webtoon manual check (scroll-to-bottom on entering trim for the last image is code-only; no e2e).
- `react-doctor`: not in repo/docs, not run.

## Notes for phase 3
- Undo toast: `trimSource` in `chapter-workspace.tsx` (notify key "trim", actions array with "Hoàn tác"); add the "Luôn cắt ở series này" action next to it, like `alwaysSkip(...)` for skip. Needs the trimmed strip's pixels, i.e. image + trim + height.
- Local upload Blob: `uploadManager.localFiles(chapterId)` (Map fileId -> Blob) is used in `useSourceImages`; `SourceItem.url` is a blob: URL when dropped in this tab, else a signed URL. Workspace has `sources` (SourceItem[]) but not natural height; the viewer measures it on load (`measured`). For hashing, load `it.url` into an Image/canvas in the click handler; signed URL needs CORS only for the hosted build.
