# Code review: redesign P2 (Home + Series + inline upload)

Branch `feat/redesign-p2-home-series`, uncommitted diff plus untracked files. Read-only review. Plan: `plans/261020-1944-web-uiux-redesign-chapter-workspace/phase-02-home-series-inline-upload.md`.

**Score: 7/10.** The structure is sound, every API change is additive, tenant scoping is correct and the gates are green. Three issues should be fixed before landing: one perf problem on Home's hot query and two correctness bugs, one in chapter numbering and one race in the upload manager.

## Gates
- `pnpm typecheck`: clean. `pnpm lint` (biome, 203 files): clean. `pnpm --filter @mtl/web test`: 13 files, 68 tests, all pass.
- API tests and e2e were not run, as instructed.
- `rg UploadPage|SeriesListPage|SeriesDetailPage|SeriesSettingsPage apps/web/src` returns 0.

## High

**H1. The series list loads every page row in the workspace (heavy jsonb columns included) on each Home load.** `apps/api/src/routes/series.ts:184` calls `chapterStats(sdb, chs)` with *all* chapters, and `series.ts:113` runs `sdb.select(pages, inArray(...))`. That is `SELECT *` over `pages`, which includes `ocr_result`, `prepare_partial` and `source_map`.
- Failure: a workspace with 100 chapters × 50 pages pulls 5k rows of OCR JSON just to show `latest_chapter.page_counts` for about 10 series.
- The query is hit often. It runs on every Home mount and every `invalidateQueries(["series", ws])`. ChapterPage now invalidates that prefix on every status change (`chapter-page.tsx:66,71`), and the prefix also refetches every series detail and recent-chapters. The series detail query does the same full-row load per series (`series.ts:215`) and repolls every 5s while any chapter is processing (`series-page.tsx:40`).
- Also, the plan asked for "1 truy vấn pages group theo chapter_id". This code is one query, but it is not a group-by.
- Fix:
  - In the list route, call `chapterStats` only on the `latest` chapters. `exported_count` only needs `exportedChapterIds`.
  - Add a scoped count/aggregate helper to `@mtl/db` `Scoped` (for example `countBy(table, col, where)`), so pages are never loaded as full rows.

**H2. Multi-file drops number chapters in the wrong order.** `new-chapter-confirm-row.tsx:23-27,117-119`:
- `zips` keep the browser's `FileList` order, which is not natural-sorted.
- The base number is guessed from `files[0]` (`:81`), which is also unsorted.
- Groups are then numbered `base + i`.
- Failure: the OS hands over `[ch10.zip, ch11.zip, ch9.zip]` (lexicographic). The guess is base 10, so ch10→10, ch11→11 and **ch9→12**. The server does not block duplicate or out-of-order numbers, so the bad numbering is saved silently.
- The same thing happens in "N chương, mỗi ảnh 1 chương" mode on Home. `d.loose` *is* natural-sorted, but the base comes from unsorted `files[0]`.
- Fix:
  - `naturalSortBy(zips, z => z.name)`.
  - Take the guess from the first *sorted* group.
  - Better: when every group parses a number, use the per-group `parseChapterNumber`, and fall back to `base + i` only when it doesn't.

**H3. Running two resumes on the same chapter at once can mark the upload "uploaded" while files are still missing.** `upload-manager.ts:174-197`, `:199`, `:138-139`.
- How it breaks:
  - `resumeChapter` and `retryFailed` don't check for an active run.
  - `jobs.set` swaps the job, but the old `run` keeps going with its stale closure.
  - When the old run ends, it calls `writeMarker(null)` and `publish(id, "uploaded")`. That `publish` reads the *new* job's states and forces phase `uploaded`.
- Trigger: on ChapterPage ("Upload dở"), the user picks files. `resumeFromFiles` takes a few seconds (unzip + fetch), and the "Tải tiếp ảnh…" picker stays enabled during that time (`chapter-upload-status.tsx:57`, no pending guard in `chapter-page.tsx:98`), so the user picks again.
- Result: run 1 finishes first, and "Dịch chương" is enabled while run 2 is still uploading. The commit then succeeds with missing files reported as `rejected`, and the chapter is ingested with pages missing.
- Fix:
  - Keep a `running: Set<chapterId>` (or a per-job generation token). Make `resumeChapter`/`retryFailed` refuse or no-op while a run is active, and drop stale-run `publish`/marker writes when `jobs.get(id) !== job`.
  - Disable the resume picker while a resume is pending.

## Medium

**M1. Loose page images on Home get a chapter number from a page filename.** `new-chapter-confirm-row.tsx:90`: `defaultNumber ?? guess.number ?? next_number`.
- Failure: dropping `001.jpg…054.jpg` (a normal set of page images) on Home defaults to "Chương 1" (or 54, depending on `FileList` order), not the series' `next_number`. Easy to miss, and it creates a duplicate chapter 1.
- Fix: guess the number from the filename only for single files or ZIPs. For more than one loose image in "1 chương" mode, use `picked.next_number`. (On the Series page and with "+ Ch.N", `defaultNumber` already wins, so those paths are fine.)

**M2. "Exported" is permanent, so chapters reworked after export disappear from "Việc cần làm".** `exportedChapterIds` (`series.ts:90-106`) counts any chapter that ever had a succeeded `chapter.export`, and `recent-chapters?open=1` filters on that alone (`chapters.ts:112-115`), whatever the current status.
- Failure: the owner exports, then retranslates or edits (status goes back to `processing`/`partial_failed`/`review`). The chapter vanishes from Home's todo list, and the Series "Cần làm" chip hides it too (`needsWork`).
- `nextAction` already limits "Đã xuất" to `review|done`; the filter should match.
- Fix: exclude only when `status === "done"`, or when exported and `status === "review"`. Alternatively, compare the export job's `created_at` with `chapters.updated_at`. Product call; see Questions.

**M3. A partial failure in a multi-create duplicates chapters and series.** `new-chapter-confirm-row.tsx:112-122`. Chapters are created one at a time. If group k fails (400 too-many-files, network), groups 0..k-1 are already created and uploading, but the row only shows an error. Clicking "Tạo" again recreates all of them. If "+ Series mới" was selected, the series is created again too (`:114`). Fix: remember created series and group ids inside the mutation state and skip them on retry, or close the row and report which groups were created.

**M4. Every upload progress tick re-renders the whole todo and chapter lists, and each row reads localStorage.**
- `useUploads()` returns `s.chapters`, which gets a new identity on every XHR `onprogress` → `publish` (`upload-manager.ts:76-104`). See `todo-list.tsx:17,37` and `series-page.tsx:96,161`.
- Each row calls `uploadManager.view()`, which does `localStorage.getItem` + `JSON.parse` whenever the chapter isn't in the store.
- Cost: a 200-chapter series at about 10 progress events/s gives roughly 2k sync storage reads/s plus a full list reconcile.
- Fix: subscribe per row (`useChapterUpload(id)` inside the row), or throttle progress publishes. Also cache marker reads.

**M5. Cross-tab: an upload running in another tab shows as "Upload dở" / "Tải tiếp ảnh".** The marker is shared via localStorage, but the store is per tab. Tab B sees tab A's active upload as `incomplete` (`upload-manager.ts:207-212`), offers resume, and both tabs then upload the same keys. When tab A finishes it clears the marker under tab B. This is low frequency (single owner), but the label is wrong. Fix: put a heartbeat timestamp in the marker and treat a fresh one as "đang tải ở tab khác".

## Low
- `chapters.ts:111-112`: recent-chapters loads every chapter in the workspace and, with `open=1`, sends an `inArray` over all chapter ids. `chapterStats` then queries jobs again for `picked`, which repeats work already done. Acceptable for the MVP; reuse the `exported` set.
- "Việc cần làm" is capped at `limit=20` (`api.ts` `fetchRecentChapters`) with no "xem thêm". This conflicts with the plan's "mọi chương mở". Acceptable, but note it.
- Markers for chapters that were committed elsewhere or deleted are never cleaned up, so localStorage keys leak. Cleanup could run when `view` sees a status other than draft.
- `chapter-page.tsx:69-72`: the `liveStatus` effect also fires on first load, so every chapter open triggers one extra refetch of the series list, details and recent-chapters. This makes H1 worse.
- `drop-zone.tsx:6` imports `../home/home.css`, so the upload feature depends on home styling. Minor coupling.
- `series.ts:128-129` `nextNumber` duplicates web `nextChapterNumber`. The comment documents it; fine.

## Contract / pattern checks
- API: additive only. Series list gains `exported_count`, `next_number`, `latest_chapter`. Detail chapters gain `page_counts` and `exported`. The new route `/w/:ws/recent-chapters` does not conflict with `/chapters/:id`. Web types are optional, and no other web consumer depends on the shapes. `Map.groupBy` is fine (engines node >=24).
- Tenant isolation: every new query goes through `sdb` (`chapters`, `series`, `pages`, `jobs`). The tenant test case was added. There is no raw `db` in routes; raw `db` appears only in tests, consistent with the existing tests.
- Router: `series/$seriesId/upload` now redirects with `beforeLoad` to `/w/$ws/s/$seriesId` (replace). `?tab=settings|glossary` is preserved. The `SettingsForm` move is byte-identical apart from the header.
- Drop handling: React handlers on the zone and draft rows call `preventDefault`, and the window listener skips events where `defaultPrevented` is set. The order is correct (React root, then window), so there is no double-fire. The file inputs are `display:none`, so drops never land on them.
- Comments are in Vietnamese and explain intent; no plan or finding IDs.

## Acceptance criteria
| Criterion | Status |
|---|---|
| parse-chapter-filename cases (incl. unaccented name matching an accented series, null series) | Met |
| next-action: one label per state | Met |
| Home: no "Tiếp tục" card; todo list lock-first; series rows with "+ Ch.{next}" | Met (capped at 20) |
| Series: "Cần làm" default; 3 loose images → 3 chapters; glossary quick-add appears | Met (see M2 for the "Cần làm" semantics) |
| upload-manager tests (a)–(d) | Met |
| API recent-chapters tests (order, limit, series_title, page_counts) | Written, not run |
| tenant-isolation case | Written, not run |
| E2E rewritten (navigation before upload ends via held routes, redirect case) | Written, not run |
| "Dịch chương" label, disabled until upload is done | Met (H3 can bypass it) |
| `beforeunload` while uploading | Met |
| rg for old components = 0 | Met |

## Recommended order
1. H3: run guard plus stale-run fencing in upload-manager.
2. H2 and M1: numbering in the confirm row (sort zips, base from sorted first group, page-image heuristic).
3. H1: limit stats to latest chapters in the series list; aggregate pages server-side.
4. M2: product decision on what "exported" means for the todo list.
5. M3 and M4.

## Unresolved questions
1. M2: should a chapter that was exported and is now being edited or retranslated reappear in "Việc cần làm"? The current code hides it permanently.
2. Is the cap of 20 todo items acceptable, or should there be "xem thêm"?
