---
title: "Trí nhớ series: gợi ý glossary + xưng hô, nhớ ngữ cảnh giữa các chương"
description: "Sau mỗi lô dịch, AI gợi ý thuật ngữ và cặp xưng hô mới để người dùng Nhận/Bỏ ở trang series. Ngữ cảnh cuối chương trước thành ngữ cảnh mở đầu cho chương sau."
status: completed
priority: P2
effort: 2d
branch: main
tags: [translate, glossary, pronoun, worker, api, web, db]
created: 2026-11-11
---

# Trí nhớ series

## Vấn đề (đã xác minh)

1. Glossary series hoàn toàn do người dùng nhập tay, nên dịch xong chương glossary không có thêm mục nào.
2. `carry` chỉ chuyền giữa các lô **trong cùng một lượt**. `lastCarry` (`apps/api/src/jobs/translate-chain.ts:151`)
   chỉ lọc job thuộc `inCurrentRun`, nên lô đầu của lượt mới hay chương mới luôn bắt đầu với ngữ cảnh rỗng
   (`translate-chain.ts:230`).

## Thiết kế đã chốt

- **Không thêm lượt gọi LLM.** Output của mỗi lô dịch có thêm 2 mảng `new_terms` và `pronoun_pairs`. Worker gom các
  mảng này vào `result` của `chapter.translate`. API lưu chúng thành gợi ý chờ duyệt, trong bảng mới `series_suggestions`.
- **Trí nhớ ngầm** là `carry` cuối của lượt dịch cả chương, lưu ở cột mới `chapters.translate_memory`. Khi lượt dịch
  chưa có carry (lô đầu, hoặc các lô trước đều lỗi), API lấy trí nhớ của chương gần nhất làm `payload.carry`.
  **Hợp đồng payload giữ nguyên**: worker 0.10.0 vẫn đọc được, không phải nâng `MIN_PIPELINE_VERSION`.
- **Prompt:** `context_notes` đổi thành ghi chú cộng dồn ≤ 300 ký tự (giữ điều còn đúng, thêm điều mới; ban đầu 500, hạ sau smoke LLM thật). Prompt ghi
  rõ khi mâu thuẫn thì `glossary` và `pronoun_rules` thắng ngữ cảnh.
- **Nhận dùng lại đường ghi đang có:**
  - Thuật ngữ: gọi `POST /series/:id/glossary` (`glossary_rev` tăng 1).
  - Xưng hô: thêm một hàng vào bảng Xưng hô của form, người dùng bấm Lưu thì gọi `PATCH /series/:id`
    (`settings_rev` tăng 1).
  - Gợi ý đã có trong glossary hiệu lực hoặc trong `pronoun_rules` thì server ẩn khi đọc. Vì vậy không cần trạng
    thái "accepted" và không có race với form.
- **UI tối giản:**
  - Màn series: `count-badge` trên nút Glossary và trên icon Cài đặt dịch.
  - Danh sách "Gợi ý từ AI · N" nằm đầu modal Glossary series và trong nhóm Xưng hô.
  - Mỗi dòng có nút Nhận và Bỏ.

## Quyết định tự chốt (kèm lý do)

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Nguồn trí nhớ là chương **khác** trong cùng series và cùng cặp ngôn ngữ. Ưu tiên chương có số ≤ số chương hiện tại, gần nhất. Không có thì lấy chương số lớn hơn gần nhất. Bỏ qua chính chương đang dịch | Trạng thái "đầu chương N" chính là "cuối chương trước". Chọn chương gần nhất theo số (không chọn "mới nhất") để quan hệ nhân vật ít lệch. Bỏ chính chương đó để khi dịch lại trang đầu, AI không nhận ghi chú cuối chương (xưng hô có thể đã đổi giữa chương) |
| D2 | Chỉ ghi trí nhớ từ **lượt dịch cả chương** (`run_target='translated'` và `run_total` ≥ số trang hiện) | Nếu dịch lại vài trang mà vẫn ghi đè thì ghi chú của cả chương bị mất, chương sau chỉ nhận trí nhớ nghèo |
| D3 | Không có trạng thái "accepted". Gợi ý đã có trong glossary/quy tắc thì ẩn khi đọc | Đụng ít file và không race với form Cài đặt. Cái giá: xoá entry hoặc quy tắc sinh ra từ gợi ý thì gợi ý hiện lại, người dùng bấm Bỏ |
| D4 | Không có nút "Nhận tất cả" | Duyệt tay là để chặn tên OCR đọc sai. Nút này khiến người dùng bấm mà không đọc. Thêm sau nếu danh sách dài |
| D5 | Gợi ý **chưa duyệt** không đưa vào prompt của chương sau | Đúng quyết định "tránh tên OCR sai lan sang chương sau". Trí nhớ ngầm chỉ gồm ghi chú và tên nhân vật (đã có trong `carry`) |
| D6 | Không có UI xem hay xoá trí nhớ ngầm | YAGNI. Muốn sửa thì dùng glossary hoặc quy tắc xưng hô, vì prompt ưu tiên tuyệt đối hai thứ này. Một lượt dịch cả chương cũng ghi lại trí nhớ |
| D7 | Khoá chống trùng của gợi ý xưng hô là cặp (người nói, người nghe), không gồm cách gọi | Tránh rác kiểu "anh/em" và "Anh / em" thành hai gợi ý. Cái giá: cặp đã Bỏ sẽ không được gợi ý lại khi quan hệ đổi, người dùng phải thêm tay |
| D8 | Bỏ gợi ý thuật ngữ có bản dịch trùng nguyên văn từ gốc (sau chuẩn hoá) | Không có giá trị (ví dụ EN→VI giữ nguyên tên), bỏ đi cho bớt rác |
| D9 | Giới hạn số lượng: mỗi lần gọi LLM tối đa 5 thuật ngữ và 3 cặp (ghi trong prompt; ban đầu 8/5, hạ sau smoke LLM thật vì token ra mỗi trang tăng +15,4% → +3,1%). Mỗi job tối đa 50 thuật ngữ và 30 cặp (hợp đồng). Mỗi series giữ tối đa 200 gợi ý chờ duyệt cho mỗi loại | Chặn token và danh sách gợi ý phình to |
| D10 | Giữ API `PIPELINE_VERSION` (muối input_rev). Worker nâng 0.10.0 → 0.11.0. `MIN_PIPELINE_VERSION` giữ 0.10.0 | Nâng bản API thì mọi trang thành lỗi thời. Hai key mới trong result là optional: API cũ bỏ qua key lạ, API mới nhận được result thiếu key |
| D11 | Trí nhớ ghi kèm `source_lang`/`target_lang`. Khi đọc, chỉ dùng trí nhớ đúng cặp ngôn ngữ hiện tại của series | Đổi ngôn ngữ đích thì ghi chú cũ (đang ở ngôn ngữ cũ) không được lẫn vào prompt |
| D12 | Thuật ngữ được Nhận sẽ có `note` rỗng. Loại (Tên người, Địa danh, Thuật ngữ) chỉ hiện trong danh sách gợi ý | Giữ glossary sạch. Người dùng sửa bằng icon Sửa có sẵn |

## Luồng dữ liệu

```
advanceTranslateChain (lô kế của lượt, chương N)
  carry = lastCarry(lượt) ?? memoryCarry(N)          ← chapters.translate_memory của chương chọn theo D1, D11
  → payload chapter.translate.carry                  (hợp đồng cũ, không đổi)
Worker handle_translate
  RollingContext(carry) → mỗi lô gọi LLM: items + context_notes + new_terms + pronoun_pairs
  → gom, khử trùng, cắt theo hợp đồng → result {pages, carry, new_terms?, pronoun_pairs?}
API applyResult(chapter.translate)   [đã khoá job → chapter]
  → ghi page_state như cũ
  → lượt dịch cả chương và có carry thì chapters.translate_memory = carry + cặp ngôn ngữ   (D2)
  → gợi ý: lọc (đã có trong glossary hiệu lực hoặc pronoun_rules, trùng nguyên văn, '?', tự gọi mình)
           → INSERT … ON CONFLICT (series_id, kind, key) DO NOTHING, có trần D9
Web
  GET /api/series/:id/suggestions (bỏ dismissed và gợi ý đã có) → badge + danh sách
  Nhận thuật ngữ → POST /api/series/:id/glossary → glossary_rev+1 → lần dịch sau dùng
  Nhận xưng hô   → thêm hàng vào form → Lưu → PATCH /api/series/:id → settings_rev+1
  Bỏ             → PATCH /api/series-suggestions/:id {dismissed:true}
```

## Phases

| # | Phase | File sở hữu | Phụ thuộc | Effort | Status |
|---|---|---|---|---|---|
| 1 | [Hợp đồng + DB](./phase-01-contract-and-db.md) | `packages/shared/**`, `packages/db/**` | — | 2h | completed |
| 2 | [Worker: thu gợi ý + prompt](./phase-02-worker-learned-terms.md) | `worker/**` | 1 | 4h | completed |
| 3 | [API: trí nhớ + gợi ý](./phase-03-api-memory-and-suggestions.md) | `apps/api/**` | 1 | 5h | completed |
| 4 | [Web: Nhận/Bỏ ở series](./phase-04-web-suggestions-ui.md) | `apps/web/**` | 3 | 5h | completed |
| 5 | [Docs](./phase-05-docs.md) | `docs/**` (trừ `editor.md`, `design-guidelines.md`) | 2, 3, 4 | 1h | completed |
| 6 | [Smoke với LLM thật](./phase-06-real-llm-smoke.md) | `plans/…/reports/` | 2, 3 | 1h | completed |

Phase 2 và 3 chạy song song được sau phase 1 vì không chung file. Phase 6 chạy song song được với phase 4 và 5.
Không đụng các file đang có thay đổi chưa commit của plan khác: `apps/web/src/features/chapter/**`,
`docs/editor.md`, `docs/design-guidelines.md`.

## Tiêu chí xong (đo được)

1. Test API: dịch xong chương 1 với result có `new_terms`/`pronoun_pairs` thì `GET /series/:id/suggestions` trả đúng
   các gợi ý mới. Gợi ý đã có trong glossary series, glossary chung đúng cặp, `pronoun_rules`, gợi ý đã Bỏ và gợi ý
   trùng nguyên văn đều không xuất hiện.
2. Test API: lô đầu của chương 2 có `payload.carry` bằng trí nhớ của chương 1. Lô thứ hai dùng carry của lượt. Lượt
   dịch một phần không ghi đè trí nhớ. Trí nhớ khác cặp ngôn ngữ bị bỏ qua.
3. E2E: badge hiện ở màn series. Nhận thuật ngữ thì entry có trong bảng glossary và badge giảm. Nhận xưng hô rồi Lưu
   thì quy tắc được lưu và gợi ý biến mất. Bỏ thì gợi ý không quay lại.
4. Tương thích: payload không đổi. Result không có key mới (worker 0.10.0) vẫn complete 200. Mọi test cũ xanh
   (`translate-chain.test.ts` "carry from the previous batch…" giữ nguyên).
5. Các lệnh sau đều xanh: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `cd worker && uv run pytest -q`,
   `pnpm --filter @mtl/web e2e`.
6. Smoke với LLM thật (phase 6): không thêm lô nào lỗi `schema`. Token ra mỗi lô tăng ≤ 15%. Chương 2 dùng tên
   nhân vật thống nhất với chương 1.

## Rủi ro chính

| Rủi ro | Khả năng × Tác động | Giảm thiểu |
|---|---|---|
| Output dài hơn chạm guard 4096 token, lô bị tách thành từng trang và tốn tiền hơn | TB × TB | Prompt giới hạn số mục (D9) và notes ≤ 300 ký tự (giá trị cuối sau smoke; ban đầu 8/5/500). Phase 6 đo; vượt ngưỡng thì hạ giới hạn |
| Field mới bị LLM trả sai, làm hỏng cả lô | TB × Cao | Parse lỏng (bỏ mục sai, không raise). Worker cắt và lọc trước `validate_contract`. Có test với dữ liệu rác |
| Nhiều gợi ý rác (từ thường, tiếng động) | TB × TB | Prompt chỉ rõ các loại cần lấy. Lọc trùng nguyên văn (D8). Gợi ý đã Bỏ không quay lại. Trần D9 |
| Trí nhớ sai (tên OCR sai) lan sang chương sau | TB × TB | Glossary và quy tắc thắng ngữ cảnh. Dịch lại cả chương thì trí nhớ được ghi lại từ chương trước (D1, D2) |
| Deadlock hoặc tranh khoá khi ghi gợi ý trong `applyResult` | Thấp × Cao | Chỉ INSERT vào `series_suggestions` và UPDATE `chapters` (đã khoá sẵn). Không khoá dòng `series`. Khoá FK là KEY SHARE, tương thích với UPDATE `glossary_rev` (NO KEY UPDATE) |

Chi tiết từng rủi ro nằm trong file của từng phase.

## Rollback

Revert theo thứ tự web → API → worker. DB chỉ thêm (một cột nullable và một bảng mới), nên rollback riêng app vẫn an
toàn. Cần gỡ hẳn thì chạy `packages/db/migrations-down/0026_series_memory.down.sql`. Worker và API deploy theo thứ tự
nào cũng được (D10).

## Kết quả

Đo theo "Tiêu chí xong":

1. Gợi ý sau khi dịch chương 1: đạt. Test API trả đúng gợi ý mới, ẩn gợi ý đã có, đã Bỏ, trùng nguyên văn.
2. Trí nhớ giữa chương: đạt. Lô đầu chương 2 mang carry của chương 1, lượt một phần và khác cặp ngôn ngữ không ghi đè. Smoke: carry chương 2 = trí nhớ chương 1.
3. E2E badge, Nhận, Bỏ: đạt (`series-suggestions.spec.ts` xanh). E2E toàn bộ 100/101.
4. Tương thích: đạt. Payload không đổi, result thiếu key vẫn complete, `translate-chain.test.ts` giữ nguyên và xanh.
5. Lệnh chất lượng: lint, typecheck xanh. API 564 pass / 1 skip sau các sửa cuối, web unit 462, worker 414, ruff xanh. E2E 100/101: `block-panel.spec.ts:317` đỏ sẵn trên HEAD sạch c485335 (lặp 3/3), không do tính năng này.
6. Smoke LLM thật: đạt ở lần chạy 2. 0 lỗi `schema`, token ra mỗi trang +3,1% (lần 1 là +15,4%, trượt ngưỡng), carry chương 2 = trí nhớ chương 1.

Quyết định trong lúc làm:
- Hạ giới hạn prompt xuống 5/3/300 sau smoke lần 1 đo +15,4%.
- "Lượt dịch cả chương" chỉ tính các trang đã qua bước 1.
- Trí nhớ ghi khi lượt dịch cả chương đóng bình thường (`advanceTranslateChain`, trước `closeRun`), lấy carry thành công gần nhất của lượt. Huỷ hoặc dừng do hạn mức không bao giờ ghi đè trí nhớ.
- Trần gợi ý chờ duyệt chỉ đếm gợi ý chưa được phủ (chưa có trong glossary hoặc quy tắc).
- Gợi ý được chèn theo thứ tự (kind, key) để tránh deadlock.

Giới hạn đã biết:
- Gợi ý không lưu cặp ngôn ngữ.
- Lượt chạy tiếp sau khi dừng do hạn mức không ghi trí nhớ.
- Smoke lần 2 gợi ý xưng hô = 0 (lần 1 là 4). Cần theo dõi, đã ghi ở roadmap mục "Cần đo".
- Badge không tự làm mới khi người dùng vẫn ở màn series.

Việc còn lại cho người dùng:
- Dữ liệu smoke trong DB dev: 2 series, 4 chương. Xoá khi xong.
- Worker dev được khởi động lại bằng code 0.11.0 trước chỉnh `_learned` cuối cho `？` toàn chiều rộng. API vẫn lọc nên không ảnh hưởng. Khởi động lại worker để nhận bản mới nhất.

## Câu hỏi chưa giải quyết

1. Có nên thêm dòng nhắc "AI gợi ý N thuật ngữ → Glossary series" trong editor (tab Glossary của panel Văn bản) ngay
   sau khi dịch xong không? Plan này **không làm**, vì UI cần tối giản và chỗ duyệt đã chốt là Glossary series. Nếu
   sau smoke thấy người dùng không nhìn ra badge thì làm sau.
2. ~~Chi phí smoke~~ Đã giải quyết: smoke đã chạy, tốn khoảng $0,023 cho 4 chương.
