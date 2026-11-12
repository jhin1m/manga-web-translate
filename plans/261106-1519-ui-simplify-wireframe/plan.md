# Plan: rút gọn UI theo wireframe

Status: **chưa làm** · Branch dự kiến: `feat/ui-simplify` · Wireframe + bảng 45 mục: https://claude.ai/artifact/KGDsaaFXTa79VEt6vyE7u5

## Quyết định đã chốt (06/11/2026)

| Việc | Chốt |
|---|---|
| Sửa khối | Phương án A: panel đè lên canvas, tự mở khi chọn khối. Không làm thẻ nổi B |
| Icon Sửa ở hàng chương | Bỏ. Thay quyết định 21/10. Icon Sửa ở hàng series giữ (khác đích: mở cài đặt) |
| Nhãn rail | Mặc định chỉ icon + tooltip |
| Màu, font | Giữ token hiện tại trong `docs/design-guidelines.md` |

Giữ đủ tính năng. Không đổi API, DB, worker.

## Phase

Làm theo thứ tự, mỗi phase một commit riêng và gate xanh rồi mới sang phase sau.

| # | Phase | Mục trong bảng | Rủi ro |
|---|---|---|---|
| 1 | [Home, Series, Cài đặt](phase-01-home-series-settings.md) | 15 | Thấp |
| 2 | [Thanh trên màn chương](phase-02-chapter-topbar.md) | 6 | Vừa |
| 3 | [Panel khối và thanh phụ công cụ](phase-03-panel-and-tool-bar.md) | 11 | Cao |
| 4 | [Canvas và cột trang](phase-04-canvas-and-page-rail.md) | 6 | Vừa |
| 5 | [Rail 5 nút, Văn bản, Xuất](phase-05-rail-text-export.md) | 7 | Vừa |

Phase 3 phải xong trước phase 4 vì nút thao tác trang chuyển từ panel sang menu trang. Phase 5 cần rail đã ổn định.

## Gate mỗi phase

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @mtl/web e2e
```

- Sửa selector e2e theo tên mới, không nới lỏng assertion.
- `e2e/click-budget.spec.ts` là giới hạn số bấm: không tăng budget cho luồng chính. Nếu buộc phải tăng, dừng lại và báo user.

## Tiêu chí hoàn thành

- Khung 1280, không chọn gì: canvas rộng 1160px, thanh trên tối đa 8 mục.
- Mỗi thao tác khối và trang chỉ có một chỗ hiển thị (chuột phải mở cùng menu ⋯).
- Không còn chữ "Export" trong UI.
- `docs/design-guidelines.md` và `docs/editor.md` khớp UI mới, cập nhật ở phase cuối cùng đụng tới mục đó.
