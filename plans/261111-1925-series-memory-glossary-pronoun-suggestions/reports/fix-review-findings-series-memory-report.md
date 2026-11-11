# Fix review findings: series memory

Date 11/11/2026. All in `apps/api/src/lib/series-memory.ts` (SM), `apps/api/test/series-memory.test.ts` (T), worker files.

| Finding | Change | Test |
|---|---|---|
| H1 + L2 | SM `admit()`: loads all existing keys of series+kind once (incl. dismissed); drops known keys BEFORE `slice(0, room)`; pending = `dismissed_at is null` AND key not in covered set (glossary / pronoun_rules). Cap 200 unchanged. Replaces `pendingCount`. | T "accepting a suggestion frees a slot under the cap" (200 pending, accept via glossary POST, new term inserted); "an already known dismissed key does not take the last free slot" (199 pending + dismissed key listed first) |
| M1 | SM `hasPendingTranslate()` + condition in `rememberTranslate`. `queue.ts` untouched (rememberTranslate already runs after the batch's `translate_queued=false` write, before `advanceTranslateChain`). | T "memory is written only by the last batch of a full run" (6 pages = 2 batches, retranslate of chapter with memory: batch 1 leaves memory, last batch updates) |
| M2 | SM `translatableCount()`; full run = `runTarget === "translated"` AND `runTotal >= translatableCount`. | T "default flow with a page failed at step 1 still writes memory after the last batch" (ingest `prepared`, 1 page failed `invalid_input`, `translatePrepared`). Existing partial-retranslate test still passes. |
| L1 | SM `rows.sort` by (kind, key) before the insert, with comment. | none (deadlock needs true concurrency) |
| L5 | T: `db.update(seriesSuggestions)` now `.where(seriesId = S.seriesId)`. | n/a |
| L7 | SM `UNKNOWN = /[?？]/` for speaker/listener, address `?` or `？`; worker `_UNKNOWN_SPEAKER` in `handlers.py` `_learned`. | T filter test gains `？` speaker, `？` listener, `？` address; worker `test_translate_learned.py` gains `？` speaker/listener pairs, assertion updated |
| L4 | `worker/mtl_worker/__init__.py` `# 0.11.0:` line. | n/a |

## Predicates (evidence)

- Pending translation (M1): non-skipped page of the chapter with `translate_queued = true` AND NOT (`status = 'failed'` AND (`ocr_result` is null OR `prepare_input_rev` is null)). This mirrors `queuedPages` + `step1Failed` (`!hasOcr`) in `jobs/translate-chain.ts`, i.e. exactly the pages `advanceTranslateChain` would still batch or wait on (pages still in step 1 count as pending). Quota stop calls `closeRun` after `rememberTranslate`, so queued pages remain at write time and memory is not written; a cancelled run never completes its batch.
- Translatable page (M2): `skipped = false AND ocr_result is not null AND prepare_input_rev is not null` (`hasOcr` in translate-chain.ts). `translatePrepared` selects `status = 'prepared'` non-skipped pages (all have OCR; step1-failed pages do not); status is not used in the count because the just-finished batch has already turned pages `ready`/`failed`.

## Notes

- Behavior change: suggestions of one batch now insert in (kind, key) order, so within the same `created_at` the list order is by key. One existing expectation (order of "민 준" / "민준" in the filter test) was updated for this; no test assumed per-batch memory writes.
- Memory now comes from the last batch's `carry` only; if that batch's result has no `carry`, memory is not written (worker always sends it).
- Verified green: `pnpm --filter @mtl/api test` (561 pass, 1 skip), worker pytest 414, ruff, `pnpm typecheck`, `pnpm lint`. Not committed.

Status: DONE
Summary: H1/L2, M1, M2, L1, L4, L5, L7 implemented with tests; all suites, typecheck, lint, ruff green.
Concerns/Blockers: none

## Sửa theo re-review (N1–N5)

- **N1**: ghi trí nhớ chuyển sang nhánh `live.length === 0` của `advanceTranslateChain` (ngay trước `closeRun`), qua `rememberRunMemory(tx, ch, s, carry)` trong `lib/series-memory.ts`; carry = `lastCarry` (lô thành công gần nhất của lượt, không có thì không ghi). Giữ điều kiện `runTarget === "translated"` và `runTotal >= translatableCount`. Cặp ngôn ngữ lấy từ cài đặt series hiện tại (cùng thứ `memoryCarry` so khi đọc). `rememberTranslate` đổi tên thành `rememberSuggestions` (chỉ lưu gợi ý), xoá `hasPendingTranslate`. Chương đã khoá bởi `lockChapter` ở đầu `advanceTranslateChain` nên thứ tự khoá job → chapter → pages không đổi. Quota đóng lượt trước nhánh này, huỷ đi qua `stopTranslateChain` nên cả hai không ghi (có test). Test mới: kịch bản probe (lô cuối xong rồi trang lỗi bước 1), huỷ, hết hạn mức. Giới hạn đã biết: lượt chạy tiếp sau dừng vì hạn mức không ghi trí nhớ.
- **N2**: Nhận/Bỏ của mọi hàng bị khoá khi `accept.isPending || dismiss.isPending` (glossary) / `dismiss.isPending` (xưng hô).
- **N3**: `focusAfterRemoval` chỉ chuyển focus khi focus đang ở body/null hoặc trong mục gợi ý.
- **N4**: `.ai-src` dùng `word-break: keep-all; overflow-wrap: anywhere` thay `nowrap`.
- **N5**: e2e kiểm `expect.soft(res.status()).toBe(204)` khi xoá series (route trả 204).
