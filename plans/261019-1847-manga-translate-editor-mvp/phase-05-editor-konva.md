---
phase: 5
title: "Editor react-konva"
status: completed
priority: P1
effort: "12d"
dependencies: [3, 4]
---
# Phase 5: Editor (react-konva)

## Overview
Editor kiểu Canva để sửa kết quả: layer original/clean/text/mask, sửa/di chuyển/resize/xoay text box, font/stroke/căn lề, brush mask → re-inpaint, OCR vùng chọn, undo/redo, chuyển trang, so sánh trước/sau, strip dài render theo tile, merge "kết quả AI mới" theo vùng, không mất chỉnh sửa khi xung đột hoặc crash. Trạng thái nằm trong store; Konva chỉ render. Chỉ chữ ngang (VI ngang, nguồn KO) — không có chữ dọc (red team, gộp kèm).

Effort 8d → 12d (red team #10): thêm hàng đợi patch IndexedDB + rebase khi 409, merge kết quả AI, route mask, hợp đồng layout.

## Requirements
- **Nguồn sự thật:** `page_states.state`, lưu bằng optimistic version (`PUT /api/w/:ws/pages/:id/state`, `If-Match: <version>`). Server **ép khoá chương**: không giữ khoá → 423 (red team #6).
- **Không ghi đè mù (red team #6):** 409 → tải state mới từ server, **áp lại các patch chưa lưu** (immer patches) lên bản mới; patch nào không áp được (box đã bị xoá) → liệt kê cho người dùng bỏ/khôi phục. Không có nút "ghi đè".
- **Hàng đợi patch chưa lưu trong IndexedDB** (theo page + base version): ghi trước khi gửi PUT, xoá khi server xác nhận; mở lại sau crash/đóng tab → đề nghị khôi phục (red team #6).
- Autosave debounce 2s + khi rời trang + heartbeat khoá chương.
- **Kết quả AI mới (red team #1):** `ai_update_available=true` → banner "có kết quả AI mới"; xem diff theo vùng (source/translation cũ vs mới), áp từng vùng hoặc tất cả (`applyRegionTranslation`) như một thao tác editor bình thường (có undo, đi qua save). `resetToAI` = thay state bằng `ai_state` (1 bước undo).
- **Undo/redo thống nhất ≥ 100 bước/trang** (red team, gộp kèm): zustand + immer `produceWithPatches`, gộp kéo liên tục thành 1 bước.
- Strip dài: ảnh cắt tile 2048px (client `createImageBitmap` cắt vùng từ ảnh clean rev hiện tại), chỉ mount tile trong viewport ± 1; không canvas nào vượt 4096px/cạnh (Safari/iOS). Page logic tối đa 12000px (trần ingest, Phase 3).
- **Layer clean theo `pages.clean_rev`** (cột ở `pages`, không nằm trong `page_state`) (red team #6); editor nhận rev qua `GET /pages/:id`.
- **Text theo hợp đồng layout (red team #11):** NFC khi nhập; đo `lines[]` bằng Konva với **cùng file font** server dùng (`FontFace`, chờ `document.fonts.ready`); baseline từ ascent/descent của font (giá trị lấy từ manifest font sinh bởi `worker/scripts/font_glyph_check.py`); stroke ra ngoài: `strokeWidth = 2·stroke.width` + `fillAfterStrokeEnabled`.
- **Brush mask → reinpaint (red team #3):** vẽ trên offscreen canvas theo vùng chạm → PNG crop + offset → `POST /pages/:id/mask-upload` (presigned POST ≤ 5MB, key `user-mask/{uuid}.png`) → upload → `POST /pages/:id/reinpaint {user_mask_key, offset:[x,y], base_clean_rev}` → poll job → khi xong đổi layer clean sang `clean_rev` mới.
- OCR vùng chọn: kéo khung → `page.ocr_region` → poll → editor chèn region + text box vào state (thao tác có undo).
- Phím tắt: V (chọn), T (text), B (brush), E (tẩy), Ctrl/Cmd+Z/Shift+Z, Space kéo canvas, ←/→ chuyển trang.
- UI theo `docs/design-guidelines.md` (không AI slop): toolbar gọn, panel thuộc tính bên phải, bảng region (source | translation) sửa nhanh.

## Architecture
`page_state` (schema_version 1, zod ở `packages/shared/src/page-state.ts`):
```json
{
  "schema_version": 1,
  "size": {"w": 800, "h": 12000},
  "view": {"show_original": false},
  "regions": [{"id":"r1","kind":"bubble|text_bubble|text_free","bbox":[x,y,w,h],"polarity":"dark_on_light|light_on_dark",
               "source_text":"…","translation":"…","confidence":0.92,"flags":["sfx","empty","low_conf"]}],
  "text_boxes": [{"id":"t1","region_id":"r1","x":120,"y":340,"w":180,"h":120,"rotation":0,
                  "text":"…","lines":["Anh đang","làm gì vậy?"],
                  "font":"BeVietnamPro-SemiBold","size":22,"line_height":1.15,"letter_spacing":0,
                  "align":"center","fill":"#111","stroke":{"color":"#fff","width":3},
                  "auto_fit":true,"hidden":false}],
  "meta": {"pipeline_version":"0.3.0","model":"…","glossary_rev":12,"settings_rev":4,"context_used":"rolling"}
}
```
Không có `vertical`, không có `clean_rev` trong state (red team #6, gộp kèm). `stroke.width` = bề rộng ra ngoài (red team #11).

Store: `useEditorStore` { state, version, selection, tool, history(past/future patches, ≥ 100), pending(patch chưa lưu), dirty }. Action thuần (move, resize, editText, setStyle, addBox, deleteBox, applyRegionTranslation, resetToAI, insertOcrRegion) → test unit không cần DOM.
`save.ts`: PUT → 200 (xoá pending khỏi IndexedDB) | 409 (fetch + rebase pending) | 423 (mất khoá → read-only + thông báo).
Konva tree: `Stage` → `Layer original|clean (tiles)` → `Layer text` (Group mỗi box + Transformer) → `Layer mask` (brush) → `Layer ui`.
Text edit: overlay `<textarea>` HTML trên box khi double-click (pattern chuẩn Konva).

API (Phase 5 sở hữu `apps/api/src/routes/page-state.ts`, dưới `/api/w/:ws`):
```
GET  /pages/:id                state, version, ai_state, ai_update_available, clean_rev, presigned GET clean/original
PUT  /pages/:id/state          If-Match; cần khoá; ghi history; state_origin='user'; ai_update_available giữ nguyên
POST /pages/:id/ai-update/ack  tắt cờ sau khi người dùng xem xong
POST /pages/:id/mask-upload    presigned POST user-mask
POST /pages/:id/reinpaint      cần khoá; enqueue page.reinpaint
POST /pages/:id/ocr-region     enqueue page.ocr_region
```

## Related Code Files
Create (Phase 5 sở hữu `apps/web/src/features/editor/**`):
- `features/editor/{EditorPage.tsx,store.ts,actions.ts,history.ts,save.ts,pending-queue.ts,rebase.ts,fonts.ts,measure.ts}`
- `features/editor/canvas/{Stage.tsx,TileLayer.tsx,TextLayer.tsx,TextBoxNode.tsx,MaskLayer.tsx,OcrSelect.tsx}`
- `features/editor/panels/{Toolbar.tsx,Properties.tsx,RegionTable.tsx,PageStrip.tsx,AiUpdatePanel.tsx}`
- `features/editor/__tests__/{actions.test.ts,history.test.ts,measure.test.ts,rebase.test.ts,pending-queue.test.ts}`
- `apps/api/src/routes/page-state.ts`, `apps/api/test/page-state.test.ts`
- `apps/web/public/fonts/` (cùng bộ font với `worker/fonts/` + manifest metric, script sync)
Modify: `packages/shared/src/page-state.ts`, `apps/web/src/app/router.tsx` (1 dòng route — phối hợp với P4), `apps/api/test/tenant-isolation.test.ts`

## Implementation Steps
1. Store + actions + history thuần TS, test trước.
2. Stage + TileLayer (viewport culling), zoom/pan, đo hiệu năng trên page 800×12.000px (trần ingest) và ảnh thử 20.000px (dự phòng ingest đổi trần).
3. TextLayer + Transformer + textarea edit + đo `lines[]` theo hợp đồng layout.
4. Properties panel (font, size, stroke, align, auto-fit), RegionTable sửa bản dịch hàng loạt.
5. Route `page-state.ts` (khoá, If-Match, history) + test cô lập tenant theo id.
6. `save.ts` + `pending-queue.ts` (IndexedDB) + `rebase.ts`; test: 409 → rebase; patch xung đột → liệt kê.
7. AiUpdatePanel: diff theo vùng, áp từng vùng.
8. MaskLayer brush/tẩy + mask-upload + reinpaint, poll, đổi clean_rev.
9. OCR vùng chọn.
10. Reset về AI, toggle before/after, phím tắt, chuyển trang, heartbeat khoá.
11. Playwright: sửa text → reload → còn nguyên; đóng tab giữa chừng → mở lại khôi phục; undo 100 bước.

## Success Criteria
- [ ] Page 800×12.000px (trần ingest) và ảnh thử 800×20.000px: mở < 2s (ảnh đã cache), cuộn ≥ 50fps trên MacBook M1 Chrome; không crash Safari 18.
- [ ] Undo/redo đúng sau 100 thao tác hỗn hợp (test unit).
- [ ] Reinpaint vùng brush trả về và hiển thị ≤ 15s với worker Mac.
- [ ] Lưu xung đột 409 → tự rebase, không mất patch; patch xung đột được liệt kê, không ghi đè mù.
- [ ] Kill tab giữa lúc sửa → mở lại khôi phục được thay đổi chưa lưu.
- [ ] Chạy lại dịch chương khi đã sửa tay → chỉnh sửa còn nguyên, banner AI mới, áp từng vùng được.
- [ ] Tiếng Việt dấu chồng (ệ, ẫ, ữ) hiển thị đúng ở mọi font mặc định.
- [ ] Owner sửa xong 1 chương KO 40 slice mà không phải rời editor.

## Risk Assessment
| Rủi ro | K×A | Giảm thiểu |
|---|---|---|
| Giới hạn kích thước canvas / RAM trên strip dài | Cao × Cao | Tile 2048, culling, mask theo vùng, không `toDataURL` toàn trang ở client |
| Lệch đo chữ browser vs server | TB × Cao | Hợp đồng layout (NFC, baseline font, stroke ra ngoài), `lines[]` lưu sẵn, cùng font file; gate bbox glyph ≤ 1px ở Phase 6 (red team #11) |
| Mất chỉnh sửa (crash, 409) | TB × Cao | IndexedDB pending + rebase, không ghi đè mù (red team #6) |
| Rebase patch sai ngữ nghĩa | TB × TB | Patch theo id box/region; không tìm thấy id → liệt kê, không đoán |
| Hiệu năng undo với state lớn | Thấp × TB | immer patches, không clone toàn state |
| Ghi đè lẫn nhau | TB × TB | Khoá chương ép ở server + If-Match |
| UI rối/"AI slop" | TB × TB | Design guidelines + owner duyệt |

Rollback: feature folder riêng; nếu editor chưa ổn vẫn xuất được kết quả AI (Phase 6 đọc `page_state`).
