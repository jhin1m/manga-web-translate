# Code Review: per-series ignored text (watermark) — phase 05

## Scope
- Files: 13 modified + 7 new (api claim-inputs/series route/test, db schema+migration 0010+down, shared ignore-text(+test), web settings form/parser(+test), text-table rows/hook, chapter-workspace, e2e series-manage)
- LOC: ~+266/-30
- Focus: uncommitted diff on `feat/skip-p5-watermark-text`
- Verified: focused vitest green (shared ignore-text 3/3, web rows + ignore-text-input 12/12). Node probe of `normalizeIgnoreText`/`isIgnoredText` edge cases (results below).

## Overall Assessment
Architecture matches plan: filtering at claim (`withoutIgnored`), DB `ocr_result` untouched, worker `handle_translate` already drops `empty` items (`worker/mtl_worker/handlers.py:213`), `translate_chapter`/`make_batches` skip pages with no regions (`worker/mtl_pipeline/translate.py:54`) so all-ignored pages make no LLM call and get no boxes. `glossary_rev` bump is correct for the translate key. One real validation hole defeats the plan's only guard against over-matching (3-char minimum), and the failure mode is silent.

## Critical Issues
None.

## High Priority

1. **The 3-char minimum is checked on the raw string, not the normalized string. Short entries can slip past it and hide almost all dialogue without any warning.**
   `apps/api/src/routes/series.ts:59-62` (zod `.trim().min(3)`), `apps/web/src/features/series/ignore-text-input.ts:7`, `packages/shared/src/ignore-text.ts:11-17`.
   I confirmed this with a probe:
   - `"http://a"` (8 chars) normalizes to `"a"`. `isIgnoredText("Anh ơi, chạy đi!", ["http://a"])` returns `true`, so every line containing "a" is dropped.
   - An NFD `"ắ"` has length 3 in UTF-16, so it passes `min(3)`. It normalizes to 1 NFC char and matches any text containing "ắ". macOS clipboard text can be NFD.
   - Why this is High: ignored regions are sent with `empty: true` (no LLM call, no box), hidden from the text table (`rows.ts:74`), and therefore also hidden from export warnings (`export-warnings.ts` counts `rows`). The user can export a chapter that is untranslated with zero warnings.
   - Fix: validate and dedupe on the normalized form in a single shared function used by both the API and the web form. Example:
     ```ts
     // shared
     export const ignoreEntryValid = (s: string) => { const n = normalizeIgnoreText(s); return n.length >= IGNORE_TEXT_MIN && n.length <= IGNORE_TEXT_MAX; };
     // api
     z.array(z.string().trim().refine(ignoreEntryValid, "3–100 ký tự (sau khi bỏ http(s)://)"))
     ```
     Optionally store `s.normalize("NFC")` so that what is stored is what is displayed.

## Medium Priority

2. **On chapters translated before an entry was added, the watermark's translation box stays on the canvas and in the export, but it disappears from the table and from export warnings.** `apps/web/src/features/chapter/text-table/rows.ts:72-74`: `regionIds` covers the ignored regions, so their linked boxes also get no "Tự thêm" row.
   - The plan intends this ("không sửa ngược, chỉ ẩn dòng ở bảng"). The effect is that the old watermark translation is still printed, but the user can no longer find it in the table to delete it. Clicking it on the canvas sets `current` to a key that has no row (`chapter-workspace.tsx:245,255`), so `currentRow` is null.
   - Suggested fix: hide the row only when the region has no visible linked box (`!linked.some(b => !b.hidden && b.text.trim())`). Alternatively, keep the row and flag it.
   - This needs a product decision (see Q1).

3. **Ignored regions now carry the worker `empty` flag in `ai_state`** (`handlers.py:126` via `_flags`). The table hides them while the entry stays in the list. Once the entry is removed, they reappear as "Trống" until the user retranslates. The hint text says this, so it is acceptable, but no test covers it. Informational.

4. **`page.ocr_region` target text is not filtered.** If the user draws a region over a watermark and runs OCR, it is still translated and boxed (`handlers.py:307`). Only its context lines are filtered (`claim-inputs.ts:216`). This is arguably correct because the action is explicit. The context exclusion for `page.ocr_region` has no test.

5. **Ignore-list vs `glossary_rev` snapshot mismatch.** The translate payload snapshots `glossary_rev`/glossary when the job is enqueued (`enqueue.ts:247`), but the ignore list is read when the job is claimed (`claim-inputs.ts:186`).
   - A job that is still queued when the list changes runs with the new list, while `ai_state.meta.glossary_rev` records the old rev. No code reads `meta.glossary_rev` for staleness (I grepped web and api), so this is harmless today. A reclaimed job (lease expiry) may also see a different list than its first attempt.
   - Idempotency is correct: the bump changes `translateInputRev`, so a retranslate after a list change creates a new job instead of reusing the active one. `retryFailedPages` stage-1 detection uses only `settings_rev` (`enqueue.ts:292`), so a list change does not re-run step 1.
   - Pre-existing and not new: `enqueueTranslate` does not refuse when another translate job for the chapter is active, so changing the list mid-run and then retranslating gives two concurrent jobs. Glossary edits already behave this way.

## Low Priority

6. **Entries like `"https://"` or `"http://"` are accepted and stored but never match anything** (normalized to `""`, skipped at `ignore-text.ts:24`). Fix #1 rejects them.
7. **Biome suppression in `text-table.tsx:47`.** The memo is correct, because `rowsMemo` is replaced exactly when `ignoreKey` changes. `ignoreKey = join("\n")` can collide for entries that contain `\n` (the API allows inner newlines) — theoretical. A simpler option is to add `ignore` to the deps and drop the suppression. A new array reference after a refetch still hits the per-state WeakMap, so this is cheap. Or key on `JSON.stringify(ignore)`.
8. **`Form.ignore_text` in `series-settings-form.tsx:53` is dead state.** The mutation always overrides it with `ignore.list`, and the textarea is driven by `ignoreRaw`. It only exists to satisfy the `SeriesSettings` type. Harmless.
9. **Order- or case-only edits bump `glossary_rev`** (`series.ts:322`, raw `JSON.stringify` compare). The cost is only a fresh translate key. Harmless.
10. **Untracked `TODO.md` at the repo root** is unrelated to this feature. Keep it out of the commit.
11. **Possible false negatives:** OCR often inserts spaces in URLs (`"discord . gg"` does not match `"discord.gg"`, confirmed by probe), and `www.` is not stripped. Worth a note in the docs or hint. No code change required for the MVP.

## Edge Cases Checked
- **All items on a page ignored (rolling):** `make_batches` skips pages with no regions. `clean` is not downloaded (`page_items` is empty). The `ai_state` has no translations and no boxes, and the page is set to `ready`. If every page in the job is ignored, there are zero LLM calls; billing is still `2*pages+2` (`ledger.ts:27`, pre-existing).
- **Rolling context inside a job:** the worker builds context only from the regions it sent, so the watermark is excluded. `neighborLines` and `pageLines` filter correctly (`claim-inputs.ts:118`).
- **NFC/NFD:** matching works in both directions (tested). Length validation does not (finding #1).
- **Null `ocrResult`:** guarded before `withoutIgnored` (`claim-inputs.ts:190`).
- **Concurrent PATCH:** the rev is incremented in SQL, so two saves cannot produce the same rev. List changes are last-writer-wins, the same as the other fields.
- **Settings form remount:** the form is keyed by `settings_rev` only (`series-page.tsx:66`), so an ignore-only save does not remount it. `setIgnoreRaw(s.ignore_text)` reflects the server-side dedupe, and the e2e test asserts this. The "Lần dịch sau…" message now also fires on a `glossary_rev` change. The glossary editor invalidates `["series", ws]`, so the comparison base stays fresh.
- **Chapter workspace:** `seriesKeys.detail` is invalidated through the `["series", ws]` prefix, so the list takes effect in the table after navigating there.

## Contract / Compatibility
- Additive only. `seriesView.ignore_text` was added. `ignore_text` is optional on PATCH and POST (`Settings.partial()`). The migration is `NOT NULL DEFAULT '{}'`, which is safe for existing rows. The down migration follows the 0009 pattern. Snapshot and journal are consistent. No worker contract change (`empty` already exists in `OcrItem`).

## Acceptance Criteria (phase-05)
- [x] Matching watermark is not in the LLM prompt (items `empty: true`, neighbor context filtered; covered by `chapters.test.ts`) and gets no box.
- [x] Removing the entry and retranslating translates the region normally (test asserts `wm` `empty: false`).
- [~] "Too short → 400 / form error per line": implemented on the raw string only. Bypassable (finding #1).
- [x] PATCH bumps `glossary_rev`, not `settings_rev`. The reason is commented at `series.ts:320`.
- [x] Table hides matching regions (`rows.test.ts`). Settings textarea present (e2e).

## Recommended Actions
1. Validate entry length (min and max) on the normalized form in the shared helper, use it in both the zod schema and `parseIgnoreText`, and add tests for `"http://a"`, `"https://"` and the NFD 1-char case. **Blocking before merge.**
2. Decide finding #2: either keep rows for ignored regions that still have a visible box, or accept the current behavior and document it.
3. Optional: drop the biome suppression (#7) and add a test for `page.ocr_region` context exclusion.

## Metrics
- Type coverage: no `any`. One `as unknown as number` (existing pattern for SQL rev bumps).
- Tests: shared 3, web 12 focused pass. API integration test added (not re-run here; reported green).
- Lint: 1 new suppression (`text-table.tsx:47`).

## Score: 7/10

## Unresolved Questions
1. For a chapter translated before an entry was added, should a watermark region that has a visible translation box still get a row, so the user can find and delete the printed box? Currently it is hidden but still exported.
2. Should a `page.ocr_region` drawn over an ignored text be translated (current behavior) or skipped?

Status: DONE_WITH_CONCERNS
Summary: Feature meets the phase-05 acceptance criteria with additive contracts and correct glossary_rev keying; one High finding — min-length validation runs on the raw string, so "http://a" or a 1-char NFD entry passes and silently drops nearly all dialogue (confirmed by probe).
Concerns/Blockers: Fix #1 before merge; #2 needs a product decision.
