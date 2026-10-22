# Code Review: Phase 3, hiding pages after step 1 (`feat/skip-p3-hide-pages`, uncommitted)

## Scope
- Files: 23 modified + 3 untracked (migration 0008 + down + snapshot); about 417 added / 69 removed lines
- Focus: working-tree diff against spec `plans/261022-1357-page-rail-delete-and-credit-skip/phase-03-an-trang-sau-xu-ly.md`
- Checks I ran: `pnpm typecheck` passed, `biome check` passed (198 files), `ruff` passed, `pytest test_export_slices + test_contract_schema` 21/21. I did not run e2e or the API suites (the tester runs those).

## Overall
The business logic is mostly correct and close to the spec. All 10 server-side filter points listed in the spec are in place. `refreshChapter` and `translatePrepared` filter skipped pages before choosing rolling or neighbors. The PATCH route takes the chapter row lock before checking `last_page`, so concurrent hides are serialized. The worker `SliceAssembler` handles straddling slices correctly. One blocker: the shared contract changed without the pipeline-version gate that this repo uses for new input fields.

**Score: 7/10. Critical: 1.**

---

## Critical

### C1. New `skipped` field in export inputs, but no worker pipeline-version gate, so every export fails on an old worker
- `packages/shared/json-schema/inputs-chapter-export.schema.json`: `pages.items` has `additionalProperties: false` (I checked: required = 8 old fields, `skipped` optional).
- `worker/mtl_worker/runner.py:254` validates `inputs-chapter-export` at runtime. An old worker (0.4.1) receiving `skipped` raises `ContractError`, which becomes `JobFailure("internal", "hợp đồng: …")`.
- `apps/api/src/jobs/claim-inputs.ts:237` always sends `skipped` for every page in every export, not only chapters that have hidden pages. So while any worker on 0.4.1 is still running (Mac pull worker or Modal), **every export fails**.
- The repo rule says so directly in `worker/mtl_worker/__init__.py:3-5`: "Tăng khi … payload có trường mới worker cũ không hiểu (schema additionalProperties: false). API từ chối worker < MIN_PIPELINE_VERSION (426)". Commit `b2c5915` (narration_font) followed it: worker 0.4.1 + `MIN_PIPELINE_VERSION` 0.4.1, with the API `PIPELINE_VERSION` salt kept at 0.4.0.
- Fix:
  - Set worker `PIPELINE_VERSION = "0.4.2"` and add the comment `# 0.4.2: inputs chapter.export pages[].skipped`.
  - Set `apps/api/src/env.ts:38` `MIN_PIPELINE_VERSION` default to `"0.4.2"` and update its comment.
  - Set `apps/web/e2e/fake-worker.ts:10` `VERSION = "0.4.2"`, and the version in `apps/api/test/worker-helpers.ts` if it is hard-coded.
  - Do not change the API `PIPELINE_VERSION` (input_rev salt), so jobs that already finished are not rerun.
- Side note: the spec and the `ExportInputs` comment say `.optional()` exists for "job xếp hàng trước deploy" (jobs queued before deploy). That is not the real risk: export inputs are built at claim time (`buildInputs` inside the claim transaction), so a queued job never carries old inputs. `.optional()` still helps when the API is rolled back while the worker is new, so keep it, but correct the comment at `packages/shared/src/worker-protocol.ts:122-125`.

---

## High
None.

---

## Medium

### M1. After an export, hiding or restoring a page does not raise "Xuất lại" (re-export), and a `done` chapter stays "đã xuất" (exported)
- `apps/api/src/routes/series.ts:96-153` `exportStatus` only uses the timestamps of `chapter.translate` jobs and `page_states.updatedAt`. PATCH `skipped` changes neither, but the next export file will be different (the page is dropped or added back).
- `refreshChapter` keeps `done` (`enqueue.ts:455-457`) when every visible page is ready. So hiding a credit page in an already-exported chapter leaves the chapter marked "đã xuất", and the user gets no signal to export again.
- Options: (a) on PATCH, touch a timestamp that `exportStatus` reads, for example a new `pages.updated_at`, and include `pages.updatedAt` in `lastChange`. (b) Accept the behavior and document it in P6. This is a product decision, so ask the user.

### M2. Several spec tests (step 6) are missing
- "Hiding the only page still `failed` → chapter becomes `review`": no test. This is the most important status-machine case and the one most likely to regress.
- Glossary-apply preview/apply excluding skipped pages: not tested. It shares `chapterPages` with find-replace, so the risk is low, but the spec requires it.
- 409 `chapter_busy` while `ingesting`: not tested (only `processing` is covered, by hiding while `chapter.translate` runs).
- `queue.test.ts`, `export.test.ts`, `find-replace.test.ts` and the web vitests (`status.test.ts`, `page-status.test.ts`, `export-warnings.test.ts`) are listed under Related Code Files but untouched. That is acceptable because the web side filters once in `useChapterData`, but there is no unit test for that filtering (`progress.pages` contains no skipped pages, `hiddenPages` contains them).
- The API test has one ~90-line `it` that checks 8 behaviours. When it fails it is hard to see which one broke. Low priority, but splitting it would help.

### M3. e2e `chapter-tools.spec.ts` › "delete a page from the rail…" is still red (per the hand-off). The phase cannot be closed with that failure.
- I read the code path and found no clear cause. `onSuccess` → `notify({tone:"info", key:"skip"})` → `role="status"`, text `Đã xoá trang ${ord+1} (…)`. The 6s timer starts again only when `notice` or `settled` changes. `ChapterWorkspace` is keyed only by `chapterId`.
- Two things to check first: (1) whether `onError` fired instead (`role="alert"`, not `status`) even though the rail still updates through `onSettled: data.refresh`. Check the console or network in `error-context.md`. (2) Whether an extra `notify(null)` or remount happens when `pageIds` changes, through `useChapterSession`.

---

## Low

1. `page-rail.tsx:103` shows the Xoá (delete) icon on the last visible page too. Clicking it always gives 409 `last_page` and a red toast. Hide or disable the icon when `props.pages.length === 1`.
2. `chapter-workspace.tsx:470-474` `skipPage` calls `go()` to the next page *before* the mutation. If the mutation fails (409, 423), the user has already been moved off the page they were working on. Acceptable, but it would be better to move only in `onSuccess`, or to move back on error.
3. `chapter-workspace.tsx:638` `editable={pagesEditable && !pageSkip.isPending}`: every icon *disappears* while the request is in flight, so the layout jumps. Better to pass a separate `disabled` prop.
4. `retranslate` (`enqueue.ts:265-268`) reads non-skipped pages *before* `enqueueTranslate` takes `lockChapter`. A hide committed in between makes the whole-chapter retranslate fail with 409 `page_skipped` (a confusing message, but the data stays safe). To avoid it, call `lockChapter` before the read in `retranslate`.
5. Page-level endpoints still accept hidden pages: `PUT /pages/:id/state`, `reinpaint`, `ocr-region`, `ai-update/ack`. The UI cannot reach them (the canvas has no hidden pages), but a direct API call could spend a reinpaint/OCR job on a hidden page. Add a `page_skipped` guard to the job-enqueuing endpoints if you want strict behaviour.
6. `original_slices`: when a whole slice in the *middle* is dropped, file names have gaps (001, 003, …) because names come from `source_ord`. This matches the existing behaviour for excluded untranslated slices and the spec only requires contiguous numbering for the `pages` layout. Noting it so the user is not surprised.
7. Pager `CanvasStatus` "Trang i/n" uses the index in the visible list (e.g. "Trang 2/2"), while the rail and inspector show the original number ("Trang 3"). This follows the spec but can confuse users. Mention it in the P6 docs.
8. `GET /chapters/:id/states` (`page-state.ts:109`) still returns states for hidden pages. The client ignores them because rows are built from `chapterStore.pages`. This is slightly wasteful but not wrong.
9. `routes/pages.ts:22` adds a 4th local `conflict` helper (copies exist in chapters.ts, glossary.ts, enqueue.ts). This follows the existing per-file pattern, so no change is required.

---

## Acceptance criteria (a)

| Criterion | Status | Evidence |
|---|---|---|
| PATCH: lock → 423, busy → 409 `chapter_busy`, `last_page`, `refreshChapter` | Done | `routes/pages.ts:85-106`; test covers 423, 409 (processing), last_page |
| Other workspace → 404 | Done | `tenant-isolation.test.ts` RESOURCE_CASES + BODIES |
| `refreshChapter` excludes skipped | Done | `enqueue.ts:447-451` |
| `translatePrepared` still rolling | Done | `enqueue.ts:429-435`; test checks `context === "rolling"` |
| Whole-chapter `retranslate` / `retryFailedPages` | Done | `enqueue.ts:265-268`, `:289` |
| `page_ids` contains skipped → 409 `page_skipped` | Done | `enqueue.ts:236`; tested |
| `neighborLines` | Done | `claim-inputs.ts:106`; the test can tell the cases apart (without the filter, context would be page 2's lines, not "Trang một") |
| `/translate` no_pages | Done | `chapters.ts:372` (unreachable in practice because of `last_page`) |
| Progress `counts` + `skipped` | Done | `progress.ts:52,69`; tested |
| Find/replace + glossary-apply (preview + apply) | Done | `find-replace.ts:125` shared `chapterPages` (glossary not tested, M2) |
| `enqueueExport` no_pages | Done | `enqueue.ts:374` |
| `chapterStats` (series list) | Done (extra) | `series.ts:161-165`; consistent with "Tất cả n" |
| `ExportInputs.pages[].skipped` optional | Done, but see C1 | missing worker version gate |
| Worker `pages` layout contiguous numbering | Done | `export.py:97-99,117,145`; tested |
| Worker `original_slices` drop / straddle | Done | `render.py:269-285`; 3 tests |
| Web: icon only with lock, "Đã xoá n" filter, original numbering, visible-only counts, active page jumps, toast, text table | Done in code, but e2e red (M3) | `page-rail.tsx`, `chapter-workspace.tsx:451-477`, `use-chapter-data.ts:63-66` |
| No jobs enqueued on hide/restore | Done | PATCH only updates + `refreshChapter` |

## Regressions (b)
- Status machine: `rows.length === 0` cannot happen because of `last_page`. `done` is kept when every visible page is ready (see M1). Restoring a `prepared` page → `prepared` (tested).
- Rolling vs neighbors: correct. `chapter.translate` inputs read by `page_ids` only, and hiding is blocked while `processing`, so a skipped page cannot get into an in-flight job.
- Export: the idempotency key is computed over visible pages only, so hiding or restoring creates a new job instead of reusing the old one. `chapterHasUserEdits` and the find-replace `undo` still scan every page, which is correct (protects edits / restores the batch).
- CSS rename `.cw-source-item` → `.cw-rail-row`: no old references remain (grepped).

## Public contracts (c)
- DB: `ADD COLUMN boolean DEFAULT false NOT NULL` (fast default on PG11+, no table rewrite). The down migration matches the 0007 pattern. No index is needed (the filter sits next to `chapter_id`).
- API: progress `pages[].skipped` (additive), `PATCH /pages/:id` (new), `page_counts.total` now excludes hidden pages (intended).
- Job inputs: see C1.

## Positive notes (for risk calibration)
- PATCH serializes on the `chapters FOR UPDATE` lock, so two parallel hides cannot leave the chapter with no visible page.
- `translated = !pg.skipped && …` makes a straddling slice use the original image instead of the clean one, so no text is drawn for the hidden page.

## Recommended actions
1. (Blocking) C1: bump worker 0.4.2 + `MIN_PIPELINE_VERSION` 0.4.2 + fake-worker, and correct the `ExportInputs` comment.
2. (Blocking) M3: fix the red e2e.
3. M2: add the test "hide the last failed page → review" and the glossary-apply preview test.
4. M1: ask the user about the re-export signal after hide/restore.
5. Low 1–3 (rail UX) if there is time.

## Metrics
- Typecheck: 0 errors. Lint (biome/ruff): 0 issues.
- Tests: worker export/contract 21/21 (run). API/web/e2e not run (tester).

## Unresolved questions
1. M1: after a chapter is exported, should hiding or restoring a page raise "Xuất lại"? (This is a product decision.)
2. During deploy, is there ever a window where a 0.4.1 worker (Mac pull) is still claiming jobs? If the API and every worker are always deployed together, C1 drops to High, but the repo convention still requires the bump.
3. Should page-level endpoints (reinpaint, ocr-region) reject hidden pages (Low 5), or is blocking only through the UI enough?
