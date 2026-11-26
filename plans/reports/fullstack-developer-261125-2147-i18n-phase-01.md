# Báo cáo: nền tảng i18n web (vi + en)

Trạng thái: hoàn thành. Typecheck, unit test, e2e (vi-VN, 1 worker) và build đều xanh. Chưa commit gì.

## File đã tạo / sửa

Tạo:
- `apps/web/src/i18n/locales.ts`: registry `LOCALES`, kiểu `Locale` / `MessageKey` / `Messages`, `loadMessages`.
- `apps/web/src/i18n/i18n-store.ts`: store, `detectLocale`, `setLocale`, `applyLocale`, `initI18n`.
- `apps/web/src/i18n/t.ts`: `t`, `tp`, `tNode`, `useT`.
- `apps/web/src/i18n/format.ts`: `fmtNumber`, `fmtDate`, `collator`.
- `apps/web/src/i18n/messages/vi.json`, `en.json`: `common.*` và `settings.language.*`.
- `apps/web/src/i18n/i18n.test.ts`, `messages-parity.test.ts`, `no-hardcoded-vietnamese.test.ts`.
- `apps/web/src/features/admin/language-settings.tsx`: ô chọn ngôn ngữ.
- `apps/web/e2e/settings-language.spec.ts`: e2e mới (file ngoài danh sách, task cho phép thêm e2e có tên mô tả).

Sửa:
- `apps/web/playwright.config.ts`: thêm `locale: "vi-VN"`.
- `apps/web/src/main.tsx`: gọi `initI18n().then(render)`.
- `features/admin/admin-layout.tsx`: thêm `<LanguageSettings />` dưới thanh mục.
- `features/home/list-prefs.ts`: thay `Intl.Collator("vi")` bằng `collator()`.
- Phase file: đánh dấu các checkbox, đặt `status: completed`, thêm mục Implementation Notes.

Khác với phase: không sửa `admin-sections.ts`. Ô chọn ngôn ngữ không phải là một mục mới trong `SETTINGS_SECTIONS`, vì
`admin-sections.test.ts` và `admin-settings.spec.ts` khoá đúng danh sách mục (người thường chỉ có `["fonts"]`). Thêm mục
sẽ buộc phải sửa test cũ. Ô chọn nằm ở cột trái, dưới các nhóm, nên mọi người dùng đều thấy ở mọi mục.

## API i18n (các phase sau đọc phần này)

```ts
// i18n/t.ts
t(key: MessageKey, params?: Params): string            // Params = Readonly<Record<string, string | number>>
tp(key: PluralKey, count: number, params?: Params): string
tNode(key: MessageKey, nodes: Readonly<Record<string, ReactNode>>): ReactNode[]
useT(): { t; tp; tNode; locale: string }                // subscribe store → re-render khi đổi ngôn ngữ
// i18n/format.ts (đọc locale lúc gọi, cache formatter)
fmtNumber(n: number, opts?: Intl.NumberFormatOptions): string
fmtDate(value: Date | string | number, opts?: Intl.DateTimeFormatOptions): string   // ngày không hợp lệ → ""
collator(opts?: Intl.CollatorOptions): Intl.Collator    // mặc định { numeric: true, sensitivity: "base" }
// i18n/i18n-store.ts
initI18n(): Promise<void>        // không bao giờ reject; không lưu locale tự nhận
setLocale(code: Locale): Promise<void>   // áp ngay + lưu localStorage "mtl.locale"; tải chunk lỗi → reject
detectLocale(env?: DetectEnv): Locale    // overload thứ 2 nhận registry tạm { codes, base, foreign }
applyLocale(locale: string, messages: Messages): void   // cấp thấp, dùng trong test cho locale giả lập
```

- **Key**: phẳng, có namespace theo feature, ví dụ `common.save`, `chapter.upload.dropHint`, `errors.<code>`. Kiểu
  `MessageKey = keyof typeof vi.json` nên gõ sai key là lỗi typecheck. Thêm key thì ghi cả `vi.json` và `en.json`; test
  parity kiểm hai file có cùng key, cùng tập placeholder và không có chuỗi rỗng.
- **Placeholder** `{name}`: nếu không truyền param thì giữ nguyên `{name}`. Giá trị số được đổi bằng `String(n)`. Muốn
  định dạng theo locale thì tự truyền `fmtNumber(n)`.
- **Số nhiều**: dùng cặp `<key>.one` và `<key>.other`. Bản `vi` cũng phải có cả hai (cùng nội dung) để parity khớp.
  `tp` tự thêm `{count}` (`String(count)`); truyền `params.count` sẽ ghi đè giá trị này. Thứ tự tìm: nhóm số nhiều của
  locale hiện tại, rồi `.other` của locale đó, rồi bản `vi`.
- **Fallback**: key thiếu ở locale hiện tại thì lấy `vi`; thiếu cả ở `vi` thì trả về chính key.
- **Hằng module-level** (`const LABELS = {…}` có `t()`) sẽ giữ chữ cũ khi đổi ngôn ngữ. Hãy gọi `t()` lúc render, hoặc
  đưa `locale` vào deps của `useMemo` / `useEffect`.
- **Unit test**: chạy trên Node. Store mặc định là `vi` và không đọc `navigator`, vì Node 24 có `navigator` báo en-US.
  Nhờ vậy test cũ assert tiếng Việt vẫn xanh. Muốn test tiếng Anh thì dùng `applyLocale("en", en)` và reset về `vi`
  trong `afterEach`.
- **Thêm locale**: thêm file `messages/<code>.json` và một dòng trong `LOCALES` (`load: () => import(...)`).

## Allowlist của guard (`no-hardcoded-vietnamese.test.ts`)

- Guard quét `src/**/*.{ts,tsx,css}`, bỏ `*.test.*`, `__tests__/` và `i18n/messages/`. Comment (`//`, `/* */`,
  `{/* */}`) được bỏ trước khi quét, và số dòng vẫn giữ nguyên. Guard báo `file:dòng` nào còn ký tự có dấu tiếng Việt.
- Mỗi mục `ALLOWLIST` có dạng `{ path, line?, reason }`:
  - Không có `line`: bỏ qua cả thư mục. Cách này chỉ dùng cho thư mục chưa chuyển (`reason: NOT_MIGRATED`). Hiện có
    10 thư mục `features/*` (mỗi thư mục một dòng), cộng `app`, `routes`, `lib`.
  - Có `line`: chỉ bỏ qua những dòng chứa đoạn chữ đó, dùng cho dữ liệu hợp lệ. Hiện chỉ có `"Tiếng Việt"` trong
    `i18n/locales.ts`.
- Mục không còn khớp dòng nào thì test báo lỗi. Chuyển xong một thư mục thì xoá dòng của nó: guard bật cho thư mục đó,
  và nếu quên xoá thì test nhắc. Vì vậy `styles` không có trong allowlist: chữ Việt trong `tokens.css` chỉ nằm ở comment.
- Đã đối chiếu bộ bỏ comment với một bản quét heuristic độc lập trên toàn bộ `src`. Có 1.284 dòng bị bắt, chỉ lệch 1
  dòng, và dòng đó là comment CSS (bỏ đúng). Số dòng theo thư mục: chapter 607, series 139, admin 107, editor 104,
  fonts 64, home 60, glossary 51, update 45, pipeline 39, upload 29, app 20, routes 12, lib 7.
- Giới hạn đã biết: chữ JSX có dấu `'` hoặc `//` có thể làm bộ bỏ comment lệch tới hết dòng đó.

## Lệnh kiểm đã chạy (tuần tự, `nice`)

| Lệnh | Kết quả |
|---|---|
| `nice pnpm --filter @mtl/web typecheck` | xanh |
| `nice pnpm --filter @mtl/web test` | 64 file, 606 test xanh (test cũ không sửa) |
| `nice pnpm exec biome check` (các file đã đổi) | sạch |
| `nice pnpm --filter @mtl/web exec playwright test routes.spec.ts admin-settings.spec.ts settings-language.spec.ts --workers=1` | 9/9 xanh |
| `nice pnpm exec vite build --outDir <scratchpad>` | xanh, `en` tách thành chunk riêng 0,49 kB |

Playwright tự bật và tắt API :8797 và Vite :5181. Sau khi chạy xong, kiểm `lsof` không còn process nào nghe ở hai cổng
này. Postgres e2e (:5442, container `mtl-dev-postgres-1`) đã chạy sẵn từ trước và vẫn để nguyên. Có chụp ảnh tạm cột
trái `/settings` ở 1920 px và 800 px; spec tạm đã xoá.

## Câu hỏi chưa giải quyết

- Ở màn hẹp (≤ 900 px), ô chọn ngôn ngữ chiếm hết chiều ngang dưới hàng nút mục và tên nhóm bị ẩn theo CSS sẵn có.
  Tên truy cập vẫn đúng nhờ `aria-labelledby`. Muốn gọn hơn thì cần sửa `admin.css`, file này nằm ngoài phạm vi phase.
