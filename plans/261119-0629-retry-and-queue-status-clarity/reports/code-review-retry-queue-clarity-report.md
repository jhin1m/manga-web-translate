# Code review: retry and queue status clarity (uncommitted working tree)

## Scope
- Files: apps/api/src/jobs/queue-state.ts (new), apps/api/test/queue-state.test.ts (new), apps/api/src/routes/{progress,series,chapters}.ts, apps/web/src/features/chapter/{api,chapter-topbar,chapter-workspace,job-error,next-action,primary-action,status}.ts(x) + tests, apps/web/src/features/series/api.ts, docs/{job-queue-worker,self-host}.md
- LOC: ~175 changed + ~200 new
- Gates: not rerun (lead reported typecheck/biome/targeted tests green). Verified by reading claim SQL (jobs/queue.ts), breaker.ts, worker-token.ts, worker main loop, retryFailedPages, polling hooks.

## Overall
All stated requirements are implemented and the contract changes are additive. No blocker. The main defect is semantic: the "waiting" label asserts "auto-starts when a worker is free" in a situation the claim query will not serve (provider breaker pause), which is exactly the 2-worker 429 scenario docs/self-host.md describes. The rest are low-severity polish/perf items.

## Requirements check (a)
| Requirement | Status |
|---|---|
| Retry title "Chỉ chạy lại N trang lỗi — trang đã xong giữ nguyên" on button + prepared menu | Met (primary-action.ts:31-32, 97, 130); menu `title` is rendered via MoreMenu (type already had `title?`) |
| Post-click notice counts pages | Met (chapter-workspace.tsx:534-541); count matches server: retryFailedPages takes `status='failed' && !skipped` (translate-chain.ts:349-354) |
| Chip "Lỗi N trang" tooltip with grouped causes | Met (job-error.ts:153-160, chapter-workspace.tsx:448-456, chapter-topbar.tsx:102-104) |
| RETRY_HINT without right-click | Met (job-error.ts:17-19); page menu label is `Dịch lại trang ${n}` (page-rail.tsx:82), only on the open page |
| API waiting / no_worker semantics | Met as specified (queue-state.ts:33-41, 44-55) |
| progress `chapter.queue`, rows `queue_state` (detail, recent, latest) | Met (progress.ts:88-91, series.ts:192/205/329/368, chapters.ts:202) |
| Web chip / cards / ingest banner labels, no bar while waiting | Met (status.ts:86-87, 140-145; next-action.ts:78-93; chapter-workspace.tsx:1582-1584); card bar only drawn for tone busy (series-page.tsx:192) |

## Critical
None.

## High
None.

## Medium

### M1. "Đang chờ lượt" shown while jobs are blocked by the provider breaker, not by busy workers
- Where: apps/api/src/jobs/queue-state.ts:33-41 (`isWaitingForWorker`), used by both `chapterQueueStates` and `chapterQueueView`.
- Claim excludes LLM jobs of paused breaker keys (queue.ts:182 `not(breakerBlockedSql(paused))`; breaker.ts:14 pause = 2 min). queue-state treats any `queued` job with `run_after <= now` as "ready".
- Scenario (documented in docs/self-host.md:252-253): self-host, 2 workers, 2 chapters translating, provider 429s, breaker pauses `env`/provider for 2 min. Chapter B's next translate batch is queued, ready, never errored (no `error_class`, so no "Chờ AI" banner from `providerWait`). Both workers sit idle. UI: chip "Đang chờ lượt · 0 chương đang chạy", title "tự bắt đầu khi có worker rảnh — không cần bấm gì", card "Tự bắt đầu khi worker rảnh". The stated cause is false; the user is told workers are the bottleneck when the AI provider is. Same for the job that tripped the breaker once its own backoff `run_after` passes but the pause has not ended.
- Not a regression in correctness (old label "Đang dịch · lô x/y" was also uninformative) but the new label asserts a wrong cause in a known scenario.
- Fix (cheap): when there are waiting candidates, load `pausedBreakerKeys(db)` (one tiny `runtime_flags` read) and do not count a queued job as ready if it is breaker-blocked. Easiest in SQL: `bool_or(status = 'queued' and run_after <= now() and not ${breakerBlockedSql(paused)})` (only add the clause when `paused.length`). Either return null (old busy label, existing aiWait banner) or add a third state like `provider_paused` with "AI tạm dừng 2 phút, tự chạy tiếp". Add a test: trip breaker → ready LLM job → `queue` null / provider state.

## Low

### L1. One-poll flicker to "Đang chờ lượt" at every job boundary of a single running chapter
- Where: queue-state.ts:33-41 + worker loop (worker/mtl_worker/main.py:263-293: claim max=1, next claim only after `complete` returns).
- Between `complete` of job k (and chain enqueue of the next batch, or ingest fan-out to page.prepare) and the worker's next claim, the chapter has ready queued jobs and no running job. A progress poll (2.5 s) or series poll (5 s) landing in that window shows "Đang chờ lượt[...]" and drops the topbar bar, then flips back. Probability per boundary ≈ gap/poll interval; with 50 prepare jobs and a 50-150 ms gap that is roughly 1-3 visible flickers per chapter. The plan's risk table only accepted lag for two-worker claims.
- Fix: hysteresis. Only report waiting when no job of the chapter finished within the last ~5 s, e.g. in the progress route `jobRows` already contains recently finished jobs (`updatedAt`); in the list query add `max(updated_at) filter (where status in ('succeeded','failed','cancelled'))` to the grouped query (see L2) and require `now - max > 5s`.

### L2. List query pulls every queued/running row of busy chapters, O(n^2) grouping
- Where: queue-state.ts:66-79.
- A 1000-page chapter during ingest has ~1000 queued `page.prepare` rows; series detail polls every 5 s while any chapter is busy, so each poll transfers all of them and `[...(byChapter.get(id) ?? []), r]` copies the array per row (~500k element copies for 1000 rows). Not dangerous at current sizes, but the plan's own sketch (`bool_or ... group by chapter_id`) returns one row per chapter and also makes M1/L1 trivial to express.
- Fix: grouped SQL with `bool_or(status='running' and lease_expires_at > now())`, `bool_or(status='queued' and run_after <= now())`, `group by chapter_id`. If keeping JS, push into the existing array instead of spreading.

### L3. Waiting chip turns chip click from "open Activity" into "jump to review page"
- Where: chapter-workspace.tsx:1370-1371 (`chip.tone !== "busy"`), status.ts:405-412 (waiting tone `idle`, no_worker tone `warn`).
- During `processing`, `needsReview` is true for failed pages, AI-update pages and overflow pages (page-status.ts:53-54), so a waiting processing chapter with any such page now jumps to that page and the tooltip says "Bấm: nhảy tới trang cần xem tiếp theo", while the chip label ("Đang chờ lượt") shows no "N cần xem" suffix. With an export running, `chipWithActivity` flips tone back to busy and the click goes to Activity again, so behaviour depends on unrelated activity. Contradicts the comment at 1367 ("Chương đang chạy thì chip dẫn tới Hoạt động").
- Fix: gate on chapter state instead of tone: `chip && settled ? nextReviewPage(...) : null` or `chip && chip.tone !== "busy" && !chipInput?.queue`.

### L4. `chapterQueueStates` uses global `db` though a scoped handle is available
- Where: queue-state.ts:62-75; caller series.ts:192 has `sdb`.
- Today safe: all ids come from `sdb`-scoped chapter rows (series detail, `/series` latest, `/recent-chapters`) and progress uses `sdb.byId`; output per id is only a state. But tenancy rests on a comment ("id đã được route kiểm quyền"); a future caller passing raw ids would reveal whether foreign chapters are queued. Only `running_chapters` genuinely needs cross-tenant reads (accepted, count only).
- Fix: pass `sdb` and use `sdb.select(jobs, ...)` for the per-chapter rows; keep global `db` only for the running-chapters count and `worker_tokens`.

### L5. Failed pages whose job is older than 24 h get the cause "lỗi hệ thống"
- Where: job-error.ts:136-143 via failedCauseTitle (153-160); progress only returns jobs active or updated in the last 24 h (progress.ts:26-31), so `job` is null and the group falls back to `internal`.
- Scenario: user returns the next day to a chapter that failed on a bad API key; chip tooltip says "N trang: lỗi hệ thống" instead of the auth cause. Pre-existing in the Activity grouping, but now surfaced on the main chip.
- Fix: when `job` is null use a neutral label ("chưa rõ nguyên nhân — lỗi cũ hơn 24 giờ") rather than `internal`.

### L6. Minor
- progress.ts:2-3 header still says "4 truy vấn cố định"; now up to 6 when waiting (global running count + worker_tokens in local mode). Update the comment.
- series.ts:192 awaits `chapterQueueStates` after the `Promise.all`; move it into the same `Promise.all` to avoid a serial round trip on every list request / 5 s poll.
- Test gaps (queue-state.test.ts): `running_chapters` only asserted `>= 0` (no check that own chapter is excluded and another running chapter counts); "idle chapter" case has no jobs, so the busy-status filter (non-busy chapter with a ready queued job, e.g. export) is not proven; `/series` list and `/recent-chapters` `queue_state` untested; no breaker case (M1).
- RETRY_HINT is also appended to cancelled jobs (job-error.ts:71). If cancelled pages are not `failed`, the "Chạy lại" button / "Chạy lại trang lỗi" menu it points to does not exist. Pre-existing semantics, not verified which page status cancel leaves; see questions.

## Touchpoint regression check (b)
- chapterStats callers: `/series` (latest per series), `/series/:id`, `/recent-chapters` all add `queue_state`; extra query only when a busy chapter is in the set. `/recent-chapters` currently has no web consumer (`fetchRecentChapters` is never called; drop-to-translate only reads the cache), so that field is unused for now.
- Progress route: `chapterQueueView` reuses already-loaded `jobRows` (they include all `queued`/`running` via ACTIVE_JOB_STATUSES), zero extra queries unless waiting.
- Polling: series-page refetch and `isChapterSettled` key off `status`, which stays `ingesting|processing` while waiting, so polling continues. Home page has no polling (labels stale until refocus, pre-existing for status too).
- `chipWithActivity` now spreads the chip, so `title` survives; tone flip unchanged.
- `primaryAction` has a single consumer (chapter-workspace.tsx:426); menu item `title` is optional and rendered.
- nextAction: stale `queue_state` on a settled chapter is ignored (status guard + test).

## Contract (c)
Additive only: progress `chapter.queue` (always present, null or object), chapter rows `queue_state` (null or string). Web types mark both optional, so new web on old API falls back to old labels; old web ignores the fields. No schema/migration change.

## Security/tenancy and SQL (d)
- No cross-tenant leak beyond the accepted global running-chapter count (see L4 for hardening).
- `inArray(jobs.status, ["queued","running"])` on the enum is fine; `jobs_chapter_idx` serves the per-chapter query.
- Running-count query uses literal `status = 'running'` so it matches the `jobs_running_lease_idx` partial predicate; `selectDistinct` over live leases is bounded by worker count.
- `workerSeen`: `last_seen_at` is written by `authenticateWorker` at most once per 60 s, and a busy worker heartbeats every 20 s via the same auth, so 180 s cannot report `no_worker` while a worker is running a job. Clock source mix (JS `now` vs DB `now()`) is fine on a single host.

## Performance (e)
- Progress poll: +0 queries normally; +1 (hosted) / +2 (local) small indexed queries per poll only while waiting.
- List: +1 query per request when busy chapters are present; row volume scales with queued jobs (L2).

## Patterns (f)
Comments are Vietnamese, no plan/phase IDs in code or tests. Docs updated and consistent with behaviour (except M1 caveat).

## Recommended actions
1. M1: exclude breaker-blocked LLM jobs from "ready" (or add a provider-paused state) + test.
2. L1/L2: switch to grouped SQL with a short hysteresis window.
3. L3: gate chip jump on settled state.
4. L4-L6 as convenient.

## Unresolved questions
- After "Huỷ xử lý", which status do affected pages end in? If not `failed`, RETRY_HINT on cancelled jobs points to a button that is not shown.
- Hosted mode: should "Đang chờ lượt · N chương đang chạy" show other users' counts at all (accepted in plan), or hide the count outside local mode?

Status: DONE_WITH_CONCERNS
Summary: Requirements are met and contract changes are additive with no blocker; one medium semantic defect (breaker-paused jobs labelled "waiting for a free worker") plus low-severity flicker, list-query efficiency, chip-click and tenancy-hardening items.
