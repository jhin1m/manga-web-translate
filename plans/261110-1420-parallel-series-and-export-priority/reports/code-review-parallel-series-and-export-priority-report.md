# Code review: parallel series + export priority

Date: 2026-11-10. Scope: uncommitted diff on `main` (8 files, +168/−15) + untracked `worker/tests/test_worker_threads.py`.
Plan: `plans/261110-1420-parallel-series-and-export-priority/` (plan.md, phase-01..03, measure report).

**Score: 7.5/10.** The code is small and correct. The tests prove the fix (red check done). Two doc problems affect the
user's bug #2 directly: the docs promise more than the claim order delivers, and existing installs never receive the
2-worker compose file.

## Scope / scout

- Files: `apps/api/src/jobs/enqueue.ts`, `apps/api/test/{queue,page-state}.test.ts`, `worker/mtl_worker/main.py`,
  `worker/tests/test_worker_threads.py`, `docker-compose.yml`, `docs/{job-queue-worker,self-host}.md`, `README.md`.
- Touchpoints checked by grep/read:
  - every `insertJob` call site (7);
  - callers of the 3 enqueue functions (`routes/export.ts:88`, `routes/page-state.ts:305,321,335`, plus tests);
  - claim `ORDER BY` (`queue.ts:130`), `jobs_claim_idx` (`schema/app.ts:403`), dispatcher (`dispatcher.ts:73-78`
    uses `run_after`), `jobView` (no `priority` field);
  - fencing `fenced()` (`queue.ts:222-233`: `leaseOwner` = token id + random `leaseToken` per job), `worker_id`
    consumers (display only, `schema/app.ts:380`), e2e fake worker, `infra/selfhost-smoke.sh`;
  - model download (`models.py:118-136` mkstemp + replace), worker entrypoint, threads plumbing (all onnxruntime
    `intra_op_num_threads`; no torch).
- Probe: `MTL_THREADS=abc … parse_args(['--threads','2'])` → `SystemExit`. `MTL_WORKERS=2` on the 12-core host → 6.

## (a) Acceptance criteria

| Criterion | Result |
|---|---|
| plan: API test, export claimed first ahead of the prepare + translate backlog | Met (`queue.test.ts:134-185`, goes through the real `enqueueExport`, red check done) |
| plan: `compose up -d` → N workers, distinct `worker_id`, threads split | Met (smoke in report: 2 ids, `threads=6`) |
| plan: two chapters overlap in `claimed_at` | Met in the weak sense: they overlap at the chapter boundary. See M1 |
| plan: docs cover worker count, RAM, `MTL_WORKERS`/`MTL_THREADS` | Met, but see M1, M2, m3, m4 |
| phase 1: RAM/CPU table, base, nproc, prepare 1 vs 2 workers, RAM min | Met |
| phase 2: priority 10 for 3 types; 50/100 unchanged; no schema change | Met (`enqueue.ts:365,401,437`; proofread/ingest/prepare/translate unchanged) |
| phase 2: reinpaint/ocr_region assert | Met (`page-state.test.ts:236-237,341-342`; the `auto_text_bbox` path is not asserted, but it is the same function) |
| phase 3: `default_threads` tests (0 / 4 / 3 / 1) | Met. `_cpu_count` itself is untested (m6) |
| phase 3: `--threads` beats both env vars | Partial: an invalid env value still exits when `--threads` is passed (m1) |
| phase 3: startup log `threads=` | Met (`main.py:199-206`) |
| phase 3 step 4: `pull && up -d` recreates replicas | Not shown directly (the report only covers changing env and a no-op `up`). This is standard compose behaviour, so low risk |

Plan files still say `status: pending`, every phase is `Pending` and the criteria are unchecked. The lead should
update them.

## (b) Regressions: none found

- No code or tests assume priority 100 for export/reinpaint/ocr_region (`grep priority apps/api/test` only finds
  `translate-chain.test.ts:185` = 50 and `cancel-and-recovery.test.ts:114` = 0).
- Reordering within the same page is safe: reinpaint goes through `editablePage` → `isPageBusy` (`page-state.ts:168`),
  so it cannot jump ahead of a prepare of the same page. Export only runs when the chapter is not busy (`enqueue.ts:419`).
  When the chapter is re-run after that, export still takes the snapshot the user asked for, which is better than before.
- LLM breaker/quota: paused ocr_region jobs are left out of the claim (`breakerBlockedSql`), so they do not block the
  head of the queue.
- Dispatcher/healthz use `run_after` and are not affected. Nothing depends on `worker_id == "local"` (API, web, infra,
  docs: grep is empty).
- An existing install with the old compose and the new worker image: `MTL_WORKERS` is unset → threads 0, the same as
  before.

## (c) Public contract

Job payloads unchanged. `jobView`/`exportView` do not expose `priority`. New env vars (`MTL_WORKERS`, `MTL_THREADS`)
are additive. The compose file drops `MTL_WORKER_ID: local` and adds `deploy.replicas`. No unintended contract change.

## Findings

### Critical

None.

### Major

**M1. The docs say "số worker = số chương chạy cùng lúc", but the claim order is global FIFO, not shared out per chapter.**
`docker-compose.yml:105`, `docs/self-host.md:80`, `docs/self-host.md:143-144`.

- The claim orders by `priority, created_at, pages.ord` (`queue.ts:130`). Ingest creates every `page.prepare` of a
  chapter in one transaction (same `created_at`).
- So both workers take chapter 1's prepare backlog first. Chapter 2 only starts xoá chữ once chapter 1 has no queued
  prepare left. The report shows this too: "Chương nào cũng có job do cả 2 worker chạy". The 15 overlapping pairs are
  at the chapter boundary (chapter 1 translate batches vs chapter 2 prepares).
- Example: a 60-page chapter followed by a 5-page chapter. The second chapter waits for about 30 × 17,6 s ≈ 9 minutes,
  not "chạy cùng lúc".
- Goal 2 is met in the sense of "chồng nhau + thông lượng ×2", not in the sense the docs describe.

Fix (docs only, no change to the locked decision). Reword along these lines:

- compose:105: `# Mỗi worker chạy 1 job một lúc → N worker chạy N job song song (xoá chữ + OCR, dịch, xuất). Mỗi worker nạp model riêng (tốn RAM).`
- self-host.md:80: `Số worker = số job chạy cùng lúc. …`
- self-host.md:143-144: `**Mặc định 2 worker**: mỗi worker chạy 1 job một lúc, nên 2 job chạy song song. Job xếp theo thứ tự tạo: 2 worker cùng xoá chữ chương trước (nhanh hơn ~2 lần), chương sau bắt đầu ngay khi chương trước hết trang chờ xoá chữ, chạy chồng với phần dịch của chương trước. Xuất file, …`

If the user expects true per-chapter parallelism (chapter 2 starts right away), that needs fairness in the claim, for
example ranking by `row_number() over (partition by chapter_id order by created_at)` before `created_at`. That is new
scope: ask the user (see the open questions).

**M2. Existing installs never receive the 2-worker compose file: `docker compose pull && docker compose up -d` does not
refresh `docker-compose.yml`.**
`docs/self-host.md` "Cập nhật" (lines 58-70).

- The user who reported the bug is an existing self-host install. Updating as the docs say gives the new app image (the
  priority fix reaches them) but keeps the old compose: 1 worker, `MTL_WORKER_ID: local`, no `MTL_WORKERS`.
- Setting `MTL_WORKERS=2` with the old compose does nothing, and the docs never mention fetching the compose file again.
- New installs, by contrast, `curl` the compose file from `main` (`self-host.md:27`). Before a release is tagged, that
  gives 2 replicas of the old `latest` image: no thread split and no priority fix. It still works (measured
  "2 worker không chia luồng"), but it is a configuration nobody intended.

Fix: add to "Cập nhật": `Bản mới có thể đổi docker-compose.yml (vd 2 worker từ bản x.y): tải lại file bằng lệnh curl ở mục Cài (ghi đè file, .env giữ nguyên), rồi docker compose up -d.`
Also merge this change to `main` together with the release tag, or right after it, as the maintainer steps
(`self-host.md:194`) describe.

### Minor

**m1. An invalid `MTL_THREADS`/`MTL_WORKERS` exits even when `--threads` is passed.** `main.py:124`.
`default=default_threads()` runs at parse time, before argparse sees the flag. Verified:
`MTL_THREADS=abc mtl-worker --threads 2` → `SystemExit: MTL_THREADS phải là số nguyên ≥ 0`. `--help` dies the same way.
Low impact (compose sets valid values; Modal sets neither), but it contradicts "`--threads` vẫn thắng cả hai".
Fix: `default=None`, then in `main()`: `if args.threads is None: args.threads = default_threads()`. Change the test to
assert that `--threads 2` together with `MTL_THREADS=abc` gives 2.

**m2. The smoke script does not isolate the new env vars.** `infra/selfhost-smoke.sh:22`.
The comment says dev shell variables must not leak into compose, but the `unset` list lacks `MTL_WORKERS MTL_THREADS`.
A dev with `MTL_WORKERS=1` exported runs the smoke on 1 worker and still believes they tested the default.
Fix: `unset COMPOSE_FILE … MTL_ALLOWED_HOSTS MTL_WORKERS MTL_THREADS`.

**m3. The OOM troubleshooting signal is unlikely to show up.** `docs/self-host.md:184-185`.
The worker has `restart: unless-stopped`. When the OOM killer takes python (tini forwards 137), Docker restarts it at
once (the backoff resets because the worker ran for more than 10 s). `docker compose ps -a` shows `Up N seconds` or
`Restarting (137)`, almost never `Exited (137)`. The report saw no OOM, so this line is unverified.
Fix: `**Worker khởi động lại giữa chừng** (docker compose ps thấy worker "Up vài giây" / "Restarting (137)", log in lại dòng mtl-worker … mode=loop, job đang chạy bị chạy lại): thường do thiếu RAM. Kiểm: docker inspect -f '{{.State.OOMKilled}} {{.RestartCount}}' mtl-local-worker-1 mtl-local-worker-2. Tăng RAM cho Docker hoặc MTL_WORKERS=1 docker compose up -d.`

**m4. The "≥ 10 GB" threshold has about 2% headroom and was never tested at that size; the units are inconsistent.**
`docs/self-host.md:17,80,147`, `README.md:23`, compose:14.

- 2 × 4 687 + 669 = 10 043 MiB = 9,81 GiB. A 10 GiB Docker VM leaves about 200 MiB for the guest kernel, dockerd and
  containerd.
- The measured VM had 15,66 GiB, and only on arm64 (amd64 onnxruntime may use larger arenas).
- "~4,7 GB mỗi worker" is 4 687 MiB read as decimal thousands. In the same GiB unit the report used for 9,8 GiB, it is
  ~4,6 GiB.
- Option A (recommended): keep "tối thiểu 10 GB" and add "nên để 12 GB". Option B: measure a VM at exactly 10 GiB with
  2 workers, both having loaded ko + ja models. Fix the unit to "~4,6 GB".
- This is a plan formula, not a user decision, but changing the threshold changes the user-facing text, so the lead
  decides.

**m5. Multi-user (VPS) mode: export becomes a way to jump the queue for every user.** `enqueue.ts:437`, `routes/export.ts:33-38`.

- `exportKey` contains the payload, so `quality` 1..100 × 2 formats × layouts × `include_untranslated` lets one user
  create hundreds of different active export jobs per chapter.
- At priority 10 they all run ahead of other users' prepare/translate on the shared workers. Export calls no LLM, so
  quota does not cap it.
- Before this change the same jobs were FIFO at 100. The fairness gap existed already; this change makes it worse.
  Self-host has 1 user, so it does not matter there.
- Fix when VPS matters again: limit queued `INTERACTIVE_PRIORITY` jobs per user (only the first N get 10, the rest 100),
  or answer 429 when the user already has ≥ N queued exports.

**m6. Test gaps / hermeticity.** `worker/tests/test_worker_threads.py`.

- `_cpu_count` (both branches) is not tested, although phase 3 step 1 says to mock `sched_getaffinity`/`cpu_count`.
  Add: `monkeypatch.delattr(os, "sched_getaffinity", raising=False); monkeypatch.setattr(os, "cpu_count", lambda: None)` → 1;
  `monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: {0, 1, 2}, raising=False)` → 3.
- `test_threads_flag_wins_over_env` does not `delenv("MTL_THREADS")`, so it breaks if CI or the shell has it set.

### Low

- `main.py:78-87` `_env_int`: the `value: int | None = int(raw)` + `except: value = None` pattern is roundabout. Use
  `try: value = int(raw) except ValueError: raise SystemExit(msg) from None`.
- The priority scale is spread over 3 places: 10 (`enqueue.ts:58`), 50 (`translate-chain.ts:38`), the literal 100
  (`enqueue.ts:109`) and the schema default. A shared `DEFAULT_PRIORITY = 100` next to `INTERACTIVE_PRIORITY` would let
  the docs table point to one place. Not required.
- `queue.test.ts:153` comment says "Thứ tự claim chỉ xét priority + created_at", but the claim also orders by
  `pages.ord` and `id`. Write "trước hết theo priority + created_at".
- On amd64 with SMT, `sched_getaffinity` counts logical CPUs. 2 workers × (logical/2) threads = 2 × the physical cores,
  while onnxruntime auto (1 worker) uses only physical cores. Not measured. The docs' "tuỳ máy" covers it.
- Untracked files `qa-before-delete.png` (repo root) and `apps/web/.claude/` are not part of this change. Do not
  commit them with it.

## (d) Pattern conformance

- Vietnamese JSDoc comments that explain the reason, English `it(...)` names, the `as unknown as JobPayload` pattern
  and `cancelActiveJobs` isolation match `queue.test.ts`.
- The worker test uses `monkeypatch`, like the existing tests.
- The compose comment style matches the existing blocks.
- No plan IDs or finding codes appear in code or comments.

## (e) Docs vs measure report

| Claim | Report | OK? |
|---|---|---|
| ≥ 10 GB (2 worker) / ≥ 6 GB (1) | 10 043 MiB / 5 356 MiB, rounded up | Yes (thin headroom, m4) |
| ~4,7 GB per worker | 4 687 MiB (= 4,58 GiB) | Unit off (m4) |
| ~0,7 GB app + DB | base 669 MiB | Yes |
| xoá chữ ~2× faster (arm64, 12 cores) | ~25 s/page → ~10,2 s/page (2,45×) | Yes, conservative |
| export runs as soon as a worker finishes its current job | waited 9,5 s with 26 prepares queued | Yes |
| default 2 log lines `mode=loop threads=…` | log format `… mode=%s threads=%s caps=…` | Yes |
| "số chương chạy cùng lúc" | smoke: both workers on every chapter | No (M1) |

## `default_threads` sanity

- It is evaluated inside `parse_args` on each call, not at import. The `env=os.environ` default is bound to the live
  `os.environ` object, so `monkeypatch.setenv` and the container env both work. Only the eager evaluation in m1 is a
  problem.
- `_cpu_count`: Linux uses the cpuset via `sched_getaffinity` (the Docker VM's nproc). It does not reflect a CFS
  `--cpus` quota, but compose sets none. macOS falls back to `os.cpu_count() or 1` (verified: `hasattr` False → 12).
- `max(1, …)` clamps correctly.

## Recommended actions

1. M1: reword compose:105 and self-host.md:80,143-144. Ask the user whether per-chapter fairness is wanted.
2. M2: add the "tải lại docker-compose.yml" step to "Cập nhật", and line up the merge with the release tag.
3. m1, m2: lazy `--threads` default; add the two vars to the smoke `unset`.
4. m3, m4: OOM wording; RAM headroom/unit (lead decides on 12 GB).
5. m6: the `_cpu_count` tests plus `delenv`.
6. Update the plan status and check the criteria.

## Open questions

- Does the user expect "nhiều bộ chạy cùng lúc" to mean chapter 2 starts right away, without waiting for chapter 1's
  backlog? If so, claim fairness per chapter is new scope that needs its own plan.
- Should the RAM threshold be raised to 12 GB "khuyến nghị", or should 10 GiB be measured on the boundary VM?

Status: DONE_WITH_CONCERNS
Summary: The priority, threads and compose code is correct, tested and causes no regression in any touchpoint. Two
major doc problems remain: "số worker = số chương chạy cùng lúc" contradicts the global FIFO claim, and the update
path never delivers the new compose file to existing installs.
Concerns/Blockers: Whether per-chapter fairness is in scope is a product question for the user; nothing blocks the commit.

---

## Re-review (2026-11-10, after fixes)

Read-only check of the new diff. Ran (no DB): `uv run pytest tests/test_worker_threads.py` passed (10 tests). `ruff check`,
`ruff format --check` and `mypy mtl_worker/main.py` are clean. Probe: `MTL_THREADS=abc` + `--threads 2` → 2; without the
flag it still exits with an error that names the variable.

| Finding | Result |
|---|---|
| M1 wording | Fixed. compose:105 says "N worker chạy N job song song". The self-host.md:84 row and Worker section (147-149) describe the claim order, the next chapter starting once the previous one has no xoá chữ left, and the overlap with translation. Accurate to `queue.ts:130` |
| M2 update path | Fixed in `docs/self-host.md:58-66` (curl, then pull/up, plus a note to use env/`.env` instead of editing the file) and in the compose header line 4. **Not fixed in `README.md:18`** (see R1) |
| m1 lazy `--threads` | Fixed (`main.py:122-140`). `args.threads` is set before `main()` reads it. The only caller is `main()` |
| m2 smoke unset | Fixed (`selfhost-smoke.sh:22`) |
| m3 OOM wording | Fixed (`self-host.md:190-192`) |
| m4 RAM/unit | Fixed: ~4,6 GB per worker, "≥ 10 GB (nên 12 GB)" in README:23, compose:14 and self-host.md:17, and "tổng ~9,8 GB, chưa gồm phần VM" |
| m5 VPS flood | Accepted as a limitation in `job-queue-worker.md:83-85`. That is reasonable for a self-host product focused on one user |
| m6 tests | Fixed: `delenv`, bad env together with an explicit flag, and the `_cpu_count` fallback (both the `cpu_count()` and `None → 1` branches). The Linux `sched_getaffinity` branch is still untested, but it is a single line |

### Remaining

**R1 (minor). `README.md:18` still says `Cập nhật: \`docker compose pull && docker compose up -d\`.`**
The README is the entry point most users read, and this line still skips the compose file, so M2 is only half fixed
there. Fix: `Cập nhật: tải lại \`docker-compose.yml\` (lệnh \`curl\` ở trên) rồi \`docker compose pull && docker compose up -d\` — xem [docs/self-host.md](./docs/self-host.md#cập-nhật).`

**R2 (low, maintainer process).** Updates now always fetch the compose file from `main`, so every compose change on
`main` reaches users before the matching `latest` image exists. Users who pin `MTL_TAG` via `.env` also get `main`'s
compose with an older image. It is harmless for this change: an old worker ignores `MTL_WORKERS`/`MTL_THREADS` and only
skips the thread split. Fix: in the maintainer steps (`self-host.md:~200`), add "đổi `docker-compose.yml` thì merge vào
`main` cùng lúc / ngay sau khi tag bản chính thức".

**R3 (cosmetic).** `self-host.md:152-154` breaks the line awkwardly ("…cạnh" / "`docker-compose.yml` để…"). Re-wrap the
paragraph.

Plan: `plan.md` is now `status: completed`. Per-chapter fairness remains an open question for the user, as the
coordinator stated.

**New score: 9/10.** Every original finding is fixed or explicitly accepted. Only the one-line README fix (R1) is left.

Status: DONE_WITH_CONCERNS
Summary: All re-review fixes are verified (worker tests, lint and typecheck pass; lazy `--threads` probe passes). Only
`README.md:18` still shows the old update command without fetching `docker-compose.yml` again.
Concerns/Blockers: R1 is a one-line doc fix and does not block the commit. Per-chapter fairness is still for the user to decide.
