# Red-team plan: chia lượt claim theo chương

Ngày: 2026-11-11. Chỉ đọc plan và code, không sửa code hay plan. Thực nghiệm chạy trên DB tạm `mtl_redteam_fairshare`
(tạo từ template `mtl_test_api_ecda7392`, Postgres 17.11) và đã xoá. SQL do Drizzle 0.45.4 sinh lấy bằng `.toSQL()`
(`QueryBuilder`, không kết nối DB).

## Kết luận

Thiết kế đúng về Postgres: không trùng job, không trả rỗng oan, kiểm lại dòng (EPQ) đúng như plan viết. Có **1 lỗi High**
làm sai mục "Cần người dùng duyệt: Không có": trên bản VPS (token Modal, có hạn mức người dùng) câu claim mới chậm
khoảng 150 lần, vượt xa ngưỡng 15 ms của chính plan. Research chỉ đo `claimableSql('mac')` nên bỏ sót. Phần còn lại
mức Medium/Low, chủ yếu là test chưa bắt đúng lỗi và docs.

## High

### H1. Bộ lọc tính theo từng dòng giờ chạy trên mọi job đang chờ: claim Modal có hạn mức ~370 ms

- Câu hiện tại đọc `jobs_claim_idx` theo thứ tự rồi dừng sớm, nên bộ lọc chỉ chạy trên ~40 dòng. Câu mới phải xếp
  **cả nhóm priority đứng đầu** (Incremental Sort, presorted key `priority`). Vì vậy mọi vị từ tính theo từng dòng chạy
  trên toàn bộ nhóm đó.
- `claimableSql("modal")` = `not(overQuotaSql(jobs.userId))` (`apps/api/src/billing/user-quota.ts:40-43`). Đây là
  subquery tương quan `sum(usage_ledger.cost_usd)` theo user, viết ở `user-quota.ts:28-31`. Khi có hạn mức hiệu lực
  (`system_settings.user_daily_usd` hoặc `USER_DAILY_USD`), subquery chạy **một lần cho mỗi job queued**. Token Mac cũng
  chịu cho mọi job LLM (`not(and(llmJobSql, overQuota))`). `breakerBlockedSql` (`jsonb_each` cho từng dòng) cũng chịu
  khi breaker bật.
- Số đo, thời gian thật (`\timing`) trong cùng một phiên. Dữ liệu: 5.998 job queued `page.prepare`, 150 chương, 20 user,
  2 job đang chạy, `user_daily_usd = 1000`, bộ lọc kiểu Modal:

  | Ledger hôm nay / user | Câu hiện tại | Câu mới |
  |---|---|---|
  | 0 dòng | 0,25 ms | 13,5 ms |
  | 100 dòng | 0,5 ms | 51 ms |
  | 1.000 dòng | 2,5 ms | **370 ms** (EXPLAIN: SubPlan `loops=5998`, 170.088 buffer so với 1.150) |
  | Không đặt hạn mức | 0,15 ms | 5–8 ms (khớp research) |

- Hệ quả: mỗi container Modal trả ~0,4 s CPU DB cho mỗi lần claim. Transaction claim dài hơn thì cửa sổ hai worker cùng
  rơi vào một chương cũng dài hơn. Dispatcher đã chịu chi phí này 5 s một lần (`oldestQueuedAgeS` +
  `claimableSql("modal")`, `dispatcher.ts:154`), nay nó bị nhân theo số lần claim.
- Đề xuất sửa plan:
  1. Mục "Cách đo lại" và ngưỡng ở quyết định 5 phải đo **cả hai kind**, có hạn mức và có ledger thật (≥ 1.000 dòng/user).
  2. Thêm vào phạm vi (hoặc đưa lên "Cần người dùng duyệt"): viết lại `overQuotaSql` thành subquery không tương quan
     để Postgres băm một lần:
     `user_id in (select l.user_id from usage_ledger l where l.user_id is not null and l.created_at >= dayStart group by l.user_id having sum(l.cost_usd) >= limit)`.
     Đo thử: câu mới + Modal + 1.000 dòng/user giảm từ 405 ms xuống 8 ms (EXPLAIN ANALYZE, `hashed SubPlan`).
     **Bắt buộc lọc `user_id is not null`**: ledger có dòng `userId: null` (`apps/api/src/billing/ledger.ts:109`). Thiếu
     điều kiện này thì `NOT (x IN (…, NULL))` cho ra NULL và chặn mọi claim. Giá trị hạn mức âm sẽ khác nghĩa với bản cũ.
     Cần kiểm validator chặn số âm. Test sẵn có ở `user-quota.test.ts` và `admin-limits.test.ts` giữ ngữ nghĩa.
  3. Sửa risk table của phase 1: đây không còn là rủi ro "có thể vượt" mà là chắc chắn vượt với cấu hình VPS.

## Medium

### M1. Không test nào kiểm quyết định 2 ("đếm mọi loại, mọi priority")
Cả 6 ca đều dùng `page.prepare`. Nếu code chỉ đếm job cùng loại hoặc cùng priority thì vẫn xanh. Thêm ca: A có
`chapter.translate` (priority 50) đang chạy và `page.prepare` chờ tạo trước; B có `page.prepare` chờ tạo sau. Claim
`page.prepare` kế tiếp phải là của B.

### M2. Ca "`chapter_id` NULL" chưa phân biệt được đúng với sai
Plan chỉ ghi "không trùng, claim theo `created_at`". Cần dựng cụ thể: A có 1 job running (lease còn hạn) và 1 job chờ
tạo trước; job `chapter.export` có cột `chapter_id` NULL tạo sau. Claim kế tiếp phải là job NULL. Ca này dựng được với
helper hiện có: FK `(user_id, chapter_id)` là MATCH SIMPLE nên NULL không bị kiểm, `exportInputs` đọc
`payload.chapter_id` (`claim-inputs.ts:280-291`), còn `claim()` bỏ `lockChapter` khi `chapterId` null (`queue.ts:140`).
Không cần nhánh "bỏ ca".

### M3. Plan và docs không nêu cái giá phải trả so với FIFO, nhất là trên VPS/Modal
Quyết định 1 chỉ so với xoay vòng tuyệt đối. So với hiện tại: khi có ≥ N chương chờ, chương đầu chỉ còn 1 worker nên
**xong chậm ~N lần** (2 worker → ~2×). Với Modal K container (`MODAL_MAX_CONTAINERS`) là ~K×. Lý do plan đưa ra, "người
đọc cần chương đầu xong sớm", lại ngược hướng với FIFO. Đề xuất: ghi rõ đánh đổi này trong plan và phase 2
(`job-queue-worker.md`, `project-roadmap.md`), kèm câu về bản VPS. Không cần đổi thiết kế: đây là yêu cầu của chủ dự án.

## Low

- **L1. Drizzle sinh tên cột không có tiền tố.** SQL thật là `order by "jobs"."priority" asc, coalesce("n", 0), …`,
  không có `"busy".`. Hiện chạy đúng (đã thử trên PG17) vì `jobs` và `pages` không có cột `n`. Nếu sau này có cột tên `n`
  thì câu này báo cột mơ hồ và mọi claim trả 500. Câu còn lại đúng: `left join (select "chapter_id", count(*)::int as "n" from "jobs" "running_jobs" … group by "running_jobs"."chapter_id") "busy" on "busy"."chapter_id" = "jobs"."chapter_id"`,
  `for update of "jobs" skip locked`, và `${jobs.x}` trong bộ lọc trỏ đúng bảng ngoài. Đề xuất: đặt alias riêng
  (`.as("busy_n")`) hoặc viết `sql\`coalesce("busy"."n", 0)\``. Sửa câu "SQL phải khớp câu trong plan.md" thành "khớp
  về ngữ nghĩa": Drizzle sinh `in (…)` chứ không phải `= ANY`, và không có alias `j`.
- **L2. "1 worker thứ tự không đổi" chỉ đúng gần đúng.** Worker chạy tuần tự (`main.py:265-295`). Nhưng khi worker
  restart, bị OOM, hoặc complete lỗi, job cũ vẫn `running` với lease còn hạn ≤ 120 s, cộng thêm tới 30 s chờ reaper. Trong
  khoảng đó chương của nó bị tính là bận, nên 1 worker nhảy sang chương khác. Hành vi lành, nhưng docs đừng ghi tuyệt đối.
- **L3. Phase 2 sót chỗ.** (a) `.claude/agent-memory/code-reviewer/selfhost-docker-release-probes.md:24` (memory nằm
  trong repo) ghi "the claim is global FIFO". Grep ở bước 1 không quét `.claude/`. (b) `docs/job-queue-worker.md:84-85`,
  vế "(trước đây hàng loạt job 100 cũng chặn job tạo sau)": nay chỉ còn đúng trong cùng một chương, cần viết lại chứ
  không "giữ ý". Các chỗ khác plan liệt kê đã kiểm và đúng dòng.
- **L4. Tiêu chí đo dễ hỏng.** "Plan vẫn dùng `jobs_running_lease_idx`" phụ thuộc vào planner. Trên DB nhỏ, `busy` đọc
  qua `jobs_idempotency_active_uq`, nên câu "luôn đọc qua jobs_running_lease_idx" trong research không đúng tuyệt đối.
  EXPLAIN ANALYZE cũng cộng thêm chi phí đo: cùng dữ liệu ra 21–26 ms, trong khi thời gian thật là 5–8 ms. Đề xuất: đo câu
  cũ và câu mới liền nhau trong cùng phiên, ngưỡng tính bằng thời gian thật, bỏ điều kiện về tên index.
- **L5. Test cần thêm chi tiết để chạy ổn định.** Ca "Hai chương chia lượt" phải đặt `createdAt` tường minh cho A < B.
  Nếu chèn cùng transaction thì `now()` trùng nhau và thứ tự rơi xuống `id`. Ca 120 job cần `timeout` riêng (mặc định
  30 s; test 1.000 job đang đặt 120 s). Assert "không deadlock" không cho tín hiệu gì về thay đổi này: `busy` chỉ đọc, thứ
  tự khoá job → chapter → pages không đổi.
- **L6. Smoke chưa phân biệt được code cũ và mới.** Tiêu chí "`claimed_at` đầu của chương ngắn < `claimed_at` cuối của
  chương dài" vẫn đúng với code cũ nếu một trang của chương dài phải retry, vì `claimed_at` bị ghi đè ở lần claim sau.
  Thêm điều kiện `attempts = 1`, hoặc so với `claimed_at` của trang `ord = n−3` của chương dài.
- **L7. (Tuỳ chọn) Priority 10 cũng bị chia lượt.** Chương người dùng đang mở sửa thường vẫn có job nền chạy, nên một lần
  tẩy lại hay OCR vùng của chương đó thua job export của chương khác dù export tạo sau. Ảnh hưởng nhỏ, chỉ một job ngắn.
  Chấp nhận và ghi docs, hoặc chỉ áp khoá xếp cho `priority > 10`.

## Đã kiểm, đúng

- `FOR UPDATE OF "jobs" SKIP LOCKED` cùng `GROUP BY` trong bảng dẫn xuất chạy được trên PG17. Bỏ `OF` thì báo
  `FOR UPDATE is not allowed with GROUP BY clause` (đã chạy thật).
- Plan chạy đúng thứ tự `Limit → LockRows → Incremental Sort`. Ba ca kiểm, dùng `pg_sleep` trong câu lệnh để ép đúng thời
  điểm:
  - Dòng đang bị khoá thì bỏ qua, lấy dòng kế: S2 nhận A1 khi S1 đang giữ A0.
  - EPQ: S1 claim và commit A0 sau khi S2 đã lấy snapshot. S2 kiểm lại thấy `status = 'running'`, bỏ A0, nhận A1. Không
    rỗng, không trùng.
  - LEFT JOIN `busy` khi dòng ghép là NULL cũng kiểm lại đúng.
  - 4 phiên drain đồng thời 28 job: nhận đủ 28, 0 trùng.
- Hai claim cùng lúc có thể vào cùng một chương: S2 nhận B1 trong khi C còn rảnh. Lần complete kế tiếp tự cân lại, đúng
  như plan mô tả.
- Mô phỏng tuần tự không kết thúc job ra A0 B0 C0 A1 B1 C1 …, khớp kỳ vọng của ca "Hai chương chia lượt" (bản 2 chương).
  Ca "Priority vẫn thắng" và "Lease hết hạn" bắt được lỗi chúng nhắm tới.
- Mọi lời gọi `insertJob` đều truyền `chapterId` (`enqueue.ts:213-464`). Worker luôn claim `max = 1`.
- Test "claims a finished chapter's export…" (`queue.test.ts:134`) vẫn xanh: bước 3 trở đi chỉ còn job của `ch2`, nên số
  đếm của mọi ứng viên bằng nhau. Test 1.000 job chỉ có 1 chương.
- **Không tìm thấy test nào chắc chắn đỏ.** Các file đều chạy tuần tự (`fileParallelism: false`) và `cancelActiveJobs`
  đặt `leaseExpiresAt = null` trước mỗi file. Những file có nhiều chương (user-quota, admin-users) claim trong một câu
  lệnh, `max: 8`, không giữ job đang chạy ở chương khác. `chapters.test.ts` claim toàn cục nhưng đã lọc
  `.find(chapter_id)`. Trường hợp duy nhất có thể đổi kết quả là còn sót job chờ ở chương khác *tạo sau* chương đang test
  trong lúc test giữ job chạy. Không thấy mẫu này trong repo.

## Câu hỏi chưa giải quyết

1. Bản VPS có đang đặt hạn mức người dùng (`USER_DAILY_USD` hoặc giá trị trong DB) không, và hàng đợi Modal thường có bao
   nhiêu job queued? Câu trả lời quyết định H1 phải sửa ngay trong plan này hay chỉ cần chặn bằng tiêu chí đo.
2. Viết lại `overQuotaSql` chạm vào `billing/user-quota.ts`, file dùng chung với dispatcher, health và
   `lockQueuedOverQuotaLlmJobs`. Planner tự quyết theo quyền được giao việc nhỏ, hay đưa lên chủ dự án vì nằm ngoài phạm
   vi "chỉ sửa đoạn `picked`"?
