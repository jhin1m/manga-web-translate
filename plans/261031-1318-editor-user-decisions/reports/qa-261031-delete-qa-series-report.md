# QA cleanup: delete test series "QA đêm" (2026-10-31)

Status: DONE_WITH_CONCERNS (Chrome tab cleanup not possible, see below)

## Steps (app UI only, agent-browser, auto-login as owner)
1. Library `/` listed 5 series: QA đêm, Wireless Onahole, Alpha Injection, jinx, arm-boy-rivalry.
2. Opened `/s/01a18df3-d212-70fa-82a5-b7a51a11ca31`: h1 = exactly `QA đêm`, path id matches. Its only chapter is `01a18df3-d21d-7100-9a4d-d0ddd106b526` (not the real chapter).
3. `?tab=settings` -> "Xoá series" danger zone ("Xoá vĩnh viễn QA đêm cùng 1 chương ... và glossary riêng"). Confirmation is in-page: type series name to unlock button (no native confirm). Typed `QA đêm`, button enabled, clicked "Xoá series".
4. App navigated to `/`.

## Evidence
- Library now shows "4" series; QA đêm absent.
- `/s/01a18df3-d212-70fa-82a5-b7a51a11ca31` renders "series not found"; `GET /api/series/01a18df3-...` -> 404.
- Real chapter `01a18dab-be1b-72b5-ad44-450025cfd188`: `GET /api/chapters/...` -> 200; still in series "Wireless Onahole" (`01a18dab-a65b-716a-89a7-7a55153342dd`).

## Remaining series
- Wireless Onahole
- Alpha Injection
- jinx
- arm-boy-rivalry

## Browser cleanup
- agent-browser session closed.
- Chrome (claude-in-chrome): tabs_context_mcp reports this session has no tab group of its own; earlier agents' groups are not visible/controllable from this session. No tabs closed. User may close leftover localhost:5180/5181 tabs manually.
