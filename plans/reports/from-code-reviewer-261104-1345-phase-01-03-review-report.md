# Code review: Phase 1 (admin foundation) + Phase 3 (OpenAIProvider, env mode)

Branch `feat/admin-settings-ai-providers`, uncommitted diff over main `1aec051`. I left out `.env.example` and `docs/job-queue-worker.md` because a docs agent is editing them at the same time.

## Scope
- API: `app.ts`, `auth.ts`, `env.ts`, `middleware/admin.ts`, `routes/{admin,admin-settings,me}.ts`, `lib/system-settings.ts`, `jobs/{enqueue,translate-chain}.ts`, `billing/prices.ts` + 8 test files
- DB: `schema/system-settings.ts`, migration 0021 (+ down, snapshot, journal), `test/system-settings-migration.test.ts`
- Web: `app-shell`, `router`, `routes/{settings,fonts}.tsx`, `features/admin/*`, `pipeline-settings.tsx`, `lib/api.ts` + 6 e2e files
- Worker: `providers/{openai,__init__,base,anthropic,gemini}.py`, `mtl_worker/{log_redact,runner,main}.py`, `pyproject.toml`, `uv.lock` + 4 test files
- Size: about 384+/156- in tracked files, plus about 1.1k lines in new files

## Gate (I ran these myself)
| Check | Result |
|---|---|
| `pnpm typecheck` | clean |
| `pnpm lint` (biome, 348 files) | clean |
| `pnpm test` | shared 38, db 7, api 331, web 336, all pass (baseline 38/5/322/333) |
| `uv run pytest -q` | 334 passed (baseline 286) |
| `uv run ruff check .` / `ruff format --check` | clean / 80 files formatted |
| e2e | not run by me. The implementer reports 48 + 2 pass after fixing signup.spec |
| `db generate` no-diff | not checked independently (it writes into the repo). Implementer says "No schema changes" |

## Overall
Both phases are close to the spec. The admin guard is correct and has good tests: a real router sweep, normalization checked on both sides, and env state restored between tests. All 7 pipeline call sites were migrated. No stale callers of `pipelineSettingsOf`, `me.settings` or `/api/settings/pipeline` remain. The migration's data copy is tested against a real DB built up to 0020.

On the worker side, `jobs.error` sanitization is complete:
- every provider raise site sets `provider`/`status`;
- the `except Exception` branch sends only the exception class name.

The OpenAI error classification uses the real SDK exception classes. I confirmed that `openai._client` unwraps `body["error"]`, so `e.code`/`e.type` hold the actual quota codes.

I found no Critical or High defects. The main gap: the logger pinning targets the wrong HTTP libraries for the SDK versions actually installed.

## Critical
None.

## High
None.

## Medium

**M1. The HTTP transport loggers actually in use are not pinned. The test that should catch this only checks the list against itself.**
`worker/mtl_worker/log_redact.py:22` pins `httpx`/`httpcore`. But the installed `anthropic 1.15.0` and `openai 3.45.0` both depend on **`httpx2`/`httpcore2`** (`Requires-Dist: httpx2<3,>=2.x`), which use the logger names `httpx2` and `httpcore2.*`. I checked after `configure_logging(True)`: the effective level of `httpx2` and of `httpcore2.connection` is INFO. That means:
- `httpx2/_client.py:1085` writes `HTTP Request: POST <full url> ...` for every LLM call;
- if root is ever lowered, or an operator sets `OPENAI_LOG`/`ANTHROPIC_LOG`, the transport loggers are not held at WARNING.

The plan's T9 says "logger SDK/HTTP ghim WARNING kể cả `-v`" (SDK/HTTP loggers pinned at WARNING, even with `-v`). That holds only for `openai`/`anthropic`/`google_genai`. `test_verbose_keeps_sdk_and_http_loggers_at_warning` loops over `QUIET_LOGGERS`, so it cannot detect a missing name.

This is not a regression (before this change root was INFO with nothing pinned), but the requirement is not met, and phase 4 will send per-job keys through these same clients.

Fix: add `"httpx2", "httpcore2"` to `QUIET_LOGGERS`. In the test, assert a hardcoded list of names, including `httpx2`, instead of iterating the constant.

**M2. Phase 3 success criterion 1 is still open: no smoke test with real keys.**
This is not a code defect. But the T8 behaviours that only a real endpoint can confirm are unverified:
- OpenRouter's response to `strict: true` combined with a non-strict schema (see L4);
- quota body codes on real 429s;
- `max_tokens` handling on compatible endpoints.

The phase file honestly shows `status: code-complete-pending-smoke`. Do not mark phase 3 complete or start phase 4's claim wiring until the smoke run passes.

## Low

**L1. Redaction gaps in env mode.** `providers/__init__.py:37-59` never calls `register_secret` for `OPENAI_API_KEY` / `MTL_OPENAI_COMPAT_API_KEY` (or the Anthropic/Gemini env keys). Compatible keys with prefixes the patterns don't cover pass through unredacted. I verified `redact("xai-ABCDEFGHIJKLMNOPQRSTUV gsk_ABCDEFGHIJKLMNOPQRSTUVWX")` comes back unchanged. The plan defers registration to phase 4, but registering env keys in `make_provider` is a one-line addition per branch and closes the gap now.

**L2. Redaction false positives inside words.** `log_redact.py:17`: `sk-[A-Za-z0-9_\-]{16,}` has no left boundary. `redact("u/1/p/mask-3f2a1b4c-1111-...png")` gives `ma[redacted].png`, and `desk-…`, `task-…` get mangled too. Only logs are affected, but storage keys and job names in logs become unreadable while debugging. Fix: add `(?<![A-Za-z0-9])` before `sk-`, `sk-ant-`, `sk-or-` and `AIza`.

**L3. A missing provider env var fails each LLM job, not the worker at startup, and `jobs.error` no longer says why.**
- `main.py:51` `provider` is a lazy `cached_property`. A misconfigured `--provider openai` without `OPENAI_API_KEY` starts normally, claims LLM jobs, and fails each one with `internal: ValueError`, using up attempts.
- Before this change, jobs.error carried the reason (`ValueError: provider openai cần …`). Now it is only in the worker log.
- Same for Anthropic and Gemini with missing keys (`internal: AnthropicError`).

Suggested fix: when LLM capabilities are enabled, construct the provider eagerly in `main()` and exit with code 2 and a clear message.

**L4. `openai_compatible` sends `strict: True` with a non-strict schema.** `openai.py:125`: compatible endpoints get the raw `TRANSLATE_SCHEMA` (`style` is not in `required`) with `strict: True`. Backends that enforce OpenAI strict rules (OpenRouter routing to OpenAI models, Azure) return 400. That triggers the one-time downgrade, so the instance stays on `json_object` for its lifetime. It works, but structured output is lost on exactly the backends that support it best. T8 chose `strict_schema` for official only. Using `strict_schema` for compatible too is safe, because the `style` validator already accepts `null` (`schema.py:187`). Decide this after the smoke test.

**L5. Code fences are removed only in `json_object` mode.** `openai.py:207`: a compatible endpoint that silently ignores `response_format` while in `json_schema` mode, and returns fenced JSON, gives `schema` errors (one retry in the job, then fail) instead of being parsed. Removing fences unconditionally costs nothing.

**L6. The SDK reads other env vars implicitly.** `openai.OpenAI(...)` still picks up `OPENAI_ORG_ID`/`OPENAI_PROJECT_ID` (and `OPENAI_ADMIN_KEY`) from the environment (`openai/_client.py:308-313`). For `openai_compatible`, the org/project headers would go to a third-party host if the operator has them set. These are not secrets, but they break the "SDK không tự đọc env" (SDK does not read env on its own) intent. Fix: pass `organization=None, project=None` explicitly. Check that 3.45's `sync__init__` treats explicit `None` as "do not infer"; if it doesn't, use `default_headers`.

**L7. The sign-up hook reveals which emails are admin when sign-up is enabled.** `auth.ts:45-53`: while sign-up is on, admin emails get 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` and every other email gets 200, so an attacker can test whether an address is an admin. This is plan-specified and production keeps `SIGNUP_ENABLED=false`. The code comment "không lộ email tồn tại" (does not reveal that an email exists) is true only about existence. Phase 5 makes sign-up a runtime toggle, so revisit then. Option: return the same body as the duplicate-email path (`{token:null, user:{email}}`) for admin emails.

**L8. `ADMIN_EMAILS` entries are not validated.** `env.ts:78-83`: a value like `a@x.com;b@y.com` or a typo silently leaves no admin at all. Validating each entry with `z.email()` makes the API fail at boot instead.

**L9. Operational note.** A user who signed up *before* their email was added to `ADMIN_EMAILS` becomes admin, because `requireAdmin` checks only the email and `emailVerified` is false everywhere. The deployment guide's order ("create-user first, then set the var"; create-user errors if the email already exists) covers this. It is worth one line in the phase 5 docs, when sign-up becomes runtime-toggleable.

## (a) Acceptance criteria

Phase 1, all met:
- 401/403 on every `/api/admin/*` route, found by sweeping `adminApi().routes`; `is_admin` correct; emails normalized on both sides
- Sign-up with an admin email is rejected for every case/spacing variant and creates no user row; `createUser` still works
- All 7 call sites use `systemPipeline`; the default input_rev is unchanged (`pipeline-settings.test.ts:117`); a job of user B snapshots the admin's settings
- Migration 0021 copies the newest `user_settings` row, otherwise inserts `{}`; singleton CHECK in place; down file follows the 0020 pattern
- Web: redirect from `/settings` (Navigate renders before the panel, so no admin query fires for non-admins); `/fonts` works; menu as specified; `quota-line` moved into the menu
- `tenant-isolation` excludes `/api/admin/` with a comment

Phase 3:
- `jobs.error` sanitization: met
- Redaction in the formatter, including tracebacks: met
- Logger pinning: partially met (M1)
- No contract or `PIPELINE_VERSION` change: met
- Anthropic/Gemini behaviour: unchanged except `provider`/`status` added to errors
- Real smoke tests: open (M2)

## (b) Touchpoints walked
- Pipeline resolution: every `enqueuePrepare` caller passes a pre-read `pipeline` in loops (`enqueue.ts:484`, `translate-chain.ts:320`), so no N+1.
- Payload snapshots: unchanged.
- Auth hook: runs before the handler. `ctx.path` is the endpoint path. better-auth 1.7.11 lowercases emails in sign-up (`sign-up.mjs:158`), and the hook does trim + lower, so it is a superset. `/change-email` is disabled (`update-user.mjs:430`), so there is no path to change an email to an admin one.
- Admin router: mounted before `userApi`. Hono stops at the admin handler, so `requireUser` does not run twice.
- Worker: no worker code calls `cost_usd` (only `bench.py`), so models with unknown prices don't break jobs. The usage contract carries only `model`, not `provider`, so the new provider names need no shared-schema change. Modal goes through `main()`, so it gets `configure_logging`, and `pip_install_from_pyproject` picks up `openai`.
- Billing: the new prices don't change the "unknown model = most expensive" fallback (Sonnet stays the maximum).

## (c) Public contract changes
All intended by the plan:
- `/api/me` drops `settings` and adds `is_admin`
- `PUT /api/settings/pipeline` is removed and replaced by `/api/admin/settings{,/pipeline}`
- env `ADMIN_EMAILS`
- worker `--provider` choices extended
- format of `jobs.error` messages
- new `system_settings` table

No shared zod or JSON schema changes.

## (d) Patterns
Follows local conventions:
- `parseJson`, `inJobTx`, upsert with `onConflictDoUpdate`
- the down-file template
- the scoped test-DB migration pattern (copied from `single-user-migration`)
- design tokens in `admin.css` (`--radius`, accent-weak/hover)

## Implementer deviations
Phase 1:
- `signup.spec` switched to the plain user: sound, because the owner is now an admin email by design.
- `userId` parameters kept: sound.
- Proofread hint text: fine.

Phase 3:
1. Quota suffixes narrowed so `rate_limit_exceeded` isn't treated as auth: sound and tested.
2. No downgrade for official OpenAI: sound.
3. `MTL_OPENAI_COMPAT_JSON` defaults to `json_schema`: matches phase 2.
4. Explicit `base_url` for official: sound.
5. `llm <class>` when no provider is set: fine.
6. `usage None` treated as non-retryable, which maps to `internal`: acceptable.
7. No compatible premium tier: fine.
8. A `git stash` during baseline: the implementer reports the stash was popped and stash list is empty.

## Recommended actions
1. M1: add `httpx2`/`httpcore2` to `QUIET_LOGGERS` and hardcode the names in the test.
2. M2: run the real smoke test (OpenAI `gpt-4.1-mini` plus OpenRouter) before phase 4, and decide L4 from what it shows.
3. L1 + L2: register env keys in `make_provider`; add a left boundary to the `sk-`/`AIza` patterns.
4. L3: build the provider eagerly at startup when LLM capabilities are enabled.
5. L5–L8 when convenient. Track L7 and L9 in phase 5.

## Unresolved questions
- Does openai 3.45's `sync__init__` honour `organization=None` as "do not infer from env" (L6)?
- Should a 200 response with no `usage` be retryable for compatible gateways that sometimes drop usage? The implementer flagged this too.

**Score: 8.5/10**: Critical 0, High 0, Medium 2, Low 9.
