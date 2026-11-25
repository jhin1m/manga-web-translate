# Brainstorm: AI tự bổ sung trí nhớ series thay vì gợi ý

Ngày 24/11/2026. Thay luồng "Gợi ý từ AI → Nhận/Bỏ" của plan
[261111-1925-series-memory-glossary-pronoun-suggestions](../261111-1925-series-memory-glossary-pronoun-suggestions/plan.md)
bằng luồng tự ghi. Quyết định này đảo D4 và D5 của plan đó theo yêu cầu người dùng.

## Hiện trạng (đã đọc code)

- Worker trả `new_terms` (≤ 5/lô) và `pronoun_pairs` (≤ 3/lô) cùng kết quả dịch. API lưu thành gợi ý chờ duyệt ở bảng
  `series_suggestions` (`apps/api/src/lib/series-memory.ts` `rememberSuggestions`). Người dùng bấm Nhận/Bỏ ở modal
  Glossary và nhóm Xưng hô (`apps/web/src/features/series/suggestions.ts`, `pronoun-suggestions.tsx`).
- Ghi chú ngữ cảnh đã tự động: `carry` chuyền giữa các lô, và lượt dịch cả chương lưu vào `chapters.translate_memory`
  để chương sau mở đầu bằng nó.
- Mỗi lô dịch chụp cài đặt lúc enqueue (`translateSettings`, `apps/api/src/jobs/enqueue.ts:266`). Vì vậy mục được ghi sau
  lô 1 sẽ có trong lô 2 của cùng chương.
- `Giọng văn` (`style_prompt`) do người dùng nhập tay, worker gộp vào `pronoun_rules` (`worker/mtl_worker/handlers.py:166`).
  AI không bao giờ điền.
- Web không có chỉ báo "trang lỗi thời" khi `glossary_rev` đổi, nên tăng `glossary_rev` giữa lượt không làm phiền người dùng.

## Hợp đồng

**Outcome:** Mỗi chương dịch xong, AI tự cộng thêm vào kho chung của series: thuật ngữ và tên riêng vào Glossary, cặp
xưng hô vào Xưng hô, giọng văn vào Giọng văn (khi ô này trống), ghi chú ngữ cảnh như hiện nay. Lô sau trong cùng chương
và chương sau dùng ngay. Người dùng không phải bấm Nhận.

**Constraints:**

- Không ghi đè mục người dùng tự nhập. Thuật ngữ đã có (glossary series hoặc glossary chung cùng cặp), cặp
  (người nói, người nghe) đã có, Giọng văn đã có chữ: AI bỏ qua.
- Mục AI ghi có nhãn "AI" để nhận ra. Người dùng sửa mục đó thì nhãn mất (coi như đã xác nhận).
- Mục AI ghi mà người dùng xoá thì AI không thêm lại (dùng `series_suggestions.dismissed_at` làm bia mộ).
- Ghi xưng hô hoặc giọng văn do AI **không được tăng `settings_rev`**. `settings_rev` nằm trong khoá Bước 1
  (`translate-chain.ts:358`), tăng giữa lượt sẽ làm mọi trang coi như chưa qua Bước 1 và chạy lại OCR. Tăng
  `glossary_rev` (khoá giai đoạn dịch), giống cách Chữ bỏ qua đang làm (`routes/series.ts:382`).
- Không thêm lượt gọi LLM. Giọng văn lấy từ một trường output mới, ngắn, chỉ yêu cầu khi `style_prompt` trống.
- Worker cũ (0.11.0) vẫn chạy được: key mới trong result là optional, `MIN_PIPELINE_VERSION` giữ nguyên.
- Giữ thứ tự khoá hiện có (dòng chương rồi mới tới dòng series) để tránh deadlock khi 2 worker dịch 2 chương cùng
  series song song.
- Có migration: sao lưu DB trước khi chạy.

**Non-goals:**

- Ô "Ngữ cảnh chương" xem/sửa ghi chú AI theo từng chương (người dùng chọn cộng dồn vào series, không UI riêng ở chương).
- Lớp "Trí nhớ AI" riêng có ưu tiên thấp hơn glossary.
- AI sửa hoặc ghi đè mục đã có. AI chọn Kính ngữ (giữ nguyên / chuyển).
- Tự nhận ngôn ngữ nguồn, phân loại credit (đã xếp sau trong backlog).

**Acceptance criteria:**

1. Test API: dịch xong lô có `new_terms`/`pronoun_pairs` thì glossary series có entry mới (nhãn AI) và `pronoun_rules`
   có cặp mới (nhãn AI). `glossary_rev` tăng, `settings_rev` không đổi. Lô kế trong cùng lượt có các mục đó trong
   `payload.settings`.
2. Test API: thuật ngữ đã có (series hoặc chung cùng cặp), cặp đã có, mục trùng nguyên văn, speaker "?", mục đã bị xoá
   trước đó đều không được ghi.
3. Test API: `style_prompt` trống thì sau lượt dịch cả chương được điền từ output AI, có nhãn AI. `style_prompt` đã có
   chữ thì không đổi.
4. Test API: lượt dịch cả chương không chạy lại Bước 1 sau khi AI ghi xưng hô/giọng văn giữa lượt.
5. Test: hai chương cùng series dịch song song cùng ra một thuật ngữ thì chỉ có một entry, không lỗi, không deadlock.
6. E2E: dịch xong chương thấy entry nhãn AI trong Glossary series. Sửa entry thì nhãn mất. Xoá entry rồi dịch lại thì
   entry không quay lại. Danh sách "Gợi ý từ AI" và nút Nhận/Bỏ không còn.
7. Worker cũ 0.11.0 (result thiếu key mới) vẫn complete 200. Các lệnh chất lượng xanh: `pnpm lint`, `pnpm typecheck`,
   `pnpm test`, `cd worker && uv run pytest -q`, e2e liên quan.

## Trade-offs

| Hướng | Giả định chịu lực | Hỏng trước khi |
|---|---|---|
| **A. Ghi thẳng vào Glossary/Xưng hô/Giọng văn (đã chọn)** | Tên AI đọc ra phần lớn đúng, và người dùng chịu sửa một lần khi sai | OCR đọc sai tên ở chương đầu: tên sai có ưu tiên tuyệt đối trong prompt và lan sang mọi chương sau tới khi người dùng sửa |
| B. Lớp "Trí nhớ AI" riêng, ưu tiên thấp hơn glossary | Người dùng chịu xem thêm một danh sách | Người dùng không mở danh sách: tên AI không bao giờ được ghim, nên nhất quán kém hơn A |
| C. Giữ gợi ý, thêm công tắc "tự nhận" | Người dùng muốn giữ quyền duyệt | Trái yêu cầu "thay vì gợi ý"; còn nguyên UI Nhận/Bỏ |

Better approaches: none — hướng khuyến nghị đúng là hướng người dùng yêu cầu (bằng chứng: luồng carry/memory đã tự động
sẵn, chỉ phần glossary/xưng hô còn cần bấm tay; người dùng ưu tiên UI tối giản).

## Quyết định tự chốt (kèm lý do)

| # | Quyết định | Lý do |
|---|---|---|
| Q1 | Nhãn AI: cột `origin` ('user' / 'ai') ở `glossary_entries`, trường `origin` trong từng phần tử `pronoun_rules`, cột `style_origin` ở `series`. Sửa thì đổi về 'user' | Cần biết mục nào do AI ghi để hiện nhãn và để bia mộ chỉ áp cho mục AI |
| Q2 | Giữ bảng `series_suggestions` làm nhật ký mục AI đã ghi và bia mộ. Xoá mục có `origin='ai'` thì đánh `dismissed_at` | Dùng lại khoá chống trùng (series, kind, key) có sẵn, không thêm bảng |
| Q3 | Gợi ý chờ duyệt còn lại lúc nâng cấp: áp một lần vào glossary/xưng hô (nhãn AI), có sao lưu trước | Người dùng muốn tự động; để nguyên thì chúng chặn khoá và không bao giờ được ghi |
| Q4 | Giọng văn AI tối đa khoảng 150 ký tự, chỉ ghi khi lượt dịch cả chương đóng bình thường | Ghi từ lượt một phần dễ ra mô tả lệch; ngắn để không phình prompt |
| Q5 | Giữ trần cũ: 5 thuật ngữ, 3 cặp mỗi lô; 200 mục AI mỗi loại mỗi series | Smoke trước đã đo token +3,1% với trần này |

## Rủi ro cần plan xử lý

- **Form Cài đặt đè mất cặp AI vừa thêm.** Form gửi nguyên mảng `pronoun_rules` khi Lưu. Nếu AI thêm cặp sau lúc form
  mở thì Lưu sẽ xoá cặp đó. Cần kiểm tra PATCH có so phiên bản không; nếu không, gộp phía server hoặc từ chối khi lệch.
- **Khoá dòng series trong `applyResult`.** Thiết kế cũ cố ý không khoá dòng series. Ghi glossary/xưng hô giờ phải
  UPDATE dòng series. Plan cần xác nhận thứ tự khoá ở mọi đường ghi series (PATCH series, glossary routes) để không
  deadlock với 2 worker.
- **Tên OCR sai lan rộng** (giá phải trả của hướng A). Giảm nhẹ: nhãn AI dễ thấy, sửa một lần là chương sau dùng đúng,
  xoá thì không quay lại.

## Bước tiếp

Chuyển hợp đồng này sang `/ak-plan`, rồi `/ak-cook`.

## Cập nhật sau red-team (24/11)

Plan [261124-1418-auto-apply-series-memory](../261124-1418-auto-apply-series-memory/plan.md) thay một số quyết định ở trên:
Q3 đảo lại (người dùng chọn bỏ qua gợi ý cũ, không áp); Q4 đổi thành ghi Giọng văn ngay ở lô đầu có `style_note`
(ghi lúc đóng lượt gây deadlock với reaper); Q5 đổi trần sang 200 entry AI còn sống. Plan là nguồn đúng cho các điểm này.
