---
title: "Phase 3: Interface polish"
status: done
---

# Phase 3: Interface polish

## Overview

Dọn các chỗ khó hiểu: modal cài đặt series, nút áp kiểu, ngôn ngữ trong editor, nút Gốc, ô chọn font, drawer Hoạt động và lỗi thiếu cấu hình.

## Requirements

- Lưu series thành công thì đóng modal, không còn câu "Đã lưu…"; lỗi thì giữ modal và hiện lỗi.
- Nút áp kiểu: "Áp dụng cho mọi khối {kind}", đang chạy: "Đang áp dụng…".
- Chip cặp ngôn ngữ cạnh tên chương, mở popover đang có.
- Nút Gốc chỉ hiện khi trang đang mở có bản dịch. Phím `O`, `\` và Chia đôi giữ nguyên.
- Ô chọn font vẫn là dropdown: nhãn dễ đọc, font khuyên dùng lên đầu, ô rỗng ghi tên font mặc định thật.
- Hoạt động: ẩn mục trống, một dòng tóm tắt chương, job gấp vào "Chi tiết", nhãn job dễ hiểu.
- Lỗi thiếu model nói đúng nguyên nhân, có nút mở Model tác vụ; không gộp vào "AI từ chối khoá API".

## Related Code Files

- Modify: `apps/web/src/features/series/series-settings-form.tsx`
- Modify: `apps/web/src/features/chapter/select-panel.tsx`, `chapter-topbar.tsx`, `chapter-meta-popover.tsx`, `more-menu.tsx`
- Modify: `apps/web/src/features/chapter/activity-drawer.tsx`, `job-error.ts`, `job-error.test.ts`
- Modify: `packages/shared/src/job.ts`
- Modify: `worker/mtl_worker/main.py`, `worker/mtl_worker/handlers.py`, `worker/tests/test_provider_config.py`
- Modify: `docs/editor.md` nếu mô tả nút Gốc hoặc popover

## Implementation Steps

1. `series-settings-form.tsx`: `onSuccess` gọi `onClose`, bỏ state `saved` và phần render; giữ invalidate query. Kiểm "Tải font" và "Ảnh tự bỏ" tự lưu không đóng modal.
2. `select-panel.tsx`: đổi nhãn nút, trạng thái và `title`.
3. `chapter-topbar.tsx`: thêm chip dùng `pairLabel`; popover nhận trạng thái mở từ ngoài, hoặc tách nút mở dùng chung, giữ một form. Đổi ngôn ngữ vẫn áp cho series như hiện tại.
4. `more-menu.tsx`: `OriginalToggle` nhận điều kiện từ `chapter-topbar`. Trang "có bản dịch" = page state đang mở có ít nhất một `region.translation` khác rỗng. Dùng selector sẵn có của editor nếu có, tránh thêm state mới.
5. Font: hàm tạo nhãn từ id trong `features/fonts/` (`MTOComic-Regular` → `MTO Comic`), danh sách khuyên dùng: KomikaText, WildWords, MTOComic, AnimeAce, BeVietnamPro, chỉ lấy font hợp ngôn ngữ đích; option rỗng hiện tên font mặc định. Giá trị lưu vẫn là id.
6. Lỗi thiếu cấu hình: thêm hằng `LLM_NOT_CONFIGURED` ở `job.ts` như `QUOTA_EXCEEDED`; worker dùng chuỗi trùng khớp, có comment và test giữ đồng bộ, giữ `error_class = "auth"`. `failedPageGroups` và `describeJobError` nhận diện tiền tố, gom nhóm riêng, nhãn "Chưa chọn model AI cho tác vụ", nút mở `/settings?section=tasks`. Nêu tên tác vụ nếu job có sẵn `type`, không thì dùng câu chung.
7. Hoạt động: ẩn mục Upload khi trống; thay khối "Trang" bằng một dòng dạng `35 trang · 35 lỗi`; job chương vào `<details>` "Chi tiết"; `JOB_LABEL` dùng từ người dùng ("Dịch", "Xoá chữ và đọc chữ"). Giữ nút Chạy lại trang lỗi và lỗi kỹ thuật dạng gấp.
8. Cập nhật test web bị ảnh hưởng, chạy kiểm tra thực tế trên trình duyệt: lưu modal, chip, nút Gốc trước và sau dịch, drawer khi lỗi.

## Todo

- [x] Modal series
- [x] Nhãn nút áp kiểu
- [x] Chip ngôn ngữ
- [x] Nút Gốc có điều kiện
- [x] Ô chọn font
- [x] Lỗi thiếu cấu hình
- [x] Drawer Hoạt động

## Success Criteria

- [x] Lưu series thành công đóng modal, lỗi thì không
- [x] Chip hiện đúng cặp ngôn ngữ và mở được popover
- [x] Trang chưa dịch không có nút Gốc; trang đã dịch có
- [x] Series mới: ô font rỗng ghi KomikaText, danh sách có tên dễ đọc
- [x] Chưa gán model mà dịch: Hoạt động báo thiếu model, bấm được tới Model tác vụ
- [x] Key sai thật vẫn báo lỗi khoá API

## Risk Assessment

- Chuỗi lỗi lặp giữa Python và TypeScript: khoá bằng test ở cả hai phía.
- Tách chip khỏi popover dễ làm vỡ logic bấm ra ngoài: test đóng/mở.
- Nút Gốc đổi theo trang có thể nhảy layout thanh trên: giữ chỗ hoặc xếp cuối cụm.
