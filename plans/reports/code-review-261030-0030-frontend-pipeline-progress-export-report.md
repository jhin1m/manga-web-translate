# Code review — frontend pipeline progress / export UX

- Branch: `feat/pipeline-progress-export-ux` · scope: `git diff main...HEAD -- apps/web` (45 files, +1783/−416)
- Plan: `plans/261029-2206-pipeline-progress-export-ux/` (phase 01, 02, 04, 05)
- Checks: `vitest run src/features/chapter src/features/editor` → 26 files / 195 tests pass; `tsc --noEmit` sạch.
- Xác minh: 2 file test tạm (session deferral, page-selection) đã chạy rồi xoá; `git status --porcelain` rỗng sau khi xoá.
- Không báo (đã chốt): không nhớ "Chỉ xoá chữ" theo series; huỷ 1 job dừng cả lượt.

## Đã kiểm, không thấy lỗi

- Tự tải trong panel: `downloadedRef` theo id job, effect chỉ chạy khi `readyId` đổi → không tải 2 lần khi re-render /
  poll; StrictMode mount có `readyId = null` nên không tải. Đổi chương: `ChapterWorkspace` mount theo
  `key={chapterId}` (router.tsx:91) → selection, `exportsDone`, `pending` đều reset.
- Toast "Đã xuất xong": `exportsDone` cập nhật ở mọi lần danh sách đổi, kể cả khi drawer mở → không lặp.
  `notify` ổn định.
- Bấm 2 lần: nút chính bị khoá theo `action.isPending`, nút "Dịch N trang" theo `translating`, nút xuất theo
  `start.isPending || running`.
- Kiểu dữ liệu khớp API: `JobView.progress_done/total` (jobs.ts:16-17), `ProgressPage.translate_queued/run_batch`,
  `chapter.run` (progress.ts:83-99), `translate`/`translate-prepared` trả `job: JobView | null`.
- Mã bước trong `STAGE_LABELS` khớp worker (ingest.py download/cut/upload; handlers.py detect/inpaint/ocr/upload/
  reuse_partial/translate/typeset/proofread; export.py download/render/upload).
- Lỗi 402 quota / 409 `translate_running` / `page_not_prepared`: rơi vào `action.onError`, lựa chọn trang được giữ
  (chỉ xoá khi thành công).
- Saver không PUT khi `readOnly` (save.ts:164) → không có PUT thừa lúc trang bận; đóng tab: `pagehide` gọi persist +
  `beforeunload` chặn khi chưa lưu.

## Findings

### 1. [High] Mở lại drawer Xuất khi lượt xuất còn chạy → xong không tự tải, cũng không có toast — CONFIRMED (đọc code)

- `apps/web/src/features/chapter/export-panel.tsx:93` (`pending` là state cục bộ của panel), `:139-143` (tự tải chỉ
  theo `pending`); `apps/web/src/features/chapter/chapter-workspace.tsx:839` (`if (!seen || drawerRef.current === "export") return;`).
- Kịch bản: mở drawer → "Tải chương" → đóng drawer (panel unmount, mất `pending`) → mở lại drawer trước khi job xong.
  Panel mới có `pending = null` → `exportPhase` = idle, nút hiện "⬇ Tải chương" như chưa có gì đang chạy. Job xong:
  panel không tải vì không theo dõi id đó; workspace bỏ qua toast vì drawer đang mở. File chỉ nằm trong mục "Lượt xuất
  trước" đang thu gọn. Người dùng có thể bấm lại, và nếu đã đổi tuỳ chọn thì tạo thêm một job khác.
- Đề xuất: đưa `pending` (id lượt xuất do người dùng gửi) lên `Workspace` (hoặc lưu theo chapterId trong queryClient
  hoặc store) và truyền vào panel. Toast chỉ bỏ qua khi panel đang thực sự theo dõi id đó, không dựa vào việc drawer
  đang mở. Cách khác: khi mount, panel nhận lượt `queued|running` mới nhất trong danh sách làm `pending`.

### 2. [Medium] Bản sửa của trang bận đã cất (deferred) không tự lưu khi trang hết bận nếu không mở lại trang đó — CONFIRMED (test tạm)

- `apps/web/src/features/editor/use-chapter-session.ts:113-121` (cất `deferred` khi rời trang `page_busy`),
  `:188-197` (`applyBusy` chỉ flush trang đang mở), `:315-320` (`applyDeferred` chỉ chạy khi activate).
- Kịch bản: sửa trang A → A vào lượt dịch (`page_busy`) → chuyển sang B → A dịch xong. Test tạm (A sửa, setBusy{A},
  activate B, setBusy{}): **không có `put:A`**, server A vẫn ở bản AI, IndexedDB vẫn giữ op của A. Bảng văn bản và
  thumbnail của A hiện bản AI, không có phần người dùng đã sửa, nên trông như bản sửa bị mất. Rời chương mà không mở
  lại A thì lần mở sau hiện thông báo khôi phục. Điều này trái với mô tả "tự lưu khi trang hết bận" (save.ts:7-8, plan
  phase-04).
- Đề xuất: trong `setBusy`, với mỗi `deferred` có `pageId` vừa ra khỏi tập bận và không phải trang đang mở →
  `void this.restoreOther(rec)` (đã xử lý rebase, xung đột thì giữ deferred, gặp `page_busy` thì giữ). Thêm test:
  "deferred page saves when it leaves busy while another page is active".

### 3. [Medium] Trạng thái `page_busy` do Saver đặt (409 từ server) có thể kẹt vì chỉ được gỡ khi `busyKey` đổi — PLAUSIBLE

- `apps/web/src/features/editor/save.ts:181-185` (409 `page_busy` → `setReadOnly("page_busy")`),
  `apps/web/src/features/chapter/chapter-workspace.tsx:144-148` (`busyPageIds` memo theo chuỗi id),
  `apps/web/src/features/editor/use-chapter-session.ts:460` (effect chỉ chạy khi identity của set đổi).
  `use-chapter-data.ts:57-58`: progress dừng poll khi chương ổn định.
- Kịch bản: client đang thấy chương ổn định (không poll progress, `busyKey = ""`) trong khi server đã đánh dấu trang P
  bận (lượt dịch mở từ tab khác hoặc từ trang Series, hay lô của P chạy xong giữa 2 lần poll). Lưu P → 409 `page_busy`
  → editor read-only "Chờ lưu". Không có gì gọi `refetchProgress`, và `busyKey` vẫn rỗng nên effect không chạy lại
  → `applyBusy` không gỡ khoá. Editor kẹt ở chỉ xem, bản sửa chưa lưu, cho tới khi focus lại tab hoặc có thao tác
  invalidate.
- Đề xuất: khi Saver gặp `page_busy`, gọi callback `onPageBusy` để `useChapterSession` chạy `refetchProgress()`
  (progress sẽ chuyển sang `processing` và poll tiếp). Hoặc cho `applyBusy` kiểm lại ở mỗi lần progress đổi, không chỉ
  khi `busyKey` đổi.

### 4. [Medium] Bấm "Tải chương" sau khi đã xong tạo job xuất mới (render lại cả chương) và tự tải thêm lần nữa — CONFIRMED (đọc code)

- `apps/web/src/features/chapter/export-panel.tsx:233-251` (ở pha `ready` nút vẫn bật và gọi `start.mutate()`);
  `apps/api/src/jobs/enqueue.ts:102,108` (idempotency chỉ trong `activeStatus` → job `succeeded` không được dùng lại).
- Kịch bản: tự tải bị trình duyệt chặn, hoặc người dùng muốn tải lại → bấm nút chính (nhãn "Tải chương") thay vì link
  nhỏ "Tải xuống" → `created: true`, worker render lại toàn bộ trang rồi tải về file thứ 2. Tốn worker, người dùng
  phải chờ lại, và có thêm một lượt trùng trong lịch sử.
- Đề xuất: ở `phase.kind === "ready"` (tuỳ chọn chưa đổi) cho nút chính gọi `triggerDownload(phase.url)`. Chỉ tạo job
  mới khi tuỳ chọn khác lượt đã xong (so `exportLabel`/payload), hoặc khi link đã hết hạn.

### 5. [Medium] Lựa chọn trang "sống lại" sau khi trang hết bận — CONFIRMED (test tạm)

- `apps/web/src/features/chapter/page-selection.ts:47-50` (`selectionIds` chỉ lọc khi hiển thị, `pageSel.ids` vẫn
  giữ id); `chapter-workspace.tsx:386-388`.
- Kịch bản: chọn trang 1–3 → bấm "Dịch lại cả chương" (menu) hoặc chọn thường một trang khác qua nút dịch của panel.
  Các trang bận nên tạm rơi khỏi lựa chọn (thanh "Dịch N trang" ẩn). Lượt dịch xong → test tạm cho ra
  `['a','b','c']`: thanh "Dịch 3 trang" hiện lại sau vài phút, dù người dùng đã quên lựa chọn đó → dễ bấm nhầm, dịch
  lại (tốn quota). Comment ở page-selection.ts:3-4 nói trang bận "tự rơi khỏi" lựa chọn, nhưng code chỉ ẩn tạm.
- Đề xuất: khi `pages` đổi, cắt hẳn những id không còn chọn được khỏi `pageSel`, ví dụ
  `useEffect(() => setPageSel(s => prune(s, pages)), [pages])` với hàm `prune` trả về đúng `s` nếu không có gì đổi
  (tránh vòng render). Cách khác: xoá lựa chọn khi bất kỳ lượt dịch nào bắt đầu.

### 6. [Medium] Trang lỗi ở bước xoá chữ đã quá 24h vẫn chọn được → server từ chối cả lượt (409 `page_not_prepared`) — CONFIRMED (test tạm + đọc code)

- `apps/web/src/features/chapter/page-selection.ts:16-17` (loại trang lỗi prepare dựa vào `p.job?.type === "page.prepare"`);
  `apps/api/src/routes/progress.ts:13,25` (progress chỉ trả job đang chạy hoặc job cập nhật trong 24h);
  `apps/api/src/jobs/translate-chain.ts:259-260`.
- Kịch bản: trang lỗi OCR từ hôm qua → `job: null` → test tạm: `selectionIds` = `['a']`. Chọn trang đó cùng các
  trang khác → "Dịch N trang" → 409, cả lượt bị từ chối. Thông báo "Có trang chưa xoá chữ + OCR xong…" không nói trang
  nào. Nút "Dịch lại trang này" ở panel Chọn cũng hiện cho trang này (select-panel.tsx:89-92 chỉ ẩn khi bận).
- Đề xuất: API trả cờ rõ ràng, ví dụ `ocr_ready: boolean` (= `!!ocrResult && !!prepareInputRev`) trong
  `ProgressPage`, và `selectablePage` / `RetranslatePage` dựa vào cờ đó thay vì job gần nhất.

### 7. [Low] Trang lỗi đang chờ lượt dịch lại vẫn hiện "Lỗi", panel không có nút và không giải thích — PLAUSIBLE

- `apps/web/src/features/chapter/page-status.ts:77` (`failed` được ưu tiên trước `translate_queued` ở :80);
  `apps/api/src/jobs/queue.ts:183-191` (page chỉ đổi sang `translating` khi worker nhận lô).
- Kịch bản: "Chạy lại trang lỗi" hoặc chọn trang lỗi rồi "Dịch N trang" → các trang ở lô sau có
  `translate_queued=true, status=failed` → thumbnail ghi "Lỗi" (kèm câu lỗi cũ trong title) chứ không phải
  "Chờ lượt · lô k". Panel Chọn ghi mức "Lỗi" nhưng ẩn nút dịch (vì `isPageBusy`), editor thì chỉ xem. Ba chỗ nói ba
  trạng thái khác nhau.
- Đề xuất: trong `thumbMark` và `pageLevelOf`, xét `translate_queued` trước `failed`: một trang lỗi đã vào lượt thì là
  "Chờ lượt" hoặc "busy".

### 8. [Low] Một lần poll danh sách xuất bị lỗi làm dừng hẳn việc theo dõi → không tự tải, không toast — PLAUSIBLE

- `apps/web/src/features/chapter/export-panel.tsx:56-59` (`refetchInterval` trả `false` khi `status === "error"`),
  `:150-155`.
- Kịch bản: mạng chập chờn lúc đang xuất (retry 1 lần vẫn lỗi) → poll dừng, panel báo "Không theo dõi được tiến độ" và
  mở lại nút. Job vẫn xong ở server, nhưng panel (nếu còn mở) không tải, workspace không toast. Chỉ phục hồi khi người
  dùng bấm lại, hoặc khi focus tab (`refetchOnWindowFocus`).
- Đề xuất: khi lỗi mà vẫn đang có lượt chạy (`pending` chưa xong) thì tiếp tục poll với backoff, ví dụ
  `q.state.status === "error" ? EXPORT_POLL_MS * 4 : …`, thay vì dừng hẳn.

### 9. [Low / thông tin] Nhánh `paused_budget` của export không bao giờ xảy ra, và nếu xảy ra thì UI không tự cập nhật — PLAUSIBLE

- `apps/web/src/features/chapter/export-options.ts:84-86`; `packages/shared/src/job.ts:30-37` (`chapter.export`
  không thuộc `PAID_JOB_TYPES`, nên kill-switch ngân sách không chuyển nó sang `paused_budget`);
  `export-panel.tsx:48,57` (`isExportActive` không tính `paused_budget` → ngừng poll).
- Hệ quả: dòng "tự xuất tiếp khi có lại, không cần bấm lại" hứa một điều UI không làm được: không poll thì không bao giờ
  thấy job chạy lại, và nút khoá ở "Tạm dừng" cho tới khi đóng drawer. Hiện vô hại vì nhánh này không tới được.
- Đề xuất: hoặc bỏ nhánh này (YAGNI), hoặc thêm `paused_budget` vào điều kiện poll (với chu kỳ dài).

## Edge cases scout đã xét (không thành finding)

- Lô của trang P chạy xong giữa 2 lần poll trong lúc chương `processing`: `busyKey` vẫn đổi qua trạng thái chờ lượt,
  hoặc `syncActive` nạp bản AI qua cache → ổn.
- Đang ở trang bận rồi quay lại trang đó khi nó vẫn bận: `applyBusy` đặt read-only trước `applyDeferred`, bản sửa nằm
  lại trong editor, đổi trang lần nữa thì cất lại → không mất.
- `flushDetached` khi đổi chương lúc đang `page_busy`: bỏ qua PUT (vì `readOnly`), IndexedDB đã giữ → khôi phục lần
  sau.
- Toast cho lượt đã xong từ trước, khi danh sách lấy từ cache cũ rồi mới refetch: có thể báo một lượt xong lúc người
  dùng ở chỗ khác. Hành vi chấp nhận được, không báo lỗi.

## Câu hỏi còn mở

1. Finding 3: tab khác (hoặc trang Series) có mở được lượt dịch khi tab này đang giữ khoá không? Nếu API chặn thì
   kịch bản thu hẹp lại còn race giữa 2 lần poll.
2. Finding 4: có muốn nút chính ở pha `ready` là "Tải lại file này" (không render lại) không, hay giữ "xuất mới" là chủ
   ý?

Status: DONE_WITH_CONCERNS
