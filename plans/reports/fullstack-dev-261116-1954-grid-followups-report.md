# Grid follow-ups report

1. Thumb URL versioned by trim: `first-pages.ts` selects trim top/bottom (COALESCE 0) in both LATERAL queries; `thumbUrl(fileId, top, bottom)` -> `/api/thumbs/{id}?t={top}-{bottom}`. Route ignores query. `withStatus` already joins with `&`. Tests: series-cover updated + new trim-change test; thumbs test for `?t=` -> 302.
2. Cover upload 401: `uploadSeriesCover` now uses `api()`; `lib/api.ts` `api()` now accepts FormData body (no JSON stringify, no content-type) so onSessionLost + ApiError apply. 400/413/422 messages unchanged.
3. `coverFileError` skips MIME check when `file.type` is empty; `accept` kept.
4. Home cover retry: auto cover (not `cover_custom`) src = `withStatus(cover_src, "{chapter_count}-{latest status}")`; stable across polls, changes only on progress; null stays null.
5. `inert={confirming}` on `.card-open` and `.card-actions` (home + chapter cards); confirm button already `autoFocus`.

Deviation: touched `apps/web/src/lib/api.ts` (not on list) - needed for item 2.
Gates: api 762 pass, web 552 pass, typecheck, lint clean; e2e series-manage + upload-chapter 15/15.
