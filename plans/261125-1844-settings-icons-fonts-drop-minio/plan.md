# Cài đặt gọn hơn: icon, gộp Font, bỏ Hạn mức, bỏ MinIO

Status: done (chưa commit) · Branch: `feat/settings-icons-fonts-drop-minio` · DB dev backup: `backups-dev/mtl-before-drop-minio-261125.dump`

## Outcome

1. Modal "Cài đặt dịch" của series: nhóm "Hướng dẫn cho AI" (Giọng văn, Kính ngữ, Xưng hô, Glossary) gập lại mặc định,
   bấm tiêu đề để mở; mọi nhóm có icon.
2. Trang `/settings`: icon cho từng mục ở thanh trái và tiêu đề nhóm; bỏ mục "Hạn mức & đăng ký"; thêm mục "Font"
   (nội dung trang `/fonts` cũ), `/fonts` chuyển hướng về `/settings?section=fonts`.
3. Hạn mức (`USER_DAILY_USD`, `GLOBAL_DAILY_USD`, `SIGNUP_ENABLED`) chỉ đọc từ `.env`: bỏ route
   `PUT /api/admin/settings/limits`, bỏ 3 cột trong `system_settings` (dev DB đều null, không mất gì).
4. Bỏ MinIO/S3: chỉ còn driver lưu đĩa (`disk`) ở mọi chế độ; bỏ MinIO khỏi compose dev/prod, CI, `infra:up`, script
   backup/restore, docs. File trong MinIO dev (1 series, 1 chương) chép sang thư mục đĩa trước khi tắt container.

## Quyết định (tự chốt, user giao quyết định nhỏ)

- `/settings` mở cho mọi người dùng đăng nhập: người thường chỉ thấy mục Font; mục AI/Hệ thống chỉ admin. Lý do: font là
  của từng người, gộp vào trang admin-only sẽ làm người thường mất chỗ quản lý font.
- Gỡ hẳn driver S3 (không chỉ đổi mặc định): VPS chưa deploy thật, hosting nhiều người đang hoãn; giữ code S3 mà CI
  không còn MinIO để test thì thành code chết.
- Nhóm "Hướng dẫn cho AI" không nhớ trạng thái mở/gập giữa các lần mở modal (mặc định gập) — đơn giản, đúng yêu cầu.

## Phases

| Phase | Chủ | File sở hữu |
|---|---|---|
| A. Web UI (1, 2, phần web của 3) | agent web | `apps/web/**` |
| B. API + infra + docs (3, 4) | agent backend | `apps/api/**`, `packages/**`, `infra/**`, `worker/**`, `docs/**`, `.github/**`, `package.json`, `.env.example`, `README.md`, `docker-compose.yml` |

## Acceptance

- Web: typecheck + lint + unit test web xanh; e2e liên quan (settings, fonts, series settings) cập nhật.
- API: typecheck + test API xanh không cần MinIO; `pnpm infra:up` chỉ còn Postgres; API dev chạy với driver đĩa và
  ảnh chương cũ vẫn mở được.
- `grep -ri minio` ngoài `plans/` và journal cũ không còn kết quả.
