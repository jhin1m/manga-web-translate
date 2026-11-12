# Fix: queue claim tie-break by page order
- Cause: ingest enqueues all page.prepare in one tx -> equal created_at -> claim order (priority, created_at) arbitrary.
- Change: apps/api/src/jobs/queue.ts claim: LEFT JOIN pages ON jobs.page_id, ORDER BY priority, created_at, pages.ord ASC NULLS LAST, jobs.id. FOR UPDATE still `of: jobs`; no migration (jobs.page_id + pages.ord exist). Jobs without page sort after in ties.
- Test: queue.test.ts "claims same-timestamp page.prepare jobs in page order" (5 jobs, same created_at, inserted reverse).
- Red: fails without fix; green with fix. API suite 314/314, typecheck, lint clean; ai-write-rules passes.
- Commit: fd71708
