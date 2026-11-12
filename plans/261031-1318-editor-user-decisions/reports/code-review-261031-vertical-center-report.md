# Code review: 0f96567 vertical centering (valign)

## Scope
- Commit 0f96567 (31 files, +403/-126). I reviewed the commit with `git show`, not the working tree (another agent is editing it).
- Checks I ran: `node scripts/typeset-parity.ts --check` OK, worker `test_render_lines.py` + `test_typeset_fit.py` 30 passed,
  vitest `measure.test.ts` + `actions.test.ts` 22 passed.
- Red check: I rebuilt the commit's worker in the scratchpad with the pre-commit `render.py` (still copying the valign field).
  `test_layout_lines_valign_middle_shifts_block_by_half_the_spare_height` FAILS there, so the worker test does catch a missing dy.

## Overall
The layout code is correct. The formula matches on both sides: `blockHeight` matches `block_height`, there is no rounding on
either side, the `max(0, …)` clamp is the same, and dy is added once at the top (`top = pad + dy`). It also works with rotation:
the rotated layer is h + 2·margin tall and dy ≤ (h − blockH)/2.
Overflow detection (`overflowAxes`) and fitting (`fit_text`, `ensure_lines`, `relayout`) correctly ignore dy.
Missing valign means top: `text_box_from_shared` sets `d.get("valign") or "top"`, the golden test is unchanged, and the zod
field is optional.
valign survives every copy path: duplicate (`structuredClone`), the "Áp kiểu" style copy, rebase (diffs every key of both
boxes), immer undo, the API PUT/GET round trip, and find/replace and ignore-apply (both spread the box).
Leaving valign out of `LINE_INPUTS` is correct. Box creators: `newTextBox` (drawn box and OCR-region insert) and
`typeset_region` write middle. `typeset_region` already makes h fit the text block (h = text_h), so AI boxes look the same at
creation (dy ≈ 0) and only re-center after an edit.

The problems are in the rationale for the version bump and its rollback advice, and in how much the parity gate covers.

## Findings (ranked)

### Medium 1: the reason given for the version bump is wrong, and so is the rollback advice
- Files: `apps/api/src/env.ts:39`, `worker/mtl_worker/__init__.py:13`, `docs/deployment-guide.md:188`, and the cook report
  section "Pipeline bump … Rollback of the bump is possible (nothing but export fidelity depends on it)".
- What they claim: an old worker ignores `valign` and exports centered boxes top-aligned.
- What actually happens: the worker checks inputs against the JSON schema (`worker/mtl_worker/runner.py:306`), and
  `text-box.schema.json` sets `additionalProperties: false`. `claim-inputs.ts` passes the stored state to export unchanged.
  So a 0.7.0 worker hits a ContractError and the export job fails (`JobFailure("internal", "hợp đồng…")`, which uses up
  attempts). It does not silently export top-aligned.
- Failure scenario: an operator follows the report and rolls back `MIN_PIPELINE_VERSION`, or the whole API, while a 0.7.0
  worker is still running. Every export of a chapter with any box created after deploy then fails.
- Fix: correct the comments and the doc note. The bump itself is required, and more strongly than the commit says. Add a
  rollback note: keep workers on 0.7.1 or newer (0.7.1 also reads data without valign), or remove `valign` from
  `page_states.state` / `ai_state` / history with SQL before going back to a 0.7.0 worker.

### Medium 2: the parity gate now covers 9 of 34 bundled fonts, with a known failure hidden
- Files: `scripts/typeset-parity.ts:14-28`, `docs/typeset-layout-contract.md:89-91`.
- The font list is now fixed in the script. Users can pick 25 bundled fonts that have no editor-vs-export parity check,
  including WildWords, AnimeAce, KomikaText and BlambotClassic, the standard scanlation fonts.
- ShantellSans-Variable has a measured 2px difference, over the 1px contract limit. The commit leaves it out instead of
  recording it. Effective coverage did not shrink: the fixture was already stale after c3d09fe, so `--check` was failing and
  the e2e test only checked these 9 fonts. But the gap is now permanent and invisible.
- The "Thêm font" step in the contract doc still ends with `node scripts/typeset-parity.ts`, which no longer picks up a new
  font.
- Failure scenario: a user picks WildWords or ShantellSans, and the exported text is shifted 1–2px or more from the editor,
  with no test to catch it.
- Fix: keep a fixed list so the fixture stays stable, but measure the remaining fonts and add them. List the fonts that exceed
  the limit, with their measured difference, in the contract doc as a tracked follow-up. Change the "Thêm font" step to "add the
  id to FONTS in scripts/typeset-parity.ts, regenerate, run the e2e parity test".

### Low 3: "Áp kiểu" and the "Trên" button create changes with no visible effect on old boxes
- Files: `apps/web/src/features/chapter/chapter-workspace.tsx:573` (`valign: valign ?? "top"`), `actions.ts` `setStyle`
  (`Object.assign`), and the `Properties.tsx` "Trên" button.
- Failure scenario: on a chapter saved before this change, applying a style from an old box whose other style fields already
  match still adds `valign: "top"` to every same-kind box. immer treats the new key as a change. Every page is PUT and its
  version bumped, and the user sees "Đã áp kiểu cho N khối" instead of "đã cùng kiểu". It also creates a batch whose undo can
  skip pages as "edited". Clicking the already-active "Trên" on an old box adds an undo step and a save that change nothing.
- Fix: in `setStyle`, skip writing valign when `(b.valign ?? "top") === style.valign`. Alternatively, have the style copy leave
  out `valign` when both source and target resolve to the same value.

### Low 4: the text-edit overlay mixes `padding` and `paddingTop`
- File: `apps/web/src/features/editor/canvas/ChapterCanvas.tsx:412-414`.
- For a middle box, `pad + dy = (h − blockH)/2`, which does not depend on pad. If a re-render changes only `pad` (for example
  a remote update or rebase while the textarea is open), React updates `padding` and skips `paddingTop` because it is
  unchanged. `padding` resets padding-top to pad·k, so the text jumps to the top. React DEV also logs a shorthand/longhand
  collision warning.
- Fix: set `paddingLeft`, `paddingRight` and `paddingBottom` (= pad·k) and `paddingTop` (= (pad + dy)·k) separately, with no
  `padding` shorthand.

### Low 5: the overlay's dy can differ from the canvas when `lines` is empty
- File: `ChapterCanvas.tsx:414`.
- `verticalOffset(box, …)` uses `box.lines.length` and `box.font_size`. `drawBoxText` instead draws `kit.layout(box)` when
  `lines` is empty, which happens after find/replace or after rebase `syncLines` sets `[]`. With auto_fit the font size may
  also differ.
- Failure scenario: the user double-clicks such a box and the textarea text sits lower or higher than the canvas text while
  typing. This is cosmetic and goes away on commit.
- Fix: compute dy from the same `drawn` box that `drawBoxText` uses (`kit.layout(box)` when lines are empty).

### Low 6: README release checklist is out of date
- File: `README.md:141` still says worker 0.7.0 / `MIN_PIPELINE_VERSION` 0.7.0.

## Info
- The 426 gate is checked at claim time, so an old worker stops processing every job type, not only export. This follows the
  project's earlier bumps. Both the Mac worker and Modal must be updated. Modal copies `json-schema` into the image when
  `modal deploy` runs, so it needs a redeploy.
- If the worker is deployed before the API (as documented), the old API's zod (`z.object` strips unknown keys) drops valign
  from AI results during that window. Those boxes are saved without valign (top) and render the same in editor and export.
  No action needed.
- The e2e fake worker and API test helpers report 0.7.1, matching the default `MIN_PIPELINE_VERSION`.
- The parity spec now takes baselines from the real `linePlacements` and compares them with render.py ink boxes, so it tests
  the editor's dy rather than its own copy. It includes ≥ 10 middle boxes (asserted) and 1-line overflow boxes that are
  clamped to dy = 0.

## Recommended actions
1. Correct the bump rationale and the rollback guidance (Medium 1).
2. Decide what the gate should cover. At minimum, record the fonts left out or failing, and fix the "Thêm font" doc step
   (Medium 2).
3. Make the valign write a no-op when the value resolves to the same thing (Low 3), and switch the overlay to explicit
   padding longhands (Low 4).

## Unresolved questions
- Should the 25 unchecked bundled fonts be measured now, or tracked as a known gap? This is the owner's call. If any of them
  is a default font for a language, that raises the priority.

---

# Re-review 0cc477a (fixes for the findings above)

## Scope
- I reviewed `git show 0cc477a` (12 files). The working tree `ChapterCanvas.tsx` has other uncommitted edits, so I read that file
  only from the commit. The other reviewed files match the commit.
- Checks I ran: `node scripts/typeset-parity.ts --check` printed "fixture khớp". Vitest `actions.test.ts` 12 passed. `biome check`
  on actions.ts, TextBoxNode.tsx and typeset-parity.ts was clean. I did not run Playwright, as instructed. The cook report says the
  parity e2e passed: 127 lines, max 1px, 0 over the limit. The fixture also has 127 expected lines.
- Empirical check: in immer, assigning an array with equal contents (as `relayout` does with `box.lines = r.lines.map(nfc)`)
  produces a `replace` patch and a new state.

## Status of the earlier findings
- **Medium 1, bump reason and rollback**: fixed in env.ts, worker `__init__.py`, deployment-guide and README (0.7.1). The reason
  is now correct: the strict schema makes the export fail. The rollback SQL is incomplete; see Low B.
- **Medium 2, gate coverage**: mostly fixed. The gate now has 33 of 34 fonts (manifest minus `EXCLUDED_FONTS`). ShantellSans is
  listed in the doc table with its 2px measurement, and the "Thêm font" step is fixed. The claim of "≥ 2 boxes per font" is
  false; see Low A. The fixture is 81 KB, 17 pages and 68 boxes, and `--check` takes under a second. Size and runtime are fine.
- **Low 3, valign no-op**: fixed for the Properties "Trên"/"Giữa" buttons. A patch of only `{valign}` that resolves to the
  current value now produces no patches, so no undo step and no save. It does not affect other style fields: `rest` is still
  assigned, and `Object.keys(style)` still decides whether to relayout. It does not change Áp kiểu counts or messages either,
  because Áp kiểu always includes `font_family`/`line_height`/`pad`, so `relayout` runs and always writes a new `lines` array
  (see Low C). The Áp kiểu part of my earlier Low 3 assumed the "đã cùng kiểu" message could be reached. It cannot.
- **Low 4, padding longhands**: fixed. All four sides are set separately with no shorthand.
- **Low 5, overlay dy when lines are empty**: dy now comes from `drawnBox`. The textarea's font and line height still use the
  stored `font_size`; see Low D.
- **Low 6, README**: fixed.
- **`drawnBox` vs canvas**: the expression is the same one `drawBoxText` had inline, and `drawBoxText` still uses `drawn` for
  the font size and line placements. Canvas drawing is unchanged.

## Findings (ranked)

### Low A: "each font ≥ 2 boxes" is false; 12 of 33 fonts get 1 box and 6 get no middle box
- Files: `scripts/typeset-parity.ts:51,74,91`, `docs/typeset-layout-contract.md:91`.
- Cause: `PAGES` assumes fonts are spread evenly over `i % FONTS.length`. But `wrapBox(i)` builds `plainBox(i + 1)`, so every
  box at `i % 5 === 4` takes the next box's font. Fixture counts: 14 fonts have 3 boxes, 7 have 2, and 12 have 1 (including
  WildWords-BoldItalic, KomikaText, BlambotClassic, Baloo2-Variable). WildWords, KomikaText, BlambotClassic, SedgwickAve,
  MTOChiller and BeVietnamPro-Bold have no `valign: middle` box. This matters because dy depends on each font's
  ascent/descent through `blockHeight`.
- Scenario: a font's metrics in the editor drift from Pillow's only for middle boxes. Its only box is a top box, so the gate
  passes while the doc says the font is covered. Whether a font gets a middle box also depends on `FONTS.length` being odd
  (`i % 2`), so adding one font can silently change it.
- Fix: in `wrapBox`, keep the font of `i` (`font_family: FONTS[i % FONTS.length]`), which gives every font at least 2 boxes.
  In the spec, assert that each manifest font (minus the exclusions) has at least 2 boxes and at least 1 middle box, so the
  doc's claim is tested.

### Low B: the rollback SQL sketch is incomplete
- File: `docs/deployment-guide.md:191-193`.
- (1) The steps are not stated. Going back to a 0.7.0 worker also requires lowering `MIN_PIPELINE_VERSION` and rolling back the
  web/API, or otherwise stopping valign writes, before the UPDATE. Otherwise the next save or Áp kiểu adds valign again and
  exports fail again.
- (2) `jsonb_agg(b - 'valign')` has no `ORDER BY`. Array order is the boxes' draw order and the order the user sees. Postgres
  keeps it in practice but does not guarantee it. Use
  `jsonb_array_elements(...) WITH ORDINALITY e(b, i)` with `jsonb_agg(b - 'valign' ORDER BY i)`.
- (3) There is no WHERE clause, so it rewrites every row in all three tables, including `page_state_history`, which only
  grows. Add `WHERE state @? '$.text_boxes[*].valign'`.
- (4) `UPDATE ...` is a placeholder used for 3 tables and 2 columns (`state`, `ai_state`), but the text does not say it is a
  sketch. Write out the 3 statements in full, or label it "sketch, untested, run inside a transaction".
- The tables and columns named are correct (`page_states.state`, `page_states.ai_state`, `page_state_history.state` in
  `packages/db/migrations/0000_init.sql`). Export inputs are built when a worker claims the job, so queued jobs do not need
  changes.

### Low C (existed before this commit, not a regression): Áp kiểu can never report "đã cùng kiểu"
- Files: `apps/web/src/features/editor/actions.ts:25-29` (`relayout`), `chapter-workspace.tsx:599-612`.
- `relayout` always assigns a new `lines` array, so immer marks every same-kind box as changed. Applying the same style again
  PUTs every page with a box of that kind, bumps their versions, and creates a batch whose undo can skip pages as "edited". The
  `!r` message only appears when the chapter has no other box of that kind. The counts are also per-page totals, not boxes
  that actually changed.
- Fix: in `relayout`, assign only when the value differs, e.g.
  `if (!sameLines(box.lines, next)) box.lines = next; if (box.font_size !== r.font_size) box.font_size = r.font_size;`.
  Optionally, count the boxes that changed. This would also make resizing a box to the same size produce no change.

### Low D: the overlay's font size and line height still differ from the canvas for auto_fit boxes with empty lines
- File: `ChapterCanvas.tsx:411-412` at 0cc477a.
- dy is computed from `drawnBox(...)`, which uses the fitted `font_size`. The textarea's `font` and `lineHeight` still use the
  stored `box.font_size`. Scenario: an auto_fit box after find/replace (lines are `[]`) is drawn at the fitted size. When the
  user double-clicks it, the textarea text appears at the old size. This is cosmetic and goes away on commit.
- Fix: `const d = drawnBox(box, kit)` once, and use `d.font_size` for `font`, `lineHeight` and `verticalOffset`.

## Info
- `EXCLUDED_FONTS` and the doc table are kept in sync only by a comment, not a test. That is acceptable at 1 entry.
- The cook report says "34 fonts -> 17 pages". The gate actually covers 33 fonts, since one is excluded.
- `typeset-parity.spec.ts:71` still has its own copy of the `drawnBox` condition. It could import `drawnBox` instead.

## Verdict
No Critical, High or Medium issues. The earlier Mediums are fixed except for the documentation gaps in Low A and Low B.
Merge-safe. Low A and Low B are worth a quick follow-up.
