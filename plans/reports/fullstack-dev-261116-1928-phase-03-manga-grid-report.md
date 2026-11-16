# Phase 3 report - manga grid (web)

## Files
- New: apps/web/src/features/home/cover-image.tsx (CoverImage, initialOf, withStatus), apps/web/src/features/series/cover-section.tsx
- Modified: home/home-page.tsx (SeriesGrid/SeriesCard), home/home.css (grid, card, cover, cover-section; old row/ch CSS removed), series/series-page.tsx (ChapterCard), series/series-settings-form.tsx (CoverSection after title), series/api.ts (uploadSeriesCover, resetSeriesCover), e2e/series-manage.spec.ts
- infra/selfhost-smoke.mjs and QA scripts: no uses of the old selectors (grep clean).

## Selector changes
- .row-item[data-series|data-chapter] -> .card[...] (data-series / data-chapter kept)
- .row-name -> .card-name, .row-open .grow -> .card-state-text, .row-open/.ch-open -> .card-open, .row-progress -> .card-progress
- resume hint text "thả lại file vào hàng này để tải tiếp" -> "Thả lại file để tải tiếp"
- series-manage layout test: name <= 2 lines + card inside viewport; 56px row-height assert removed.

## Decisions
- No dark mode exists in repo tokens; dark checked by overriding tokens in the screenshot script only. Card uses tokens only, so a future dark theme works.
- Action icons: solid var(--c-bg) background + line-strong border (no hover-only, no translucency).
- Delete confirm: .card-confirm overlay filling the card (reuses same components, role alertdialog).
- ?s=status only for ingesting chapters; CoverImage remembers failed src, retries when src changes.
- Cover preview in settings reads cover_src from the cached series list query (detail has no cover_src).
- Client-side check of cover type/size before upload; server errors shown inline.

## Tests
- pnpm typecheck, pnpm lint, pnpm --filter @mtl/web test (552): green.
- e2e series-manage, upload-chapter, click-budget: 17/17 green. Full e2e (minus parity): 117 passed, 2 failed (editor.spec:111 flaky, passes on rerun; block-panel.spec:317 fails identically with my changes stashed = pre-existing, canvas editor, unrelated).
- Scratch spec also verified: upload cover -> home shows /api/series/:id/cover?v=, reset -> /api/thumbs/..., bad type error shown.

## Screenshots (dir /private/tmp/claude-501/-Users-jhin1m-Desktop-ducanh-project-manga-web-translate/6b7dd433-5ab6-4daa-9061-57c9bcb4a34c/scratchpad/shots)
home-empty-{d-light,d-dark,m-light}, home-many-{d-light,d-dark,m-light,m-dark}, home-confirm-{d,m}-light, series-chapters-{d-light,d-dark,m-light}, series-empty-{d-light,d-dark,m-light}, series-confirm-{d,m}-light, settings-cover-{custom-d-light,custom-d-dark,custom-m-light,auto-d-light,error-d-light,uploaded-d-light}. No horizontal scroll asserted on all list views. No visual defects found.

## Unresolved
- Home status text truncates with ellipsis in 150px cards (tooltip has full text) - as spec'd.
- docs/design-guidelines.md still says "chưa có dark mode"; no doc change made.
