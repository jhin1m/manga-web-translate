# Phase 2 report: worker learned terms

## Files
- `worker/mtl_pipeline/schema.py`: `TermKind`, `NewTerm` (kind validator -> "term"), `PronounPair`; `TranslateResult.new_terms/pronoun_pairs`.
- `worker/mtl_pipeline/providers/base.py`: TRANSLATE_SCHEMA (+2 props, both required, no maxItems); `_lenient` + `parse_translate` (never raises for the 2 arrays).
- `worker/mtl_pipeline/translate.py`: `_translate_once` returns 5-tuple; `ChapterTranslation.new_terms/pronoun_pairs`; public `norm_key` (strip, NFC, casefold); aggregation first-wins; hard-failed page contributes nothing.
- `worker/mtl_worker/handlers.py`: limits consts, `_clean`, `_learned`; `handle_translate` returns `**_learned(tr)`.
- `worker/mtl_worker/__init__.py`: PIPELINE_VERSION 0.11.0 (API env untouched).
- `worker/mtl_pipeline/prompts/translate_batch.md`: context/context_notes/new_terms/pronoun_pairs.
- `worker/tests/test_translate_learned.py`: new, 22 cases (parse, aggregation, split fallback, hard fail, retry-fallback, handler cut/filter/dedup, no-key-when-empty, strict_schema, prompt).
- No existing test needed changes.

## Commands
- `uv run pytest -q`: 414 passed. `uv run ruff check`: clean. `ruff format` applied to touched files.
- mypy: not in CI (no `.github` hit). Baseline already 66 errors (tests only); now 68 = +2 in new test file, same `_Deps`-vs-`Deps` pattern as test_translate_carry.py. Zero errors in source files.
- Callers of translate_batch/parse_translate/_translate_once: providers, bench wrapper, translate.py only. `page.ocr_region` does not use translate_batch; no other caller reads the new arrays.

## Deviations
- Dedup in `_learned` uses `norm_key` (NFC+casefold) rather than plain casefold, so NFD/NFC duplicates collapse after cutting too.
- A term whose only trailing char is an emoji straddling the 200 cut loses that emoji (surrogate not split); then trailing space stripped.
- Split fallback on schema error: a plain `schema` ProviderError is first retried in-job (existing behavior); tests use `OutputTokensExceeded` to force the split.

## Final prompt wording (new/changed lines)
- context: "ngữ cảnh cuộn (các dòng nguồn + bản dịch gần nhất; `characters` = nhân vật đã gặp; `notes` = ghi chú, có thể mang từ chương trước của cùng truyện). Giữ nhất quán với nó; khi mâu thuẫn, `glossary` và `pronoun_rules` thắng."
- context_notes: "ghi chú cập nhật (≤ 500 ký tự): giữ điều trong `context.notes` còn đúng, thêm nhân vật mới, quan hệ, cặp xưng hô đã chốt — dùng cho lô sau và chương sau."
- new_terms: "tên riêng / thuật ngữ cần dịch thống nhất cả truyện (tên người, địa danh, tổ chức, chiêu thức, vật phẩm đặc biệt) xuất hiện trong lô mà CHƯA có trong `glossary`. `source` = đúng chuỗi trong nguồn; `target` = bản dịch bạn đã dùng; `kind`: person | place | term. Không đưa từ thông dụng, câu, tiếng động, tên nhóm dịch / watermark. Tối đa 8; không có → []."
- pronoun_pairs: "cặp xưng hô đã dùng trong lô mà CHƯA có trong `pronoun_rules`: `speaker`, `listener` = tên nhân vật (như trường `speaker`, không dùng "?"); `address` = cách speaker xưng / gọi listener (VD "anh/em", "tôi/cậu"). Chỉ khi rõ ai nói với ai. Tối đa 5; không có → []."
- Curly-quote sentence kept.
