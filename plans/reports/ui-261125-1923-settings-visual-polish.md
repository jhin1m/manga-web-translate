# Làm lại phần nhìn trang Cài đặt và modal Cài đặt dịch (25/11/2026)

Trạng thái: xong. Không đổi hành vi, API, route hay autosave. Chỉ sửa `apps/web/**`, chưa commit.

## Nguyên nhân trang bị dồn sang trái
`.page` trong `src/styles/tokens.css` có `max-width: 1400px` nhưng thiếu `margin: 0 auto`. Thêm vào đó, `.admin-page` đặt lại `max-width: 1080px` và `.admin-panel` giới hạn ở 820px, nên cả khung dính vào lề trái. Đã sửa ở `.page`: dùng cùng container với trang chủ (`max-width: 1080px; margin: 0 auto`, padding giống `.home`). Chỉ trang Cài đặt dùng `.page`. Ảnh chụp ở 1440 và 1920 cho thấy hai bên trống đều nhau (444px ở 1920).

## Thay đổi chính
- **Khung trang**: cột trái gồm tiêu đề "Cài đặt" và thanh mục, dính khi cuộn; panel nằm bên phải, ngang hàng với tiêu đề. Từ 900px trở xuống, thanh mục thành hàng nút tròn tự xuống dòng, bỏ tên nhóm.
- **Đầu mục** (`SectionHead`): icon nằm trong ô 40px nền `--c-accent-weak`, kèm tiêu đề, một dòng mô tả, ⓘ cho phần giải thích thêm và hành động bên phải. Một vạch ngăn đầu mục với nội dung.
- **Nhóm** (`SetGroup`): mỗi nhóm là một thẻ. Đầu thẻ có ô icon 32px, tiêu đề, mô tả một dòng, ⓘ và `aside`; các hàng nằm trong thân thẻ. Ở nhóm gập, nút đặt trong `h3` và phủ cả đầu thẻ qua `::after`. Tóm tắt và chevron nằm bên phải. Khi focus bằng bàn phím có viền quanh đầu thẻ; nền hover chỉ bật với `@media (hover: hover)`.
- **Hàng** (`SetRow`): mô tả dài chuyển vào `InfoTip`. Nội dung tooltip giữ id `descId(htmlFor)` nên `aria-describedby` của ô vẫn đúng. `InfoTip` có thêm prop `id` (tuỳ chọn). Cột điều khiển rộng tối đa 320px. Ô số hẹp 112px, khoảng cho phép (min–max) hiện ngay cạnh ô.
- **Ô điều khiển**, chỉ áp trong `.admin-page` và `.settings-dialog`: input và select cao 34px, select tự vẽ chevron SVG, có viền và vòng focus màu nhấn. Ô chọn font `base-select` được căn giữa chữ và ẩn mũi tên gốc. Công tắc `.set-switch` vẫn là `input type=checkbox role=switch`.
- **Pipeline**: 5 bước là 5 thẻ, có số bước 1–5 ở góc ô icon và một vạch dọc nối các bước. Mô tả nhóm còn một dòng, phần còn lại nằm trong ⓘ.
- **Font**: tiêu đề panel đổi thành "Font". Thẻ "Thêm font" chỉ còn một hàng: "Chọn font trong máy", "Tải file .ttf/.otf…" (input file native bị ẩn, vẫn giữ `aria-label="Chọn file font"`) và công tắc "Cho mọi người dùng" kèm ⓘ. Trong lúc tải hiện chữ "Đang thêm font…". Lưới font có sẵn gọn hơn (chữ xem trước 17px, 2 cột trên điện thoại).
- **Nhà cung cấp / Người dùng**: dùng đầu mục mới. Bảng người dùng nằm trong thẻ, sát mép, và tiêu đề cột không xuống dòng.
- **Modal Cài đặt dịch**: "Hướng dẫn cho AI" giờ là một thẻ giống các nhóm khác; không còn nền highlight lạ và mô tả lặp đã chuyển vào ⓘ. Icon, select và input dùng chung style với trang Cài đặt.
- Tên nút ⓘ cố ý không chứa nhãn bên cạnh ("Giải thích", "Giải thích nhóm", "Giải thích mục"). Lý do: `getByLabel` khớp cả `aria-label`, nên nếu tên nút chứa nhãn thì sẽ trùng với ô (ví dụ "Model AI", "Nới vùng xoá (px)"). Không phải sửa spec nào.

## File sửa
- `apps/web/src/styles/tokens.css`: `.page` canh giữa.
- `apps/web/src/app/info-tip.tsx`: thêm prop `id`.
- `apps/web/src/features/admin/settings-ui.tsx`, `admin-layout.tsx`, `admin.css`, `providers-section.tsx`, `users-section.tsx`
- `apps/web/src/features/pipeline/pipeline-settings.tsx`
- `apps/web/src/features/fonts/font-settings.tsx`
- `apps/web/src/features/series/series-settings-form.tsx`
- `apps/web/src/features/home/home.css`: phần CSS của modal.

## Kết quả kiểm
- `pnpm --filter @mtl/web typecheck`: đạt.
- `pnpm exec biome check apps/web`: sạch, không còn lỗi hay cảnh báo.
- `pnpm --filter @mtl/web test`: 61 file, 582 test đều đạt.
- e2e `admin-settings fonts routes series-manage series-auto-memory pipeline-settings --workers=1`: 22/22 đạt.

## Ảnh sau khi sửa
Thư mục `/private/tmp/claude-501/-Users-jhin1m-Desktop-ducanh-project-manga-web-translate/bcb7ec1f-df5e-417b-8a38-cebfa9706db3/scratchpad/`:
- after-fonts-1440.png, after-fonts-1920.png, after-fonts-390.png
- after-pipeline-1440.png, after-pipeline-390.png
- after-providers-1440.png, after-providers-390.png, after-providers-form-1440.png
- after-users-1440.png, after-users-390.png
- after-series-closed-1440.png, after-series-open-1440.png, after-series-closed-390.png, after-series-open-390.png

## Còn lại
- `docs/design-guidelines.md` (mục Cài đặt) vẫn ghi "panel tối đa 820px" và chưa mô tả thẻ nhóm, ô icon hay số bước. Tôi không sửa vì nằm ngoài `apps/web`. Panel hiện rộng khoảng 790px ở 1440, nên vẫn khớp con số đó.
- Nút trong form thêm nhà cung cấp vẫn cao như cũ (khoảng 30px), chưa đổi.
