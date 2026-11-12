# Docs update (credit banner trim)

Changed: `docs/editor.md` (cắt mép ảnh, học dải, tự cắt, giới hạn), `docs/job-queue-worker.md` (ingest cắt `trim` trước khi ghép, `src_y` theo ảnh đã cắt, 0.12.0 / MIN 0.12.0 / 426), `docs/export-and-batch-edit.md` (slice xuất đã cắt), `docs/project-roadmap.md` (bỏ giới hạn banner ở mép, giữ giữa ảnh + AI), `README.md` (Lọc rác), `docs/deployment-guide.md` (checklist 0.12.0: migration 0027/0028 + down, rollback, `band_px`, deploy cùng lúc, quy trình phát hành).

Skipped: `docs/releases/` (chỉ có v0.3.0, số phiên bản kế chưa chốt; thêm entry khi cắt rc). `system-architecture.md` / `codebase-summary.md` không tồn tại; không doc nào khác liệt kê cột `source_files` / `series_skip_images`.
All identifiers verified against code (constants 64/8/100, error codes, labels, down files).
