# Review worker + API + shared + db: AI tự ghi trí nhớ series (24/11/2026, Asia/Saigon)

Phạm vi: `git diff` của packages/shared, packages/db, worker/, apps/api/ và 4 file mới chưa track. Không xem apps/web. Đã chạy: biome trên 9 file TS đã đổi và ruff trên worker, đều sạch. Kiểm bằng probe: zod 4.6.7 `.max(150)` đếm theo code point (150 emoji qua, 151 bị từ chối). Không chạy test DB.

**Critical / High: không có.** Thứ tự khoá đã lần theo cả hai đầu: complete khoá job → chương → trang → series (`series-memory.ts:219`). Không route nào khoá series rồi mới khoá chương: PATCH series, glossary, skip-images, cover đều không khoá chương; `chapters.PATCH` chỉ lấy KEY SHARE trên series. Reaper, claim và terminal không khoá series. DELETE series khoá chương theo id trước, sau đó mới xoá series, nên khớp với đường complete. Tenant: lệnh khoá series có lọc `user_id`, insert có `userId: s.userId`, PATCH/DELETE dùng `scoped(raw, userId)` sau khi khoá.

Các quyết định agent tự chốt: cả 5 đều ổn.
- QĐ2 cần thiết thật. Trước đây route chèn entry (dòng index unique X đã nằm đó) rồi trigger FK mới lấy KEY SHARE trên series, và chờ complete đang giữ FOR UPDATE. Trong lúc đó complete chèn cùng X thì chờ route. Hai bên chờ nhau thành deadlock. Tăng rev trước thì bỏ được vòng này (sửa entry hay xoá entry cũng có cùng vòng).
- QĐ1 hợp lý vì một job dịch xấp xỉ một lô LLM (`MAX_BATCH_PAGES/REGIONS` của API trùng `make_batches`).
- QĐ5 đúng, đã kiểm bằng probe.

## Medium
1. QĐ2 không có test nào khoá lại. `glossary.ts:226,259,339,357` mà ai đó dời `bumpGlossaryRev` về cuối như cũ thì deadlock quay lại, và không test nào đỏ. Đề xuất: viết test hai transaction thật. Giữ khoá series bằng `holdLock`, gọi POST `/series/:id/glossary` thuật ngữ X song song với complete có `new_terms` X, rồi kiểm cả hai cùng kết thúc (một 201 hoặc 409, một 200).
2. Tài liệu rollback sai so với code. `migrations-down/0030…down.sql:4` ghi "API cũ bỏ qua trường thừa". Thực tế API cũ gửi nguyên `JSON.stringify(s.pronounRules)` (bản HEAD `enqueue.ts:275`), nên `"origin":"ai"` lọt vào prompt, trái P4. Ngoài ra `listSuggestions` cũ so `r.key` với `termKey` không tiền tố, nên khi về API cũ thì **mọi** dòng sổ chưa Bỏ đều hiện thành gợi ý, kể cả mục đang có trong glossary (bấm Nhận sẽ ra 409). Đề xuất: sửa comment trong file down và mục Rollback của plan.

## Low
3. Thông báo lỗi của worker và API lệch nhau với Giọng văn chỉ có khoảng trắng. PATCH nhận `style_prompt: "   "` (`series.ts:60`, không trim). Worker coi là trống nên mỗi lô vẫn xin `style_note` (`handlers.py:176`), còn API chỉ ghi khi đúng `""` (`series-memory.ts:274`), nên tốn token mà không bao giờ điền. Đề xuất: API so `s.stylePrompt.trim() === ""`, hoặc zod `.trim()` cho `style_prompt`.
4. `applyLearned` khoá `FOR UPDATE` (`series-memory.ts:219`). Khoá này xung đột với KEY SHARE do FK lấy khi tạo chương, chèn `series_skip_images` hay `series_suggestions`. Riêng skip-images còn giữ khoá series qua lời gọi mạng `head`/`copyObject`, nên complete cùng series phải chờ trong khi vẫn giữ job và chương. Đề xuất: `.for("no key update")` là đủ để tuần tự hoá với PATCH, glossary và complete khác, và bớt chặn.
5. Với entry chung (`seriesId` null), tăng rev trước giờ khoá **mọi** series của người dùng suốt lượt import CSV. Trước đây chỉ khoá ở cuối. Entry chung không đụng unique với entry AI cấp series nên không cần khoá sớm. Đề xuất: chỉ tăng rev trước khi `seriesId` khác null, entry chung giữ thứ tự cũ.
6. Làm sạch chuỗi AI chỉ chặn được chỉ thị nhiều dòng. Chỉ thị một dòng vẫn vào chỗ "ưu tiên tuyệt đối": `address` tối đa 120, `source` tối đa 200 (chỉ `target` bị cắt ở 80, `series-memory.ts:104`), `style_note` tối đa 150. Rủi ro này plan đã chấp nhận (#9). Đề xuất rẻ: cắt `source`/`speaker`/`listener` của mục AI về khoảng 80 như `target`, và thêm U+200E/U+200F/U+061C/U+FEFF vào `CONTROL`.
7. Test reaper (`series-memory.test.ts:750`) chỉ bắt được khi có người thêm khoá series vào `terminal` nếu reaper xử lý job chương 1 trước, nên đây là lưới an toàn ngẫu nhiên. Migration 0030 (tiền tố khoá cũ) và file down chưa có test trên dòng cũ không tiền tố, vì test chèn sẵn khoá đã có tiền tố.

## Đúng hợp đồng (đã đối chiếu)
- PATCH: phần gộp `pronoun_keys_seen`, `withOrigins`, trần 200 (cắt bớt cặp chưa thấy), chế độ bảo vệ body kiểu cũ, `settings_rev` so theo nội dung: khớp phase 3.
- Không tăng `settings_rev`. `glossary_rev` chỉ dùng trong khoá idempotency.
- Worker cũ thiếu `style_note`/`new_terms` vẫn complete (zod optional, có test). Migration chỉ thêm cột có default hoặc nullable, CHECK trên dữ liệu cũ đều qua.

## Câu hỏi mở
- Web mới có gửi `pronoun_keys_seen` ở **mọi** chỗ PATCH `style_prompt` hoặc `pronoun_rules` không? Thiếu ở chỗ nào thì chỗ đó rơi vào chế độ bảo vệ, và xoá Giọng văn AI sẽ bị bỏ qua mà không báo.

Status: DONE_WITH_CONCERNS
Summary: Không có lỗi Critical/High. Thứ tự khoá, tenant, hợp đồng PATCH và tương thích worker cũ đều đúng, 5 quyết định tự chốt đều ổn. Còn 2 Medium (QĐ2 chưa có test khoá lại; tài liệu rollback sai về `origin` trong prompt và về gợi ý hiện lại) và 5 Low.
