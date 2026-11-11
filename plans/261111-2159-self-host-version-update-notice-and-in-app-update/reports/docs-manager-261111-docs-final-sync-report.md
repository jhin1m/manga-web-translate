# Docs final sync report (261111)

Checked self-host.md, releases/v0.3.0.md, project-roadmap.md, README.md against final code. README and roadmap needed no change.

self-host.md:
- Cập nhật ngay: web keeps tracking until the run finishes (cap 10 min) before reload; failure after the app already runs the new version is stated, points to logs; 60s cooldown message.
- Tắt nút cập nhật: with MTL_UPDATER=0 the app never contacts the updater.
- Bảo mật: prerelease target accepted only if equal to app's MTL_UPDATE_TARGET and newer than the running version.
- Sự cố: `.bak` keeps original owner and mode.
- Maintainer item 8: bind check both directions (add/change/remove) -> path_mismatch; running service missing from new compose -> invalid_compose.
- Maintainer item 5: pointer to usage in the smoke script header.

releases/v0.3.0.md: added 60s double-click note only (already covered MTL_UPDATER=0, logs, manual-update caveats).

Verified in code: env.ts/updater-client.ts (MTL_UPDATER), update-model.ts (60s text, 10 min cap), runner.ts (.bak keepAttrs), server.ts (prerelease target), update-dialog.tsx (docker logs). Did not re-read runner-plan.ts; item 8 wording follows the task brief.
Nothing committed; docs/editor.md and design-guidelines.md untouched.
