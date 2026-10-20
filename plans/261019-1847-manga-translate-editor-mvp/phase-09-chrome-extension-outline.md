---
phase: 9
title: "(Sau MVP) Chrome extension — phác thảo"
status: pending
priority: P3
effort: "~5d"
dependencies: [7]
---
# Phase 9: (Sau MVP) Chrome extension — chỉ phác thảo

## Overview
Extension WXT + Preact (stack quen của user) để dịch ảnh truyện ngay trên trang đọc: click ảnh / tự dịch khi cuộn, overlay bản dịch, mở trong editor web. Không triển khai trong MVP (user chốt 20/10/2026).

**Phụ thuộc (red team #8):** phase này chỉ cần Phase 7 khi extension dùng **nội bộ** cho thành viên đã được mời (cài unpacked/unlisted, cùng kill-switch ngân sách toàn cục). **Đăng công khai lên Chrome Web Store hoặc cho người ngoài nhóm dùng thì bị chặn bởi Phase 8** (quota theo workspace, takedown, form báo cáo vi phạm) — extension mở ra đúng các rủi ro chi phí/bản quyền mà Phase 8 xử lý. Vì vậy `dependencies: [7]`, riêng bước 5 phụ thuộc Phase 8.

## Requirements
- Đăng nhập dùng session web (better-auth, cookie hoặc token cấp cho extension); chỉ thành viên workspace.
- Không cào cả trang: chỉ ảnh người dùng chọn hoặc ảnh trong viewport khi bật auto; nội bộ giới hạn bởi kill-switch ngân sách (Phase 7), công khai thêm quota theo workspace (Phase 8).
- Lấy ảnh: fetch từ background (né CORS) → upload presigned POST (cùng kiểm dung lượng/magic bytes như Phase 4) → tạo chương 1 trang `ephemeral` trong series "Inbox" → `chapter.ingest` → `page.prepare` → `chapter.translate` (1 trang, không ngữ cảnh lân cận) — dùng lại nguyên pipeline 2 giai đoạn. Ảnh ephemeral xoá sau 24 giờ.
- Overlay: render ảnh đã typeset (server render) hoặc vẽ text box lên canvas phủ ảnh.
- Trạng thái: polling `GET /api/w/:ws/chapters/:id/progress` (không SSE, red team #13).

## Architecture
```
content script (Preact overlay) ─msg─> background (fetch ảnh, gọi API) ─> POST /api/w/:ws/quick-translate
                                                                     └─ polling /progress
```
API mới: `POST /api/w/:ws/quick-translate` (series "Inbox" mặc định của workspace), dùng lại toàn bộ queue/worker.

## Related Code Files
Create (khi bắt đầu): `apps/extension/` (WXT), `apps/api/src/routes/quick-translate.ts`.

## Implementation Steps
1. Spike WXT + Preact, manifest v3, quyền host tối thiểu (`activeTab` + opt-in theo site).
2. Auth flow extension.
3. Quick-translate endpoint + series Inbox + xoá ephemeral tự động.
4. Overlay + nút "mở trong editor".
5. (Chặn bởi Phase 8) Đăng Chrome Web Store công khai (rà chính sách nội dung bản quyền).

## Success Criteria
- [ ] Click 1 ảnh trên trang đọc → overlay bản dịch ≤ 15s (Modal ấm).
- [ ] Ảnh ephemeral bị xoá sau 24 giờ.
- [ ] Quyền host chỉ xin khi người dùng bật cho site.
- [ ] Bản công khai chỉ phát hành khi tiêu chí Phase 8 đạt.

## Risk Assessment
| Rủi ro | K×A | Giảm thiểu |
|---|---|---|
| Chính sách Web Store về nội dung vi phạm bản quyền | TB × Cao | Không quảng bá site cụ thể; ảnh ephemeral; takedown (Phase 8) trước khi công khai |
| Site chặn hotlink/CORS | Cao × TB | Fetch từ background với referer; fallback chụp vùng màn hình (`captureVisibleTab`) |
| Bùng chi phí do auto-translate khi cuộn | TB × Cao | Mặc định tắt auto; kill-switch toàn cục (P7); quota/ngày riêng cho extension (P8) |

Rollback: extension là app riêng; gỡ route `quick-translate` không ảnh hưởng phần khác.
