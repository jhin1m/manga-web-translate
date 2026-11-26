# Báo cáo: chuyển chuỗi editor, series, home, upload, glossary sang i18n (vi + en)

Trạng thái: hoàn thành, có một lưu ý về e2e. Typecheck, unit test (có guard và parity) và Biome đều xanh. Trong 68 test
e2e, 67 xanh. Test đỏ duy nhất trong `block-panel` đã đỏ từ trước thay đổi này (xem mục E2E). Chưa commit gì.

## Phạm vi

- Đã chuyển chữ giao diện trong `apps/web/src/features/{editor,series,home,upload,glossary}`. Đã xoá 5 dòng
  `NOT_MIGRATED` tương ứng khỏi `ALLOWLIST`.
- Có thêm file mới `features/upload/zip-entry.ts`: tách `mimeOf`, `isJunkEntry`, `UnzipMessage`, `UploadMime` ra khỏi
  `files.ts`, để `unzip-worker.ts` (Web Worker) không kéo store i18n vào. `files.ts` vẫn re-export các tên này.
- Không sửa test cũ, selector e2e hay `packages/shared`.

## Namespace key (426 key mới)

| Prefix | Số key | Ghi chú |
|---|---|---|
| `editor.<module>.*` | 116 | `save`, `shortcuts`, `ocrWait`, `ocrSelect`, `maskToolBar`, `properties`, `conflictList`, `aiUpdate`, … |
| `series.<module>.*` | 151 | `page`, `settingsForm`, `newSeriesDialog`, `fontFields`, `langLabels`, … |
| `home.<module>.*` | 69 | `page`, `newChapterConfirm`, `listPrefs`, `listToolbar` |
| `glossary.<module>.*` | 44 | `apply`, `editor` |
| `upload.<module>.*` | 28 | `chapterUploadStatus`, `dropZone`, `files`, `manager`, `queue` |
| `lang.<code>`, `lang.short.<code>` | 18 | tên đầy đủ ("Tiếng Hàn" / "Korean") và tên ngắn cho header ("Hàn" / "Korean") |

Các cách làm cần biết:
- **Tên ngôn ngữ.** `series/lang-labels.ts` có `langName`, `langShort` và `LANG_NAMES`. `LANG_NAMES` là map getter theo
  mã, đặt cùng tên để `chapter/lang-pair-fields.tsx` vẫn chạy mà không phải sửa. Trong web, chỉ
  `features/pipeline` (phase 4) còn import `LANG_NAMES` từ shared.
- **`PAGE_BUSY_SAVE_TEXT`.** Vẫn export kiểu `string`, nhưng khai báo bằng `export let` và được gán lại trong
  `i18nStore.subscribe` (ESM live binding). Nhờ vậy topbar và `save.test.ts` vẫn đọc như chuỗi.
- **Export có shape bị đọc** (`SHORTCUT_HELP`, `SERIES_SORTS` / `CHAPTER_SORTS`, `PAGE_FORMAT_LABELS`): giữ shape, nhãn
  đổi thành getter.
- **CSS.** `home.css` từng chọn `a[aria-label="Về trang chủ"]`; selector này sẽ hỏng khi nhãn được dịch. Đã đổi sang
  class `series-home-link`, thêm vào Link trong `series-page.tsx`.
- **Giữ nguyên, không dịch:**
  - Ví dụ xưng hô theo ngôn ngữ đích (`anh/em`, `Boss / kid`). Hai chuỗi này không có dấu nên không cần allowlist.
  - Tiêu đề cột CSV của glossary.
  - `natural-sort.ts` vẫn cố định `Intl.Collator("en")`, vì thứ tự trang khi tải tiếp không được đổi theo ngôn ngữ.
- **Log dev** (`console.warn`): đổi sang chữ tiếng Anh viết thẳng.

## Allowlist dữ liệu đã thêm

| File | Đoạn khớp | Lý do |
|---|---|---|
| `features/upload/parse-chapter-filename.ts` | `\|chương\|chuong\|` | Regex nhận tiền tố số chương trong tên file người dùng đặt |
| `features/upload/parse-chapter-filename.ts` | `.replace(/đ/gi, "d")` | Bỏ dấu tên file trước khi so khớp series |

## Lệnh kiểm (tuần tự, `nice`)

| Lệnh | Kết quả |
|---|---|
| `nice pnpm --filter @mtl/web typecheck` | xanh |
| `nice pnpm --filter @mtl/web test` | 64 file, 606 test xanh (có guard và parity) |
| `nice pnpm exec biome check apps/web/src/features/{editor,series,home,upload,glossary} apps/web/src/i18n` | 114 file, sạch |
| `nice pnpm exec playwright test editor block-panel draft-wheel-flip typeset-parity series-manage series-auto-memory list-sort-view upload-chapter signup --workers=1` | 67/68 xanh |

Playwright tự bật và tắt API :8797 và Vite :5181. Sau khi chạy, `lsof` không còn process nào nghe ở hai cổng này.
Postgres :5442 để nguyên.

## E2E `block-panel.spec.ts:317`: đỏ từ trước, không do i18n

Test "double-clicking a block under the future panel with the panel collapsed still edits the text on the image" đỏ ở
dòng 339 (`blockPanel` vẫn hiện sau cửa sổ nhấp đúp). Lỗi lặp lại 3/3 lần với `--repeat-each=3`.

Để tìm nguyên nhân, tôi lần lượt đưa mã về HEAD rồi chạy lại test. Trước mỗi bước đều backup bằng tar, chạy xong khôi
phục và chạy lại gate (xanh):
- Đưa `features/editor` về HEAD: vẫn đỏ.
- Đưa thêm `features/chapter` về HEAD: vẫn đỏ.
- Đưa toàn bộ file tracked của `apps/web/src` cùng `playwright.config.ts` về HEAD (không còn i18n): vẫn đỏ.

Vậy lỗi có sẵn ở HEAD. Logic hẹn mở panel nằm ở `chapter/chapter-workspace.tsx` (`openAfterPointer`, dòng ~360), không
thuộc phạm vi phase này.

## Câu hỏi chưa giải quyết

- Có xử lý test `block-panel.spec.ts:317` trong một việc riêng không?
- Lỗi "Chữ bỏ qua" ở series có dạng `{line}: {reason}`. Phần `reason` lấy từ `ignoreEntryError` trong `@mtl/shared`,
  vẫn là tiếng Việt, nên phase 4 cần xử lý cùng `LANG_NAMES`.
- Các thông báo lỗi đã ghi vào store (ví dụ `setSave("error", …)`) vẫn giữ ngôn ngữ cũ tới lượt lưu sau khi người dùng
  đổi ngôn ngữ. Đây là trạng thái tạm thời nên tôi để nguyên.
- Một số thuật ngữ en mới nên xem lại khi soát ảnh chụp ở phase 7: "Tô" = "Paint", "Tẩy nét" = "Erase strokes", "Xưng /
  gọi" = "Self / address".
