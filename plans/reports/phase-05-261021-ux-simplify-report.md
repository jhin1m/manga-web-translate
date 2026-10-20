# Phase 5 — Typeset mặc định chất manga: report

Branch `feat/ux-p5-typeset` (từ main 0f073d5). Chưa merge, chưa push. Commit: `ac1b29c` (feat), `96e8e68` (docs) + commit cập nhật plan.

## Đã làm
- Font `Bangers-Regular.ttf` (OFL) tải raw từ `github.com/google/fonts/main/ofl/bangers/` → `worker/fonts/` + `apps/web/public/fonts/` (sha256 trùng, `sync-fonts --check` xanh). Manifest sinh bằng `worker/scripts/font_glyph_check.py` (không viết tay): `viComplete: true`, `missing: []`, upm 1000, asc 883, desc 181 (OS/2.typo).
- Mặc định thoại = Bangers ở: `manifest.defaults[0]` (`PREFERRED_DEFAULTS`), `DEFAULT_FONT` (dời sang `worker/mtl_pipeline/fonts.py` để `cli.py` dùng chung mà không nạp pipeline nặng; `pipeline.py` import lại), `--font` mặc định của CLI, `DEFAULT_DIALOGUE_FONT` (API), fallback `chapter-workspace.tsx`. `FONT_IDS` API + web thêm Bangers (web: đứng đầu danh sách chọn).
- Viền: `typeset.style_for` cho mọi box viền màu tương phản (`#000` chữ → viền `#fff`; chữ sáng → viền đen), `width = max(1.5, size × k)`, `k` = `STROKE_BUBBLE` 0.1 trong bóng, `STROKE_FREE` 0.12 ngoài bóng (giữ như cũ). Editor: `contrastStroke` cùng công thức cho khối chèn từ OCR vùng chọn (sau relayout, theo cỡ chữ thật) và khối vẽ tay (`newTextBox`, cỡ 22 → 2.2px).
- Test mới/đổi: `apps/api/test/fonts.test.ts` (FONT_IDS ≡ khoá manifest, đều viComplete; DEFAULT_DIALOGUE_FONT = defaults[0]); pytest `test_typeset_fit.py` (viền trắng trong bóng đúng công thức, chữ sáng viền đen, DEFAULT_FONT = defaults[0] + đủ dấu); vitest `actions.test.ts` (stroke khối OCR + khối vẽ tay).
- Fixture parity sinh lại (`node scripts/typeset-parity.ts`, rồi biome format; `--check` khớp): có 4 box Bangers gồm dấu chồng `ếệỗửữẫ / ẤẬỖỬỮẪ` có viền.
- Docs: `docs/typeset-layout-contract.md` mục "Mặc định auto-typeset" (lý do chọn font, công thức viền, quy trình thêm font).

## Quyết định tự chốt (owner ngủ)
1. **Bangers** thay vì Comic Neue Bold: Comic Neue thiếu ~100 chữ có dấu (Ĩ Ũ Ơ Ư, toàn bộ ạ…ỹ) → loại. Itim/Mali/Baloo 2 đủ dấu nhưng trông như chữ gõ tròn, không ra lettering. Bangers in hoa, nét đậm nghiêng nhẹ — gần WildWords của Torii nhất. Chữ thường của Bangers là small caps nên bản dịch hiển thị như in hoa (đúng lối manga).
2. **k = 0.1** trong bóng: chọn bằng mắt trên chương mẫu (xem Kiểm chứng). Viền trắng trên lòng bóng trắng không thấy, chỉ lộ khi chữ chạm nét bóng/speed line → cắt nét như lettering thật; trên art (tiêu đề chương) đọc rõ.
3. Viền nằm ngoài glyph, ở cỡ lớn (> 40px) vượt `pad` 4px vài px — **không** đưa vào fit/tràn khung (giống chữ ngoài bóng trước đây); `measure.ts` không tính stroke vào `boxOverflow` nên không sinh cờ "cần xem" mới.
4. Áp viền cho cả khối OCR vùng chọn/vẽ tay ở editor để mặc định đồng nhất với auto-typeset (plan chỉ nêu worker; không làm thì khối thêm tay trông khác hẳn).
5. Không đổi `font_size` mặc định, `PAD`, `LINE_HEIGHT` — Bangers hẹp nên fit tự lên cỡ to hơn PatrickHand, không cần chỉnh.

## Kiểm chứng
- Render chương mẫu: `mtl run demo_manga_eng` chạy được detect/inpaint (ra `clean.png` + `regions.json`) nhưng **bước OCR/dịch lỗi Gemini 429** (hết quota free-tier 20 req/ngày, reset ~12h). Thay thế: lấy bản dịch thật của chương mẫu (chương 5 trên DB dev, chỉ đọc `page_states.ai_state`, bbox region khớp 100%) → `typeset_region` + `render_page` của worker với Bangers → PNG trong scratchpad, soi mắt trang 1 và 4 (+ phóng to 2×): chữ đậm, in hoa, viền trắng rõ trên art, dấu ộ/ễ/ỗ/ụ/ữ không vỡ, không chạm dòng trên.
- `pnpm typecheck` exit 0; `pnpm lint` exit 0 (240 file); `pnpm test` exit 0 — shared 8, web 140, db 3, api 147.
- `cd worker && uv run pytest -q`: 136 passed.
- `pnpm --filter @mtl/web e2e typeset-parity`: 1 passed — 83 dòng, lệch tối đa 1px, vượt ngưỡng 0. Thêm `editor` + `chapter-tools` (editor actions đổi): 10/10 xanh.

## Còn mở
- Worker local (`mtl-worker`, PID 2396) đang nạp code cũ → sau merge cần restart để chương mới dùng Bangers + viền. Phase này không restart (đúng yêu cầu).
- Chương đã dịch trước đó giữ PatrickHand/không viền (state đã lưu); muốn đổi phải dịch lại hoặc sửa tay — không tự migrate.
- Gemini free-tier hết quota hôm nay → P6 (kiểm toàn luồng với worker thật) có thể bị chặn tới khi reset hoặc khi đổi key/provider.
- Trang 4 chương mẫu: khối chữ ngoài bóng trên màn hình điện thoại chồng lên bóng thoại bên cạnh — do hình học detect/available_rect, có cả với font cũ, không thuộc phạm vi phase này; P6 nên ghi nhận.
- Font OFL: chưa chép `OFL.txt` của Bangers vào repo (các font hiện có cũng không kèm) — gom vào đợt audit license.
