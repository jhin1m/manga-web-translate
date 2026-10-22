# Code Review: Series language and page format

Date: 2026-10-22 · Reviewer: code-reviewer · Plan: `plans/261022-0918-series-language-and-page-format/plan.md`

## Scope
- Files: only the files the task listed, and only the hunks for this feature. Unrelated hunks were skipped: the two-step flow, `prepared` status, migration 0004, and the home/series delete UX.
- Focus: acceptance criteria, ko→vi regression, contracts, tenant isolation, rtl heuristic, migration, leftover KO/VI assumptions.
- Checks I ran myself:
  - `drizzle-kit check` ("Everything's fine").
  - `drizzle-kit generate` on a scratch copy of `migrations/`, which reported "No schema changes". The snapshot matches the schema.
  - Targeted worker pytest: 48 passed.
  - Two rtl probe scripts in scratch.

## Overall Assessment
The implementation is solid and matches the plan. I found no critical or high issues. The LTR path is unchanged, tenant isolation still holds through the composite FKs, and the new payload fields are optional, so jobs queued before deploy still validate. There are three medium issues:
1. The rtl row-grouping heuristic mis-orders text across panel rows when one tall box is present.
2. `reading_order` comes from the series at prepare time, not from how the chapter was actually ingested.
3. Workspace glossary entries are applied regardless of the language pair. This gap now shows because targets other than vi are allowed.

## Critical Issues
None.

## High Priority
None.

## Medium Priority

### M1. One tall box merges two panel rows in `rtl_order` (lower-right text read first)
`worker/mtl_pipeline/detect.py:132-145`. The row band grows as `max(y1, r.bbox.y2)`, and each new box is tested against `min(r.bbox.h, band)`. A tall region joins the first row and stretches the band down the page. Every box after it whose height mostly falls inside the band then joins the same row, which is sorted only by `-x2`.

I reproduced it. The page has two panel rows plus a tall SFX/narration (`text_free`, x 400-520, y 120-900) crossing the gutter:
```
in : A-right(700,100) A-left(100,120) SFX(400,120..900) B-right(750,600) B-left(100,620)
out: r0=B-right(750,600) r1=A-right r2=SFX r3=A-left r4=B-left
```
The bottom-row bubble becomes `r0`. A staircase of four staggered bubbles also chains into one row.

Impact: the rolling translation context and region ids are out of order. That hurts pronoun and speaker consistency on exactly the ja+pages path this feature targets. Big manga SFX that cross panels are common. Only ja+pages is affected; ltr is untouched.

Fix, pick one:
- (a) Test each box against the seed band of the row (first member's y/y2) and do not extend `y1`.
- (b) Leave `bubble` and very tall regions (h > ~2x the median text h) out of row formation, then insert them by center-y afterwards.

Add a regression test with the case above.

### M2. `reading_order` uses the current series settings instead of the chapter's actual ingest mode
`apps/api/src/jobs/enqueue.ts:198` uses `readingOrder(s.sourceLang, s.pageFormat)`, and `retryFailedPages` is at `enqueue.ts:303-306`.

Scenarios:
1. A ja series is `pages`, and a chapter is committed with the override `{mode:"strip"}`, or committed before the user switched the series format. The cut strip pages still get `rtl`.
2. The user flips `page_format`. That bumps `settings_rev`, so `retryFailedPages` reclassifies every **stage-2** failed page as stage-1, because `prepareInputRev` no longer matches. Those pages get re-detected, re-inpainted and re-OCR'd at extra LLM cost, and with the new reading order. Their sibling pages keep the old order and ids.

The settings form hint (`series-settings-form.tsx:137`, "Áp dụng cho chương upload sau khi lưu") says the change only affects new uploads, so this contradicts it. The settings_rev coupling already existed for other fields; `page_format` adds a new trigger.

Fix: store the ingest mode on the chapter, or carry it from the `chapter.ingest` payload into `createIngestedPages`. Then derive `reading_order` from `(series.sourceLang, chapter mode)`. Optionally keep `page_format` out of `translationChanged` (it is not a translate input once the order is per chapter), or reword the hint.

### M3. Workspace glossary is not tied to a language pair
`apps/api/src/jobs/enqueue.ts:206-221` merges every workspace-level entry (`series_id IS NULL`) into every series. Before this change every series was ko→vi, so it did not matter. Now a ko→en series receives workspace entries like `회장 → chủ tịch`, and the prompt says the glossary is "bắt buộc dùng đúng". That forces Vietnamese words into English output.

Fix (short-term): apply workspace entries only when the series pair is ko→vi, or only when the series target equals the dominant target of the workspace.
Fix (proper): add `source_lang`/`target_lang` (nullable means any) to `glossary_entries` and filter on them in `translateSettings`.

At minimum, document the limitation and add a hint in the glossary UI.

## Low Priority

- **L1. "keep" now covers more than before for existing ko→vi series** (`enqueue.ts:55-62`). The old text kept only the suffixes "(-nim, -ssi)". The new text keeps "-nim, -ssi, hyung, unnie, oppa, sunbae" as Latin transliteration. Series using `keep` will now get "hyung/oppa" where they used to get "anh". The plan accepted a changed string, but this is a behavior change on the ko→vi path (criterion 6). Confirm it is intended, or keep the address terms out of the `keep` example list.
- **L2. `page.ocr_region` translates with default `SeriesSettings`** (`worker/mtl_worker/handlers.py:312`). It now uses the correct language pair but still ignores the series glossary, `honorific_policy`, pronoun rules and style. This existed before; with non-vi targets the generic `DEFAULT_HONORIFIC_POLICY` makes it more visible. Consider sending `settings` (TranslateSettings) in the ocr_region payload.
- **L3. The dev CLI path is still KO/LTR only.** `worker/mtl_pipeline/pipeline.py:83,90` (`prepare_page`) calls `prepare_image(img)` and `ocr_page(...)` without rtl or language. `cli.py:14-22` `_settings` ignores `source_lang`/`target_lang`. This only affects local bench and CLI runs. The plan said "only if needed", so this is fine, but local ja testing will silently use ltr and ko.
- **L4. The doc wording on the version bump is misleading** (`docs/job-queue-worker.md:104`). "cập nhật worker Mac trước khi dùng nguồn khác `ko`" suggests only non-ko work needs the new worker. With MIN=0.4.0, every claim from a 0.3.x worker gets 426 right after deploy, so all processing stops until the worker is upgraded. Reword to "nâng worker lên 0.4.0 cùng lúc deploy API".
- **L5. Language-name tables are duplicated three times**: API `TARGET_NAMES` (`enqueue.ts`), web `LANG_NAMES` (`lang-labels.ts`), worker `LANG_NAMES` (`langs.py`). Honorific examples are also duplicated between API and web. Moving the names and examples into `packages/shared/src/series-lang.ts` would serve both API and web; the worker copy cannot be avoided.
- **L6. Defense in depth in `enqueueOcrRegion`** (`enqueue.ts:352`). The chapter lookup filters on `id` only. It is safe today because `pageIn` scopes by workspace and the `(workspace_id, chapter_id)` composite FK guarantees the same tenant. Adding `eq(chapters.workspaceId, ws)` costs nothing.
- **L7. `honorificText(policy, src: string, tgt: string)`** is weakly typed and silently falls back to the ko examples. The plan specified `SourceLang`/`TargetLang`. This is harmless because the API validates at the boundary.

## Edge Cases Found by Scout
- Pre-deploy queued jobs: the payloads lack the new fields, and the worker defaults to ko/vi/ltr. That is correct because the old gate only allowed `ko` series. Their `inputRev` uses 0.3.0, so after deploy `retryFailedPages` treats their stage-2 failures as stage-1 (one-off re-prepare cost). This happens on any version bump; just be aware of it.
- After the bump, active pre-deploy jobs no longer dedupe against newly enqueued ones (the key includes the version). This also happens on any bump.
- Changing the source language does not auto-change `page_format`. A user who switches an existing series to `ja` in Settings keeps strip ingest and ltr order unless they also pick "Từng trang". This matches the plan's decision but is easy to miss (see questions).
- Same-language pairs (en→en) are accepted.

## Verified as fine
- (a) Acceptance criteria:
  - All pairs can be created and patched; `de`/`th`/`scroll` return 400.
  - `ENABLED_SOURCE_LANGS` and "MVP chỉ hỗ trợ" are gone outside `plans/`.
  - Backfill is in place, and create defaults `page_format` from the source language.
  - Commit without `mode` uses the series format (web sends `{}`; `chapters.ts:269` passes `undefined`).
  - Payloads carry the language.
  - Prompts are generalized: the only Vietnamese example is conditional on the target, and system prompts stay static.
  - Docs are updated.
  - The plan deviation (commit `mode` kept optional) is documented and safe: the only caller is the commit route.
- (b) LTR is unchanged: `to_regions` keeps `sort((y, x))` when `rtl=False`, and every default chain (`detect`, `prepare_image`, handler `.get("reading_order","ltr")`) resolves to False. OCR items stay in region order (`ocr.py` `order = text_regions(regions)`), and handle_translate follows that order.
  - `ingestKey` for ko series is identical apart from the version (`mode` stays "strip").
  - `pageOpKey` now includes source/target, so a language change produces a new key. That is sensible.
  - `prepareKey` and `translateKey` pick up `page_format` through `settings_rev`.
  - The `retryFailedPages` and `createIngestedPages` callers are unchanged apart from M2.
- (c) Contracts:
  - `page_format` is added to every series response.
  - The new zod fields are `.optional()`, and the regenerated JSON schema matches; the shared drift test passes.
  - The version bump appears in `env.ts` and `mtl_worker/__init__.py`, with no env pins in `.env.example`.
  - The `@mtl/shared/series-lang` subpath export is additive.
- (d) Tenant isolation:
  - Commit uses `sdb.byId` (scoped) and then `lockChapter(ws)`.
  - `seriesOf` and the chapter lookup are reachable only from a workspace-scoped page or chapter.
  - The composite FKs `chapters(ws, series_id)` and `pages(ws, chapter_id)` keep it within one tenant.
- (e) `bubble_id` assignment happens after ids are renumbered and uses containment, so reordering cannot break host links. Nested boxes and bubble/text ties resolve deterministically (the bubble comes first by `(-x2, y)`).
- (f) Migration:
  - The journal has 0004 and 0005, and the snapshot chain is consistent (0005.prevId = 0004.id).
  - The 0005 snapshot has the column and the check.
  - The backfill runs after ADD COLUMN and CHECK, and `'pages'` satisfies the check.
  - The down script follows the repo pattern (drop the constraint, then the column, then delete the max `__drizzle_migrations` row). Like the other down scripts, it is only valid when 0005 is the latest migration.
- (g) Fonts: the coverage test pins es/pt/fr glyphs for every manifest font. Typesetting wraps on spaces, which is correct for Latin targets.

## Recommended Actions
1. M1: stop the row band from chaining (seed band or excluding tall boxes) and add the probe case as a test.
2. M2: derive `reading_order` from the chapter's actual ingest mode, and decide whether `page_format` should bump `settings_rev`. Fix the form hint either way.
3. M3: scope workspace glossary entries by language pair, or document and limit them, before advertising targets other than vi.
4. L1: confirm the broader `keep` honorific list for ko→vi.
5. L4: fix the 426 wording in the docs. L2, L3, L5, L6 and L7 can wait.

## Metrics
- Type coverage: typecheck clean (reported by the lead). New code has no `any`. There is one `as SourceLang` cast in `langShort`, which is acceptable.
- Tests: API 154, web unit 142, e2e 22, worker 151, shared 8, db 3 (reported). I re-ran the targeted worker tests: 48 passed.
- Lint issues: 0 (biome and ruff reported clean).

## Plan follow-ups
All 5 phases appear implemented, and every success criterion is met except criterion 5. That one says "ja + pages → rows top→bottom, right→left within a row"; it holds for simple layouts and breaks in the M1 case. The plan frontmatter and phase table still say `pending`, so the lead or planner should update them.

## Unresolved Questions
1. When a user changes `source_lang` to `ja` in Settings, should the UI suggest switching `page_format` to "Từng trang"? The plan says do not auto-change it, but a hint would avoid strip ingest of manga.
2. Should same-language pairs (en→en) be rejected?
3. Is broadening `keep` (L1) for existing ko→vi series intended?

Status: DONE_WITH_CONCERNS
Summary: No critical or high issues: LTR, idempotency, tenant isolation, contracts and migration all check out. There are three medium issues: the rtl row heuristic chains across panel rows when one tall box is present (reproduced), reading_order comes from the series instead of the chapter's ingest mode (and page_format changes re-prepare stage-2 failures), and the workspace glossary is applied to every language pair.
