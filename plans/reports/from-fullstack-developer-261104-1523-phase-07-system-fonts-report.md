## Phase Implementation Report

### Executed Phase
- Phase 7 system-fonts, plan plans/261104-1237-admin-settings-ai-providers. Status: completed (nothing staged/committed).

### Files
- DB: packages/db/src/schema/app.ts (`systemFonts`), migrations/0025_system_fonts.sql + meta (generated), migrations-down/0025_system_fonts.down.sql, src/scoped.ts (`selectShared`).
- Shared: storage-keys.ts (`systemFontUpload`, `systemFont`).
- API: lib/font-upload.ts (new: `inspectUploadedFont`, `fontView(row, system)`, `fail`, `discardUpload`, `FONT_URL_TTL_S`), lib/fonts.ts (unknown/resolve merge system, `allocateCustomFontId`), routes/fonts.ts (uses shared helpers, GET merges system first), routes/admin-fonts.ts (new), routes/admin.ts (mount).
- Web: fonts/api.ts (`system`, `ownFonts`, `uploadFont(file, base)`), font-settings.tsx (own only; `FontRow` exported/reused), series-settings-form.tsx (own count + 2 optgroups), editor/fonts.ts (`FontKit.custom` keeps `system`), panels/Properties.tsx (2 optgroups), admin/system-fonts-section.tsx (new), admin-sections.ts, admin-layout.tsx.
- Tests: api admin-fonts (new, 8), fonts, fonts-upload, claim-fonts, isolate-queue (clear system_fonts); web fonts/api.test.ts (new), editor/__tests__/fonts-kit.test.ts (new), admin-sections.test.ts; worker test_job_fonts.py (+1); e2e fonts.spec.ts (+1).
- Docs: job-queue-worker.md (Font tuỳ chỉnh), design-guidelines.md, editor.md. Phase file ticked/completed; plan.md row Completed.
- Worker code: unchanged (T16).

### Gate
- typecheck, lint clean. shared 60, db 7, api 429, web 371. worker pytest 351 + ruff clean. `db generate`: no schema changes. Full e2e 55/55 (54 + new).
- Tests-before (fonts-upload/fonts/claim-fonts 19, worker job_fonts 12) green before refactor; refactored without touching them.

### Deviations / decisions
- `Scoped.selectShared(table, where)` added (read-only, type rejects tables with `userId`): lib funcs keep `Scoped` signatures (`isKnownFont(sdb, id)` as planned) without routes importing raw db.
- `allocateCustomFontId(tx, generate?)` checks ALL users' `user_fonts` + `system_fonts` via `inJobTx` (font_id is globally unique, scoped read would miss other users). Optional generator param is for the retry test. Used by both routes.
- Commit race: pg advisory lock around cap check + insert in admin route (cheap, avoids two commits both passing the cap).
- Admin delete 409 returns `series_count` (no `series` key). `GET /api/admin/fonts` returns `{fonts}` only; caps are constants in web copy (matches existing MAX_USER_FONTS pattern); web pre-checks only extension/10MB, API enforces 20/100MB.
- Total cap rule: existing total + new bytes > 100MB -> 409 limit (exactly 100MB accepted, tested).
- `infra/backup.sh` mirrors the whole bucket (covers system/); lifecycle only touches tag mtl-kind=export; no infra change.
- Vitest in the same file reuses fixed `custom-*` ids; DB is reset per run so fine.

### Open questions
- None blocking. Note: a job claimed with a system font URL then font deleted before worker downloads -> 403/404 -> worker falls back (same as user fonts).

Status: DONE

## Review fixes

Gate: typecheck, biome lint, `pnpm test` (shared 60, web 371, db 8, api 431) clean; e2e `fonts.spec.ts` 2/2.

- M1: `Scoped.selectShared<T extends SharedTable>`; `SharedTable = typeof systemFonts` (`packages/db/src/scoped.ts`, exported from index). Type test `packages/db/test/scoped-shared.test.ts` with `@ts-expect-error` on `user`, `aiProviders` (verified by typecheck).
- M2: `FontRow` gets optional `confirm` prop (inline `Xoá?` / `Huỷ`, same pattern as providers); system section passes it. e2e updated (Huỷ path + confirm click).
- M3: 409 copy now "N series của người dùng đang dùng font này làm mặc định. Chỉ xoá được khi không còn series nào dùng." Runbook SQL added to `docs/job-queue-worker.md` (column `series.default_fonts` jsonb; missing slot = default font, so keys pointing at the font are stripped). No force-delete.
- L1: lock is `pg_advisory_xact_lock(hashtext('mtl_system_fonts_cap'))`, constant removed.
- L5: duplicate upload shows "Font X đã có sẵn." (checked against the current list).
- L6: `as never` removed (`db` already satisfies `DbLike`).
- L7: `series.ts` comment mentions system fonts.
- L2/L3/L4/L8: no change (L2 same race as own fonts, L3 admin-only low volume, L4 accepted in plan, L8 process note).

Concerns: runbook SQL not executed against a DB (syntax follows the existing delete query's `jsonb_each_text`).
