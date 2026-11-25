# Review web – AI tự ghi trí nhớ series (24/11/2026, Asia/Saigon)

Phạm vi: `git diff -- apps/web` (15 file, +120/−581) cùng 4 file mới. Unit `settings-diff.test.ts`: 8/8 pass (nice 19, 1 worker). Không chạy e2e.

**Critical / High:** không có.

**Medium**
1. `e2e/series-auto-memory.spec.ts:49-58` có thể chập chờn. Series tạo bằng `{title}` nên mặc định là ko → strip, lượt chạy dừng ở `prepared` (`apps/api/src/jobs/enqueue.ts:166`). `refetchInterval` (`series-page.tsx:46`) chỉ poll khi trạng thái là `ingesting`/`processing`. Nếu lần poll 5 giây rơi đúng khoảng `prepared` (khoảng 300–600 ms trước khi `runUntilReady` gọi translate-prepared), trang ngừng poll và không thấy `glossary_rev` mới. Khi đó dòng 58 chờ "Glossary · 2" hết 15 giây rồi fail; ước chừng 6–12% số lần chạy. Sửa: tạo series với `page_format: "pages"` để chương dịch luôn, không dừng ở `prepared`.
2. Tính chất chính của (a), mốc `useRef` không bị poll làm mới (`series-settings-form.tsx:158`), chưa có test nào giữ. Unit `settings-diff.test.ts:40-46` truyền cùng `base` làm form, không mô phỏng việc prop `series` đổi, nên test luôn qua. Ở e2e test 2 (dòng 112-135), lúc `goto` series chưa có chương nên detail không poll và prop không đổi khi AI ghi. Nếu code dùng `toForm(series)` làm mốc ở mỗi lần render, cả hai test vẫn pass. Sửa: ở test 2, gọi `apiCommitChapter` trước `page.goto` để detail poll trong lúc form mở, rồi mới chạy `runUntilReady`.

**Low**
3. Mỗi lần sửa glossary trên màn series, glossary bị tải 2 lần. `glossary-editor.tsx:48-49` invalidate cả `["glossary"]` lẫn `["series"]`. Detail tải lại thấy rev mới thì `series-page.tsx:83-85` invalidate glossary thêm lần nữa. Không thành vòng lặp vì rev đứng yên sau đó. Bỏ qua được, hoặc cập nhật `seenRev` theo rev mà mutation trả về.
4. A11y chip AI (`app/ai-tag.tsx:4`):
   - Phần giải thích chỉ nằm ở `title`. Người dùng bàn phím hay màn cảm ứng không xem được, vì span không focus được dù có `cursor: help`.
   - Giữa chữ và chip không có khoảng trắng. Tên của `<summary>` sẽ thành "Giọng vănAI…" (`series-settings-form.tsx:427`), ô glossary thành "민준AI" (`glossary-editor.tsx:278`).
   - Sửa: thêm `{" "}` trước chip và một `<span className="sr-only">AI tự thêm khi dịch</span>` (lớp `.sr-only` đã có ở `styles/tokens.css:283`).
5. Ngoài `apps/web`: `docs/export-and-batch-edit.md:146-156` và `docs/job-queue-worker.md:181` vẫn mô tả "Gợi ý từ AI" và badge. Việc này thuộc phase 5.

**Đã kiểm, đúng:**
- (a) `buildPatch` trả `null` khi không đổi gì, nên form đóng mà không gọi PATCH. Body chỉ có trường đổi, luôn kèm `pronoun_keys_seen` (chuẩn hoá khớp `normalizeRuleKey`). Xoá cặp đã thấy thì `memoryColumns` (`apps/api/src/routes/series.ts:266-273`) bỏ cặp đó thật. `ignore_text` không bị gửi oan, vì danh sách đã lưu đã qua `cleanIgnoreList` (trim, bỏ trùng).
- (b) Dialog chỉ render khi `tab === "settings"` (`series-page.tsx:63`), nên đóng là unmount. Mở lại thì chụp mốc mới từ cache (đã `setQueryData` sau khi Lưu); e2e dòng 155-163 có kiểm.
- (c) Lần render đầu và StrictMode không invalidate.
- (d) Không còn tham chiếu `/suggestions`, `series-suggestions`, `hint-badge`, `.ai-suggestions`. `.count-badge` vẫn dùng ở `activity-drawer.tsx:67`.
- (e) `chapter-meta-popover.tsx:197` gửi `{source_lang, target_lang}`, đúng kiểu `SeriesPatch`. Server không đụng tới xưng hô hay Giọng văn.
- (f) Đủ 6 kịch bản. Kịch bản 2 dùng chương 2 thay cho "dịch lại", vẫn kiểm được sổ khoá. Spec không có `waitForTimeout`; chỉ helper `runUntilReady` poll 300 ms có hạn chót, như trước.

Status: DONE_WITH_CONCERNS
Summary: Logic web đúng hợp đồng, không có lỗi Critical/High. Có hai điểm Medium ở test: e2e có thể chập chờn khi poll dừng ở `prepared` (series mặc định strip), và tính chất mốc `useRef` chưa test nào giữ.
