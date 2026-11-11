---
phase: 1
title: "Hợp đồng + DB"
status: completed
priority: P2
effort: "2h"
dependencies: []
---

# Phase 1: Hợp đồng + DB

## Overview

Phase này thêm vào `chapter.translate` result hai key optional là `new_terms` và `pronoun_pairs`. Nó cũng thêm kiểu
`TranslateMemory`, helper chuẩn hoá khoá gợi ý dùng chung cho API và web, cột `chapters.translate_memory` và bảng
`series_suggestions`. Không đổi payload.

## Context

- `packages/shared/src/job.ts:141-145`: `TranslateCarry`. Ở `job.ts:269-273`, result `chapter.translate` có `carry` optional.
- `packages/shared/src/job.ts:254-278`: `JobResult` là discriminatedUnion của các `z.object`. API dùng zod mặc định
  (strip) nên bỏ qua key lạ, worker cũ gửi thiếu key vẫn hợp lệ.
- `packages/db/src/schema/app.ts:95-125`: bảng `chapters`. `app.ts:425-447`: `proofread_suggestions` là mẫu bảng gợi ý.
- Giới hạn độ dài khớp với các nơi đang có: glossary `source_term`/`target_term` ≤ 200 (`apps/api/src/routes/glossary.ts:20-25`).
  Xưng hô: `speaker`/`listener` ≤ 80, `address` ≤ 120 (`apps/api/src/routes/series.ts:28-34`).
- Quy ước: đổi zod thì chạy `pnpm schema:emit` và commit `packages/shared/json-schema/` (có test chặn lệch). Đổi DB thì
  chạy `pnpm db:generate` và viết down tay (`docs/development-setup.md` "Quy ước bắt buộc").

## Files

| Thao tác | File |
|---|---|
| Sửa | `packages/shared/src/job.ts` |
| Tạo | `packages/shared/src/series-suggestions.ts` |
| Sửa | `packages/shared/src/index.ts` (thêm `export * from "./series-suggestions.ts"`) |
| Sinh lại | `packages/shared/json-schema/job-result.schema.json` (`pnpm schema:emit`) |
| Sửa | `packages/shared/test/shared-contracts.test.ts` |
| Tạo | `packages/shared/test/series-suggestions.test.ts` |
| Sửa | `packages/db/src/schema/app.ts` |
| Sinh | `packages/db/migrations/0026_series_memory.sql`, `migrations/meta/0026_snapshot.json`, `meta/_journal.json` |
| Tạo | `packages/db/migrations-down/0026_series_memory.down.sql` |

## Implementation steps

1. **`job.ts`**: thêm sau `TranslateCarry` (l.141-146):
   ```ts
   export const TERM_KINDS = ["person", "place", "term"] as const;
   /** Thuật ngữ/tên riêng AI gặp trong lô mà glossary của job chưa có — API lưu thành gợi ý chờ duyệt. */
   export const LearnedTerm = z.object({
     source: z.string().min(1).max(200),
     target: z.string().min(1).max(200),
     kind: z.enum(TERM_KINDS),
   });
   /** Cặp xưng hô AI đã dùng mà pronoun_rules chưa có (giới hạn khớp PronounRule của series). */
   export const LearnedPronoun = z.object({
     speaker: z.string().min(1).max(80),
     listener: z.string().min(1).max(80),
     address: z.string().min(1).max(120),
   });
   export const MAX_LEARNED_TERMS = 50;
   export const MAX_LEARNED_PRONOUNS = 30;
   /** carry cuối lượt dịch cả chương + cặp ngôn ngữ lúc dịch — trí nhớ series (chapters.translate_memory). */
   export const TranslateMemory = TranslateCarry.extend({ source_lang: z.string().min(2), target_lang: z.string().min(2) });
   ```
   Result `chapter.translate` (l.269-273) thêm:
   `new_terms: z.array(LearnedTerm).max(MAX_LEARNED_TERMS).optional()` và
   `pronoun_pairs: z.array(LearnedPronoun).max(MAX_LEARNED_PRONOUNS).optional()`.
   Comment ở `TranslateCarry` sửa thành: "…của một lượt; lô chưa có carry trong lượt nhận trí nhớ series (API)".
2. **`series-suggestions.ts`** (thuần, không phụ thuộc DB):
   - `SUGGESTION_KINDS = ["term", "pronoun"] as const`, kèm type `SuggestionKind`.
   - `normKey(s)` thực hiện lần lượt: `normalize("NFC")`, `trim`, gộp khoảng trắng, `toLowerCase()`. Không dùng locale
     để API và web cho cùng kết quả.
   - `termKey(source) = normKey(source)` và `pronounKey(speaker, listener) = `${normKey(speaker)}→${normKey(listener)}``.
3. Chạy `pnpm schema:emit`. Kiểm `job-result.schema.json` có 2 property mới và chúng không nằm trong `required`.
4. **`app.ts`**:
   - `chapters`: thêm `translateMemory: jsonb("translate_memory").$type<TranslateMemory>()` (nullable). Comment:
     "carry cuối lượt dịch cả chương — lô đầu chương khác trong series mở đầu bằng nó (xem lib/series-memory.ts)".
   - Bảng mới `seriesSuggestions` đặt sau `proofreadSuggestions`:
     - Cột: `id idPk`, `userId userId()`, `seriesId uuid notNull`, `kind text $type<SuggestionKind> notNull`,
       `key text notNull`, `data jsonb $type<LearnedTerm | LearnedPronoun> notNull`, `chapterId uuid` (null, không có
       FK: xoá chương thì chỉ mất nhãn "Ch. X"), `dismissedAt timestamptz`, `createdAt timestamptz defaultNow`.
     - Ràng buộc: FK `(user_id, series_id)` → `series(user_id, id)` on delete cascade;
       `unique("series_suggestions_series_kind_key_uq").on(seriesId, kind, key)`;
       `check("series_suggestions_kind_chk", inList(kind, SUGGESTION_KINDS))`.
     - Comment bảng: nguồn gợi ý, luật ẩn khi đọc (đã có trong glossary hoặc quy tắc), `dismissed_at` = Bỏ.
5. `pnpm db:generate -- --name series_memory` (hoặc `pnpm --filter @mtl/db generate --name series_memory`). Đọc lại SQL:
   chỉ có `ADD COLUMN` nullable, `CREATE TABLE`, FK và unique, không có `DROP` nào.
6. Down tay `0026_series_memory.down.sql` theo mẫu `0025_system_fonts.down.sql`: `BEGIN;`,
   `DROP TABLE IF EXISTS series_suggestions;`, `ALTER TABLE chapters DROP COLUMN IF EXISTS translate_memory;`, xoá dòng
   migration cuối trong `drizzle.__drizzle_migrations`, `COMMIT;`.

## Tests

- `shared-contracts.test.ts`:
  - `JobResult` của `chapter.translate` hợp lệ trong 3 trường hợp: không có key mới, có `new_terms`/`pronoun_pairs`
    hợp lệ, có key lạ (bị strip).
  - Sai `kind`, chuỗi rỗng, chuỗi 201 ký tự, hoặc 51 phần tử thì bị từ chối.
  - Test lệch json-schema đã có (l.261) phải xanh sau khi emit.
- `series-suggestions.test.ts`: chuỗi NFD và NFC cùng khoá (ví dụ "민준" dạng NFD), không phân biệt hoa/thường, khoảng
  trắng đôi và đầu/cuối, `pronounKey` có thứ tự (A→B khác B→A).
- `pnpm --filter @mtl/shared test`, `pnpm typecheck`. API và web chưa dùng các kiểu mới, nên chỉ cần typecheck không vỡ.

## Risks

| Rủi ro | Giảm thiểu |
|---|---|
| Quên emit json-schema, worker validate theo schema cũ và từ chối result mới (lỗi hợp đồng làm hỏng job) | Test lệch schema chặn trong CI. Phase 2 test `validate_contract("job-result")` với key mới |
| drizzle-kit sinh thêm thay đổi ngoài ý muốn (snapshot lệch) | Đọc lại SQL. Chỉ chấp nhận đúng 1 cột và 1 bảng |
| Đặt FK cho `chapter_id` có `ON DELETE SET NULL` trên FK ghép sẽ đụng `user_id NOT NULL` | Không đặt FK cho cột này (quyết định ở bước 4) |

## Rollback

Migration chỉ thêm, nên app bản cũ chạy trên schema mới không lỗi. Muốn gỡ hẳn: chạy down SQL rồi revert commit.
