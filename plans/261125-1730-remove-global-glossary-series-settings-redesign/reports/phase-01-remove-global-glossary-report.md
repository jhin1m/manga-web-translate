# Phase 1 — Bỏ glossary chung: báo cáo

Trạng thái: xong, còn một lo ngại (e2e `series-manage` dòng 414 nằm ngoài quyền sửa, xem cuối).

## File đã đổi

- DB: `packages/db/src/schema/app.ts` (`series_id` NOT NULL, bỏ `source_lang`/`target_lang`, unique
  `(user_id, series_id, source_term)` giữ tên `glossary_entries_scope_term_uq`); migration
  `packages/db/migrations/0031_remove_global_glossary.sql` (drizzle generate + phần dữ liệu viết tay ở đầu),
  `meta/0031_snapshot.json`, `meta/_journal.json`; down `packages/db/migrations-down/0031_remove_global_glossary.down.sql`;
  test mới `packages/db/test/remove-global-glossary-migration.test.ts`.
- API: `routes/glossary.ts` (bỏ `GET/POST /api/glossary[/csv]`, `PairScope`, `inherited`, `source_lang`/`target_lang` trong
  response; `bumpGlossaryRev` chỉ nhận series id), `lib/glossary-scope.ts` (chỉ còn `seriesGlossaryWhere`, bỏ
  `mergeBySourceTerm`), `jobs/enqueue.ts`, `routes/find-replace.ts`, `lib/series-memory.ts`; test `glossary`,
  `find-replace`, `series-memory`, `tenant-isolation`.
- Web: `app/router.tsx` (bỏ `/glossary`), `app/app-shell.tsx` (bỏ dòng menu), `features/glossary/api.ts` (scope chỉ
  `{ seriesId }`), `api.test.ts`, `glossary-editor.tsx` (bỏ `GlossaryPage`, dòng kế thừa), `ApplyGlossary.tsx` (bỏ
  `mergeGlossary`), `features/series/series-page.tsx`; xoá `e2e/glossary-language-pair.spec.ts`; sửa `e2e/routes.spec.ts`
  (`?tab=glossary` mở modal, `/glossary` → không tìm thấy trang).
- Docs: `README.md`, `docs/development-setup.md`, `docs/design-guidelines.md` (chỉ dòng menu tài khoản),
  `docs/export-and-batch-edit.md` (mục Glossary viết lại), `docs/deployment-guide.md` (ghi chú migration 0031 + rollback),
  `docs/project-roadmap.md` (bỏ mục "chuyển entry giữa các cặp" đã lỗi thời).

## Quyết định tự chọn

- Giữ `PATCH/DELETE /api/glossary/:entryId`: route theo id entry (nay luôn là entry series), không phải route glossary
  chung. Chuyển sang `/series/:id/glossary/:entryId` chỉ thêm thay đổi hợp đồng mà không có lợi. Tiêu chí nghiệm thu
  "không route `/api/glossary*`" được hiểu là không còn route glossary chung.
- Migration chép bằng `NOT EXISTS` (khớp chính xác `source_term`, giống unique cũ và `mergeBySourceTerm` cũ), giữ
  note / case_sensitive / origin / created_at / updated_at, id `gen_random_uuid()`. Không tăng `glossary_rev`. Entry chung
  cặp NULL (không khớp series nào) bị xoá.

## Lệnh kiểm (chạy tuần tự, `nice`) và kết quả thật

| Lệnh | Kết quả |
|---|---|
| `pnpm -C packages/db exec vitest run test/remove-global-glossary-migration.test.ts` | 2/2 qua |
| `pnpm -C packages/db test` | 5 file, 10 test qua |
| `pnpm -C apps/api test` (toàn bộ) | 71 file, 774 qua, 1 skip |
| `pnpm -C apps/web test` (toàn bộ) | 62 file, 577 qua |
| `pnpm lint` (biome) | sạch, 506 file |
| `pnpm typecheck` (toàn repo) | qua |
| `pnpm --filter @mtl/web e2e routes.spec.ts` | 1/1 qua |
| e2e `chapter-tools`, `series-auto-memory`, `upload-chapter`, `series-manage` | 22 qua, 1 hỏng: `series-manage.spec.ts:414` (xem dưới) |

Migration thử thật trên DB test có entry chung (test DB dựng tới 0030, seed rồi migrate tiếp):
- Entry chung ko→vi chép vào 2 series ko→vi; series A đã có `검` giữ bản riêng ("kiếm"), chỉ nhận `용`; series ko→en chỉ
  nhận entry ko→en; user khác không nhận gì; entry chung cặp NULL bị xoá.
- Không còn dòng `series_id IS NULL`, hai cột đã gỡ, insert `series_id` NULL bị chặn, insert trùng term trong series bị
  unique chặn; `glossary_rev` không đổi.
- File down chạy được: cột trở lại nullable, unique cũ chặn trùng trong cùng cặp, số entry giữ nguyên; up lại sau down
  áp được lần nữa.

DB dev: backup `backups-dev/mtl-dev-before-0031-261125-1743.dump` (pg_dump -Fc, đã gitignore qua `*.dump`) rồi
`pnpm db:migrate` → 32 migration, `series_id` NOT NULL. DB dev không có entry glossary nào nên không có dữ liệu để chép.

## Còn lo

1. `apps/web/e2e/series-manage.spec.ts:412-414` vẫn chờ link "Glossary chung" ở menu tài khoản → test
   "home at 1280…" hỏng. File thuộc phase 2, không sửa ở đây. Sửa: xoá dòng 414, đổi comment dòng 412 thành
   "Font, (Cài đặt cho admin) vẫn ở menu tài khoản.".
2. Còn chữ "glossary chung" ngoài quyền sửa: `features/series/lang-labels.ts:31` + `lang-labels.test.ts:39` (cảnh báo đổi
   ngôn ngữ, phase 2), comment `features/series/series-settings-form.tsx:202` (phase 2), comment
   `features/chapter/chapter-meta-popover.tsx:199` (không phase nào sở hữu; chỉ là comment, code invalidate `["glossary"]`
   vẫn đúng). `docs/releases/v0.6.0.md` là release note cũ, giữ nguyên.
3. Rollback app về bản trước 0031 bắt buộc chạy file down trước (đã ghi trong deployment-guide); glossary chung cũ chỉ
   khôi phục được từ backup.
4. `ak plan phase close` báo "planstore: plan not found" (đã thử reindex); trạng thái phase được đặt bằng front-matter
   `status: done` trong file phase + reindex (`ak plan status` báo 1/2), ô bảng trong plan.md sửa tay. `ak plan validate`
   vốn đã lỗi "plan.md thiếu title trong front matter" từ trước.
