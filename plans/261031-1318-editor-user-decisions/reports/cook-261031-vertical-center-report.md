# Bug #8 - vertical centering of text boxes

Commit: 0f96567 `feat(typeset): vertical centering for text boxes, new boxes centered by default` (branch feat/editor-user-decisions).

## Why this design
- Per-box optional `valign: "top" | "middle"`; missing = top everywhere. Old saved boxes (no field) compute dy = 0, so editor
  render and worker export of old chapters are pixel-identical (golden test_render_lines untouched and green).
- New boxes write `"middle"`: web `newTextBox` (covers drawn box + OCR-region insert), worker `typeset_region`.
  `_text_box_to_shared` always writes valign. No other TextBox creators exist in web/worker/api (grepped).
- Formula (editor `verticalOffset`/`linePlacements`, worker `vertical_offset`/`layout_lines`):
  blockH = asc+desc+(n-1)*step; dy = middle ? max(0,(h-2*pad-blockH)/2) : 0; baseline_i = y+pad+dy+asc+i*step.
  Clamp keeps overflow behavior (text stays glued to top edge, never pushed up).
- Style field like `align`: `BoxStyle` includes valign; "Ap kieu nay" copies `valign ?? "top"` (explicit top so a middle target is reset);
  rebase/conflict is generic per-field so valign merges like align (LINE_INPUTS unaffected: valign does not change `lines`).
- API: zod PageState keeps valign through PUT/GET (test); invalid value -> 400.

## Files
- shared: packages/shared/src/page-state.ts (+ regenerated json-schema/*.json via `pnpm schema:emit`)
- web: editor/measure.ts, actions.ts, canvas/ChapterCanvas.tsx (textarea paddingTop = pad+dy), panels/Properties.tsx
  (new "Can doc" Tren/Giua toggle; aria-labels "Can doc: sat mep tren / giua khung" to avoid clashing with align "Giua"),
  chapter/chapter-workspace.tsx (apply style)
- worker: mtl_pipeline/render.py, schema.py, typeset.py, mtl_worker/handlers.py
- gate: scripts/typeset-parity.ts, apps/web/e2e/typeset-parity.spec.ts, fixtures/typeset-parity.json
- version: worker PIPELINE_VERSION 0.7.1, API MIN_PIPELINE_VERSION default 0.7.1, test constants, docs/deployment-guide.md note
- docs: typeset-layout-contract.md (TextBox table + rule 3), editor.md (toggle)

## Parity gate notes
- The spec drew each line alone; it now takes baselines from the editor's `linePlacements` (so editor valign is really exercised),
  then draws that line top-aligned at the matching y. Before this, a self-computed dy would have hidden an editor bug.
- Generator: boxes mix no-field / explicit top / middle (>= 10 middle asserted), spare height >= 60px (dy > 0), plus 1-line overflow
  boxes (clamp). Result: 74 lines, max diff 1px, 0 over threshold.
- Pre-existing drift fixed: generator read the font list from the manifest; fonts added since (ShantellSans-Variable etc.) made
  HEAD's `--check` fail and variable fonts exceed 1px (2px diff on ShantellSans). Font list pinned to the 9 fonts the fixture
  was validated with. Adding fonts to the gate now needs a deliberate, measured edit.

## Tests red -> green
- measure.test "valign middle ...": red (expected 20 close to 41) without measure.ts change; green with.
- test_render_lines valign x3: red (3 failed) without render.py change; green.
- parity e2e: with old measure.ts -> 24 lines over threshold, max 32px; with change -> 0 over, max 1px.
- also: shared zod (optional/enum), actions (newTextBox middle, setStyleMany valign), test_typeset_fit (typeset_region middle),
  API page-state round trip, e2e editor "vertical alignment toggle ..." (toggle saves valign; apply-style propagates to other page).
- Runs: pnpm typecheck OK, pnpm lint OK, pnpm test OK (web 299, api 315, shared 38, db 5), worker pytest 267 + ruff OK,
  `node scripts/typeset-parity.ts --check` OK, full Playwright 44 pass / 1 flaky (upload-chapter, passes alone 4/4, unrelated).

## Open items / product questions
- Migrate old boxes to middle? Not done (keeps old exports identical). Option: an explicit "Can giua cho ca chuong" action or bulk
  "Ap kieu" (already works per kind). User decision.
- Pipeline bump: new API requires worker >= 0.7.1 (426 otherwise). Deploy worker first. See Review fixes: an old worker would FAIL
  export (strict schema), so do not lower MIN_PIPELINE_VERSION.
- Inline edit overlay uses committed `lines` for dy while typing; text re-centers on commit (minor).
- Dev worker needs restart to pick up 0.7.1 (see below).

## Review fixes
1. Bump rationale corrected (env.ts, worker `__init__.py`, deployment-guide, README:141 -> 0.7.1): a worker < 0.7.1 validates export
   inputs against `additionalProperties: false` (runner.py), so export jobs FAIL on states with valign; they do not export top-aligned.
   Earlier "rollback possible / silent top-align" claim in this report was wrong. Rollback note: keep workers >= 0.7.1, or strip
   valign from page_states.state / ai_state / page_state_history.state before going back to 0.7.0.
2. Parity gate now measures every manifest font (generator = manifest minus `EXCLUDED_FONTS`, >= 2 boxes per font; 34 fonts ->
   17 pages, 127 lines, max diff 1px, 0 over). Only `ShantellSans-Variable` fails (2px on both sample boxes): excluded with the
   measured delta and listed in docs/typeset-layout-contract.md ("Font chua dat gate"); "Them font" step rewritten (new font
   enters the gate automatically; failing font goes into EXCLUDED_FONTS + the table). No layout code changed for it.
3. `setStyle` skips writing valign when `(b.valign ?? "top")` already equals it (no patches -> no save, no undo step, "da cung kieu"
   toast for old chapters). Unit test: setStyleMany top on old boxes -> no patches; middle twice -> no patches.
4. Overlay textarea: paddingTop/Right/Bottom/Left set separately (no `padding` shorthand).
5. Overlay dy computed from `drawnBox(box, kit)` (new export in TextBoxNode.tsx, also used by `drawBoxText`), i.e. the re-wrapped
   box the canvas draws when `lines` is empty.
Checks: typecheck, lint, pnpm test (web 304, api 316, shared 38), worker pytest 267, parity --check, parity e2e, editor e2e.

### Review fixes, round 2 (re-review of 0cc477a)
- A. `wrapBox` now keeps the font (and valign) of box i, so every gated font really has >= 2 boxes. valign rule: first round of fonts
  is always middle, later rounds mix explicit top / no field -> every font has >= 1 middle box regardless of FONTS.length parity.
  Fixture carries `excluded_fonts`; the parity spec asserts per manifest font (minus excluded) >= 2 boxes and >= 1 middle box.
  Result 122 lines, max 1px, 0 over; `--check` OK.
- B. Rollback in deployment-guide: ordered steps (lower MIN_PIPELINE_VERSION, roll back web/API, SQL, start 0.7.0 worker), three
  full UPDATE statements with WITH ORDINALITY + ORDER BY and a `@?` WHERE filter, labelled untested / run in a transaction.
- C. `relayout` assigns `lines` / `font_size` only when different (red before: new unit test failed with old code; green now).
  Re-applying a style boxes already have gives no patches -> no PUT / version bump. Editor e2e (18) incl. Ap kieu flows green.
- D. Overlay computes `drawnBox` once; font, lineHeight and dy all use its font_size.
Checks: typecheck, lint, web unit 307, parity --check + e2e, editor e2e 18 passed.
