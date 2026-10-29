---
title: "Phase 1: UX Xuất"
status: todo
effort: 4h
---

# Phase 1: UX Xuất (chỉ web)

## Overview

Drawer "Xuất chương" thành: cảnh báo nói hậu quả → "Tuỳ chọn" thu gọn (1 dòng tóm tắt) → 1 nút "Tải chương (.zip|.cbz)"
→ tiến độ ngay tại nút → **xong tự tải** (fallback nút "Tải xuống" tại chỗ) → "Lượt xuất trước (n)" thu gọn.
Không đổi API/worker. Chạy song song với P2.

## Context

- `apps/web/src/features/chapter/export-panel.tsx:50-193` (ExportPanel), `:195-241` (ExportRow, dùng lại ở
  `activity-drawer.tsx:15,271`), `:36-48` (`useExports`, dùng ở `chapter-workspace.tsx:61,748`).
- `apps/web/src/features/chapter/export-drawer.tsx:12-38` — đã nhận `detail` (có `source_files[].skip`), `pages`, `rows`.
- `apps/web/src/features/chapter/export-warnings.ts:9-37` — đếm `failed/notReady/overflow/empty/aiPending`.
- Worker: trang `translated` = `status==="ready"` có ảnh sạch (`apps/api/src/jobs/claim-inputs.ts:312`); trang khác
  khi `include_untranslated` → xuất **ảnh gốc** (`claim-inputs.ts:321`), không phải ảnh đã xoá chữ. CBZ `quality<100`
  → JPEG, `100` → PNG (`worker/mtl_worker/export.py:87`).
- Kiểu `ExportView`/`ExportRequest`: `apps/web/src/features/chapter/api.ts:154-173` (không sửa).

## Requirements

- Nhãn định dạng: "Ảnh trong .zip — để đăng web" / ".cbz — đọc bằng app đọc truyện". Không còn chữ "ZIP PNG", "slice".
- Chất lượng CBZ: 3 nút Gốc (100, PNG) / Cao (90, mặc định) / Nhẹ (75). Bỏ ô số.
- "Cách chia ảnh": "Giống lúc tải lên (N ảnh)" / "Theo trang đã cắt (M ảnh)"; N = `source_files` có `skip===null`,
  M = số trang hiện (`pages.length`). Ẩn cả mục khi N === M (manga 1 ảnh = 1 trang), gửi `original_slices`.
- Checkbox "Đưa cả trang chưa dịch vào (ảnh gốc, chưa có bản dịch)" — nhãn theo đúng hành vi worker (ảnh gốc).
- Dòng tóm tắt khi thu gọn, VD "Ảnh .zip · 96 ảnh như lúc tải lên", ".cbz · 30 trang đã cắt · Cao · gồm trang chưa dịch".
- Cảnh báo (thứ tự): "N trang chưa dịch → không có trong file" (ẩn khi bật checkbox; trang lỗi/đang chạy/chờ dịch đều
  tính) · "N khối chưa dịch → để trống chữ" · "N trang AI có bản mới → xuất bản đang hiện" · "N khối tràn khung → chữ
  có thể bị cắt"; nút "Xem N chỗ này" (N = khối chưa dịch + tràn khung + trang AI mới; ẩn khi 0) gọi `onShowWarnings`.
- Nút chính "⬇ Tải chương (.zip)" / "(.cbz)"; đang chạy → "Đang xuất 40%…" (disabled); xong → tự tải 1 lần qua anchor
  `download_url`; luôn hiện link "Tải xuống" tại chỗ khi lượt vừa xuất xong còn hạn (fallback trình duyệt chặn).
  Lỗi → câu lỗi + nút bấm lại.
- Bỏ: mục "Phạm vi", câu "PNG luôn không mất dữ liệu", dòng "link 5 phút / giữ 7 ngày" (→ `title` của ExportRow),
  nút "Huỷ" của panel (drawer đã có "Đóng").
- ExportRow: nhãn ".zip · như lúc tải lên · Cao", không in `x.stage` thô (P5 thêm nhãn bước tiếng Việt). Giữ chữ ký.

## Architecture

Luồng: `ExportDrawer` (đếm `sources`, `pages`, `rawWarnings = exportWarnings(pages, rows)`) → `ExportPanel` (state
`format/layout/quality/include/pendingId`) → `createExport` → `useExports` poll 1,5s → `exportPhase(list, pendingId)`
→ phase `ready` + chưa tải → `triggerDownload(url)` (ref chặn tải lặp).

```ts
// export-options.ts (mới, thuần)
export type CbzQuality = "original" | "high" | "light";
export const CBZ_QUALITY: Record<CbzQuality, { label: string; value: number }>; // Gốc 100, Cao 90, Nhẹ 75
export function qualityLabel(q: number): string;            // 100 "Gốc", 90 "Cao", 75 "Nhẹ", khác `chất lượng ${q}`
export const FORMAT_LABEL: Record<ExportFormat, { ext: ".zip" | ".cbz"; long: string }>;
export function showLayoutChoice(c: { sources: number; pages: number }): boolean;   // sources !== pages
export function optionsSummary(o: { format: ExportFormat; layout: ExportLayout; quality: number;
  includeUntranslated: boolean }, c: { sources: number; pages: number }): string;
export type ExportPhase =
  | { kind: "idle" } | { kind: "running"; pct: number } | { kind: "ready"; id: string; url: string }
  | { kind: "failed"; error: string } | { kind: "expired" };
export function exportPhase(list: ExportView[], pendingId: string | null, now?: number): ExportPhase;

// export-warnings.ts (đổi)
export type ExportWarnings = { untranslated: number; overflow: number; empty: number; aiPending: number };
export function exportWarnings(pages, rows): ExportWarnings;               // untranslated = status !== "ready"
export function warningLines(w: ExportWarnings, o: { includeUntranslated: boolean }): string[];
export const reviewCount = (w: ExportWarnings) => w.overflow + w.empty + w.aiPending;
```

CSS mới đặt trong `export-panel.css` (import ở `export-panel.tsx`), dùng lại class `.drawer-*` có sẵn ở
`apps/web/src/app/drawer.css` (không sửa file đó). Thu gọn dùng `<details>/<summary>`.

## File sở hữu

| Thao tác | Đường dẫn |
|---|---|
| Sửa | `apps/web/src/features/chapter/export-panel.tsx` |
| Sửa | `apps/web/src/features/chapter/export-drawer.tsx` |
| Sửa | `apps/web/src/features/chapter/export-warnings.ts` |
| Sửa | `apps/web/src/features/chapter/export-warnings.test.ts` |
| Tạo | `apps/web/src/features/chapter/export-options.ts` |
| Tạo | `apps/web/src/features/chapter/export-options.test.ts` |
| Tạo | `apps/web/src/features/chapter/export-panel.css` |
| Sửa (chỉ đoạn xuất, dòng ~215-230) | `apps/web/e2e/chapter-tools.spec.ts` |
| Sửa (chỉ đoạn xuất, dòng ~90-100) | `apps/web/e2e/full-flow.spec.ts` |

## Không được đụng

`activity-drawer.tsx`, `chapter-workspace.tsx`, `chapter-workspace.css`, `app/drawer.css`, `api.ts`, `page-status.ts`,
`source-rail*.ts(x)`, mọi file `apps/api/**`, `worker/**`, `packages/**` (thuộc P2 hoặc ngoài phạm vi). Không đổi chữ
ký export `ExportRow`, `useExports`, `isExportActive`, `EXPORT_POLL_MS`. Thông báo toast khi drawer đã đóng → **hoãn
sang P5** (cần `notify` trong `chapter-workspace.tsx`).

## Test viết trước (đỏ trước khi code)

`apps/web/src/features/chapter/export-options.test.ts`
- "CBZ_QUALITY maps Gốc/Cao/Nhẹ to 100/90/75" — assert `CBZ_QUALITY.light.value === 75`, `qualityLabel(100)==="Gốc"`, `qualityLabel(80)==="chất lượng 80"`.
- "summary line says what the file contains" — `optionsSummary({format:"png_zip",layout:"original_slices",quality:90,includeUntranslated:false},{sources:96,pages:30})` === `"Ảnh .zip · 96 ảnh như lúc tải lên"`; cbz + pages + 75 + include → `".cbz · 30 trang đã cắt · Nhẹ · gồm trang chưa dịch"`.
- "layout choice hidden when uploads map 1:1 to pages" — `showLayoutChoice({sources:12,pages:12})===false`.
- "exportPhase follows the pending export" — list có pending `running` progress 0.4 → `{kind:"running",pct:40}`; `succeeded` + url + chưa hết hạn → `ready`; `expires_at` quá khứ → `expired`; `failed` → `failed` kèm `error`; `pendingId=null` → `idle`.
- "no label contains slice or ZIP PNG" — mọi chuỗi trong `FORMAT_LABEL` và `optionsSummary` không khớp `/slice|ZIP PNG/i`.

`apps/web/src/features/chapter/export-warnings.test.ts` (viết lại)
- "untranslated pages are said to be missing from the file" — 1 `prepared` + 1 `failed` + 1 `ready` → `untranslated: 2`; `warningLines(w,{includeUntranslated:false})[0] === "2 trang chưa dịch → không có trong file"`.
- "the missing-pages warning disappears when untranslated pages are included" — cùng dữ liệu, `includeUntranslated:true` → không có dòng nào chứa "không có trong file".
- "each warning states its consequence" — dòng khối trống `"1 khối chưa dịch → để trống chữ"`, AI mới `"1 trang AI có bản mới → xuất bản đang hiện"`, tràn `"2 khối tràn khung → chữ có thể bị cắt"`; `reviewCount` = 4.
- Giữ ca cũ "counts untranslated text regions only, never speech-bubble outlines" (đổi assert theo type mới).

Lệnh hẹp: `pnpm --filter @mtl/web exec vitest run src/features/chapter/export-options.test.ts src/features/chapter/export-warnings.test.ts`

## Implementation Steps

1. Viết 2 file test trên, chạy → đỏ.
2. Tạo `export-options.ts`; đổi `export-warnings.ts` theo type mới → test xanh.
3. `export-drawer.tsx`: tính `sources = detail.source_files.filter(f => !f.skip).length`, `pages.length`, `rawWarnings`;
   truyền xuống panel; bỏ prop `onCancel`.
4. `export-panel.tsx`: dựng lại bố cục (cảnh báo → `<details>` Tuỳ chọn có dòng tóm tắt → nút chính có trạng thái →
   link "Tải xuống" fallback → `<details>` "Lượt xuất trước (n)"). `pendingId` = id job từ `createExport` (cả khi
   `created:false` — dùng `r.job.id`). Tự tải: `useEffect` khi `exportPhase.kind==="ready"` và `downloadedRef !== id`
   → tạo `<a href download>` click; ghi `downloadedRef`.
5. ExportRow: nhãn mới qua `FORMAT_LABEL`/`qualityLabel`, `title` = "Link tải hiệu lực 5 phút, file giữ 7 ngày", bỏ
   in `x.stage`.
6. `export-panel.css`: khoảng cách nút chính, summary, nhóm nút chất lượng (segmented).
7. Sửa e2e: nút `"Tải chương (.zip)"`; link `"Tải xuống"` vẫn có (fallback) → giữ assert 302.
8. `pnpm --filter @mtl/web test`, `pnpm --filter @mtl/web typecheck`, `pnpm lint`.

## Success Criteria

- [ ] 2 file test xanh; toàn bộ test web xanh; typecheck + biome sạch.
- [ ] `grep -nE "slice|ZIP PNG|type=\"number\"|Phạm vi|PNG luôn" apps/web/src/features/chapter/export-panel.tsx` rỗng.
- [ ] Kiểm tay: 1 lần bấm "Tải chương" → file tự tải; trình duyệt chặn → link "Tải xuống" tại chỗ dùng được.
- [ ] Bật "Đưa cả trang chưa dịch vào" → cảnh báo "không có trong file" biến mất.
- [ ] Drawer Hoạt động (P2 đang sửa song song) vẫn render ExportRow không lỗi type.

## Risk + rollback

| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| Tự tải bị trình duyệt chặn (không có user gesture sau async) | M×M | Link "Tải xuống" luôn hiện tại nút khi lượt mới xong |
| Tải lặp mỗi lần poll | M×L | `downloadedRef` theo id job |
| P2 đổi `activity-drawer.tsx` cùng lúc | L×M | P1 không đổi chữ ký export; merge P1 trước hoặc sau đều được |
| N "ảnh như lúc tải lên" lệch số file thật (slice chỉ chứa trang chưa dịch bị bỏ) | L×L | Nhãn là số ảnh đã tải lên; chấp nhận |

Rollback: revert commit (chỉ web, không dữ liệu).

## Docs (controller làm cuối)

`docs/export-and-batch-edit.md` mục "Xuất chương": thay mô tả form cũ bằng bố cục mới, 3 mức CBZ, tự tải + fallback,
cảnh báo hậu quả. `docs/editor.md` mục "Drawer Xuất / Hoạt động": bỏ nút Huỷ, "Lượt xuất trước".
