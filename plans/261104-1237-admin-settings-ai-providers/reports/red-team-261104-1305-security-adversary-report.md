# Red team — Security Adversary (Fact Checker) — admin settings + AI providers

Plan: `plans/261104-1237-admin-settings-ai-providers/` (plan.md + phase-01..06). Date: 2026-11-04.
Method: read every phase, grep/glob verify cited paths/symbols, read better-auth 1.7.11 dist, Node 24 BlockList probe.

---

## Finding 1: Admin = unverified email string, so registering a listed email first grants admin, and that admin cannot be locked
- **Severity:** High (Critical whenever signup is on and any `ADMIN_EMAILS` entry has no account yet)
- **Location:** Phase 1, section "Architecture → Admin" + "Risk Assessment" (row "Admin xác định theo email", phase-01:195); D2; Phase 4 "Đăng ký"; Phase 5 "Requirements" (409 `cannot_disable_admin`)
- **Flaw:** `isAdminEmail(c.get("user").email)` trusts whatever email the account was created with. better-auth has no email verification configured, so an email address proves nothing. The risk table only covers *changing* an email. That path is blocked (VERIFIED `update-user.mjs:53` `EMAIL_CAN_NOT_BE_UPDATED`, `:430` `changeEmail.enabled` false). It does not cover *creating* an account with an admin email that has not registered yet.
- **Failure scenario:** The owner adds a co-admin (`ops@corp.com`) to `ADMIN_EMAILS` before that person registers, or makes a typo. Phase 4 lets signup be switched on from the UI. An attacker POSTs `/api/auth/sign-up/email` with `OPS@corp.com`. better-auth lowercases it, so it matches the lowercased CSV. The attacker gets full `/api/admin/*`, including key exfiltration (Finding 2), limits, and user disabling. The owner cannot remove them from the UI because Phase 5 returns 409 for any email in `ADMIN_EMAILS`. The only fix is editing env and restarting.
- **Evidence:**
  - `apps/api/src/auth.ts:21-27`: `emailAndPassword` has no `requireEmailVerification` and there is no `emailVerification` block (grep: 0 hits).
  - `node_modules/.pnpm/better-auth@1.7.11…/dist/api/routes/sign-up.mjs:158`: `normalizedEmail = email.toLowerCase()`.
  - `docs/deployment-guide.md:54`: production keeps signup off "tới Phase 8 (xác thực email…)".
  - `apps/web/e2e/env.ts:27`: `SIGNUP_ENABLED: "true"`.
- **Suggested fix:** Bind admin to an account that existed before, not a bare email. Do both of these:
  - `requireAdmin` also requires `user.emailVerified === true` or `user.createdAt <` a boot-time marker. Better: seed `admin_user_ids` at boot from accounts that already exist for `ADMIN_EMAILS` and log/alert any listed email that has no account.
  - Block HTTP sign-up for any email in `ADMIN_EMAILS` (same `hooks.before`, same generic 400). Admin accounts are created only with `pnpm create-user`.

## Finding 2: Changing base_url keeps the stored key, so one PATCH sends every stored provider key to an attacker host
- **Severity:** High
- **Location:** Phase 2, "Requirements" (phase-02:24 "Sửa: đổi tên/base URL/kiểu JSON, đổi key (ô trống = giữ key cũ)"); D3 (AAD `ai_provider:<id>`); "Probe"
- **Flaw:** The promise "key không trả web" is defeated by redirection. The AAD binds the ciphertext only to the provider id, not to its destination. A PATCH to `base_url` with an empty key field keeps the old key. The next "Kiểm tra" click (`GET {base}/models` with `Authorization: Bearer <key>`) or the next claimed job sends the plaintext key to the new host. It is unspecified whether `type` is immutable; flipping `openai` to `openai_compatible` would let an OpenAI key leave api.openai.com.
- **Failure scenario:** A stolen admin session (7-day session, no re-auth, no audit log; plan Q5 marks audit as YAGNI) or the squatted admin from Finding 1 does this: PATCH an OpenRouter/DeepSeek provider's `base_url` to `https://attacker.example/v1`, then press Kiểm tra. The attacker host receives the key and uses it outside the platform's ledger and kill-switch.
- **Evidence:**
  - `apps/api/src/auth.ts:39`: `session: { expiresIn: 7 * 24 * 3600, updateAge: 24 * 3600 }`, so a stolen cookie lives long.
  - No step-up auth exists anywhere: grep `freshAge|fresh` in `apps/api/src` finds 0.
  - Plan D3, phase-02 "Data flow": key decrypted for probe and sent to `{base}`.
- **Suggested fix:**
  - Any change to `base_url` origin, or to `type`, must include a fresh `api_key` (409 `key_required_on_destination_change`).
  - Put `type|origin(base_url)` into the AAD so a moved blob fails to decrypt.
  - Keep `type` immutable after create.
  - Add a minimal audit row (admin id, provider id, field, at). The probe and the worker must send official-type keys only to their fixed hosts.

## Finding 3: The SSRF guard (D12) exists only in the API; the worker follows redirects and re-resolves DNS, and errors reach end users
- **Severity:** High
- **Location:** Phase 3, "Worker → openai.py" (client `openai.OpenAI(base_url=…)`); plan.md open question 7; Phase 2 "Base URL + SSRF"; open question 6 (`AI_ALLOW_PRIVATE_BASE_URL`)
- **Flaw:**
  - (a) `assertPublicHost` runs only at save time, and `safeRequest` protects only the probe. The worker connects with the Stainless SDK default client. That client follows redirects and resolves DNS on every request, so DNS rebinding or a 30x after save reaches the worker's network. That network is the operator's home LAN on the Mac worker and the Modal VPC.
  - (b) The response body ends up in `jobs.error`, which every end user can read. That makes the SSRF readable, not blind.
  - (c) The BlockList misses `::`, which Linux treats as connect-to-loopback, and NAT64/6to4.
  - (d) `AI_ALLOW_PRIVATE_BASE_URL` also allows `http:` (plaintext key) and has no production guard, unlike `DEV_AUTO_LOGIN_*`.
- **Failure scenario:** An admin adds a compatible gateway that later turns hostile, has its DNS hijacked, or is attacker-run (Findings 1/2). It answers `POST /v1/chat/completions` with `302 Location: http://192.168.1.1/…`, or switches its A record to a LAN IP after the save check. The Mac worker fetches the internal page. The SDK raises `APIStatusError` with the body. That text goes into `fail.message`, then `jobs.error`, then `GET /api/jobs/:id` for the user who enqueued the job.
- **Evidence:**
  - `worker/.venv/…/anthropic/_base_client.py:998,1749,1807`: `kwargs.setdefault("follow_redirects", True)`. `openai` uses the same Stainless base client.
  - `worker/mtl_pipeline/providers/anthropic.py:73`: error message embeds `e.message`.
  - `worker/mtl_worker/runner.py:63`: `JobFailure(cls, str(e))`.
  - `apps/api/src/routes/jobs.ts:21`: `error: j.error` returned to users.
  - Node v24.18.0 probe with the plan's ranges: `net.BlockList.check("::","ipv6") === false`, same for `64:ff9b::7f00:1` and `2002:7f00:1::`.
  - `apps/api/src/env.ts:103-105`: production guard exists for `DEV_AUTO_LOGIN_*` but is not planned for the new flag.
- **Suggested fix:**
  - Worker: pass `http_client=httpx.Client(follow_redirects=False, transport=<transport that checks the resolved IP against the same block list>)` for `openai_compatible`.
  - Worker: user-facing error = `"<provider> HTTP <status>"`; keep the body only in the local log.
  - Add `::/128`, `64:ff9b::/96`, `2002::/16`, `198.18.0.0/15`, `192.0.0.0/24`, `224.0.0.0/4`, `240.0.0.0/4` to the block list.
  - `parseEnv`: refuse `AI_ALLOW_PRIVATE_BASE_URL` in production, or split it so `http:` stays dev-only.

## Finding 4: Claim gives decrypted keys to every worker token, including Modal, so a token leak means all AI keys leak and the spend cap no longer applies
- **Severity:** High
- **Location:** Phase 3, "API → queue.ts" (claim attaches `llm`); "Risk Assessment" row "Key trong RAM/mạng tới worker Modal" (mitigation "claim cần token worker")
- **Flaw:**
  - Worker tokens are global (any token claims any user's job). Neither token kind nor capabilities limit which jobs get keys.
  - Before this plan, a leaked `mtlw_` token exposed job images. After it, the token holder can harvest every slot key: register or use any user account, enqueue a cheap `page.ocr_region`, then claim with the token. The response contains `llm.ocr.api_key` and `llm.translate.api_key`.
  - Keys used outside jobs bypass the ledger, `USER_DAILY_USD` and `GLOBAL_*_USD`, because the kill-switch only sums `usage_ledger`.
  - Modal containers (third-party runtime, secret `mtl-worker`) now receive OpenAI/Anthropic/compatible keys they never held before.
- **Failure scenario:** The Modal secret leaks (dashboard access, a mis-scoped teammate) or the Mac worker's token file is copied. The attacker loops: enqueue, claim, collect keys. The platform's budget dashboards show $0 while the provider bill grows.
- **Evidence:**
  - `apps/api/src/lib/worker-token.ts:3-4`: "Worker chung toàn hệ thống (claim job mọi người dùng)".
  - `apps/api/src/jobs/queue.ts:96-97`: "mọi token claim job mọi người dùng".
  - `apps/api/src/billing/user-quota.ts:37-38`: `claimableSql` filters only on quota.
  - `worker/mtl_worker/main.py:95`: default caps = all handlers.
  - `worker/modal_app.py:6-7`: Modal secret holds `MTL_TOKEN` (`kind=modal`).
  - `apps/api/src/billing/budget.ts:39-40`: budget counts only the ledger.
- **Suggested fix:**
  - Add a `worker_tokens.llm_keys boolean default false` column (migration). Claim returns `llm` only to tokens that opted in; other tokens use env or are skipped for jobs that carry `payload.llm`.
  - Allow per-kind slots (e.g. Modal gets only `ocr`).
  - Alert (`lib/alert.ts`) on the first claim from a new `worker_id`.
  - Docs: require provider-side spend limits or project-scoped keys for every key entered.

## Finding 5: Runtime signup toggle contradicts the production rule and breaks every deploy through smoke.sh
- **Severity:** High
- **Location:** Phase 4, "Đăng ký" + "Related Code Files" (neither `infra/smoke.sh` nor `infra/deploy.sh` is touched); plan.md "Thứ tự deploy" step 5
- **Flaw:**
  - Production policy is "signup off until email verification" (Phase 8). It is enforced at deploy time: `smoke.sh` requires a 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` and `deploy.sh` auto-rolls back on smoke failure.
  - Phase 4 lets the DB value override env at runtime. The plan does not keep env as a ceiling and does not update smoke or docs.
  - With `system_settings.signup_enabled = true`, the smoke POST creates a real account (`smoke-…@invalid.example`) and then fails the check. The new release rolls back on every deploy. The old release (env-only) passes smoke, so the system is silently pinned to the old code.
  - Security side: one admin click re-opens unverified public signup, which is what enables Finding 1.
- **Evidence:**
  - `infra/smoke.sh:2-3,16-23`: sign-up POST, then `die` unless 400 with the disabled code.
  - `infra/deploy.sh:3`: "smoke hỏng → tự rollback".
  - `docs/deployment-guide.md:54,152,160`: production "bắt buộc" `SIGNUP_ENABLED=false`; "lỡ bật … deploy tự rollback".
  - `apps/api/src/env.ts:76-78`: signup default off.
- **Suggested fix:**
  - DB may only narrow env: `effective = env.SIGNUP_ENABLED && (db ?? true)`. To open signup in production, the operator must change env, until email verification exists.
  - Alternatively, update `smoke.sh` to read effective state from an authenticated health detail and never create real users.
  - Update deployment-guide 54/152/160 in the same phase.

## Finding 6: Key scrubbing matches only the exact key, runs after logging, and leaves provider error bodies visible to end users
- **Severity:** Medium
- **Location:** Phase 3, "Worker → runner.py" (phase-03:133 `scrub()` in `_report_failure` "+ log"); "Worker → main.py" logging (only `openai`/`httpx` raised to WARNING); acceptance criterion "Key không xuất hiện … log worker"
- **Flaw:**
  - (a) `log.exception("job %s lỗi")` runs before `_report_failure` and prints the full exception chain without scrubbing.
  - (b) `-v` sets the root logger to DEBUG, so `anthropic`, `google_genai` and `httpcore` loggers stay at DEBUG. The plan quiets only `openai` and `httpx`.
  - (c) Exact-string scrub misses partial or masked echoes that compatible gateways return (key prefix plus last4, org/project ids, account email, gateway path tokens in `base_url`). That raw text is persisted in `jobs.error` and shown to every end user.
  - (d) The planned test asserts only `fail.message`.
- **Evidence:**
  - `worker/mtl_worker/runner.py:330`: `log.exception`, before `:334 _report_failure`.
  - `worker/mtl_worker/main.py:114-115`: `basicConfig(level=DEBUG if verbose)`.
  - `worker/mtl_pipeline/providers/anthropic.py:73`: provider message embedded.
  - `apps/api/src/routes/jobs.ts:21`: user sees `error`.
  - `apps/api/src/jobs/queue.ts:165-167`: claim error message persisted to `jobs.error` via `terminal`.
- **Suggested fix:**
  - Install a root `logging.Filter` that redacts every key in the current job's `llm` plus key-shaped regexes (`sk-[A-Za-z0-9_-]{8,}`, `AIza[0-9A-Za-z_-]{20,}`, `sk-ant-…`).
  - Set root DEBUG only for `mtl_worker`.
  - For DB-configured providers, the user-facing `fail.message` is a fixed template (`"<type> <status> <error_class>"`).
  - Tests: a fake provider whose error body echoes `sk-…` and the key prefix; assert `jobs.error` and the captured log are clean.

## Finding 7: A disabled user's queued and running jobs keep being claimed and keep spending money
- **Severity:** Medium
- **Location:** Phase 5, "Requirements" (phase-05:30 "Job đang chờ của user bị khoá: không đụng — YAGNI"); "Risk Assessment" row (phase-05:118, rated Thấp × Thấp); "Architecture" `session.create.before` (`if (!ctx) return;`)
- **Flaw:**
  - The main reason to disable an account is abuse: cost burning, or uploading content that gets sent to third-party AI. Disabling stops sessions only. The claim path never looks at `disabled_at`, so every queued `chapter.translate`, `page.prepare` and translate-chain continuation runs to completion. Each one gets the DB keys (Finding 4) and spends up to `USER_DAILY_USD` per day, every day. Translate-chain also enqueues follow-up batches.
  - Separately, `if (!ctx) return;` silently skips the check for any server-side session creation without endpoint context. That is a fail-open default.
- **Evidence:**
  - `apps/api/src/jobs/queue.ts:103-109`: claim `where` filters on status, type, breaker and `claimableSql` only.
  - `apps/api/src/billing/user-quota.ts:37-38`: `claimableSql` filters on quota only.
  - Grep `disabled` in `apps/api/src/jobs`: 0 hits.
- **Suggested fix:**
  - `POST /users/:id/disable` also cancels the user's `queued` jobs (reuse `cancelJob`) in the same transaction.
  - Add `not exists (select 1 from "user" u where u.id = jobs.user_id and u.disabled_at is not null)` to `claimableSql`, so running jobs finish but no new attempts or chain steps start.
  - Make the hook fail-closed: when `ctx` is absent, still look up the user through the adapter.

## Finding 8: A UI value overrides the production daily kill-switch with no ceiling
- **Severity:** Medium
- **Location:** Phase 4, "Hiệu lực" (`DB ?? env`), "Routes/Web" (zod "số ≥ 0 hoặc null", no upper bound)
- **Flaw:** `GLOBAL_DAILY_USD` is documented as the mandatory production kill-switch. Phase 4 lets any admin session replace it with an arbitrary number such as 1e9. Combined with Finding 1, 2 or 5, an attacker raises the daily cap, enables signup, and drives spend up to the monthly env cap, which is the only remaining bound.
- **Evidence:**
  - `apps/api/src/env.ts:49-53`: "Kill-switch ngân sách toàn cục … Bắt buộc ở production".
  - `apps/api/src/env.ts:94-95`: production requires both.
  - `apps/api/src/billing/budget.ts:39-40`: daily read from env today; monthly stays env per plan.
- **Suggested fix:** When env sets a cap, treat it as a ceiling: `effective = min(env, db ?? env)`. The UI shows "≤ env". Raising above env requires an env change.

## Finding 9: Every user's editor eagerly downloads all system fonts (up to 50 × 10 MB)
- **Severity:** Medium
- **Location:** Phase 6, "Requirements" (phase-06:22 "Tối đa 50 font"; `GET /api/fonts` merges system fonts); "Architecture → Web" ("editor … `fetchFonts` → tự nạp")
- **Flaw:**
  - The editor loads every font returned by `/api/fonts` into `document.fonts` at session start. Today that is at most 20 of the user's own fonts.
  - Phase 6 prepends up to 50 shared fonts for every user, with no total-size cap. Each editor open becomes up to 500 MB of presigned egress from MinIO/Cloudflare, multiplied across all users.
  - This is a platform-wide availability and cost lever behind one admin (or squatted admin) upload loop.
  - `GET /api/fonts` also presigns 50 more URLs on every call.
- **Evidence:**
  - `apps/web/src/features/editor/fonts.ts:144-158,163-169`: `loadCustomFaces` loads every listed font.
  - `apps/web/src/features/editor/use-chapter-session.ts:463-470`: called on every session with `staleTime: 0`.
  - `apps/api/src/lib/font-metrics.ts:19`: `MAX_FONT_BYTES = 10 MB`.
  - `apps/api/src/routes/fonts.ts:61-65`: list presigns every row.
- **Suggested fix:** Cap total system-font bytes (e.g. 60 MB) in addition to count. Load system fonts on demand (on picker open, or only ids used by series defaults or the chapter's text boxes).

---

## Fact Checker ledger (sampled)

| Claim | Result |
|---|---|
| `billing/prices.ts:5` `LLM_PRICES_PER_MTOK` | VERIFIED (prices.ts:5) |
| `providers/base.py:25` price table | VERIFIED (base.py:24-25) |
| `app.ts:44` mount point | FAILED (minor): `app.route("/api", userApi())` is at app.ts:46 |
| "userApi `*` middleware still runs for `/api/admin/*`" | UNVERIFIED/likely false: the admin handler returns before the later-registered middleware runs. Harmless. |
| `app.ts:58` `console.error(err)` | VERIFIED |
| `enqueue.ts:218` + 7 call sites (233, 242, 336, 374, 441, 493, translate-chain 313) | VERIFIED |
| `tenant-isolation.test.ts:272`, `:287` | VERIFIED |
| `queue.ts:170-176` `terminal(... "invalid_input")` | VERIFIED at queue.ts:165-167 (offset) |
| `routes/worker.ts:47` claim | VERIFIED |
| `ledger.ts:70` `llmPrice(usage.model)` | VERIFIED |
| `job.ts:201` `model_tier`; `worker-protocol.ts:111` JobFonts, `:182` ClaimedJob | VERIFIED |
| `main.py:58` `provider_for`, `:134` eager load | VERIFIED |
| `runner.py:66` Deps, `:79` JobContext, `:337` `_report_failure` | VERIFIED with offset (80, 334) |
| `user-quota.ts:27` overQuotaSql, `:37` claimableSql | VERIFIED (26, 37) |
| `budget.ts:39` env daily | VERIFIED |
| `auth.ts:25` `disableSignUp`, `:33` rateLimit | VERIFIED |
| better-auth `changeEmail` not enabled | VERIFIED (update-user.mjs:53, :430) |
| hooks.before `ctx.path === "/sign-up/email"` robust to path variants | VERIFIED (dispatch.mjs: `path: endpoint.path`) |
| zod 4 issues omit input (key not echoed in 400) | VERIFIED (zod 4.6.7, `reportInput` opt-in) |
| `lib/fonts.ts` `resolveCustomFonts` handles `sys-*` "tự có" | FAILED as stated: it filters by `isCustomFontId` `/^custom-…$/` (fonts.ts:24,45). Phase 6 must change the filter, which the plan implies but does not call out. |
| `claim-inputs.ts:145` `fontInputs` needs no change | VERIFIED: it uses `presignGet` directly, with no `keyBelongsToUser` check on font keys |
