# Phase 1 report: folder drop + chapter title

## Files
- New: `apps/web/src/features/upload/dropped-paths.ts` (+ `.test.ts`)
- Modified web: `upload/drop-zone.tsx`, `upload/parse-chapter-filename.ts` (+test), `home/drop-to-translate.ts` (+test), `home/new-chapter-confirm-row.tsx`, `chapter/chapter-meta-popover.tsx`, `chapter/api.ts`
- Modified api: `apps/api/src/routes/chapters.ts` (ChapterPatch.title, no-op compare includes title), `apps/api/test/chapters.test.ts`
- `upload-manager.ts` / `upload/api.ts` needed no change (already take `title`).

## Decisions
- `stem()` now strips only extensions containing a letter, so folder "Ch 12.5" keeps ".5" (ZIP "12.5.zip" still works).
- `isJunkPath` (dropped-paths): isJunkEntry + `__MACOSX` at any depth.
- `Dropped.zips` gained `path`; `Dropped.folders` = `{name, path, pages}` (plan's `parent` omitted: unused, series match uses all path segments instead).
- `namedGroups(d)` exported: ZIP + folder groups sorted naturally by path; shared by `dropGroups` and confirm row.
- `resolveDropSeries` fileNames = unique path segments (file, chapter folder, parent folders).
- Confirm row: number guess from first folder name when folders dropped; per-group `title`; ask-mode only for loose images; "Chọn folder" button added to DropZone (strip: link "chọn folder"; md/lg: "Chọn folder…"). Folder picker input omits `accept`.
- Popover: "Tên chương" field, saved with number; dialog label now "Đổi series / số chương / tên chương" (e2e matches by substring, still ok).
- Read errors from folder traversal are swallowed as "no files".

## Tests
- web: 60 files / 546 tests pass. api: 67 files / 727 pass, 1 skipped. typecheck clean, biome lint clean.
- chapterTitleFrom cases from plan all pass; readEntries 130-file batch test; sync-grab test (entries expire after first microtask).

## Not verified / unresolved
- Empty folder drop: file list empty -> `onFiles` not called, so nothing happens and no "không có ảnh" message (criterion unticked; needs product call or a small onEmpty hook).
- Browser-only criteria unticked: 40-image folder, 3 sub-folders opening first chapter, folder picker in Chrome/Edge/Firefox.
- Resume-drop on a draft chapter row with a folder: files carry basenames only; ordering across sub-folders not special-cased.
- Mixed folder with non-image files (e.g. txt) surfaces the existing "chỉ nhận png/jpg/webp" problem rather than skipping silently.

## Follow-up
- Non-image files inside a folder (path has "/", not ZIP, no png/jpg/webp ext) are skipped silently in `readDropped`; root loose files keep the format error; ZIPs in folders unchanged (ZIP-in-folder not unit-tested: unzip needs a Worker).
- Zero usable files: drop hooks (`useDropTarget`, `usePageDrop`) and the "Chọn folder…" input now call `onFiles([])` when a Files drop / folder pick yields nothing (Files flag read synchronously). `useDropToTranslate` already falls back for zero groups, so the confirm row shows "Không có ảnh nào trong folder." (role=alert, "Tạo" stays disabled; file label "folder rỗng").
- Side effect: dropping an empty folder on a draft chapter row / chapter workspace goes to resume with no files and shows its existing mismatch error.
- Tests: new readDropped cases (skip non-image in folder, loose .txt flagged, only-skipped -> no groups). The hook/confirm-row message is not unit-tested (no DOM test setup); needs browser check.
- Results: web 548 tests pass, typecheck + lint clean, api untouched.

## Follow-up 2 (review fixes)
- `usableFiles()` in `dropped-paths.ts` is the single filter (junk + non-image inside folders); used by `readDropped` and `resumeFromFiles`, so resuming from the original folder matches the page count.
- `walk()` catches per entry: an unreadable file/folder is skipped, the rest of the drop survives (unit test with a rejecting entry).
- `PREFIXED` now has `(?<!\p{L})`: "Arc 2" no longer matches `c 2`; `manga_c12`, `s2_ch10` still match. `stem()` strips only real file extensions (zip/cbz/rar/7z/png/jpg/jpeg/webp/gif/bmp/avif/tif), so "Ch 3 - St.Louis" keeps "St.Louis". All previous parse tests unchanged and green (callers: dropGroups, confirm row, chapterTitleFrom, matchSeries).
- Tests: web 552 pass; typecheck + lint clean; e2e upload-chapter, series-manage, trim-auto-drop: 18/18 pass. Reviewer's e2e locator edits kept.
