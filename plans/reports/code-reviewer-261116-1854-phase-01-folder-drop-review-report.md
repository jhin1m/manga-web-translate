# Code review: Phase 1, folder drop and chapter title

## Scope
- Files: api `routes/chapters.ts` (+test); web `upload/dropped-paths.ts` (new, +test), `upload/drop-zone.tsx`, `upload/parse-chapter-filename.ts` (+test), `home/drop-to-translate.ts` (+test), `home/new-chapter-confirm-row.tsx`, `chapter/chapter-meta-popover.tsx`, `chapter/api.ts`
- LOC: about +306/-72, plus 58 new in dropped-paths.ts
- Callers checked: series-page (page drop, DropZone, draft-row resume target), home-page, chapter-workspace (resume DropZone), chapter-topbar and chapter-upload-status (FilePickButton), resumeFromFiles / resumeChapter, startNewChapter, every e2e spec that uploads files
- Score: **7/10**. Critical: **1** (fixed during review).

## Gates
- `pnpm typecheck`: clean. `pnpm lint`: clean (also re-run after the e2e fix).
- `pnpm --filter @mtl/web test`: 60 files, 548 tests pass.
- e2e (not run by the implementer): before the fix, `upload-chapter.spec.ts` failed 5 of 5. After the fix, `upload-chapter`, `click-budget`, `full-flow`, `draft-wheel-flip`, `trim-auto-drop`, `trim-learn-band`, `trim-source` and `series-manage` all pass (24 tests). `series-manage` includes the synthetic-DataTransfer drop on a draft row, which goes through the `dt.files` fallback.
- API tests not re-run. The diff is small and covered by the added assertions, and the implementer reported 727 passing.

## Critical (fixed)
1. **The second file input inside DropZone broke every e2e upload.** Each spec calls `getByRole("region", …).locator('input[type="file"]').setInputFiles(...)`. With the new "chọn folder" input, that locator matches 2 elements, so Playwright fails with a strict-mode violation. That is 11 call sites in 7 specs, including full-flow and click-budget.
   Fix applied (test-only, mechanical): the locator is now `'input[type="file"]:not([webkitdirectory])'` in `apps/web/e2e/{upload-chapter,click-budget,full-flow,draft-wheel-flip,trim-auto-drop,trim-learn-band,trim-source}.spec.ts`. Re-ran and all pass.

## High
None.

## Medium
1. **Resuming from a folder that contains non-image files fails.** The approved rule skips non-images inside a folder silently, but only `readDropped` applies it. `resumeFromFiles` (draft row on the series page, and the workspace "Tải tiếp ảnh" zone/picker) runs `collectPages(files)` on the raw list. A folder with `readme.txt` gives N+1 pages, so resume throws "Chương nháp có N ảnh, bạn thả N+1 ảnh". This affects a chapter that was itself created from that same folder.
   Suggested fix: export the filter from `drop-to-translate.ts`/`dropped-paths.ts` (`!isJunkPath(relPath(f)) && (!dirOf(f) || isZip(f) || mimeOf(f.name))`) and apply it in `resumeFromFiles` before `collectPages`. Not applied, because it widens the resume contract.
2. **Read errors are swallowed and shown as "folder rỗng".** `readDrop = filesFromDataTransfer(dt).catch(() => [])`. If any one `readEntries` or `entry.file()` rejects (permission, broken symlink, file removed mid-drag), the whole drop becomes `[]`. On home/series the user then sees "Không có ảnh nào trong folder." for a folder that is not empty; on resume they see "bạn thả 0 ảnh".
   Suggested fix: skip only the failing entry inside `walk` (try/catch per child), or let the error reach the caller's error notice.
3. **`chapterTitleFrom` cuts words on false prefix matches.** It removes the *last* `PREFIXED` match, and the bare `c` prefix matches inside words: `"Chapter 3 - Arc 2"` becomes title `"Chapter 3 - Ar"`, and the number becomes 2. The wrong number was already there; the new title makes it visible in the header. Related: `stem()` still strips "extensions" from folder names, so `"Ch 3 - St.Louis"` becomes title `"St"`. Both can be edited in the popover. Suggested fix: require a word boundary before `c`/`ch`/`ep` in `PREFIXED` (`(?<![\p{L}])`), and skip extension stripping for folder names. This is a product-visible parsing change, so it was not applied.

## Low
- An empty ZIP (or a ZIP with no images) now shows "Không có ảnh nào trong folder." The wording says folder even when the drop was a ZIP.
- Hidden folders are handled differently by the two paths. The drag path skips them (`walk` checks each directory), but `<input webkitdirectory>` keeps images under `.thumbnails/` or similar, because `isJunkPath` only checks the basename and `__MACOSX`.
- Folder reads are async and have no ordering guard. If two drops happen close together, the slower read finishes last and replaces the newer drop. There is also no "đang đọc folder…" feedback while a large folder is walked.
- In the confirm row, several folders get consecutive numbers (`ch 9`, `ch 10`, `ch 12` become 9, 10, 11), while the auto path keeps each guessed number. This already happened with ZIPs and the row states "đánh số liên tiếp".
- In `chapter-meta-popover.tsx`, `onSuccess` declares `const title` (the series title), which shadows the new `title` state. It works but is confusing; rename it to `seriesTitle`.
- `Solo Leveling 105 - The Return` produces the title `105 - The Return`, because bare numbers are kept unless they are all that is left. This matches the spec.

## Acceptance criteria (a)
| Item | Status |
|---|---|
| chapterTitleFrom plan cases | Pass (unit tests, plus my probe) |
| Grouping by direct parent dir, ZIP in folder kept as its own chapter | Pass (`readDropped`, `namedGroups`) |
| Natural sort of chapters (by path) and pages (by name) | Pass |
| readEntries read until an empty batch | Pass (130-entry fake, batches of 100) |
| Entries captured before any await | Pass. `readDrop` runs synchronously inside the handler, `items` and `files` are read before the first await, and the fake expires after a microtask |
| webkitdirectory input | Pass (attribute renders, confirmed in the e2e error dump) |
| Popover title edit | Pass (trimmed, sent only when changed, cache updated) |
| API `ChapterPatch.title` trim/max 200, refine, no-op compares title | Pass (test covers trim, "", 201) |
| Empty drop shows the message | Pass (`onFiles([])` leads to the confirm row alert) |
| Browser-only criteria (40-image folder, 3 sub-folders, picker on Chrome/Edge/Firefox) | Not verified. No e2e covers folder drop or the picker |

## Regression walk (b)
- `stem()` change: probed old against new. It only changes names without a letter extension: `1.5` goes 1 to 1.5, `Vol.2` goes null to 2, `ch.105` goes null to 105. All real file callers (images and ZIPs) have letter extensions, so `ch12.zip`, `012.png`, `ch 7.JPEG`, `chapter 42.png` give the same results. `matchSeries` is unaffected in practice. No file-path regression.
- ZIP drop, loose images, page-wide drop (home and series), DropZone drop, draft-row resume drop, workspace resume: covered by e2e after the fix. The page drop now calls `preventDefault` for any drag of type `Files` and reports `[]` for an empty result. This is intended.
- `resolveDropSeries`: it now also receives every path segment (folder and parent names). Behaviour for loose files is unchanged.

## Contracts (c)
- `onFiles(File[])` is unchanged. Callers can now receive `[]`; all three consumers handle it (the auto path falls back to the confirm row, resume throws its mismatch message).
- API: `ChapterPatch` gains an optional `title`. The response shape is unchanged. No migration.
- `dropGroups` return gains `name`, and `Dropped` gains `folders` and `zips[].path`. Both are internal to the web app; tests were updated.

## Recommended actions
1. Keep the e2e locator fix (done).
2. Apply the folder filter in `resumeFromFiles` (Medium 1).
3. Make `walk` skip a failing entry instead of dropping everything (Medium 2).
4. Decide whether to add a word boundary to the `PREFIXED` prefixes (Medium 3, product call).
5. Add an e2e test that runs `setInputFiles` with a directory on the `webkitdirectory` input, covering the unverified folder criteria.

## Unresolved questions
- Medium 3 changes how numbers are parsed from existing file names (for example `Tower of God c2` must still work). Does the product owner want that change in this phase?
