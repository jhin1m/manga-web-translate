# Cook — Phase 5 Editor (react-konva) — 2026-10-20

Branch `feat/p5-editor-konva` (worktree p5), 8 commit trên `9d2e564`, chưa merge. Phase file: status → `completed`
(plan.md không sửa).

## Đã làm
- **API** `apps/api/src/routes/page-state.ts` (đăng ký ở `app.ts`):
  `GET /w/:ws/pages/:id` (state, version/ETag, ai_state, ai_rev, ai_update_available, clean_rev, URL ký ≤15'),
  `PUT …/state` (If-Match bắt buộc 428; khoá chương 423 qua `assertChapterLock`; version trong WHERE → 409 atomic;
  history ≤50; state_origin=user; giữ cờ AI; kiểm size + NFC qua zod),
  `POST …/ai-update/ack {ai_rev}`, `…/mask-upload` (presigned POST PNG ≤5MB `user-mask/{uuid}.png`),
  `…/reinpaint` (khoá, base_clean_rev phải = hiện tại, mask tồn tại + magic PNG + ≤5MB, key thuộc ws/page),
  `…/ocr-region` (bbox trong page). Chỉ dùng `sdb`. Test `apps/api/test/page-state.test.ts` + 6 case
  `RESOURCE_CASES` trong tenant-isolation.
- **Web** `apps/web/src/features/editor/**`: store zustand; undo immer patches 200 bước, gộp theo key 1s;
  action thuần (layout tiêm vào); rebase 3 chiều theo id/field, xung đột liệt kê (khôi phục/bỏ từng mục, không ghi
  đè mù); IndexedDB pending (ghi 300ms sau mỗi sửa + trước PUT); Saver (debounce 2s, single-flight, 409 rebase,
  423 read-only + thử lấy lại khoá, lượt lưu cuối khi rời editor); measure.ts khớp `typeset.py`;
  vẽ chữ bằng `Konva.Shape` tự viết (metric manifest, baseline/x theo hợp đồng, stroke 2w trước fill, NFC);
  tile 2048 ± 1 vùng nhìn, Stage = khung nhìn; mask brush/tẩy → PNG theo vùng (≤4096) → reinpaint → poll → clean
  mới; OCR vùng → chèn region + box; AI diff theo vùng/áp tất cả/ack; về bản AI; so sánh gốc; phím tắt; PageStrip;
  khoá chương qua `useChapterLock` (chỉ gọi). Route editor cắm vào `router.tsx`.
- Font: `apps/web/public/fonts` = bản sao `worker/fonts` (`fonts:sync`; `pnpm test` web fail nếu lệch); biome bỏ
  qua thư mục này. `packages/shared/src/page-state.ts`: chỉ sửa comment stroke Pillow cho khớp hợp đồng.
- Docs: `docs/editor.md` mới; 1 dòng trỏ tới nó trong `docs/development-setup.md`.

## Kiểm
- `pnpm typecheck` ✓, `pnpm lint` ✓, `pnpm test` ✓ (shared 8, db 3, web 43, api 89).
- `pnpm --filter @mtl/web e2e` ✓ 2/2 (tester chạy 2 lần không flaky): sửa → autosave → reload; rời editor ngay
  sau sửa vẫn lưu; bật/tắt so sánh không lỗi trang; Ctrl+Z; chặn PUT + đóng tab → mở lại → Khôi phục → lưu.
- Soi ảnh chụp: chữ VI dấu chồng (ệ ẫ ữ Ô Ư ỗ) + viền ngoài + auto-fit hiển thị đúng; mask brush hiển thị.
- Review: code-reviewer (3 High + Medium/Low) → sửa → re-review: High đóng, không Critical/High mới; N1, N3 đã sửa.
  Báo cáo: `code-reviewer-261020-p5-editor-konva-review-report.md`, `tester-261020-p5-editor-konva-test-report.md`.

## Quyết định
- Hàng đợi chưa lưu dùng op theo id (không lưu immer patch): patch immer theo chỉ số mảng, lệch khi server
  thêm/xoá box. Undo vẫn dùng immer patch; rebase đổi nội dung → xoá lịch sử undo (giữ nếu server chỉ tăng version).
- `letter_spacing` không dùng khi đo/vẽ (render.py cũng bỏ qua) — giữ đồng nhất với server.
- Sửa ngoài `features/editor`: `app.ts` (đăng ký route), `router.tsx` (component route), `biome.json` (ignore font),
  `apps/web/package.json` + lockfile (konva, react-konva, zustand, immer, @mtl/shared, fake-indexeddb).

## Chưa xác minh / còn lại
- **Chờ owner kiểm thủ công trên Mac** (controller chốt: không chặn merge, đo lại ở P7): mở <2s & ≥50fps page
  800×12k/20k trên M1, Safari 18, reinpaint ≤15s với worker Mac, owner làm trọn chương KO 40 slice.
  Lưu ý iOS: bitmap nguồn 800×20000 (~64MB) gần trần giải mã.
- Reinpaint/OCR vùng chỉ test ở API (fake worker e2e không hỗ trợ 2 job này); panel AI chưa có e2e.
- Đóng tab: keepalive DELETE của hook bắn đồng bộ trong pagehide, không đi qua `serial`, pagehide không chờ được
  promise → không sửa được thứ tự bằng chuỗi khoá; giữ cơ chế khôi phục IndexedDB (đã e2e).
- Còn mở từ review (thấp): xung đột chưa xử lý chỉ ở bộ nhớ (mất khi đổi trang/crash); `pruneHistory` đọc ≤51 state
  mỗi lần lưu; IndexedDB khoá theo page (2 tab cùng page ghi đè nhau); bút mask chép mảng điểm mỗi lần move; bundle 907kB (chưa tách chunk).

## Bổ sung sau quyết định controller
- `use-chapter-lock.ts`: chỉ thêm `export` cho `serial` (+1 dòng comment).
- `finalSave` chuyển vào `save.ts` (tiêm `relock`), chạy trong `serial(...)`; effect autosave khai báo trước
  `useChapterLock` → lượt lưu cuối xếp trước lệnh nhả khoá khi unmount. Không còn tự unlock trong finalSave.
- Test: `save.test.ts` (thứ tự trong chuỗi: 1 PUT, khoá nhả sau; lấy lại khoá sau 423; không lấy được → còn
  IndexedDB); e2e bấm "← Chương" ngay sau sửa → không PUT nào 423, server có bản mới.
- Tách chunk route editor: để P6.

## Câu hỏi mở
Không.
