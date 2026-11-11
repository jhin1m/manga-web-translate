# Phase 3 report: API memory + suggestions

## Files
- new: `apps/api/src/lib/series-memory.ts`, `apps/api/src/routes/series-suggestions.ts`, `apps/api/test/series-memory.test.ts` (14 cases)
- edit: `apps/api/src/jobs/translate-chain.ts` (carry = lastCarry ?? memoryCarry; header doc), `apps/api/src/jobs/queue.ts` (chapter.translate calls `rememberTranslate` before refreshChapter; imports seriesOf), `apps/api/src/app.ts` (register route), `apps/api/test/tenant-isolation.test.ts` (seed + 2 RESOURCE_CASES + PATCH body)

## Commands
- `pnpm --filter @mtl/api test`: 58 files, 557 passed, 1 skipped (incl. untouched translate-chain.test.ts)
- `pnpm typecheck`, `pnpm lint`: clean

## Full-run detection (how runTarget/runTotal are set)
- `openRun` (startTranslateRun / translatePrepared / retranslate / rescanPages / retryFailedPages): `runTarget='translated'`, `runTotal = pageIds.length`. Retranslate with no page_ids or all ids -> runTotal = all non-skipped pages -> full. Subset -> runTotal < count -> partial.
- Ingest with target translated (`createIngestedPages`): `runTotal = inserted.length` = all pages -> full. Covered by tests (helper ingests with target translated).
- `translatePrepared` / `retryFailedPages` use only the prepared/failed subset, so they count as full only if that subset is all pages. Intended.
- Memory write also needs `result.carry`; `runTarget` read from the chapter row locked in the same tx.

## Deviations
- `rememberTranslate` signature `{job, ch, s, result}` as planned; `queue.ts` keeps the `lockChapter` return value (`lockedChapter`).
- Pronoun filter: speaker/listener containing "?" (not just exact "?"), address exactly "?", speaker == listener after normKey.
- Extra test: deleted/unknown source chapter -> `chapter_number: null`; full retranslate via route writes memory; 400 on non-boolean PATCH body.
- Cap test also checks that dismissing one frees a slot (cap counts only non-dismissed).

## Route shapes (mounted under `/api`, user session, scoped sdb)
`GET /api/series/:seriesId/suggestions` -> 200
```
{
  terms:    [{ id: string(uuid), source: string, target: string, kind: "person"|"place"|"term",
               chapter_number: string|null, created_at: string(ISO) }],
  pronouns: [{ id: string(uuid), speaker: string, listener: string, address: string,
               chapter_number: string|null, created_at: string(ISO) }]
}
```
- `chapter_number` is the `chapters.number` numeric as string (same as `number` in series chapter list), null when source chapter deleted.
- Hides dismissed and covered (glossary incl. shared same-pair, pronoun_rules); sorted by created_at, id. Other user's series -> 404.

`PATCH /api/series-suggestions/:suggestionId` body `{ dismissed: boolean }` -> 200 `{ id: string, dismissed: boolean }`; false = undo; non-boolean -> 400; other user's -> 404.

## Notes for web
- Accept term: POST `/api/series/:id/glossary` with note "" ; matching is by normKey(source) (NFC, trim, collapse spaces, lowercase), so suggestion disappears on next GET.
- Accept pronoun: add rule to `pronoun_rules` and PATCH series; hidden by normKey(speaker)->normKey(listener).
