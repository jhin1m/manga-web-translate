# Báo cáo: README, docs, smoke English (phase 7 i18n)

Trạng thái: xong, chưa commit / stage. Lint, typecheck, unit test xanh; smoke en xanh; e2e toàn bộ 1 worker 122/125,
3 spec đỏ đều là 3 cái đã biết từ trước i18n.

## File đổi

| File | Việc |
|---|---|
| `README.md` | Viết lại bằng tiếng Anh, link `README.vi.md` ở đầu, thêm khối PowerShell `curl.exe`, đoạn chọn ngôn ngữ giao diện, ghi chú docs là tiếng Việt |
| `README.vi.md` (mới) | Bản tiếng Việt cũ + link `README.md`, khối PowerShell, một câu về ngôn ngữ giao diện |
| `apps/web/e2e/i18n-en-smoke.spec.ts` (mới) | Smoke `en-US`: home → tạo series → thả 2 ảnh ở màn series → Translate chapter (worker giả) → panel Script / Translation → panel khối → công cụ Clean → Export → link Download 302 → `/settings` |
| `apps/web/src/i18n/messages/en.json` | 11 bản en sửa thuật ngữ (dưới) |
| `apps/web/src/features/fonts/font-settings.tsx` | Tiêu đề mục viết thẳng `"Font"` (ASCII nên guard không bắt) → `t("admin.adminSections.label.fonts")` |
| `apps/web/src/features/home/home.css` | Trạng thái trên thẻ (home + series) xuống dòng thay vì cắt "…"; chấm canh dòng đầu |
| `apps/web/src/features/chapter/chapter-workspace.css` | Cột Vị trí bảng Script 44 → 64 px; thanh công cụ nổi `width: max-content` |
| `apps/web/src/features/admin/admin.css` | Màn ≤ 900 px: ô Ngôn ngữ giao diện thành nhãn + ô chọn gọn một hàng (trước: ô rộng hết hàng, không nhãn) |
| `docs/design-guidelines.md` | Mục "i18n (chữ giao diện theo ngôn ngữ)" + thuật ngữ en ở mục Ngôn ngữ (sửa chồng, giữ phần đang có) |
| `docs/self-host.md` | Một đoạn về chọn ngôn ngữ giao diện (sửa chồng) |
| `docs/releases/v0.7.0.md` (mới) | Ghi chú phát hành bản kế tiếp, gồm mọi thay đổi từ v0.6.0: i18n, Pipeline theo bước, thêm provider bằng key, Font trong Cài đặt, bỏ glossary chung, migration 0031–0033, worker 0.14.0 / `MIN_PIPELINE_VERSION` |
| Plan | phase-07 `[x]`, `status: completed`, Implementation Notes; `plan.md` bảng Phases = Completed (theo front matter), Success Criteria tích mục có bằng chứng |

Không sửa selector e2e cũ, không đụng file của task khác.

## Smoke và ca đổi ngôn ngữ

- Mỗi màn: `<html lang="en">` và `body.innerText` không có dòng nào chứa ký tự có dấu tiếng Việt (cùng regex guard),
  sau khi bỏ dữ liệu: tên series / chương lấy từ `GET /api/series` (spec khác đặt tên tiếng Việt), bản dịch cố định
  "Xin chào" của worker giả, tên bản địa "Tiếng Việt". Không có lỗi JS.
- Không chép mẫu lỗi của `full-flow`: không giữ request upload, không assert chip tạm "Đang cắt trang" / "Đang chờ
  lượt", worker giả chạy trước khi bấm dịch và chờ thumbnail `Page n · Done`.
- Ca đổi ngôn ngữ ở `/settings` → reload giữ: `settings-language.spec.ts` đã phủ, nên không lặp.

## E2E toàn bộ (`playwright test --workers=1`, 7,5 phút)

122 xanh, 3 đỏ. Cả 3 trùng đúng chữ ký đã ghi ở báo cáo phase 2–4 (lỗi có ở HEAD trước i18n):

| Spec | Chỗ dừng | Nguyên nhân |
|---|---|---|
| `full-flow.spec.ts:16` | dòng 43 `held.length` = 0 | Upload đi `/files` cùng origin từ `664740f`, bộ giữ request chỉ bắt origin khác |
| `block-panel.spec.ts:317` | dòng 339 panel khối vẫn hiện | Phase 3 đưa toàn bộ `apps/web/src` về HEAD vẫn đỏ |
| `click-budget.spec.ts:43` | dòng 73 nhận "Đang chờ lượt" | Không bật worker giả, `queue_state = waiting` có từ `e87c652` |

Thay đổi CSS của phase này không chạm logic mở panel khối hay hàng đợi. Playwright tự bật / tắt :8797 và :5181, sau
khi chạy `lsof` không còn process nào. Postgres :5442 để nguyên.

## Soát ảnh en (1920, 1280, thêm 900 px)

Chụp home, hộp New series, màn series, Cài đặt dịch (cả nhóm AI instructions), chương, panel Script (3 tab), panel
khối, công cụ Clean / Scan text / Text, menu Export, menu ⋯, Phím tắt, `/settings` 4 mục; kèm bộ dò phần tử có
`scrollWidth > clientWidth`. Sau khi sửa chỉ còn `sr-only` (cố ý) và mẫu xem trước font "Xin chào! Tiếng Việt" (dữ
liệu, vi cũng vậy). Ảnh ở scratchpad, spec chụp tạm đã xoá.

Đã sửa:
- "Ch.N · Needs review" bị cắt "…" trên thẻ 157 px → xuống dòng.
- Tiêu đề "Position" dính "Source" trong bảng Script → cột 64 px.
- Thanh công cụ Clean xuống dòng ở 1280 px dù canvas còn chỗ (khung `left: 50%` chỉ được nửa canvas; lỗi có cả ở vi)
  → `width: max-content`, vẫn giữ `max-width`.
- Ô ngôn ngữ ≤ 900 px gọn lại như trên.

Thuật ngữ en (giữ nghĩa, theo thói quen scanlation):

| vi | Cũ | Mới |
|---|---|---|
| Tẩy chữ (công cụ, B) | Erase | Clean (cleaning là từ chuẩn của nhóm dịch; khớp "Clean + OCR", "Clean painted area") |
| Tuỳ chọn Tẩy chữ | Erase options | Clean options |
| Tô / Tẩy nét | Paint / Erase strokes | Brush / Eraser (cặp quen của trình sửa ảnh) |
| Phím tắt công cụ | Select · Text · Erase · Erase strokes · Scan text | Select · Text · Clean · Eraser · Scan text |
| Xưng / gọi | Self / address | I / you (kèm câu báo hàng thiếu ô) |
| Văn bản (panel) | Script | giữ: "script" là bản dịch cả chương trong scanlation |

## Còn lại

- Image / smoke Docker theo quy trình release (rc → smoke → tag) vì có migration 0031–0033 và worker 0.14.0.
- Smoke LLM thật cho `style_note` / `reason` tiếng Anh (cần key); mục này trong Success Criteria để trống.
- `plan.md` front matter vẫn `status: pending`: tôi không đổi vì còn hai việc trên; đổi bằng `ak plan update --status`.
- Bảng Phases sửa tay vì `ak plan` không có lệnh đồng bộ bảng; trạng thái nguồn là front matter (`ak plan status` 7/7).

## Câu hỏi chưa giải quyết

- `v0.7.0.md` có nhắc "Tự động" (model AI theo thứ tự thêm nhà cung cấp) của task khác đang chưa commit; nếu task đó
  không vào bản này thì bỏ câu đó ở mục Pipeline.
- Ô số (ngưỡng tin cậy) hiện "0,35" trong ảnh en: đó là `input type=number` của Chrome theo locale hệ điều hành máy
  chụp, không do app; để nguyên.
