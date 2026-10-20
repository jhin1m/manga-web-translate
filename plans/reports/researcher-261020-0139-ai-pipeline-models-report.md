# Research: AI pipeline models, licenses, build vs embed

Nguồn: researcher 20/10/2026. Đã fetch 5 trang (manga-image-translator, Koharu, BallonsTranslator, ogkalu detector, manga-ocr); phần còn lại từ kiến thức nền — ghi "unverified".

## Kết luận
Tự dựng pipeline gọn từ thành phần Apache/MIT. KHÔNG nhúng manga-image-translator (GPL-3.0) vào SaaS.
- Detect: ogkalu/comic-text-and-bubble-detector (RT-DETRv2, Apache-2.0, ONNX, 42.9M params, class bubble/text_bubble/text_free, train cả manga/webtoon/manhua) + tile cho manhwa dài.
- OCR mặc định: Gemini Flash trên crop (gộp mọi crop + thumbnail trang vào 1 call → OCR + dịch). Fallback offline: manga-ocr (JA, Apache, ~400MB, chữ dọc OK) + RapidOCR PP-OCRv5 ONNX (ZH/KO/EN/JA, Apache).
- Inpaint: big-lama ONNX (Apache, ~200MB, input 512) theo crop quanh mask; bóng thoại nền trắng → flood-fill, không cần model.
- Typeset: tự viết (Pillow+libraqm hoặc Skia), font OFL có tiếng Việt.
- Kiến trúc tham khảo: Koharu (MIT/Apache, Rust) — có RF-DETR seg, PaddleOCR-VL, auto-fit, chữ dọc, xuất PSD.

## Detection
| Lựa chọn | License | Ghi chú |
|---|---|---|
| ogkalu RT-DETRv2 | Apache-2.0 ✓ | Chỉ box, không pixel mask |
| comic-text-detector | GPL-3.0 (unverified) | Có pixel mask; chỉ dùng local |
| MIT detectors | GPL-3.0 | Không dùng |
| ogkalu YOLOv8m | AGPL (Ultralytics) | Tránh |
| Koharu RF-DETR Seg | weights chưa rõ | Box + mask, cần check model card |

- Thiếu mask: tự sinh mask chữ trong box bằng threshold/morphology, hoặc seg model — đây là việc kỹ thuật thật.
- Manhwa dài: cắt cửa sổ cao ~1–1.5× rộng, overlap 15–25%, merge box qua IoU/union ở mép.
- Chữ dọc JA: suy hướng từ tỉ lệ box; manga-ocr đọc dọc native.

## OCR: local vs vision LLM
Local rẻ, ổn định, offline nhưng yếu với font cách điệu/SFX/viết tay và KO/ZH phồn thể trên webtoon. LLM vision trên crop chính xác hơn, OCR+dịch 1 call, nhưng thêm latency, phụ thuộc API, có thể bịa trên crop rỗng. Phải benchmark trên trang thật trước khi chốt default.

## Inpainting
- big-lama: tốt trên screentone nếu mask chặt; trên MPS vài op FFT rơi về CPU.
- AOT/lama_mpe (fine-tune manga, ship cùng repo GPL): weights không rõ license.
- MI-GAN (MIT, unverified): rất nhanh, kém với lỗ lớn.
- Diffusion (FLUX Klein…): quá nặng cho MVP.

## Typesetting
Thuật toán: mask bóng thoại → hình chữ nhật nội tiếp (distance transform) → binary search cỡ chữ → ngắt dòng greedy theo từ tiếng Việt → canh giữa, viền chữ, cỡ tối thiểu (co chứ không tràn); text_free dùng box gốc + stroke. Renderer phải xử lý dấu chồng (ệ, ẫ). Font OFL (kiểm glyph "ếệỗửữ" trước): Be Vietnam Pro, Patrick Hand, Itim, Mali, Baloo 2, Anton, Lexend. Tránh font SVN-* fansub cho SaaS.

## License
| Thành phần | License | Ảnh hưởng SaaS |
|---|---|---|
| manga-image-translator, BallonsTranslator, comic-text-detector | GPL-3.0 | SaaS thuần không phát tán binary thì không kích hoạt; phát tán app local thì có. Chỉ dùng làm tham khảo |
| Koharu | MIT/Apache | Dùng code được; check weights riêng |
| ogkalu RT-DETRv2, manga-ocr, PaddleOCR/RapidOCR, LaMa | Apache-2.0 | An toàn (LaMa: train trên Places — kiểm điều khoản) |
| Ultralytics YOLO | AGPL-3.0 | Tránh |

## Nhúng MIT vs tự dựng
Nhúng: MVP vài ngày nhưng rủi ro license cao, typeset tiếng Việt yếu, glossary/ngữ cảnh hạn chế, tile manhwa yếu, dependency nặng. Tự dựng: vài tuần, kiểm soát hoàn toàn. → Tự dựng; có thể chạy MIT local làm "oracle" để so chất lượng.

Thứ tự build: ogkalu detect → Gemini OCR+dịch (glossary, ngữ cảnh) → fill bóng trắng + LaMa → typesetter → OCR local fallback.

## Câu hỏi chưa giải quyết
1. License weights của Koharu.
2. LaMa big-lama có ràng buộc thương mại từ dataset Places?
3. Độ chính xác + chi phí thực của Gemini Flash OCR vs local trên trang thật JA/KO/ZH.
4. Sinh pixel mask từ detector chỉ-box cho art nhiều screentone.
5. App local có phát tán cho người khác không (quyết định GPL)?
6. Font comic tiếng Việt nào qua glyph test và dùng thương mại được?
