# Final docs sweep: admin settings + AI providers

## Scope
`docs/` has no codebase-summary, system-architecture, roadmap or changelog files, so the index docs to check were README.md and the existing guides. No code or tests touched.

## Verified against code
- `.env.example` documents `ADMIN_EMAILS`, `SECRETS_KEY` and the OpenAI vars (`OPENAI_API_KEY`, `MTL_OPENAI_*`, `MTL_OPENAI_COMPAT_*`).
- `env.ts` defaults `MIN_PIPELINE_VERSION` to 0.10.0.
- AES-256-GCM in `lib/secrets.ts`.
- `/api/admin` mounted behind `requireAdmin` in `app.ts`.
- Migrations 0021–0025 exist (system_settings, ai_providers, drop_series_llm_tier, user_disabled_at, system_fonts).
- `routes/fonts.ts` merges `systemFonts` and `userFonts`.
- Deployment-guide has the 0.10.0 checklist and job-queue-worker has the provider-from-DB and per-provider breaker sections. Neither was changed.

## Fixes
`README.md`:
- Pipeline settings now point to `/settings` → Pipeline chung, admin only.
- Fonts are personal at `/fonts`; system fonts are admin-managed.
- Added an "Admin" feature bullet that links to deployment-guide and job-queue-worker instead of repeating them.
- Added `/api/admin/*` (`requireAdmin`, `ADMIN_EMAILS`) to the architecture table.
- The Deploy item was stale (migrations only up to 0020, worker pipeline 0.7.1). It now lists 0021–0025, requires worker 0.10.0 and `MIN_PIPELINE_VERSION` 0.10.0, requires `SECRETS_KEY` + `ADMIN_EMAILS`, and links to the 0.10.0 checklist.
- Replaced the "Cài đặt chung" reference in the known limits.

`docs/development-setup.md` line 17: "không có vai trò" contradicted the admin model. It now says admin is an email in `ADMIN_EMAILS` with no role table.

## Notes
- No changelog exists in the repo, so I added none.
- No doc exceeds 800 lines (longest is `job-queue-worker.md`, 443).
- I did not run `validate-docs.cjs`.

Status: DONE
Summary: README and development-setup now match the admin/AI-provider architecture (ADMIN_EMAILS, `/settings` sections, personal `/fonts`, migrations 0021–0025, pipeline 0.10.0). The other docs were already consistent.
