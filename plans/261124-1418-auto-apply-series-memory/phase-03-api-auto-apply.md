---
phase: 3
title: "API: tự áp vào series"
status: completed
priority: P2
effort: "7h"
dependencies: [1]
---

# Phase 3: API – tự áp thuật ngữ, xưng hô, giọng văn

<!-- Updated: Red Team Session 1 - ghi ở complete, khoá có user_id, trần mục sống, chế độ bảo vệ PATCH, DELETE series -->

## Goal

Complete `chapter.translate` ghi thẳng thuật ngữ, cặp xưng hô và (khi trống) Giọng văn vào series, có nhãn AI. Form
Cài đặt và tab web cũ không đè mất mục AI. Không có deadlock mới.

## Context

- `apps/api/src/jobs/queue.ts:489-519`: nhánh `chapter.translate` khoá chương (l.489), gọi `rememberSuggestions` (l.517)
  rồi `advanceTranslateChain` (l.519). Lô kế được enqueue trong cùng transaction và đọc lại series
  (`enqueue.ts:304-305, 321`), nên mục vừa ghi có trong `payload.settings` của lô kế.
- Reaper (`reaper.ts:15-27`) và claim (`queue.ts:259-316`) gọi `terminal` cho nhiều chương trong một transaction.
  Vì vậy **không** khoá series trong `terminal`, `advanceTranslateChain` hay `rememberRunMemory`.
- `apps/api/src/lib/series-memory.ts`: `coveredKeys`, `acceptTerm`, `acceptPronoun`, `admit`, `rememberSuggestions`,
  `listSuggestions`.
- `apps/api/src/jobs/enqueue.ts:266-286` `translateSettings` (`pronoun_rules: JSON.stringify(s.pronounRules)`).
- `apps/api/src/routes/series.ts`: `PronounRule` (l.34-40), body PATCH bắt buộc khác rỗng (l.70-73), `toColumns`
  (l.~228-240), `translationChanged` (l.243-254), POST (l.343), PATCH (l.373-392, `tx.byId` không khoá), DELETE
  (l.460-468, xoá series rồi cascade chương).
- Mẫu khoá có `user_id`: `routes/series-skip-images.ts:118-123`.
- `apps/api/src/routes/glossary.ts`: `scopeValues` (l.65-68, entry series có `source_lang/target_lang` null),
  `bumpGlossaryRev` (l.76), create (l.219), import CSV (l.246), sửa (l.325), xoá (l.344).
- `apps/api/src/routes/series-suggestions.ts` (GET, PATCH), đăng ký ở `app.ts:29, 110`.
- Test: `series-memory.test.ts`, `tenant-isolation.test.ts` (l.18, 53, 115, 222, 307-308), `chapters.test.ts:659`.

## Files to Create / Modify

| Thao tác | File |
|---|---|
| Sửa | `apps/api/src/lib/series-memory.ts` |
| Sửa | `apps/api/src/jobs/queue.ts` (đổi tên hàm gọi ở l.517) |
| Sửa | `apps/api/src/jobs/enqueue.ts` (`translateSettings` bỏ `origin`) |
| Sửa | `apps/api/src/routes/series.ts` (PATCH, POST, DELETE, view) |
| Sửa | `apps/api/src/routes/glossary.ts` |
| Sửa | `apps/api/src/routes/series-suggestions.ts` (chỉ còn GET trả rỗng) |
| Sửa | `apps/api/test/series-memory.test.ts`, `tenant-isolation.test.ts`, `chapters.test.ts`, test glossary/series liên quan |

## Tasks & Steps

1. **`applyLearned(tx, { job, result })`** thay `rememberSuggestions` (chỉ gọi ở nhánh complete `chapter.translate`):
   1. Khoá `SELECT … FROM series WHERE user_id = job.userId AND id = <series của chương> FOR UPDATE` và dùng dòng vừa
      đọc. Comment: thứ tự khoá chương → series; chỉ gọi ở đường một chương.
   2. Lọc như cũ (trùng nguyên văn, "?", tự gọi mình, đã phủ) cộng làm sạch: thuật ngữ có `target` chứa xuống dòng hoặc
      ký tự điều khiển, hoặc dài hơn 80 ký tự → bỏ; `address` có xuống dòng → bỏ.
   3. Khoá sổ = `ledgerKey(s.sourceLang, s.targetLang, termKey|pronounKey)`. Bỏ khoá đã có trong sổ.
   4. Thuật ngữ: chỉ ghi khi số entry `origin='ai'` của series < 200. `INSERT glossary_entries (user_id, series_id,
      source_lang null, target_lang null, source_term, target_term, note '', origin 'ai') ON CONFLICT DO NOTHING`.
   5. Xưng hô: nối `{speaker, listener, address, note: '', origin: 'ai'}` khi `pronoun_rules` < 200.
   6. Giọng văn: `result.style_note` khác rỗng, `style_prompt = ''`, `style_origin IS DISTINCT FROM 'user'` → làm sạch lại
      (một dòng, ≤ 150) rồi ghi `style_prompt`, `style_origin = 'ai'`.
   7. Thêm vào sổ (sắp theo kind, key; `ON CONFLICT DO NOTHING`) mọi khoá đã ghi **và** khoá đã phủ sẵn. Khoá bị bỏ vì
      trần thì không thêm, để lần sau còn học được.
   8. Có ghi gì → `UPDATE series SET pronoun_rules, style_prompt, style_origin, glossary_rev = glossary_rev + 1`.
      Không đụng `settings_rev`.
   9. Bỏ `listSuggestions`, `admit`, `MAX_PENDING_PER_KIND`.
2. **`translateSettings`**: map `pronounRules` về `{speaker, listener, address, note}` trước `JSON.stringify`.
3. **Hàm chung `withOrigins(next, cur)`** cho POST và PATCH: cặp trùng y nguyên (speaker, listener, address, note) với
   một cặp `ai` hiện có thì giữ `'ai'`, còn lại `'user'`. Không nhận `origin` từ client. POST dùng nó với `cur = []`.
4. **PATCH series**:
   - Khoá theo mẫu skip-images (`user_id` + `id`, `FOR UPDATE`), rồi dùng `scoped(tx, userId)` cho phần còn lại.
   - Body nhận `pronoun_keys_seen?: z.array(z.string().max(250)).max(200)`. Server chuẩn hoá lại từng khoá.
   - **Có `pronoun_keys_seen`** (web mới): nếu có `pronoun_rules` thì kết quả = các cặp trong body + các cặp hiện có
     mà khoá không thuộc `pronoun_keys_seen` và không có trong body. Tổng > 200 thì bỏ bớt cặp chưa thấy. `style_prompt`
     có trong body và khác hiện tại → `style_origin = 'user'`.
   - **Không có `pronoun_keys_seen`** (tab cũ): giữ các cặp `origin='ai'` hiện có mà body không có. Không ghi
     `style_prompt = ''` khi `style_origin = 'ai'` (bỏ qua trường đó).
   - `translationChanged` so `pronoun_rules` sau khi bỏ `origin`. `seriesView` trả `style_origin` và `origin` từng cặp.
5. **DELETE series**: trước khi xoá series, `SELECT id FROM chapters WHERE series_id = … ORDER BY id FOR UPDATE`.
6. **Glossary routes**: create và import CSV ghi `origin 'user'`; sửa entry → `origin 'user'`; list trả `origin`.
7. **`series-suggestions.ts`**: chỉ còn `GET /series/:id/suggestions` trả `{ terms: [], pronouns: [] }` (sau khi kiểm
   series thuộc người dùng), comment "giữ một bản cho tab web cũ". Bỏ PATCH. Sửa `tenant-isolation.test.ts`
   (`BODIES` l.222, `RESOURCE_CASES` l.307-308).

## Verification

- `pnpm --filter @mtl/api test` (tuần tự, một worker), `pnpm lint`, `pnpm typecheck`.
- Test trong `series-memory.test.ts`:
  1. Complete có `new_terms`/`pronoun_pairs`/`style_note` → entry `origin 'ai'`, cặp `origin 'ai'`, Giọng văn điền,
     `glossary_rev` +1, `settings_rev` không đổi; lô kế trong lượt có các mục đó trong `payload.settings`.
  2. Không ghi: đã phủ (series, chung cùng cặp, `pronoun_rules`), trùng nguyên văn, "?", `target` nhiều dòng hoặc > 80,
     khoá đã có trong sổ (gồm dòng cũ sau migration).
  3. Xoá entry AI rồi complete lại cùng thuật ngữ → không thêm lại. Đổi cặp ngôn ngữ series → học lại được.
  4. Đã có 200 entry AI → không ghi, khoá không vào sổ; xoá bớt một entry → lần sau ghi được.
  5. Giọng văn: đã có chữ hoặc `style_origin 'user'` → không đổi.
  6. Ghi giữa lượt không làm trang nào bị coi là chưa qua Bước 1 (lô kế là dịch, không có `page.prepare`).
  7. Hai transaction thật: hai complete hai chương cùng series cùng thuật ngữ → một entry; complete song song với
     reaper xử lý 2 job của 2 chương cùng series → không deadlock; complete song song với DELETE series → không deadlock.
  8. PATCH: cặp AI chưa thấy còn; xoá cặp AI đã thấy → mất; sửa `note` cặp AI → `'user'`; gộp > 200 → cắt về 200;
     body kiểu cũ không xoá cặp AI và không xoá Giọng văn AI; `settings_rev` chỉ tăng khi người dùng đổi thật.
  9. Result thiếu `style_note`/`new_terms` (worker 0.11/0.12) vẫn complete 200.
- `chapters.test.ts:659` sửa kỳ vọng có `origin: 'user'`.

## Risk

| Rủi ro | Giảm thiểu |
|---|---|
| Complete chờ khoá series khi 2 worker cùng series | Đoạn ghi ngắn; test 7 đo |
| Tên OCR sai vào glossary | Giá đã chấp nhận; nhãn AI để nhận ra, sửa một lần |
| Token vào tăng theo glossary AI | Trần 200 entry sống (P3); Phase 5 đo |
