# Code Review — Font theo kiểu chữ (text-style-fonts)

Date: 2026-11-02 · Scope: uncommitted `git diff` (40 files, +603/−36) + untracked `apps/web/src/features/editor/__tests__/text-style-options.test.ts` + docs diff · Spec: `plans/261102-1547-text-style-fonts/`

Score: **8.5/10**. No critical issues. One major problem: a test does not cover what it claims to. The rest are minor.

## Gates (run locally)

| Gate | Result |
|---|---|
| `pnpm typecheck` | green (shared, db, web, api) |
| `pnpm lint` (biome) | green, 332 files |
| `pnpm --filter @mtl/web test` | 324/324 |
| `pnpm --filter @mtl/shared test` | 38/38 |
| `pnpm --filter @mtl/api test` | 319/319 |
| `worker: uv run pytest` / `ruff check` | 276 passed / clean |
| `vitest run test/claim-fonts.test.ts -t "includes the thought"` (run alone) | **FAIL**: `Error: chapter has no pages` |

## Findings

### Major

**M1. Export-inputs test depends on the test before it, and it never checks the `thought` slot** — `apps/api/test/claim-fonts.test.ts:171-179`
- I ran it with `-t`. Run alone, it fails at `claim-inputs.ts:293` with "chapter has no pages", because the page for user A is only seeded by the previous test (`:159`).
- In the normal run order, that seeded page already has boxes using `FONT_A` (`:159`). The test sets `thought: FONT_A`. So if you deleted `defaults?.fonts.thought` from `apps/api/src/jobs/claim-inputs.ts:309`, the test would still pass. Only the `note` key is actually proven.
- Phase 3 says this claim test is mandatory, because it guards the risk that a custom font in a new slot silently falls back to the default font. So this gap matters.
- Fix: seed the data inside the test. Use a fresh user C with 2 custom fonts and `seedPage(C, ["Bangers-Regular"])`, so the boxes use no custom font. Then check each slot on its own: `{thought: C1}` → `[C1]`, then `{note: C2}` → `[C2]`. Also delete the comment "seeded by the previous test".

### Minor

**m1. The docs claim a parity rule that the worker does not follow** — `docs/typeset-layout-contract.md:73` (column "Slot trống (hoặc font không dùng được)")
- Web `fontForStyle` (`apps/web/src/features/editor/fonts.ts:83`) skips a slot font it cannot load and falls back to the font for the kind.
- Worker `font_for` (`worker/mtl_pipeline/typeset.py:207-209`) uses the slot id as-is. `fonts.font_path` then draws with Bangers, but the box keeps the missing id in `font_family`.
- Same behaviour as the existing narration slot, and rare: `routes/fonts.ts:145` blocks deleting a font that is a series default. Fix: either drop "hoặc font không dùng được" from the docs, or state that only the editor checks it.

**m2. "Loại chữ" can change the style while the font stays the same** — `apps/web/src/features/chapter/select-panel.tsx:34` + `editor/fonts.ts:191`
- `kit.knows` only returns true for custom fonts that have finished loading. If loading the user's fonts fails (the `catch` at `fonts.ts:176`) and the thought slot is a `custom-*` font, picking "Suy nghĩ" writes `region.style = "thought"` but sets the font to the dialogue font.
- To the user, nothing seems to change, and the region now disagrees with what the worker would have produced. Low priority: it only happens when font loading fails. One option is to show the slot font anyway (the canvas has a fallback family), or to disable the option when the slot font is not loaded.

**m3. The rule that hides the select has no test** — `apps/web/src/features/editor/panels/Properties.tsx:175`
- Phase 4 asked for a test: "series không slot → không render select". Only the pure `textStyleOptions` function is tested (`text-style-options.test.ts`).
- `Object.values(textStyle.slots).some(Boolean)` and the `region` guard at `:101` are not covered. Fix: move the guard into a pure function like `textStyleOptions` and test it.

**m4. Style parsing is only tested through Anthropic** — `worker/tests/test_llm_contract.py` (`test_anthropic_translate_keeps_style`)
- Phase 2 asked for Gemini and Anthropic. Both go through `parse_translate` (`providers/base.py:225`), so the risk is low. Adding the same case using the Gemini fixture would be cheap.

**m5. The `defaultFonts` type is written out twice** — `editor/fonts.ts:78` and `chapter/select-panel.tsx:50` both spell out `Partial<Record<"dialogue"|"narration"|"thought"|"note", string>>`. It should reuse `Series["default_fonts"]` / `FontSlot` (`series/api.ts:6`) so the two cannot drift apart when a slot is added.

### Missing plan deliverable (not code)

**P1. No report on how accurately the AI tags styles.** Phase 2's success criterion and phase 5 require running the CLI on 2–3 real chapters (KO + JA), counting thought/note regions, and checking 10 samples by eye. `plans/261102-1547-text-style-fonts/reports/` only has `phase-04-loai-chu.png`. The plan's open question about thought/note accuracy is still unanswered. Do this before deploy, because a prompt that over-tags thought/note will put the slot font everywhere.

## Checks requested

**(a) Acceptance criteria in plan.md**
- New translations carry `style`; `font_for` uses the slot font when set: yes (`test_style_font_slot_applies_and_normal_omits_key`).
- Old pages, jobs and payloads: yes, see (b).
- Editor changes the style, saves, and undoes in one step: yes. `setTextStyle` + the `apply` call with no merge key, and `actions.test.ts` checks the inverse patches. A manual screenshot exists.
- Custom fonts in the new slots are fetched by the worker: yes for translate. Export only has the `note` key proven (M1).
- Gates green: yes.
- The accuracy measurement is still missing (P1).

**(b) No regression for old data**
- Worker: `font_for(..., style="normal")` and missing slots fall back exactly as before (`typeset.py:197-210`, table test). `build_page_state` writes no `style` key when `styles` is missing or `normal` (`handlers.py:214-216`). Old payloads: `.get(...)` returns `None`, so the font follows the kind.
- API: the spreads at `enqueue.ts:276-277` add no key when a slot is unset, checked by `not.toHaveProperty` in `series.test.ts`.
- Web: no `style` means `normal`, and the select is hidden.
- The only output that changes is CLI `state.json`, which now includes `"style":"normal"` in `translations` (`pipeline.py` dumps the whole `TranslateItem`). That file is a bench/CLI artifact, not a contract, so this is acceptable.

**(c) Public contract changes**
- Changed: `Region.style` (optional enum) and `TranslateSettings.thought_font`/`note_font` (optional).
- `OcrRegion` deliberately omits `style` (`page-state.ts:119-125`).
- The regenerated schemas match the zod definitions: the contract test is green and `job-result` adds `style` in both places that embed Region (page state and the `page.ocr_region` result). The worker never emits `style` for `ocr_region`.
- `MIN_PIPELINE_VERSION` is 0.8.0, and the e2e and test worker versions are bumped. No `0.7.1` strings are left except in comments.

**(d) Worker / web parity**
- Same order on both sides: slot of the style, else `text_free` → narration (empty → dialogue), else dialogue.
- Only difference: the web checks whether a font is usable and the worker does not (m1, m2).
- The rule tables in `test_typeset_fit.py` and `fonts.test.ts` match.

**(e) Undo, rebase and autosave**
- `setTextStyle` is one undo step. It deletes the key for `normal`. A box without a region does nothing (tested).
- Rebase can leave `style: undefined` in memory. I checked that this is harmless:
  - `same()` (`rebase.ts:34-42`) counts keys, but it only compares whole entities for add/remove ops.
  - No action removes regions.
  - `diffStates` compares field by field, and `undefined === undefined`.
  - The dirty check is identity-based (`save.ts:117`).
  - JSON drops the key when the state is PUT.
- Remaining risk: if a future action removes regions, the rebase remove path would report a false `removed_but_changed` conflict. It does not need a fix now.

**(f) Test isolation:** confirmed and made worse by the masking described in M1. Fix as described there.

**(g) Series PATCH replaces `default_fonts` wholesale**
- The web form sends the whole object: `toForm` copies `s.default_fonts` and `setFont` spreads `f.default_fonts` (`series-settings-form.tsx:66,110`), so `sfx`, `thought` and `note` survive.
- Old cached SPA bundles also spread the whole object, so they keep the new keys too.
- `assertKnownFonts` checks every value, and `translationChanged` bumps `settings_rev` when the fonts change.

**(h) Patterns and lint:** follows the existing narration-slot pattern, the version comment conventions, and the immer recipe and Properties fieldset (`disabled={readOnly}` covers the new select). No new type or lint errors. Docs are updated (deployment order, editor, job queue, typeset contract).

Note: `applyRegionTranslation` (`actions.ts:126-151`) keeps the user's `region.style` and does not take the AI's new one. This matches its rule of keeping the user's box styling, so it is not a defect.

## Recommended actions
1. Fix M1: give the export test its own seed data and assert each slot alone.
2. Run the accuracy measurement (P1) and write it to `plans/261102-1547-text-style-fonts/reports/` before deploy.
3. Fix the docs wording (m1). Optionally handle m2, m3, m4, m5.

Status: DONE_WITH_CONCERNS
Summary: The feature is correct and all gates pass; old data behaves the same, contract changes are only the intended ones, and the undo, rebase and save paths are fine. Main problem: the export claim test fails when run alone and does not prove the `thought` slot is included (major). The phase-2 accuracy measurement has not been done.
