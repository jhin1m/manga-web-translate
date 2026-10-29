# Code review — backend: tiến độ pipeline + chuỗi dịch theo lô

- Nhánh: `feat/pipeline-progress-export-ux`, phạm vi `git diff main...HEAD -- apps/api worker packages` (bỏ snapshot)
- Plan: `plans/261029-2206-pipeline-progress-export-ux/` (phase-02..04)
- Kiểm chứng: viết file test tạm `apps/api/test/zz-review-tmp.test.ts` (8 kịch bản) và một probe Python, chạy xong thì xoá. Bộ API đầy đủ 303/303 pass, worker 260/260 pass, `tsc --noEmit` sạch. Working tree đã trở lại như cũ (file chưa track duy nhất còn lại là báo cáo frontend của agent khác).

## Đánh giá chung

Lõi chuỗi dịch chạy đúng trên các đường đã lần theo: advance chạy dưới khoá dòng chapter và idempotent (`activeJobOf`), mọi nhánh khoá theo thứ tự chapter → pages, trang lỗi Bước 1 bị bỏ đúng khỏi lượt, lô lỗi không chặn chuỗi. Đã tái hiện và thấy **chạy đúng**:
- reaper requeue lô dịch, worker cũ complete bằng fence cũ thì nhận 409, claim lại xong thì chuỗi đi tiếp; reaper fail ở max_attempts thì lô kế vẫn được enqueue;
- xoá chương giữa chuỗi: 204, job cascade, worker complete thì nhận 409;
- page.prepare của trang giữa lỗi trong lúc chuỗi đang chờ lô đầy: trang bị bỏ, lô kế là `[1,2,4,5]`;
- strip đang ở lượt `prepared` mà dịch vài trang chọn: chương về `prepared`, `run_target` null.

Migration up/down khớp nhau. Thêm cột (default hằng số) và CHECK an toàn trên dữ liệu có sẵn. Không thấy rò quyền giữa user: mọi entry đều `lockChapter(userId)` hoặc `sdb` scoped.

Lỗ hổng chính: **job `chapter.translate` không gắn với lượt đã tạo ra nó**. Vì vậy một lô còn sống của lượt cũ có thể ghi đè trạng thái của lượt mới.

---

## Findings (nặng trước)

### 1. [High] Lô của lượt cũ còn chạy làm hỏng lượt mới: trang bị bỏ qua không dịch lại, huỷ lô cũ giết luôn lượt mới. CONFIRMED

- `apps/api/src/jobs/translate-chain.ts:239-268`: `startTranslateRun` chỉ chặn khi `run_target='translated'` (`assertNoRun`). Nó không kiểm tra job dịch còn active. `retryFailedPages` (`:297-323`) cũng vậy.
- `apps/api/src/jobs/queue.ts:367` (applyResult) và `:562` (terminal) gán `translateQueued=false` cho mọi `p.page_ids` mà không xét job đó thuộc lượt nào.
- `apps/api/src/jobs/queue.ts:566`: lô bị huỷ thì gọi `stopTranslateChain`, đóng **lượt hiện tại** dù lô thuộc lượt trước.

Kịch bản đã tái hiện:
1. Chương manga, lô 1 = `[p0]` đang chạy.
2. Người dùng huỷ page.prepare của p1. Lượt đóng, theo quyết định đã chốt. Lô 1 vẫn chạy.
3. Người dùng đổi glossary rồi bấm Dịch các trang `[p0,p2,p3]`. Kết quả 202 `{job:null}`, p0 có `translate_queued=true`.
4. Lô 1 cũ (payload mang glossary_rev cũ) complete. p0 bị gán `translate_queued=false`, advance enqueue `[p2,p3]`.
5. Hết lượt mà **không lô nào chứa p0**. p0 giữ bản dịch theo glossary cũ, không có lỗi hay thông báo nào.

Biến thể đã tái hiện: sau bước 3, huỷ lô 1 cũ thì `run_target=null` và 0 job active. Lượt mới (đã trả 202) chết mà không báo.

Đề xuất: cách đơn giản nhất là trong `startTranslateRun` và `retryFailedPages`, nếu `activeJobOf(ch.id,'chapter.translate')` còn job thì trả 409 `translate_running`. Cách thay thế: chỉ xoá cờ / gọi advance / gọi stop khi `job.created_at >= chapters.run_started_at` (dùng lại `inCurrentRun`).

### 2. [Medium] Hết hạn mức hoặc huỷ giữa chuỗi: trang của lô đang xếp hàng (chưa từng chạy) bị đánh `failed` thay vì giữ `prepared`. CONFIRMED

- `apps/api/src/jobs/queue.ts:552-561`: terminal của `chapter.translate` gom các trang có status `translating` **hoặc `prepared`** và có `aiRev=0` vào nhóm `failed`.
- Trước đây job dịch hiếm khi bị huỷ khi còn queued. Với chuỗi thì lúc nào cũng có đúng một lô queued, nên đường này giờ chạy thường xuyên.

Kịch bản (test R8): lô 1 xong, lô 2 `[p1..p4]` đang queued, người dùng vượt hạn mức. `failOverQuotaQueued` chạy lúc claim và kết quả là `ready,failed,failed,failed,failed,prepared,prepared,prepared,prepared`, chương ở `prepared`. Đặc tả nói "hết quota → trang còn lại giữ prepared", nhưng 4 trang chưa hề được gọi AI lại hiện "Lỗi" với error là quota. Bấm "Dịch" (translate-prepared) chỉ dịch p5..p8, p1..p4 phải đi riêng qua "Chạy lại trang lỗi". Huỷ chương giữa chuỗi (R6) cho cùng kết quả.

Đề xuất: trong terminal của `chapter.translate`, trang còn `prepared` (job chưa được claim ở attempt này) thì giữ `prepared` (hoặc `ready` nếu `aiRev>0`), chỉ trang `translating` mới thành `failed`. Hoặc dùng mapping của `pauseForBudget` (`queue.ts:633-645`) cho lỗi quota.

### 3. [Low] Worker `_carry` crash khi notes hoặc tên nhân vật chứa surrogate lẻ, làm hỏng cả lô sau khi đã trả tiền LLM. CONFIRMED (probe)

- `worker/mtl_worker/handlers.py:307-316`: `s.encode("utf-16-le")` ném `UnicodeEncodeError: surrogates not allowed` với chuỗi như `json.loads('"abc\\ud83d"')`.
- `_carry` chạy **sau** khi đã dịch và typeset xong. Exception này thành lỗi `internal`: job retry (gọi LLM lại) tới max_attempts rồi lô `failed`.
- LLM trả JSON có escape surrogate lẻ là hiếm (thường do output bị cắt), nhưng trước thay đổi này chuỗi đó vẫn đi qua được (zod chấp nhận).

Đề xuất: `s.encode("utf-16-le", "surrogatepass")[: 2 * n].decode("utf-16-le", "ignore")`, hoặc bọc `_carry` trong try và trả `carry` rỗng khi lỗi.

### 4. [Low] Chương đang dở lúc deploy mất hành vi tự dịch của manga. PLAUSIBLE (lần code)

- `autoTranslatePages` đã bị xoá. Migration 0020 để `run_target=NULL` cho mọi chương có sẵn.
- Chương manga đang `ingesting` hoặc đang chạy Bước 1 lúc deploy: `createIngestedPages` (`apps/api/src/jobs/enqueue.ts:478-489`) gán `translateQueued = (runTarget==='translated')`, tức false, và advance không làm gì (`translate-chain.ts:189`). Chương dừng ở `prepared` thay vì tự dịch như trước.
- Chỉ xảy ra một lần lúc chuyển đổi, nhưng sẽ khiến user hỏi "sao manga không tự dịch".

Đề xuất: thêm ghi chú vào deployment guide (chờ hàng đợi rỗng trước khi deploy), hoặc backfill `run_target='translated', run_started_at=now()` cho chương `ingest_mode='pages'` đang `ingesting`/`processing` và không có job dịch nào.

### 5. [Low] Claim giờ khoá dòng chapter cho mỗi job: tăng khả năng deadlock và claim phải đợi các tx giữ khoá chương lâu. PLAUSIBLE

- `apps/api/src/jobs/queue.ts:121`: claim giữ khoá dòng job (`FOR UPDATE SKIP LOCKED`) rồi khoá chapter.
- Reaper (`reaper.ts:17-37`) và `failOverQuotaQueued` (gọi trong claim, `queue.ts:61-64`) khoá nhiều chapter liên tiếp theo thứ tự job, không theo thứ tự id. Hai tx khoá hai chương theo thứ tự ngược nhau có thể deadlock. Postgres huỷ một tx: claim trả 500 (worker sẽ thử lại), hoặc reaper tick lỗi rồi chạy lại ở tick sau. Không mất dữ liệu.
- `applyIngest` giữ khoá chapter (`queue.ts:475`) trong lúc HEAD tới 1000 object (`:496`). Phần này có từ trước, nhưng giờ claim job khác của chương đó phải chờ theo. Prod claim với `max=1` (`worker/mtl_worker/main.py:214`) nên rủi ro thấp.

Đề xuất: chuyển `requireObjects` của applyIngest lên trước `FOR UPDATE`. Nếu thấy deadlock trong log, sắp xếp job theo `chapter_id` trước khi terminal trong reaper và failOverQuota.

---

## Đã kiểm, không phải lỗi

- **AI ghi đè sửa tay:** `writeAiState` đọc `state_origin` dưới `FOR UPDATE`. PUT state đổi origin thành `user` có điều kiện version, nên dù có TOCTOU giữa `editablePage` và lúc bắt đầu lượt thì AI chỉ bật `ai_update_available`.
- **Double-enqueue:** chỉ có advance tạo job dịch, và advance kiểm `activeJobOf` sau khi đã giữ khoá chapter (READ COMMITTED đọc snapshot mới sau khi lấy khoá). Test có sẵn với 5 advance đồng thời cho đúng 1 job.
- **Chuỗi kẹt:** điều kiện chờ (`!batch` hoặc lô chưa đầy) luôn kéo theo một trang ở Bước 1 có page.prepare active (queued/running/paused_budget). Mọi đường kết thúc của prepare đều gọi advance, hoặc stop khi bị huỷ.
- **Ẩn trang giữa chuỗi:** PATCH trả 409 vì chương luôn ở `processing` khi lượt còn trang chờ (`refreshChapter` coi `translate_queued` là bận). Ignore-apply chặn khi có job active.
- **Re-ingest:** `enqueueIngest` trả 409 `chapter_busy` khi còn job. Ingest lỗi hoặc huỷ thì `run_target=null`.
- **Budget pause:** lô `paused_budget` vẫn active nên chuỗi chờ, resume thì đi tiếp. Trang về `prepared`/`ready` nhưng vẫn `translate_queued` nên vẫn chỉ xem.
- **Carry:** kích thước có trần ở zod (2000 + 30×64), worker cắt theo UTF-16 khớp zod (trừ case ở #3). `MIN_PIPELINE_VERSION=0.7.0` chặn worker cũ. API `PIPELINE_VERSION` không đổi nên `prepare_input_rev` cũ vẫn hợp lệ.

## Hành động đề xuất

1. Sửa #1: chặn mở lượt khi còn job dịch active (một dòng trong `startTranslateRun` và `retryFailedPages`), kèm test hồi quy theo kịch bản trên.
2. Sửa #2: terminal giữ trang `prepared` chưa được claim. Thêm test quota/huỷ khi đang có lô queued.
3. #3: dùng `surrogatepass` trong `_cut_utf16`.
4. #4: ghi chú vào deployment guide.

## Câu hỏi còn mở

- Ở #1, chặn bằng 409 khi lô cũ còn chạy có được chấp nhận về UX không, hay muốn lượt mới "nhận" lô cũ (gắn job vào lượt theo `run_started_at`)?

Status: DONE
