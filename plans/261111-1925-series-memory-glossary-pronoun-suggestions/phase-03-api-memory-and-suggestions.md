---
phase: 3
title: "API: trí nhớ series + gợi ý"
status: completed
priority: P2
effort: "5h"
dependencies: [1]
---

# Phase 3: API – trí nhớ series + gợi ý

## Overview

API làm 3 việc:
1. Khi nhận result dịch, ghi trí nhớ chương theo D2 và lưu gợi ý.
2. Khi lượt dịch chưa có carry, lấy trí nhớ của chương gần nhất làm carry (D1, D11).
3. Thêm route đọc gợi ý và route Bỏ gợi ý. Không có route "Nhận" riêng (D3).

## Context (đã đọc và trace)

- `apps/api/src/jobs/translate-chain.ts:151-159`: `lastCarry` lấy carry của job dịch thành công gần nhất **trong lượt**.
  `translate-chain.ts:193-232`: `advanceTranslateChain` đã khoá chương (`lockChapter`), rồi
  `enqueueTranslate(…, { carry: await lastCarry(tx, ch.id) })` (l.224-231). Ngoài chỗ này không nơi nào gọi
  `enqueueTranslate` (đã grep).
- `apps/api/src/jobs/enqueue.ts:296-341`: `enqueueTranslate` đưa `carry` vào payload. `translateKey` (l.330-337)
  **không chứa carry**, nên trí nhớ không làm đổi input_rev hay idempotency. `seriesOf` ở `enqueue.ts:132`.
- `apps/api/src/jobs/queue.ts:480-518`: `applyResult` nhánh `chapter.translate`. Nhánh này khoá chương ở l.488 (giá trị
  trả về đang bị bỏ), ghi `writeAiState`, cập nhật status, rồi gọi `refreshChapter` (l.516) và
  `advanceTranslateChain` (l.517). Thứ tự khoá job → chapter → pages.
- `queue.ts:584-630`: `applyProofread` là mẫu lọc và chèn gợi ý phía server.
- `chapters.runTarget`, `runTotal` (`packages/db/src/schema/app.ts:113-116`). `openRun` ghi
  `runTotal = pageIds.length` (`translate-chain.ts:161-167`). Ingest có `run_target='translated'` thì ghi
  `runTotal = số trang` (`enqueue.ts:518`).
- Glossary hiệu lực của series: `seriesGlossaryWhere` (`apps/api/src/lib/glossary-scope.ts:14-25`).
  Quy tắc xưng hô: `series.pronounRules` (`app.ts:75`).
- Mẫu route gợi ý: `apps/api/src/routes/proofread.ts:31-71` (GET danh sách, PATCH `{dismissed}`).
  Đăng ký route ở `apps/api/src/app.ts:96-110`.
- Bắt buộc: route mới có `:param` phải có case trong `RESOURCE_CASES` (`apps/api/test/tenant-isolation.test.ts`, mẫu
  l.46, 99, 188, 268). Route không được dùng `db` thô, chỉ dùng `c.get("sdb")`.

## Files

| Thao tác | File |
|---|---|
| Tạo | `apps/api/src/lib/series-memory.ts` |
| Sửa | `apps/api/src/jobs/translate-chain.ts` (l.12 doc, l.224-231) |
| Sửa | `apps/api/src/jobs/queue.ts` (l.480-518, import `seriesOf`) |
| Tạo | `apps/api/src/routes/series-suggestions.ts` |
| Sửa | `apps/api/src/app.ts` (đăng ký route) |
| Tạo | `apps/api/test/series-memory.test.ts` |
| Sửa | `apps/api/test/tenant-isolation.test.ts` |

## Implementation steps

1. **`lib/series-memory.ts`**. Chỉ import `@mtl/db`, `@mtl/shared` và `lib/glossary-scope.ts`, không import `jobs/*` để
   tránh vòng import.
   - `MAX_PENDING_PER_KIND = 200`.
   - `memoryCarry(tx, ch, s): Promise<TranslateCarry | undefined>`. Chạy một câu `select` trên `chapters` với điều kiện
     `series_id = ch.seriesId`, `id <> ch.id`, `translate_memory is not null`,
     `translate_memory->>'source_lang' = s.sourceLang`, `->>'target_lang' = s.targetLang`. Sắp xếp
     `(number <= ch.number::numeric) desc, abs(number - ch.number::numeric), updated_at desc`, lấy `limit 1`.
     Kết quả đi qua `TranslateMemory.safeParse`; sai thì trả `undefined`. Trả `{ notes, characters }`, bỏ cặp ngôn ngữ
     để payload giữ đúng hợp đồng `TranslateCarry`. Có sẵn index `chapters_series_idx` (`app.ts:122`).
   - `coveredKeys(tx, s)` trả `{ terms: Set<string>, pronouns: Set<string> }`. `terms` là `termKey(sourceTerm)` của
     entry trong `seriesGlossaryWhere(s)`, chỉ select cột `source_term`. `pronouns` là `pronounKey(speaker, listener)`
     của `s.pronounRules`.
   - `rememberTranslate(tx, { job, ch, s, result })`:
     a. Trí nhớ: nếu `result.carry` có giá trị, `ch.runTarget === "translated"` và
        `ch.runTotal >= count(pages where chapter_id = ch.id and skipped = false)`, thì `update chapters set
        translate_memory = { ...carry, source_lang, target_lang }`. Cặp ngôn ngữ lấy từ `job.payload.settings`
        (thiếu thì là `ko`/`vi`, như worker mặc định).
     b. Gợi ý: không có `new_terms`/`pronoun_pairs` thì return luôn. Nếu có, chuẩn hoá NFC và trim. Bỏ mục có khoá đã
        có trong `coveredKeys`, thuật ngữ có `normKey(source) === normKey(target)` (D8), cặp có `"?"` hoặc người nói
        trùng người nghe. Khử trùng theo khoá. Đếm số gợi ý pending (`dismissed_at is null`) theo từng loại, rồi cắt
        cho vừa trần D9. Cuối cùng chạy `insert … values (…) on conflict (series_id, kind, key) do nothing`, với
        `chapterId = payload.chapter_id`.
   - `listSuggestions(sdb, s)` cho route: lấy dòng chưa Bỏ của series, bỏ dòng có khoá đã phủ, nối `chapters` lấy
     `number` (chương đã xoá thì `null`). Trả
     `{ terms: [{id, source, target, kind, chapter_number, created_at}], pronouns: [{id, speaker, listener, address, chapter_number, created_at}] }`,
     sắp theo `created_at, id`. Truy vấn đi qua `Scoped` (có `user_id`).
2. **`translate-chain.ts`**:
   - l.224-231: `const carry = (await lastCarry(tx, ch.id)) ?? (await memoryCarry(tx, ch, await seriesOf(tx, ch)));`.
     `seriesOf` đã import sẵn ở l.24-32.
   - Doc đầu file (l.12): "Ngữ cảnh: … + `carry` của lô thành công gần nhất trong lượt; lượt chưa có thì trí nhớ series
     (lib/series-memory.ts)".
3. **`queue.ts`** nhánh `chapter.translate`:
   - l.488: `const ch = await lockChapter(t, owner, p.chapter_id);`.
   - Trước `refreshChapter` (l.516): `await rememberTranslate(t, { job, ch, s: await seriesOf(t, ch), result });`.
     Thêm `seriesOf` vào import ở l.50.
   - Thứ tự khoá không đổi: ghi `chapters` (đã khoá) và INSERT `series_suggestions` (FK chỉ lấy KEY SHARE trên dòng
     `series`, tương thích với `UPDATE series SET glossary_rev` mà route glossary/series đang dùng). Không thêm
     `FOR UPDATE` trên `series`.
4. **`routes/series-suggestions.ts`**:
   - `GET /series/:seriesId/suggestions`: `sdb.byId(series, …)` (series của người khác trả 404), rồi gọi
     `listSuggestions`.
   - `PATCH /series-suggestions/:suggestionId` với body `{ dismissed: boolean }`: `sdb.byId(seriesSuggestions, …)`, đặt
     `dismissedAt`, trả `{ id, dismissed }`. Cùng dạng với `PATCH /proofread-suggestions/:id`, tiện cho nút hoàn tác
     sau này.
   - Comment đầu file nói rõ "Nhận" đi qua route glossary/series có sẵn, server ẩn gợi ý đã có.
5. **`app.ts`**: `app.route("/", seriesSuggestionRoutes)`, đặt cạnh `glossaryRoutes`.

## Tests (`pnpm --filter @mtl/api test`)

Tạo `apps/api/test/series-memory.test.ts`, dựa trên các helper của `translate-chain.test.ts` (`ingested`, `prepare`,
`claimTranslate`, `complete`). Test tên tiếng Anh, mô tả hành vi:

| Ca | Kỳ vọng |
|---|---|
| full run on chapter 1 writes translate_memory with the language pair | `chapters.translate_memory = {notes, characters, source_lang, target_lang}` sau lô cuối |
| partial retranslate does not overwrite memory | Đặt sẵn trí nhớ, dịch lại `page_ids` một phần, trí nhớ giữ nguyên |
| first batch of chapter 2 starts from chapter 1 memory | `payload.carry` của lô 1 bằng `{notes, characters}` của chương 1 |
| next batch uses the run carry, not memory | Complete lô 1 có `carry` X, `payload.carry` của lô 2 bằng X |
| picks the nearest lower chapter, else the nearest higher, never itself | Có chương 1, 3, 5 cùng có trí nhớ: chương 4 lấy của 3, chương 0.5 lấy của 1, chương 3 không lấy của chính nó |
| memory of another language pair is ignored | Đổi `target_lang` của series, lô đầu không có `carry` |
| old worker result without new keys completes and stores nothing | 200, không có dòng `series_suggestions` |
| suggestions skip glossary, shared pair glossary, rules, identical and '?' | Chỉ còn đúng mục mới |
| duplicate across chapters and dismissed never come back | Chương 2 gợi ý lại khoá đã Bỏ thì GET không thấy |
| accepting via glossary POST / series PATCH hides the suggestion | POST glossary (khác hoa thường) thì gợi ý thuật ngữ biến mất. PATCH `pronoun_rules` thì gợi ý cặp biến mất |
| pending cap per kind | Có sẵn 200 gợi ý pending, thêm nữa không được chèn |
| PATCH dismissed true/false toggles visibility | |

Thêm vào `tenant-isolation.test.ts`:
- Seed một dòng `series_suggestions` cho mỗi user (theo mẫu l.99).
- `RESOURCE_CASES` thêm `GET /api/series/:seriesId/suggestions` và `PATCH /api/series-suggestions/:suggestionId`,
  kèm body `{ dismissed: true }` theo mẫu l.188.

Hồi quy: `translate-chain.test.ts` phải xanh nguyên vẹn. Ca "carry from the previous batch…" kỳ vọng lô 1 không có
carry, và vẫn đúng vì series có một chương nên không có trí nhớ nguồn.

## Risks

| Rủi ro | K×T | Giảm thiểu |
|---|---|---|
| Lỗi DB khi lưu gợi ý làm rollback cả transaction complete, trang đã dịch bị mất kết quả | Thấp×Cao | Zod đã chặn độ dài. Dùng `ON CONFLICT DO NOTHING`. Không ràng buộc nào khác có thể vỡ. Có test với dữ liệu biên |
| Đua: 2 chương cùng series complete cùng lúc | Thấp×Thấp | Unique khoá chống trùng. Trần pending có thể vượt vài dòng, chấp nhận |
| `number` là `numeric` nên so chuỗi sẽ sai thứ tự | TB×TB | So trong SQL bằng `::numeric`. Có test chương 0.5 |
| Lượt của ingest manga (`run_target` từ ingest) bị coi là lượt một phần | Thấp×TB | `runTotal = số trang được chèn` (`enqueue.ts:518`) bằng số trang hiện, nên là lượt cả chương. Có ca test riêng nếu helper `ingested` hỗ trợ `target: "translated"` |
| Thêm câu query trong `applyResult` làm chậm complete | Thấp×Thấp | Mỗi lô thêm 1 count `pages`, 1 select `source_term` glossary, 1 insert |

## Rollback

Revert phase này: lô đầu quay về carry rỗng như trước, không còn gợi ý mới, route mất. Dữ liệu đã ghi vô hại. Worker
mới vẫn gửi key mới, API (bản cũ hoặc bản đã revert) strip bỏ.
