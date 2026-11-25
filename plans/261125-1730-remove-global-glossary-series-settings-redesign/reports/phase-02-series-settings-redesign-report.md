# Phase 2: Thiết kế lại Cài đặt series, tự lưu (báo cáo)

Trạng thái: xong. Ảnh modal mới: [series-settings-modal.png](series-settings-modal.png).

## File đã đổi

Web, `apps/web/src/features/series/`:
- `series-settings-form.tsx` (viết lại, 685 → 320 dòng): 4 nhóm luôn hiện (`SetGroup`), footer gồm "Xoá series" và
  `SaveStatus`, không còn nút Lưu và nhóm thu gọn.
- Tách mới:
  - `use-settings-autosave.ts`: hook tự lưu (nháp, mốc, debounce, nối lượt lưu, flush khi đóng).
  - `settings-draft.ts` + `settings-draft.test.ts`: phần thuần gồm nháp, kiểm hợp lệ, nhận bản server.
  - `pronoun-rules-table.tsx`, `series-font-fields.tsx`, `settings-row.tsx` (hàng nhãn + ⓘ dùng lớp `.set-row`).
- `settings-diff.ts` (+ test): thêm tham số `only` cho `buildPatch` và hàm `sameField`.
- Xoá `settings-summary.ts` + test. Tóm tắt nhóm thu gọn không còn dùng; `firstMissingRuleField` chuyển sang
  `settings-draft.ts`, test cũng chuyển theo.
- `lang-labels.ts` + test: cảnh báo đổi ngôn ngữ chỉ còn nhắc glossary của series.
- `skip-images-section.tsx`: bỏ dòng "không cần bấm Lưu". ⓘ chuyển lên hàng chứa nó.

CSS `features/home/home.css`: thay khối `.settings-fold`/`.settings-grid`/`.field-head` bằng luật hàng trong modal. Xoá
`.settings-group` (đã không còn dùng từ trước). Lưới Ảnh tự bỏ bỏ margin trên.

`features/chapter/chapter-meta-popover.tsx`: chỉ sửa comment.

E2E:
- `series-manage.spec.ts`: viết lại 3 test cài đặt theo tự lưu, bỏ dòng chờ "Glossary chung".
- `series-auto-memory.spec.ts`: test 2 nay kiểm đúng ca khó. Người dùng đang sửa hàng xưng hô thì AI ghi; Giọng văn hiện
  bản AI, hàng đang sửa giữ nguyên, rời hàng thì lưu mà cặp AI vẫn còn.
- `fonts.spec.ts`: bỏ bấm Lưu.

Docs:
- `design-guidelines.md`: đoạn Cài đặt dịch, thêm dòng cập nhật 25/11.
- `export-and-batch-edit.md`: ý "không đè mục AI".
- `editor.md`: font tải lên tự lưu.

## Lệnh kiểm (tuần tự, `nice`) và kết quả thật

| Lệnh | Kết quả |
|---|---|
| `pnpm -C apps/web exec vitest run --maxWorkers=1 src/features/series` | 5 file, 30 test qua |
| `pnpm -C apps/web test -- --maxWorkers=1` | 62 file, 585 test qua |
| `pnpm lint` | sạch, 510 file |
| `pnpm typecheck` | qua (db, api, web) |
| `pnpm --filter @mtl/web e2e series-manage.spec.ts` | 10/10 qua |
| `… e2e series-auto-memory.spec.ts fonts.spec.ts routes.spec.ts` | 5/5 qua |
| `… e2e trim-learn-band.spec.ts upload-chapter.spec.ts` | 7/7 qua |
| `grep -rni "glossary chung" apps docs` (bỏ `dist`, `test-results`) | còn ghi chú migration trong `deployment-guide.md`, `export-and-batch-edit.md` và `development-setup.md` (path `/glossary` đã bỏ), cùng release note `v0.6.0.md` |

Ảnh chụp tạo bằng một spec Playwright tạm (đã xoá sau khi chụp). Cổng 5181/8797 đã trống sau khi chạy.

## Quyết định nhỏ tự chọn

- **Nháp/mốc theo từng trường.** Bản server mới chỉ thay trường nào nháp bằng mốc, không có con trỏ (`data-field`),
  không chờ gõ, không đang lưu. Lưu xong thì mốc lấy đúng giá trị đã gửi. Nhờ vậy `pronoun_keys_seen` luôn là các cặp
  form đã thấy và server giữ cặp AI thêm sau.
- **Nối lượt lưu.** Các lượt lưu chạy nối tiếp (`scope`). Lượt trùng giá trị đang lưu thì bỏ. Sửa tiếp trong lúc lưu
  thì lưu tiếp ngay sau. Lỗi chỉ tắt khi trường lỗi đã lưu lại được.
- **Debounce 800 ms** cho Tên, Giọng văn và Chữ bỏ qua; rời ô thì lưu ngay. Khi đóng modal (Esc, Đóng, scrim hoặc bấm
  "Mở" glossary) thì lưu nốt các trường hợp lệ. Hàng xưng hô chưa đủ ô lúc đóng thì không lưu.
- **Xưng hô.** Lưu khi rời một hàng; ở lại cùng hàng thì không. Bấm "+ Thêm quy tắc" thì xoá báo lỗi cũ để hàng trống
  mới không đỏ ngay.
- **Gộp ô ngôn ngữ.** "Dịch từ" và "Sang" gộp thành một hàng "Ngôn ngữ" (`aria-label` giữ tên cũ), tên ngôn ngữ bỏ mã
  "(ko)". Cảnh báo đổi ngôn ngữ so với cặp lúc mở modal, vì cặp mới lưu ngay.
- **Font chữ hiện đủ 4 ô.** Bỏ mục thu gọn "Font khác" vì 4 hàng không dài và không giấu tính năng.
- **Chữ ngắn hơn.**
  - Kính ngữ: "Chuyển sang cách gọi đích" / "Giữ nguyên (phiên âm)", ví dụ kính ngữ chuyển vào ⓘ.
  - ⓘ Định dạng: "Áp dụng cho chương upload sau."
  - "Áp lại chữ bỏ qua" bị khoá kèm lý do "Chờ lưu danh sách mới." khi ô khác bản đã lưu.
- **CSS và lời gọi API.**
  - Modal import `features/admin/admin.css` để dùng `SetGroup`/`SaveStatus` (như `routes/fonts.tsx`). `SetRow` không
    dùng vì cần ⓘ cạnh nhãn; thay bằng `settings-row.tsx` cùng lớp CSS.
  - Bỏ invalidate `["glossary"]` khi đổi cặp trong modal, vì glossary series không còn theo cặp.

## Chỗ còn lo

1. Hook tự lưu chỉ có test thuần (`settings-draft`, `settings-diff`). Web không có thư viện test DOM, nên hành vi theo
   thời gian (debounce, nối lượt, flush khi đóng) chỉ được kiểm qua e2e. E2e chưa có ca "lưu lỗi rồi thử lại".
2. Gõ Tên series sẽ PATCH sau 800 ms nghỉ, nên tiêu đề trang phía sau đổi theo trong lúc gõ. Gõ Giọng văn dài có thể tạo
   vài lượt lưu, mỗi lượt tăng `settings_rev`. Tác động tới job giống một lần lưu, chỉ thêm request.
3. `ak plan phase close` vẫn báo "planstore: plan not found" (giống phase 1). Phase 2 được đánh dấu bằng front-matter
   `status: done` + `ak plan reindex` (`ak plan status` báo 2/2), ô bảng trong `plan.md` sửa tay. Front-matter của
   `plan.md` vẫn để `in-progress` cho người điều phối chốt.
