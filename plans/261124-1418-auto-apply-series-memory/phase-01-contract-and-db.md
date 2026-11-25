---
phase: 1
title: "Hợp đồng + DB"
status: completed
priority: P2
effort: "2h"
dependencies: []
---

# Phase 1: Hợp đồng + DB

<!-- Updated: Red Team Session 1 - bỏ applied_at, khoá sổ có tiền tố ngôn ngữ, schema:emit -->

## Goal

Thêm các trường cho nhãn AI và `style_note`, đổi khoá sổ sang có cặp ngôn ngữ, không phá hợp đồng payload hay worker cũ.

## Context

- `packages/shared/src/job.ts`: `TranslateCarry` (l.152), `LearnedTerm`/`LearnedPronoun` (l.160-174), result
  `chapter.translate` (l.310-314).
- `packages/shared/src/series-suggestions.ts` (l.9-21): `normKey`, `termKey`, `pronounKey`.
- `packages/db/src/schema/app.ts`: `series` (l.~80-98), `glossaryEntries` (l.333-358), `seriesSuggestions` (l.476-494).
- JSON Schema cho worker: `packages/shared/json-schema/job-result.schema.json` (`additionalProperties: false`,
  l.715-718), sinh bằng `pnpm schema:emit` (`docs/development-setup.md:63`).
- Migration mới nhất `0029_series_cover_key`; down ở `packages/db/migrations-down/`; sinh bằng
  `pnpm --filter @mtl/db generate`.

## Files to Create / Modify

| Thao tác | File |
|---|---|
| Sửa | `packages/shared/src/job.ts`, `packages/shared/src/series-suggestions.ts` (+ test) |
| Sửa | `packages/shared/json-schema/*.json` (sinh lại) |
| Sửa | `packages/db/src/schema/app.ts` |
| Tạo | `packages/db/migrations/0030_auto_apply_series_memory.sql` (+ `meta/`) |
| Tạo | `packages/db/migrations-down/0030_auto_apply_series_memory.down.sql` |

## Tasks & Steps

1. `job.ts`:
   - `MAX_STYLE_NOTE = 150`; result `chapter.translate` thêm `style_note: z.string().max(MAX_STYLE_NOTE).optional()`.
   - `ORIGINS = ["user", "ai"] as const`, type `Origin`.
   - Sửa comment `LearnedTerm`/`LearnedPronoun`: "API ghi thẳng vào series (nhãn AI)".
2. `series-suggestions.ts`: thêm `ledgerKey(src, tgt, key) => \`${src}>${tgt}|${key}\``. Test cho hàm mới.
3. `app.ts`:
   - `glossaryEntries.origin`: `text("origin").$type<Origin>().notNull().default("user")` + check trong `ORIGINS`.
   - `series.styleOrigin`: `text("style_origin").$type<Origin>()` nullable (null = chưa ai đặt) + check.
   - Sửa comment `seriesSuggestions`: sổ khoá AI đã gặp, khoá có cặp ngôn ngữ; `dismissed_at` chỉ còn ý nghĩa lịch sử.
4. `pnpm --filter @mtl/db generate` (tên `0030_auto_apply_series_memory`), rồi thêm tay vào cuối file SQL:
   `UPDATE series_suggestions s SET key = ser.source_lang || '>' || ser.target_lang || '|' || s.key FROM series ser
   WHERE ser.id = s.series_id AND s.key NOT LIKE '%|%';`
   Câu này giữ mọi dòng cũ làm khoá đã gặp (plan P1). File down: bỏ tiền tố (`substring(key from position('|' in key) + 1)`),
   `DROP CONSTRAINT`, `DROP COLUMN`.
5. `pnpm schema:emit` và commit file JSON Schema sinh ra.

## Verification

- `pnpm --filter @mtl/shared test`, `pnpm typecheck`.
- Sao lưu DB dev (`pg_dump -Fc`) → áp migration → kiểm khoá cũ có tiền tố → chạy down → áp lại: đều thành công.
- Result thiếu `style_note` vẫn parse; `style_note` 151 đơn vị UTF-16 bị từ chối. JSON Schema có `style_note`.

## Risk

- Khoá cũ có chứa `|` (tên có ký tự này) sẽ không được thêm tiền tố. Hiếm; điều kiện `NOT LIKE '%|%'` chỉ để chạy lại
  migration không cộng tiền tố hai lần. Ghi chú trong file SQL.
