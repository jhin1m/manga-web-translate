# Trí nhớ series: gợi ý glossary + xưng hô, và quy tắc "lượt dịch đủ" phải viết ba lần

**Date**: 2026-11-11
**Severity**: Medium (không lỗi dữ liệu người dùng; review bắt được 1 High, 2 Medium, 1 deadlock trước khi commit)
**Component**: worker (`mtl_pipeline`, `mtl_worker`), API (`lib/series-memory.ts`, `jobs/translate-chain.ts`), web (`features/series`, `features/glossary`), DB (bảng `series_suggestions`, cột `chapters.translate_memory`)
**Status**: Xong, chưa commit. Gate xanh trừ e2e 100/101 (`block-panel.spec.ts:317`, lỗi có sẵn trên HEAD sạch)

## Đã làm gì

Plan `plans/261111-1925-series-memory-glossary-pronoun-suggestions/`.

- LLM học thuật ngữ và cặp xưng hô ngay trong lượt dịch hiện có: thêm `new_terms` và `pronoun_pairs` vào output, không thêm lượt gọi nào.
- Gợi ý chỉ có Nhận hoặc Bỏ ở màn series. Không có trạng thái "accepted"; server ẩn gợi ý đã nằm trong glossary hoặc `pronoun_rules` khi đọc.
- Trí nhớ cuối chương trước làm `carry` cho chương sau, không đổi payload.
- Worker 0.10.0 lên 0.11.0, `MIN_PIPELINE_VERSION` giữ 0.10.0. Hai key mới trong result là optional nên API cũ bỏ qua được.

## Smoke LLM thật

Baseline (0.10.0, 33 trang) là 372,8 token ra mỗi trang. Lần 1 (prompt 8 thuật ngữ / 5 cặp / ghi chú 500 ký tự): 430,1, tức **+15,4%**, vượt ngưỡng 15% đúng 0,4 điểm. Hạ prompt xuống 5/3/300 theo phương án dự phòng; lần 2: 384,2, tức **+3,1%**. Chi phí cả hai lần khoảng 0,023 USD.

Điều đáng lo: lần 2 **không ra gợi ý xưng hô nào** trong 2 chương (lần 1 có 4). Có thể do giới hạn thấp, có thể là phương sai; n=1 không tách được. Tôi không thích việc phải mua +12 điểm token bằng đúng tính năng khó nhất của cả đợt này.

## Review: phần đau

**1. Trạng thái ẩn khi đọc làm hỏng bộ đếm.** `pendingCount` đếm mọi dòng `dismissed_at is null`. Nhận không đặt `dismissed_at`, chỉ làm dòng bị ẩn khi đọc. Hậu quả: gợi ý đã Nhận chiếm trần 200 vĩnh viễn, series dài đầy trần thì không còn gợi ý nào được lưu, không báo lỗi, và người dùng không Bỏ được vì các dòng đó đã bị ẩn. Quyết định "không có accepted" rẻ ở UI nhưng trả giá ở mọi chỗ đếm. Sửa: một hàm `admit()` đếm theo "chưa bị phủ".

**2. Quy tắc "lượt dịch đủ" sửa ba lần.**
1. Ghi trí nhớ sau mỗi lô: lượt bị huỷ hoặc dừng vì hạn mức ghi đè trí nhớ đủ bằng bản dở dang.
2. Đòi "không còn trang chờ sau lô": bỏ sót trường hợp lô cuối xong rồi trang lỗi ở bước 1, lượt đóng sau lô cuối. Reviewer tìm ra bằng probe, không phải do test của chúng tôi.
3. Bản cuối ghi ở nhánh `live.length === 0` của `advanceTranslateChain`, ngay trước `closeRun`, bằng `rememberRunMemory`. Điều kiện: `runTarget === "translated"` và `runTotal >= translatableCount`.

Bài học: "lượt kết thúc" là một sự kiện trong state machine, đừng suy ra nó từ trạng thái trang.

**3. Deadlock.** `INSERT ... ON CONFLICT` nhiều dòng của hai lần complete đồng thời, thứ tự khoá ngược nhau, tái hiện được `40P01`. Complete trả 500, worker không thử lại, lô đã dịch (tốn tiền) mất. Sửa: sắp `rows` theo (kind, key) trước khi chèn. Không có test, vì cần đồng thời thật.

**4. E2E để rác và chẩn đoán sai.** `series-suggestions.spec.ts` không xoá series nó tạo; thả file ở home chọn series của chương mới nhất nên 2 test `upload-chapter` vỡ. Implementer gọi đó là "flaky" vì lần chạy lại không có spec của mình. Đây không phải flaky, mà lặp lại được. Sửa: xoá series trong `finally`, kiểm 204.

**5. `block-panel.spec.ts:317`.** Nghi do file chương chưa commit của plan khác. Dựng worktree: bản chỉ có feature vẫn fail, HEAD sạch `c485335` fail 3/3 với `--repeat-each=3`. Có sẵn từ trước, plan `261109-1709` đã ghi cùng lỗi tại `7e0ed9e`.

Khác (Medium/Low đã sửa): nút Nhận/Bỏ bấm đôi nhận 409, mất focus sau khi gỡ hàng, `？` full-width lọt bộ lọc, thiếu dòng `# 0.11.0:`.

## Bài học

- Dựng worktree để trả lời "lỗi này của tôi hay có sẵn". Đừng đoán.
- Khi nghe "flaky", yêu cầu tái hiện đúng thứ tự chạy trước khi tin.
- Mọi số đếm trên dữ liệu mà một nửa quy tắc nằm ở lúc đọc đều phải áp cùng quy tắc đó.

## Việc còn lại và giới hạn

- **Quyết định cần chủ dự án:** giữ 5/3/300 hay quay về 8/5/500? Cần lần chạy thứ 3 để tách phương sai khỏi hiệu ứng. Docs phải khớp giá trị cuối.
- Dữ liệu smoke còn trong DB dev (2 series, 4 chương): xoá tay.
- Lượt chạy tiếp sau khi dừng vì hạn mức không ghi trí nhớ (giới hạn đã biết).
- Watermark/tên nhóm scan lọt vào `new_terms`; chỉ bộ lọc bản dịch trùng nguyên văn chặn được. Prompt loại trừ không hiệu quả.
- Khoá xưng hô (người nói, người nghe) không gộp biến thể tên người nghe: "ajudan → Haegyeol" rồi "ajudan → Pangeran Haegyeol".
- Gợi ý không lưu cặp ngôn ngữ; đổi ngôn ngữ đích thì gợi ý cũ vẫn hiện. Cần quyết định sản phẩm.
- Mỗi lần OCR vùng bằng LLM trả thêm 2 mảng rồi bỏ: tốn token nhẹ.
- Sửa hoặc cô lập `block-panel.spec.ts:317` ở một thay đổi riêng, bisect về `7e0ed9e`.
- Chưa commit; các file chương của plan khác vẫn chưa commit cùng cây.

Status: DONE_WITH_CONCERNS
Summary: /Users/jhin1m/Desktop/ducanh-project/manga-web-translate/docs/journals/261111-series-memory-suggestions.md
