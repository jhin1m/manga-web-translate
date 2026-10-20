# Redesign P6 docs report

Updated (Vietnamese): docs/development-setup.md, docs/editor.md, docs/export-and-batch-edit.md, docs/design-guidelines.md.

- development-setup: Web section rewritten to new router (Home/Series/Chapter, legacy redirects), upload-manager, natural sort, no auto-translate; test DB per package+checkout; e2e notes (auto-login E2E_OWNER, 1920x1080, shared mtl_test_e2e, new specs, login vs loginWithForm).
- editor: now the chapter screen; active page + chapterStore cache; lock policy (runAi flush -> release -> API); flushDetached on chapter->chapter navigation.
- export-and-batch-edit: Export = drawer; Tìm / Thay + Áp glossary = bottom-panel tabs.
- design-guidelines: 4-zone chapter layout, drawers, primary button by state, Home/Series summary; open items records owner approval of direction A + design artifact on 20/10/2026.

Verified against router.tsx, testing.ts, e2e/env.ts, helpers.ts, playwright.config.ts, save.ts, use-chapter-session.ts, primary-action.ts, chapter-workspace.css/tsx. No tests run; validate-docs script not run.
