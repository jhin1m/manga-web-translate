---
status: done
created: 2026-11-25
---

# Bỏ glossary chung + thiết kế lại Cài đặt series

## Kết quả mong muốn

1. Không còn glossary chung: không trang `/glossary`, không dòng "Glossary chung" ở menu tài khoản, không route API
   `/api/glossary*`, AI chỉ nhận glossary riêng của series. Dữ liệu glossary chung đang có không mất.
2. Cài đặt series (`/s/:id?tab=settings`) gọn hơn: Giọng văn, Kính ngữ, Xưng hô gộp thành một nhóm "Hướng dẫn cho AI";
   tự lưu như trang Cài đặt (bỏ nút Lưu).

## Quyết định đã chốt (user, 25/11/2026)

- Gộp kiểu "một nhóm, giữ ô": dữ liệu `style_prompt`, `honorific_policy`, `pronoun_rules` không đổi; AI vẫn tự ghi
  giọng văn / cặp xưng hô có nhãn AI.
- Glossary của series vẫn là modal riêng (mở từ "Glossary · N" ở đầu trang). Nhóm AI chỉ có một dòng
  "Glossary: N thuật ngữ · Mở" dẫn tới `?tab=glossary`.
- Tự lưu, bỏ nút Lưu.

## Quyết định tự chọn (lý do)

- Dữ liệu glossary chung: migration chép mỗi entry chung vào mọi series cùng người dùng, cùng cặp nguồn→đích, mà series
  chưa có term đó (entry series vẫn thắng như trước), giữ `origin` 'user'; rồi xoá entry chung. Glossary hiệu lực của mỗi
  series không đổi nên không cần tăng `glossary_rev`. Lý do: bản self-host của người khác có thể có dữ liệu ở đây.
- Bỏ cột `source_lang`, `target_lang` của `glossary_entries` (chỉ entry chung dùng), `series_id` thành NOT NULL, unique
  thành `(user_id, series_id, source_term)`. Có file down thủ công trong `packages/db/migrations-down/`.

## Không làm

- Không đổi worker (worker chỉ nhận dict glossary trong snapshot).
- Không đổi luồng AI tự ghi trí nhớ series.
- Không đưa bảng glossary vào modal Cài đặt.

## Phases

| # | Phase | Trạng thái |
|---|-------|------------|
| 1 | [Bỏ glossary chung (DB, API, web, docs)](phase-01-remove-global-glossary.md) | done ([báo cáo](reports/phase-01-remove-global-glossary-report.md)) |
| 2 | [Thiết kế lại Cài đặt series, tự lưu](phase-02-series-settings-redesign.md) | done ([báo cáo](reports/phase-02-series-settings-redesign-report.md)) |

Chạy tuần tự: phase 2 sửa `series-settings-form.tsx` vốn đang gọi glossary API phase 1 đổi.

## Tiêu chí nghiệm thu

- `grep -ri "glossary chung"` trong `apps/` và `docs/` không còn (trừ ghi chú migration / release note).
- API test, web unit test, lint, typecheck qua; e2e `series-manage` và các spec liên quan glossary qua (spec
  `glossary-language-pair` bị xoá hoặc thay bằng kiểm tra series).
- Migration chạy được trên DB có entry chung: entry được chép vào series đúng cặp, không trùng term, không còn dòng
  `series_id IS NULL`.
- Cài đặt series: nhóm "Hướng dẫn cho AI" có Giọng văn, Kính ngữ, Xưng hô, dòng Glossary; đổi ô nào lưu ô đó, có trạng
  thái "Đang lưu… / Đã lưu / lỗi"; không có nút Lưu; Xoá series vẫn hoạt động.
