# Code Review — Phase 3 manga grid (web)

Score: **7/10** before fixes (8.5/10 after) · Critical: **0** · High: 1 (fixed) · Medium: 1 (fixed) · Low: 6

## Scope
- Files: `apps/web/src/features/home/{home-page.tsx,home.css,cover-image.tsx}`, `apps/web/src/features/series/{series-page.tsx,series-settings-form.tsx,api.ts,cover-section.tsx}`, `apps/web/e2e/series-manage.spec.ts`
- LOC: about +320 / −210
- Spec: `plans/261116-1129-folder-drop-and-manga-grid/phase-03-web-manga-grid.md`

## Gates (after the fixes)
- `pnpm typecheck` passed · `pnpm lint` passed (498 files) · `pnpm --filter @mtl/web test` passed: 552/552 in 60 files
- e2e `series-manage` + `upload-chapter`: 15/15 passed (run before and after the fixes)
- `block-panel.spec.ts:317` fails at `expect(blockPanel(page)).toBeHidden()` (line 339). That is the canvas editor, and this diff touches no shared file there, so the failure was already present and is unrelated.
- Scratch Playwright probes (outside the repo, real API + Vite) confirmed both fixed bugs. A control run without each fix reproduced the bug.

## High (fixed)
**H1. A chapter thumbnail went back to the placeholder once ingest finished.**
`CoverImage` remembered only the last src that failed, and a successful load never cleared it. The chapter status is
`draft` for the whole upload, not `ingesting`. `ingesting` starts only after the commit, when every file is uploaded.
So the actual sequence is:
1. Plain src returns 404 while uploading, so `failedSrc = plain`.
2. Status becomes `ingesting`, src gets `?s=ingesting`, and the image loads.
3. Status becomes `processing`/`prepared`, src is plain again, `failedSrc === src`, and the placeholder stays until a remount.

This broke the success criterion "placeholder → ảnh khi upload xong". The implementer had ticked it, but it held only
while the status was `ingesting`.
The probe saw the img disappear in step 3 without the fix and stay with it.
Fix (`cover-image.tsx`): `onLoad={() => setFailedSrc(null)}`. A successful load clears the old failure, so going back to a src that failed earlier tries again. The only cost is one image request per status change, never per 5s poll.

## Medium (fixed)
**M1. The delete confirm cut off the start of the question for long series names.**
`.card-confirm` used `justify-content: center` together with `overflow-y: auto`. When the content was taller than the card, it overflowed above the top, where you cannot scroll. Measured with a 200-character title (titles can be up to 200): the text started 14–22 px above the overlay at 375, 700 and 1280 px, with `scrollTop` = 0.
Fix (`home.css`): remove `justify-content: center` and center with `margin-top/bottom: auto` on the first and last child. The probe now measures `textTop ≥ boxTop` at all three widths.

## Small fixes also applied
- `api.ts`: the doc comment for `deleteChapter` ("Xoá hẳn chương…") had ended up above `uploadSeriesCover`. Moved it back.
- `cover-section.tsx`: clicking "Dùng ảnh tự động" after a failed upload left the stale upload error on screen, or hid the reset error, because `error = upload.error ?? reset.error`. The button now calls `upload.reset()` first.

## Low (reported, not fixed)
1. `uploadSeriesCover` copies the error handling of `api()` but skips `onSessionLost`. A 401 during a cover upload does not trigger a session refetch; the next normal query does. Option: export a multipart variant from `lib/api.ts`.
2. The client checks the type with `file.type`. A valid file with an empty MIME type (some OS/extension setups) is refused on the client even though the server checks the content. Option: also accept by extension when `type === ""`.
3. Home series card: `cover_src` never changes, so a cover that returned 404 on first view (series created by a drop, still uploading) keeps the placeholder until the card remounts. This is the same failure memory as H1, and nothing on home ever changes the src.
4. While the confirm overlay is open, the covered card link and the Sửa/Xoá icons can still be reached with Tab, so focus becomes invisible. The old rows replaced the buttons. Option: `inert` on `.card-open` and `.card-actions` while confirming.
5. No unit test for `withStatus` (`?`/`&` joining), `initialOf` or the `CoverImage` retry logic, and no e2e for `CoverSection` (upload / error / reset). The probes covered these by hand; a short spec would stop them regressing.
6. API side (phase 2, informational): the thumb URL `/api/thumbs/:fileId` does not change when `trim` changes, but the storage key does. With a 10-minute cached 302 and an unchanged React src, the grid shows the old crop until reload.

## Acceptance check (spec)
| Item | Result |
|---|---|
| Grid `auto-fill minmax(150px,1fr)`, 2 columns ≤480px, no horizontal scroll | OK (checked at 375 in e2e and the probe) |
| `loading="lazy" decoding="async"`, width/height + `aspect-ratio: 3/4`, `object-position: top` | OK |
| src stable across polls; `?s=` only for `ingesting`, `?`/`&` joined correctly | OK (polling probe: 3 thumb requests in total, no reload per poll) |
| CoverImage tries again when src changes; placeholder shows the first letter / "Ch.N" | OK, after the H1 fix |
| Link accessible name (series: text content; chapter: `Mở chương N`), icon `aria-label`s, focus ring (global `:focus-visible`, offset −2px inside `overflow:hidden`), `data-series`/`data-chapter` kept | OK |
| Tokens only, no hard-coded colors | OK (all tokens exist in `styles/tokens.css`) |
| Removed CSS unused | OK (grep found no use of `row-item/row-open/row-name/row-count/ch-*/row-progress/delete-confirm`; `.rows` still appears in glossary-editor `rows-empty rows`, but the border moved to `.rows-empty`, so it looks the same) |
| Cover section: accepts png/jpeg/webp, invalidates list + detail, errors shown inline, double submit blocked (buttons disabled while busy; hidden input opens only from the button) | OK (probe: server 400 shows "không đọc được ảnh", client gif error, upload then reset shows the auto label) |

## Preserved behaviors (old rows vs new cards)
- `nextAction`/`needsWork` state + tone logic, `title={a.detail}`, `timeAgo`: unchanged.
- Sửa leads to `?tab=settings`. The probe clicked it and checked the URL.
- Xoá shows the confirm in place, with `autoFocus` on confirm and Huỷ restoring the card. The DeleteSeries/ChapterConfirm components are reused; only the class changed.
- `data-drop` + `useDropTarget` stay on the card root, only for `kind === "resume"`. The resume e2e passes.
- The progress bar shows when `tone === "busy"`, which includes uploading. It moved inside the cover.
- Search box, "+ Series", drop strip, confirm-row position: unchanged.
- No nested interactive elements: `.card-actions` is a sibling of `<Link>`, not a child, so clicking Sửa/Xoá does not navigate. `<a>` wrapping `<div class="cover">` is valid HTML5 (transparent content model, parent is a div).

## Recommended next actions
1. Optional: Low 4 (`inert` while confirming) and Low 5 (unit tests for `withStatus`/`CoverImage`, e2e for the cover section).
2. Low 3: consider `?s=` / remount on home if users report placeholders that stay after a drop.

## Unresolved questions
- Low 6 (stale thumbnail after a trim change) belongs to the API contract from phase 2. Should the URL carry a trim/rev version?
