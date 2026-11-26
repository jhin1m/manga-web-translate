# Báo cáo: chuyển chuỗi features/chapter sang i18n (vi + en)

Trạng thái: hoàn thành, có một lưu ý về e2e. Typecheck, unit test (gồm guard và parity) và Biome đều xanh. Trong 27
test e2e liên quan, 26 xanh. `full-flow` đỏ do một lỗi có từ trước thay đổi này (xem mục E2E). Chưa commit gì.

## Phạm vi đã làm

- Đã chuyển 40 file trong `apps/web/src/features/chapter`. Các file không có chữ giao diện thì để nguyên, ví dụ
  `use-chapter-lock.ts`, `use-chapter-data.ts`, `context-menu.tsx`, `thumb-flag.tsx`, `tool-icons.tsx`, các
  `*-model.ts` thuần số.
- `apps/web/src/i18n/messages/{vi,en}.json`: thêm 667 key `chapter.*`.
- `apps/web/src/i18n/no-hardcoded-vietnamese.test.ts`: xoá dòng `features/chapter` khỏi `ALLOWLIST`. Không cần thêm
  allowlist theo dòng, vì trong thư mục không có chuỗi dữ liệu tiếng Việt nào.
- Phase file: đánh dấu xong mọi task, đặt `status: completed`, thêm mục Implementation Notes.
- Không sửa test cũ, không sửa selector e2e.

## Nhóm key (namespace)

| Prefix | Số key | Prefix | Số key |
|---|---|---|---|
| `chapter.workspace` | 71 | `chapter.exportPanel` | 36 |
| `chapter.nextAction` | 47 | `chapter.jobError` | 33 |
| `chapter.topbar` (gồm `band.*`) | 46 | `chapter.status` | 32 |
| `chapter.activityDrawer` | 31 | `chapter.findReplace` | 29 |
| `chapter.pageStatus` | 26 | `chapter.proofreadPanel` | 26 |
| `chapter.primaryAction` | 23 | `chapter.proofreadModel` | 21 |
| `chapter.selectPanel` | 21 | `chapter.stage` | 20 |
| `chapter.bandLearnModel` | 20 | `chapter.exportOptions` | 19 |
| `chapter.pageRail` | 19 | `chapter.sourceRail` | 17 |
| `chapter.textTable` | 14 | `chapter.sourceRailModel` | 13 |

Phần còn lại: `metaPopover`, `trimPanel`, `sourceViewer`, `toolPanels`, `moreMenu`, `canvasControls`, `toolRail`,
`undoStyleText`, `exportWarnings`, `docTabs`, `textUtils`, `api.rejectReason`, `lockBanner`, `langPairFields`,
`toolRailModel.panel`, `sourceTrimOverlay`, `shortcutHelp`, `contextPanel`, `exportMenu`. Có dùng lại `common.*` sẵn có
(`cancel`, `save`, `saved`, `saving`, `retry`, `close`, `loading`, `pages`), không thêm key `common.*` mới.

## Quy ước mới (phase 3–4 làm theo)

- **Tên key**: `chapter.<module>.<name>`, trong đó `<module>` là tên file viết camelCase, bỏ đuôi
  (`chapter-topbar.tsx` → `chapter.topbar`, `FindReplace.tsx` → `chapter.findReplace`). Bảng tra theo mã thì giữ mã
  nguyên văn ở đoạn cuối key: `chapter.jobError.class.rate_limited`, `chapter.stage.pagePrepare.reuse_partial`.
- **Tra theo mã động**: dùng map kiểu `Record<code, MessageKey>`, rồi gọi `t(map[code])` lúc dùng. Không ghép key động.
  Nếu mã có thể là tên thuộc tính sẵn có của object (ví dụ `"constructor"`), kiểm `Object.hasOwn` trước.
- **Export có shape bị test hoặc file khác đọc** (`STAGE_LABELS`, `CHAPTER_STATUS`, `PAGE_LEVEL`, `ERROR_CLASS`,
  `KIND_LABEL`, `FLAG_LABEL`, `CBZ_QUALITY`, `FORMAT_LABEL`, `SKIP_LABEL`, `PANEL_TITLE`): giữ nguyên shape, nhãn đổi
  thành getter `get label() { return t(...) }`. Như vậy chữ đọc theo ngôn ngữ lúc dùng mà test cũ không phải sửa.
- **Hằng chữ không bị test đọc**: đổi thành hàm (`translateDraft()`, `tools()`, `stateLabel(state)`,
  `proofreadDataNotice()`).
- **Câu có số**: dùng `tp`. Câu có hai số (ví dụ "Đã thay {matches} trên {pages}.") thì ghép hai `tp` làm param của
  một `t`. Câu có nút JSX lồng (ví dụ "Chương đang mở ở tab khác {retry}") dùng `tNode`.
- **Ngày giờ**: chỗ trước dùng `toLocaleString("vi-VN")` đổi sang `fmtDate(x, { dateStyle/…})`. Đã đối chiếu bằng
  node: chữ vi ra y hệt cũ. Chỗ đang in số thô thì giữ số thô.
- **Component lớn chỉ cần vẽ lại** (`chapter-workspace.tsx`): gọi `useT()` không lấy biến, rồi dùng `t` / `tp` import
  từ module. Cách này tránh Biome đòi thêm `t` vào deps của `useCallback`. Các callback chỉ gọi `t()` khi chạy, nên
  không giữ chữ cũ. Đã quét: không còn `useMemo` / `useCallback` nào tính sẵn chữ mà thiếu `locale` trong deps.
- **Selector DOM phụ thuộc nhãn**: `closeTrim` tìm nút Cắt mép theo `aria-label = t("chapter.toolRail.trim")` (có
  `CSS.escape`). Đổi key đó thì phải sửa chỗ này theo.
- **Thuật ngữ en đã thống nhất** (phase sau nên dùng y vậy):

  | vi | en |
  |---|---|
  | cắt trang | slice / Re-slice pages |
  | xoá chữ (inpaint) | clean / Clean + OCR |
  | Tẩy chữ (công cụ) | Erase |
  | Quét chữ | Scan text |
  | Cắt mép | Trim |
  | dải | band |
  | Văn bản (panel) | Script |
  | Hiệu đính | Proofread |
  | Chạy lại trang lỗi | Retry failed pages |
  | Dịch lại trang | Retranslate page |
  | Hoạt động | Activity |
  | Xuất | Export |
  | Chỉ xem | Read-only / View only |

## Còn chữ Việt từ thư mục khác (phase 3–4 lo)

- `PAGE_BUSY_SAVE_TEXT` trong `features/editor/save.ts`: topbar dùng ở hai chỗ.
- `timeAgo()` trong `lib/format.ts`: dòng "Lần trước" của drawer Xuất dùng.

Khi chọn English, mấy chỗ này vẫn hiện tiếng Việt cho tới khi editor và lib được chuyển.

## Lệnh kiểm (tuần tự, `nice`)

| Lệnh | Kết quả |
|---|---|
| `nice pnpm --filter @mtl/web typecheck` | xanh |
| `nice pnpm --filter @mtl/web test` | 64 file, 606 test xanh, gồm guard (đã bỏ `features/chapter` khỏi allowlist) và parity |
| `nice pnpm exec biome check apps/web/src/features/chapter apps/web/src/i18n` | 83 file, sạch |
| `nice pnpm exec playwright test chapter-tools chapter-topbar proofread trim-auto-drop trim-learn-band trim-source rail-text-export full-flow --workers=1` | 26/27 xanh, `full-flow` đỏ |

## E2E `full-flow`: đỏ từ trước, không do i18n

Không dùng git stash, nên tôi suy luận nguyên nhân từ mã và lịch sử commit, rồi chạy một bản tạm để kiểm.

1. **Chỗ dừng đầu tiên** là `expect.poll(() => held.length).toBeGreaterThan(0)` (dòng 43), trước mọi assert chữ.
   Spec giữ các POST gửi tới origin khác `WEB_URL`. Commit `664740f` (bỏ MinIO, chỉ lưu đĩa) chuyển upload sang `/files`
   cùng origin, qua proxy Vite. Vì vậy bộ giữ không bắt được request nào và upload xong ngay. Lần cuối spec được sửa là
   `4418dd9` (16/11), trước khi bỏ MinIO.
2. Khi cho bộ giữ bắt cả `/files/`, spec dừng ở `chip == "Đang cắt trang"`: chip hiện "Đang chờ lượt" vì fake worker
   chỉ khởi động sau bước đó. Trạng thái `queue_state = waiting` do API tính (`jobs/queue-state.ts`, commit `e87c652`
   ngày 19/11, sau lần sửa spec cuối). Diff `status.ts` chỉ thay chữ, logic `queueChip` giữ nguyên.
3. Bản tạm áp cả hai chỉnh trên (giữ `/files/`, chấp nhận chip `^(Đang cắt trang|Đang chờ lượt)`) chạy **xanh trọn
   luồng** (11,4 s). Luồng này đi qua mọi nhãn chương đã chuyển: chip "Nháp" / "Chờ duyệt", thumbnail "· Xong", nút
   "Xuất", "Tải chương", "Tải xuống", khoá chương. Spec tạm đã xoá ngay sau khi chạy.

Cần sửa `full-flow.spec.ts` theo hai điểm trên. Đây là việc ngoài phạm vi phase này, vì phase cấm sửa selector e2e.

Playwright tự bật và tắt API :8797 và Vite :5181. Sau mỗi lần chạy, `lsof` không còn process nào nghe ở hai cổng này.
Postgres e2e :5442 để nguyên.

## Cách làm

Chia 5 helper song song theo nhóm file không chồng nhau. Key được thêm qua một script merge có khoá (scratchpad), nên
không ai ghi đè JSON của người khác. Sau đó tôi soát toàn bộ 667 cặp vi/en và sửa 18 bản en cho thống nhất thuật ngữ
(slice, clean, band, Erase, Script). Chữ vi không đổi.

## Câu hỏi chưa giải quyết

- Có sửa `full-flow.spec.ts` (giữ POST `/files/`, chấp nhận chip "Đang chờ lượt") trong một việc riêng không?
- Một số bản en là lựa chọn mới, nên được duyệt lại khi soát ảnh chụp ở phase 7: panel "Văn bản" → "Script" (để không
  trùng công cụ "Text"), "Tẩy chữ" → "Erase".
