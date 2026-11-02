# Đo độ chính xác style (thought/note) — 2026-11-02

Cách đo: lấy `ocr_result` 3 chương đã prepare trong DB dev (2 series `ko`, 1 `en`; không có chương JA local), chỉ gọi `translate_batch` (lô 8 trang, không ngữ cảnh), đếm `style`. Script: scratchpad, không commit.

## Lượt 1 — prompt ban đầu, Gemini 2.5 Flash (1 chương, 2 chương còn lại 429 free tier)

| Chương | Region | normal | thought | note |
|---|---|---|---|---|
| 01a18bcf (ko) | 119 | 108 | 1 | 10 |

`note` sai gần hết: watermark nhóm dịch (6), **thoại/la hét ngoài bóng** ("WE NEED SOME TISSUE!", "YOU GOT ME GOOD.", "ARE YOU REALLY KIM DAN?", "HAA"). LLM hiểu "ngoài bóng" = note.

→ Siết prompt `translate_batch.md`: note CHỈ cho ghi chú/chú thích nhỏ trong tranh; cấm rõ thoại/la hét/rên ngoài bóng, lời dẫn, watermark/credit; "text_free không có nghĩa là note"; thought = toàn bộ nguồn trong ngoặc hoặc rõ độc thoại.

## Lượt 2 — prompt đã siết, Claude Haiku 5.5 (Gemini 503 quá tải + 429 quota)

| Chương | Region | normal | thought | note |
|---|---|---|---|---|
| 01a18bcf (ko) | 120 | 111 | 1 | 8 |
| 01a1911a (ko) | 112 | 98 | 2 | 12 |
| 01a187a0 (en) | ?* | — | 1 | 29 |

\* dòng tổng của chương en bị cắt khỏi log (`tail -30`); số thought/note đếm từ danh sách in ra (đủ).

Soi mẫu:
- **thought (4)**: "(영화 끝나고 왜인지 어색해짐)" ✓, "GUESS I DON'T HAVE TO WORRY ABOUT MEALS…" ✓ (độc thoại), "MUMBLE" ~ (nói thầm, gần SFX), "친구들이랑..." ✗.
- **note đúng** (~25): nhãn đồ vật/món ăn ("POTATO PANCAKE", "R.O.K ARMY", "KOREA"), chú thích nhân vật ("한채아, 21세", "PARK TAE-HO (27 YEARS OLD)…"), "다음화에 계속", chữ trên poster.
- **note sai** (~20): watermark/credit ("Zin Chan", "Desirescans.com", "STAFF 원작…", "Thank you for reading…") dù prompt cấm; mảnh SFX OCR ("CREE", "TICKE", "CR"); vài câu lời dẫn trong khung infographic.
- Không còn thoại la hét ngoài bóng bị gắn note (lỗi chính lượt 1).

## Đánh giá

- Mức chấp nhận được cho MVP: slot trống = không tác động; người dùng đổi tay bằng "Loại chữ". Sai chủ yếu rơi vào watermark/credit — box thường bị xoá khi sửa.
- Chưa đo được trên Gemini với prompt mới (model mặc định production) — quota free tier hết trong phiên.

## Câu hỏi mở

- Đo lại trên Gemini 2.5 Flash khi có quota (cùng script, 3 chương) trước khi deploy 0.8.0.
- Nếu watermark→note gây khó chịu: cân nhắc lọc watermark ở bước prepare (vấn đề riêng, ngoài phạm vi plan).

## Lượt 3 — chạy thật end-to-end (worker 0.8.0 local, Anthropic Haiku 5.5)

Series `arm-boy-rivalry` (en → id), slot thought = JimLeeThought-Regular, note = PatrickHand-Regular (PATCH qua API). Dịch lại chương 54 trang: 13 job lô succeeded, 0 lỗi. Payload job có `thought_font`/`note_font`; API nhận worker 0.8.0 (claim 200).

| style | kind | font box | số vùng |
|---|---|---|---|
| normal | text_bubble/text_free | KomikaText-Regular (thoại) | 145 |
| note | text_bubble + text_free | PatrickHand-Regular | 35 |
| thought | text_bubble | JimLeeThought-Regular | 5 |

- thought 5/5 đúng (độc thoại: "WHAT WOULD MY PARENTS THINK…", "I SHOULD HAVE JUST RE-ENLISTED…").
- note: ~23 đúng (chú thích nhân vật/tuổi, màn hình ngân hàng, thông báo web, nhãn món ăn, "R.O.K ARMY"); ~12 watermark/credit (Desirescans.com, STORY/ART credit).
- Trang đã sửa tay (4) không bị ghi đè → `ai_update_available`; 50 trang AI thay state.
- Editor: trang 14 hiện chữ JimLeeThought; Properties "Loại chữ = Suy nghĩ", Font = JimLeeThought. Ảnh: `e2e-real-worker-thought-page14.jpg`, `e2e-real-worker-loai-chu-panel.jpg`.
