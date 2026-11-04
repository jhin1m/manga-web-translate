# OCR local mặc định · cảnh báo Hiệu đính · DeepSeek

Status: done (chưa commit) · Created: 2026-11-04 · Branch: main (local, chưa push)

## Bối cảnh (scout)
- OCR engine chọn theo ngôn ngữ nguồn ở Cài đặt → Pipeline (`packages/shared/src/pipeline-settings.ts`), lưu jsonb
  `system_settings.pipeline`; DB local = `{}` → đang dùng mặc định code (`llm` cho cả 4 ngôn ngữ).
- Model local đã có (`worker/models/`: manga-ocr, ppocr v6 + rec Hàn v5); Modal tải qua `fetch_models.py`.
- `prepareInputRev` bỏ options khi bằng mặc định (`isDefaultPrepareOptions`) → đổi mặc định phải ghim baseline cũ,
  không thì trang đã OCR bằng LLM và trang OCR local trùng input_rev (idempotency trả kết quả cũ).
- Hiệu đính: `proofread-panel.tsx` bấm là chạy ngay, không báo giá/thời gian/việc gửi ảnh. Không có API ước tính.
- Provider: 4 loại (`AI_PROVIDER_TYPES`), DeepSeek = endpoint tương thích OpenAI (`https://api.deepseek.com`),
  chỉ `json_object`. Giá chính thức (api-docs.deepseek.com, đọc 2026-11-04): `deepseek-flash` (vision) $0.30/$1.20,
  `deepseek-v4-pro` (không vision) $1.32/$3.96 — giá giờ cao điểm (bảo thủ; thấp điểm = ½).

## Quyết định (user uỷ quyền)
1. Mặc định OCR: ja → `manga_ocr`, ko/zh/en → `paddle_ocr`. Admin vẫn đổi về LLM được. Baseline input_rev ghim
   = options LLM cũ (không đổi rev của trang/job đã có).
2. Cảnh báo Hiệu đính: bấm chạy → hộp xác nhận inline: số trang, model/provider, ước tính USD (khoảng), thời gian
   (khoảng), ghi rõ gửi ảnh trang thu nhỏ + bản dịch lên provider. Ước tính = trung bình token/giây theo trang của
   ≤20 lượt hiệu đính thành công gần nhất của chính user; chưa có lịch sử → hằng số mặc định.
3. DeepSeek = mẫu (preset) trong form provider, lưu dưới loại `openai_compatible` — không migration, không đổi
   protocol worker. Gợi ý giá 2 model; danh sách hiển thị nhãn "DeepSeek" theo host base URL.

## Phase
| # | Việc | Trạng thái |
|---|---|---|
| 1 | OCR local mặc định + ghim baseline input_rev + test/docs | done |
| 2 | API `GET /chapters/:id/proofread/estimate` + hộp xác nhận ở panel | done |
| 3 | Preset DeepSeek trong form provider + gợi ý giá | done |
| 4 | Test (shared, api, web unit, e2e liên quan) + review | done |

## Tiêu chí xong
- Cài đặt chưa lưu → prepare tiếng Hàn chạy `paddle_ocr`, payload không mang model OCR; trang cũ không đổi input_rev.
- Bấm "Chạy AI hiệu đính" → thấy cảnh báo (trang, model, $, thời gian, gửi ảnh) → phải bấm xác nhận mới chạy.
- Form provider có "DeepSeek": tự điền base URL, json_object, gợi ý model + giá; lưu & kiểm tra như compatible.
- Toàn bộ test shared/api/web xanh; lint/typecheck sạch.

## Rủi ro
- Chất lượng OCR local thấp hơn LLM (SFX, chữ nghiêng) → admin đổi lại LLM theo ngôn ngữ ở Cài đặt → Pipeline.
- Giá DeepSeek có giờ thấp điểm; hệ thống tính theo giá nhập (cao điểm) → chi phí ghi nhận ≥ thực tế.

## Sau review (`plans/reports/from-code-reviewer-261104-1731-local-ocr-proofread-deepseek-review-report.md`, 7/10)
- H1 DeepSeek bật thinking mặc định → worker gửi `thinking: disabled` khi host `api.deepseek.com` (trừ model đánh dấu
  reasoning); không đổi payload/protocol. Test `test_deepseek_disables_thinking_unless_model_is_marked_reasoning`.
- M1 "Chạy lại trang lỗi" OCR lại trang lỗi theo cài đặt hiện tại → giữ (đúng thiết kế đổi cài đặt), ghi docs.
- M2 dòng "gửi ảnh lên AI" luôn hiện; nút xác nhận khoá khi đang ước tính; mở hộp → bỏ ước tính cũ + focus hộp.
- M3 checklist nạp model OCR local vào volume Modal (`docs/deployment-guide.md`), docstring `models.py`.
- L: mốc input_rev ghim số cứng, đổi tên `isBaselinePrepareOptions`, comment cũ.
- Bỏ qua (Low, chi phí > lợi): lịch sử ước tính trộn model, giá fallback bảo thủ khi chưa gán slot, type ước tính khai
  2 nơi.

Gate cuối: biome, typecheck, shared 60, api 435, web 377, db 8, worker 352, e2e 9/9 (admin-settings, pipeline-settings,
proofread).

## Chưa kiểm (cần key thật)
- DeepSeek: `json_object` + ảnh (OCR/hiệu đính bằng `deepseek-flash`) + `thinking: disabled` với API thật.
- Chất lượng OCR local trên chương thật (Hàn/Trung với PaddleOCR).
