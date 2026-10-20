---
title: "UX gọn như Torii: thả là dịch, tín hiệu đúng, canvas dễ nhìn, chữ ra chất manga"
description: "Sửa nhiễu 'cần xem', canvas vừa trang + chỉ báo trang, gom trạng thái, thả file → tự tạo + tự dịch, font comic tiếng Việt có viền trắng."
status: in-progress
priority: P1
effort: 5d
branch: main (mỗi phase 1 branch feat/ux-pN-*, merge --no-ff)
tags: [web, ux, editor, upload, typeset]
created: 2026-10-21
---

# UX gọn như Torii

## Mục tiêu
Owner dùng thử song song toriitranslate.com/image và app với chương mẫu `/Users/jhin1m/Downloads/demo_manga_eng` (5 webp 954×1500), thấy app "khó dùng". Đo thực tế 21/10/2026:

| Vấn đề quan sát | Nguyên nhân (đã kiểm) |
|---|---|
| 5/5 trang "tràn khung", "Cần xem 5" | `boxOverflow` ngưỡng 0 (`apps/web/src/features/editor/measure.ts:169`); box auto-fit do Pillow đo, trình duyệt đo lệch ~1px → "Tràn khung 1px" |
| 145 khối / 5 trang, 70 "Trống" | Region `kind: "bubble"` (khung bóng thoại, không phải chữ — `worker/mtl_pipeline/detect.py:14`) bị `pageRows` (`text-table/rows.ts`) đưa vào bảng như dòng thoại trống |
| Thả file → form → "Tạo và mở chương" → "Dịch chương" | Upload xong cố ý không commit (`upload-manager.ts:4`); `NewChapterConfirmRow` luôn hiện |
| Lúc dịch canvas hiện bóng thoại trống ~1 phút | `PageSlot` hiện ảnh `clean` ngay khi có, dù page chưa `ready` |
| "Trang –/5" mãi | Effect `setCenter` chỉ phụ thuộc `[centerId]`, chạy trước khi `fitted` = true → không bao giờ set (`ChapterCanvas.tsx:139`) |
| Trang không vừa màn (100%) | Fit theo bề ngang, trần 1 (`ChapterCanvas.tsx:116`) |
| Toolbar nổi đè ảnh khi cuộn | `.cw-tools` absolute trên canvas (`chapter-workspace.css:211`) |
| Trạng thái ở 5 chỗ; banner "Bắt đầu dịch N ảnh" còn mãi | topbar chip + `lock-banner` + banner `chapter-workspace.tsx:235` + nút primary + rail |
| Chữ trông "gõ dán lên", không giống manga | Font mặc định PatrickHand, `stroke: null` |

Không phải lỗi (đã kiểm): `chapter.translate` chạy → queued → chạy = `provider_retries=1` (provider tạm lỗi, đúng thiết kế).

## Quyết định (controller, owner uỷ quyền 21/10/2026 — "gộp cả làm nhanh + đổi luồng")
1. Phạm vi = làm nhanh + đổi luồng. **Không** làm lại bố cục theo chế độ (Xem/Sửa/Tẩy) đợt này.
2. Thả file mà xác định được series (đoán từ tên file → series của chương gần nhất → series duy nhất) ⇒ tạo chương ngay (số = kế tiếp) + upload + **tự Dịch chương khi upload xong**, mở thẳng màn chương. Không xác định được (0 series, hoặc đoán mơ hồ khi có nhiều series và chưa từng có chương) ⇒ giữ dòng xác nhận cũ.
3. Series/số chương sửa sau ngay trên header màn chương (API `PATCH /chapters/:id` mới).
4. Giữ tính năng nhóm (khoá chương, hoạt động, glossary, chia đôi, bảng văn bản, CBZ).
5. Font mặc định thoại = font comic OFL có đủ glyph tiếng Việt (kiểm bằng manifest `viComplete`) + viền trắng; parity Konva ↔ render.py phải xanh.

## Phases
| # | Phase | Branch | Phụ thuộc | Status |
|---|---|---|---|---|
| 1 | [Tín hiệu "cần xem" đúng: bỏ region bubble, dung sai tràn khung](./phase-01-accurate-review-signals.md) | feat/ux-p1-review-signals | — | Done |
| 2 | [Canvas: vừa 1 trang, chỉ báo trang, toolbar không đè, ảnh gốc khi đang dịch](./phase-02-canvas-fit-indicator-processing-view.md) | feat/ux-p2-canvas | 1 | Done |
| 3 | [Gom trạng thái về 1 chỗ](./phase-03-consolidate-status.md) | feat/ux-p3-status | 2 | Done |
| 4 | [Thả là dịch: tự tạo + tự commit, sửa series/số chương trên header](./phase-04-drop-to-translate-flow.md) | feat/ux-p4-drop-flow | 3 | Done |
| 5 | [Typeset mặc định chất manga: font comic + viền trắng](./phase-05-comic-typeset-defaults.md) | feat/ux-p5-typeset | 4 | Done |
| 6 | [Kiểm thử toàn luồng với chương mẫu + docs](./phase-06-verify-and-docs.md) | feat/ux-p6-verify | 5 | Pending |

Tuần tự (e2e dùng DB `mtl_test_e2e` + cổng cố định chung → không chạy song song). File chung: `chapter-workspace.tsx` (P2, P3, P4), `chapter-topbar.tsx` (P3, P4), `chapter-workspace.css` (P2, P3), e2e `full-flow`/`click-budget`/`upload-chapter` (P3, P4).

## Quy tắc cho agent mỗi phase
- Tạo branch từ `main` mới nhất; commit conventional, không nhắc AI/plan/phase trong code, comment, tên test, commit message.
- Trước khi báo xong: `pnpm typecheck && pnpm lint && pnpm test` (cần `pnpm infra:up`, đang chạy) + e2e spec bị ảnh hưởng (`pnpm --filter @mtl/web e2e <spec>`). Không sửa test cho xanh bằng cách nới assert sai.
- Không merge vào main — controller review rồi merge.
- Cập nhật Status phase file + bảng trên khi xong; ghi report ngắn `plans/reports/` nếu có vấn đề còn mở.

## Tiêu chí chấp nhận chung
- [ ] Chương mẫu 5 trang: không trang nào bị "cần xem" chỉ vì tràn ≤ dung sai; khối tiêu đề tràn thật vẫn bị cờ.
- [ ] Bảng văn bản chương mẫu không còn dòng region `bubble`; số "khối chưa có bản dịch" ở drawer Xuất chỉ đếm vùng chữ.
- [ ] Mở chương: 1 trang nằm trọn khung nhìn; góc dưới hiện "Trang i/5" đúng khi cuộn.
- [ ] Đang dịch: page chưa `ready` hiện ảnh gốc + lớp "Đang dịch…", không hiện bóng thoại trống.
- [ ] Trạng thái chương chỉ ở topbar (+ rail theo trang); không banner tồn đọng.
- [ ] Từ home: thả 5 ảnh (series đoán được) → ≤ 1 thao tác (chính lần thả) tới khi chương tự dịch; e2e click-budget cập nhật.
- [ ] Đổi series/số chương trên header hoạt động, có test API + tenant isolation.
- [x] Bản dịch mặc định: font comic tiếng Việt, viền trắng; `typeset-parity` xanh.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` + toàn bộ e2e xanh trên main sau P6.
