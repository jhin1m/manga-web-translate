---
phase: 2
title: "Chuyển chuỗi features/chapter"
status: completed
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 2: Chuyển chuỗi features/chapter

## Goal

Toàn bộ chữ hiển thị trong `apps/web/src/features/chapter` (~614 dòng / 39 file, lớn nhất dự án) đi qua `t()`, có bản
`en`; xoá `features/chapter` khỏi `ALLOWLIST` của guard.

## Key Insights

- `stage-labels.ts`, `job-error.ts` (`ERROR_CLASS`, `jobErrorLabel`, `describeJobError`, `failedCauseTitle`) là hàm
  thuần được unit test assert tiếng Việt → đổi sang `t()` (không hook), test giữ nguyên vì locale mặc định vi.
- Hiển thị proofread `reason` (`proofread-panel.tsx:298`) là dữ liệu AI, không qua `t()` (phase 6 lo ngôn ngữ).
- Toast/Notice cục bộ trong `chapter-workspace.tsx:136`.

## Tasks & Steps

- [x] Quét lại danh sách file bằng guard (chỉ bật cho `features/chapter`), chuyển theo nhóm: workspace/topbar → rail +
      panels (proofread, trim, text export, activity) → dialogs → labels/helpers thuần.
- [x] Giữ nguyên câu tiếng Việt khi chuyển vào `vi.json` (e2e dựa vào đúng chữ); viết `en` cùng lúc.
- [x] Chuỗi ghép số lượng dùng `tp()`; chuỗi có thẻ JSX dùng `tNode()`; ngày/số qua `fmtNumber`/`fmtDate`.
- [x] Component dùng `useT()`; hàm thuần/module-level dùng `t()` gọi lúc render (không gán hằng lúc import, nếu không
      đổi locale sẽ không cập nhật).
- [x] Xoá `features/chapter` khỏi `ALLOWLIST`.

## Files to Create / Modify

- Modify: `apps/web/src/features/chapter/**/*.tsx|ts` (39 file), `apps/web/src/i18n/messages/{vi,en}.json`,
  `apps/web/src/i18n/no-hardcoded-vietnamese.test.ts`

## Verification

- `pnpm --filter @mtl/web typecheck && pnpm --filter @mtl/web test`
- E2E liên quan, tuần tự: `chapter-tools`, `chapter-topbar`, `proofread`, `trim-*`, `rail-text-export`, `full-flow`.

## Success Criteria

- Guard xanh cho `features/chapter`; parity xanh; e2e trên xanh không sửa selector.

## Risk Assessment

- Hằng module-level như `const LABELS = { … }` giữ chữ cũ sau khi đổi locale → đổi thành hàm hoặc map key; tín hiệu:
  đổi English trong phiên mà nhãn vẫn Việt.

## Implementation Notes

- 667 key `chapter.<module>.*` (module = tên file camelCase: `chapter.workspace`, `chapter.topbar`, `chapter.stage`,
  `chapter.jobError`, …); bảng theo mã giữ mã nguyên văn ở đoạn cuối key (`chapter.jobError.class.rate_limited`).
- Export mà test/file khác đọc (`STAGE_LABELS`, `CHAPTER_STATUS`, `PAGE_LEVEL`, `ERROR_CLASS`, `KIND_LABEL`,
  `FLAG_LABEL`, `CBZ_QUALITY`, `FORMAT_LABEL`, `SKIP_LABEL`, `PANEL_TITLE`) giữ shape, nhãn thành getter gọi `t()`.
- Còn chữ Việt đến từ thư mục khác: `PAGE_BUSY_SAVE_TEXT` (`features/editor/save.ts`), `timeAgo` (`lib/format.ts`).
- `full-flow.spec.ts` đỏ từ trước thay đổi này: upload đã chuyển sang `/files` cùng origin (bỏ MinIO) nên bộ giữ POST
  khác origin không bắt được gì. Bản tạm giữ cả `/files` + chấp nhận chip "Đang chờ lượt" chạy hết luồng xanh.
