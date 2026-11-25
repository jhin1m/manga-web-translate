# Web: icon cài đặt, gộp Font vào Cài đặt, bỏ Hạn mức

Trạng thái: xong. Chỉ sửa `apps/web/**`, không commit, không đụng index git.

## Đã làm

- Modal "Cài đặt dịch": `SetGroup` (`features/admin/settings-ui.tsx`) có thêm prop `icon`, `collapsible`, `summary`.
  Nhóm "Hướng dẫn cho AI" gập sẵn mỗi lần mở modal. Tiêu đề là nút có chevron, `aria-expanded` và `aria-controls`.
  Khi gập, cạnh tiêu đề hiện tóm tắt do `aiGuideSummary` tạo (trong `settings-draft.ts`, có test), vd
  "Có giọng văn · 3 xưng hô · 12 thuật ngữ".
  Thẻ khi gập chỉ được đặt `hidden`, không bị gỡ, nên state bên trong còn nguyên. Ô đang sửa vẫn lưu khi rời ô
  (blur xảy ra trước click). Bốn nhóm đều có icon.
- Icon gom ở `src/app/settings-icons.tsx`: SVG kiểu lucide, 16px, `aria-hidden`.
- `/settings`:
  - Danh sách mục ở `admin-sections.ts` đổi tên thành `SETTINGS_SECTIONS`. Mục "Font" thuộc nhóm "Chung" và đứng đầu.
    `visibleSections({ admin, localMode })` lọc mục: người thường chỉ thấy Font, local mode ẩn mục Người dùng.
  - Vào mục lạ, hoặc mục mình không được thấy, thì về mục đầu tiên (Font). Admin giờ cũng mặc định mở mục Font.
  - Thanh trái và tiêu đề các panel đều có icon: Pipeline và 5 nhóm bước của nó, Nhà cung cấp, Người dùng, và 3 nhóm
    của mục Font.
- Bỏ "Hạn mức & đăng ký": xoá `limits-section.tsx` và `limits-model.ts(+test)`. `AdminSettings` chỉ còn
  `pipeline` và `slots`. `fmtUsd` chuyển sang `users-model.ts`, có test. `price-suggestions.ts` vẫn giữ vì form
  nhà cung cấp còn dùng.
- `/fonts` chuyển hướng (replace) sang `/settings?section=fonts`; đã xoá `routes/fonts.tsx`. Menu tài khoản bỏ link Font
  riêng; link "Cài đặt" giờ hiện cho mọi người dùng.
- e2e cập nhật:
  - `admin-settings`: bỏ ca limits; đổi kỳ vọng mặc định sang Font; thêm ca người thường chỉ thấy Font.
  - `fonts`, `routes`: đi qua `/settings?section=fonts`.
  - `signup`: bỏ ca bật/tắt đăng ký trên UI vì giờ chỉ đổi được qua env.
  - `series-manage`, `series-auto-memory`: bấm mở nhóm AI trước khi điền.

## Kiểm

- `pnpm --filter @mtl/web typecheck`: xanh.
- `biome check apps/web`: sạch.
- `pnpm --filter @mtl/web test`: 61 file, 582 test, đều xanh.
- Spec e2e đã sửa: typecheck tạm không có lỗi mới; chỉ còn lỗi môi trường thiếu kiểu node có sẵn từ trước. Chưa chạy e2e.
