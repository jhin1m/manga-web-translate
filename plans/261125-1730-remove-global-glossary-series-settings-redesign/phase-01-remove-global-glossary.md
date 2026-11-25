---
status: done
---

# Phase 1 — Bỏ glossary chung

## Bối cảnh

Glossary chung = dòng `glossary_entries` có `series_id IS NULL`, mang `source_lang`/`target_lang`. Áp cho mọi series
cùng cặp, series đè khi trùng `source_term` (`apps/api/src/lib/glossary-scope.ts`). AI không bao giờ ghi entry chung.

## File liên quan

- DB: `packages/db/src/schema/app.ts` (bảng `glossaryEntries` ~dòng 338), `packages/db/migrations/` (drizzle, mới nhất
  0030), `packages/db/migrations-down/` (down viết tay, xem `0030_*.down.sql` làm mẫu).
- API: `apps/api/src/routes/glossary.ts`, `apps/api/src/lib/glossary-scope.ts`, `apps/api/src/jobs/enqueue.ts`
  (~dòng 266), `apps/api/src/routes/find-replace.ts` (`glossaryRules`), `apps/api/src/lib/series-memory.ts`,
  test `apps/api/test/glossary.test.ts`, `apps/api/test/series-memory.test.ts`.
- Web: `apps/web/src/app/router.tsx` (`glossaryRoute`), `apps/web/src/app/app-shell.tsx` (link menu),
  `apps/web/src/features/glossary/*` (`GlossaryPage`, `inheritedLabel`, scope `pair`),
  `apps/web/src/features/series/series-page.tsx` (`inheritedLabel`), e2e `apps/web/e2e/glossary-language-pair.spec.ts`,
  `apps/web/e2e/routes.spec.ts`.
- Docs: `README.md`, `docs/development-setup.md`, `docs/design-guidelines.md`, `docs/export-and-batch-edit.md`,
  `docs/deployment-guide.md` (thêm ghi chú migration / rollback).

## Bước

1. Migration mới (drizzle generate + phần SQL dữ liệu viết tay ở đầu file): chép entry chung sang series đúng cặp
   (`INSERT … SELECT … ON CONFLICT DO NOTHING` hoặc `NOT EXISTS`), xoá entry chung, drop unique cũ, drop 2 cột, `series_id`
   NOT NULL, unique `(user_id, series_id, source_term)`. Down thủ công: thêm lại cột nullable + unique cũ, `series_id`
   nullable (dữ liệu chung không khôi phục — ghi rõ trong comment).
2. API: xoá route chung (`/api/glossary*`), bỏ kiểu `PairScope`, `bumpGlossaryRev(null)`, field `inherited` trong
   response series; `glossary-scope.ts` chỉ còn lọc theo series (bỏ `mergeBySourceTerm` nếu không còn cần).
3. Web: xoá route `/glossary`, link menu, `GlossaryPage`, phần "kế thừa" trong editor glossary, scope `pair` trong
   `glossary/api.ts`. KHÔNG sửa `features/series/series-settings-form.tsx`, `lang-labels.ts`, `settings-*.ts` (phase 2);
   nếu typecheck lỗi ở đó do đổi kiểu, sửa tối thiểu để biên dịch và ghi lại.
4. Test: cập nhật API test; xoá spec e2e `glossary-language-pair`, sửa `routes.spec.ts`.
5. Docs: bỏ mọi nhắc glossary chung; thêm ghi chú migration vào `docs/deployment-guide.md`.

## Kiểm

Tuần tự, `nice`: `pnpm -C apps/api test` (hoặc lệnh test có sẵn), test web glossary, `pnpm lint`, typecheck. Chạy
migration trên DB test có entry chung để xác nhận chép đúng.

## Rủi ro

Rollback app về bản cũ sau migration: route chung của bản cũ lỗi do thiếu cột → chạy file down trước.
