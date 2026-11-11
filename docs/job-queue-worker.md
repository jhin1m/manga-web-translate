# Hàng đợi job + worker

Bảng `jobs` tự quản (`FOR UPDATE SKIP LOCKED`), API worker `/worker/v1/*` có fencing, worker Python pull-only
(`worker/mtl_worker`). Hợp đồng dữ liệu: `packages/shared/src/{job,worker-protocol,page-state}.ts` → JSON Schema ở
`packages/shared/json-schema/` (worker validate payload/inputs/result bằng các file này).

## Chạy local

```bash
pnpm infra:up && pnpm db:migrate
pnpm dev                      # API :8787
pnpm jobs                     # process riêng: reaper 30s + runtime_flags.runner_heartbeat

# token worker (file mode 600, token gốc không in ra terminal); --kind mac | modal
pnpm worker-token create --name mac-$(whoami) --kind mac --out ~/.config/mtl/worker.token

cd worker && uv sync && uv run python scripts/fetch_models.py
export GEMINI_API_KEY=…                       # không commit
MTL_TOKEN_FILE=~/.config/mtl/worker.token uv run mtl-worker --api http://localhost:8787
```

- Provider khác: `--provider openai` (cần `OPENAI_API_KEY`; model `MTL_OPENAI_MODEL` mặc định `gpt-4.1-mini`, premium
  `MTL_OPENAI_PREMIUM_MODEL` mặc định `gpt-4.1`) và `--provider openai_compatible` (cần `MTL_OPENAI_COMPAT_BASE_URL`,
  `MTL_OPENAI_COMPAT_API_KEY`, `MTL_OPENAI_COMPAT_MODEL`; `MTL_OPENAI_COMPAT_JSON` = `json_schema` | `json_object`). Model
  compatible không có giá tĩnh → billing tính giá đắt nhất. DeepSeek (text-only) không chạy OCR/proofread.
- Log worker: formatter redact key (`sk-…`, `sk-ant-…`, `sk-or-…`, `AIza…`, `Bearer …`); `-v` chỉ bật DEBUG cho
  `mtl_worker`/`mtl_pipeline`, logger `anthropic`/`google_genai`/`openai`/`httpx`/`httpcore` ghim WARNING.
- Không có key LLM: `--no-llm` (chỉ nhận `chapter.ingest`, `page.reinpaint`).
- Token qua Keychain thay file: `security add-generic-password -s mtl-worker -a default -w` (để trống
  `MTL_TOKEN_FILE`; đổi account bằng `MTL_KEYCHAIN_ACCOUNT`).
- Chạy nền: `worker/launchd/com.mtl.worker.plist` (sửa đường dẫn, `launchctl bootstrap gui/$(id -u) …`).
- Thu hồi: `pnpm worker-token revoke --id <token-id>`.
- **Worker chung toàn hệ thống**: token không gắn người dùng. `worker_tokens.kind` = `mac` (máy người vận hành) hoặc
  `modal` (qua dispatcher); `--capabilities a,b` (tuỳ chọn) giới hạn loại job. Token nào cũng claim được job — và nhận
  URL ảnh presigned — của **mọi** người dùng, nên token Mac là credential toàn nền tảng: chỉ cấp cho người vận hành,
  không đưa cho người dùng thường. Cờ cũ `--workspace` / `--platform` và setting `worker_mode` đã bỏ.
- Worker chỉ gọi ra ngoài (API + domain file `FILES_DOMAIN`) → chạy sau NAT được.
- **Nhiều worker cùng lúc**: mỗi worker chạy 1 job một lúc, N worker (dùng chung token được) chạy N job song song —
  claim `SKIP LOCKED`, fencing theo `lease_token` từng job, model tải về ghi file tạm rồi đổi tên. `--threads` (luồng
  onnxruntime) mặc định lấy `MTL_THREADS`; không đặt mà `MTL_WORKERS ≥ 2` thì `số nhân / MTL_WORKERS` (tối thiểu 1) để
  các worker cùng máy không giành hết nhân của nhau; còn lại 0 = onnxruntime tự chọn. Dòng log khởi động in `threads=`.
  Khi nhiều chương cùng chờ, N worker chạy N chương cùng lúc, mỗi chương một worker (xem thứ tự claim bên dưới).
  Self-host chạy mặc định 2 worker ([self-host.md](./self-host.md#worker)).

## Luồng dịch chương: xoá chữ + OCR rồi chuỗi lô dịch

```
"Dịch chương" = POST /chapters/:id/commit {target?} → enqueueIngest: chapter → ingesting, mở lượt run_target + run_started_at
  → chapter.ingest; complete [tx]: pages (uuid v5) + page_states rỗng + page.prepare × N, chapter → processing,
  run_total = N, pages.translate_queued = (run_target='translated')
page.prepare (song song): detect → mask → inpaint → OCR (local mặc định / LLM, cuối cùng) → clean/{rev}, mask/{rev}, ocr_result
  complete/fail [tx, khoá dòng chapter]: ghi page → refreshChapter → advanceTranslateChain
chapter.translate (tuần tự, mỗi job 1 lô): dịch + typeset → ai_state theo luật AI ghi → page ready/failed
  complete/fail [tx, khoá dòng chapter]: xoá translate_queued của lô → refreshChapter → advanceTranslateChain
hết trang translate_queued → run_target = null; chapter → review | partial_failed | prepared
```

**Lượt (run)** nằm trên `chapters.run_target` (`prepared` = dừng sau xoá chữ + OCR, `translated` = dịch luôn theo chuỗi
lô; null = không có lượt), `run_started_at`, `run_total` (số trang của lượt) và `pages.translate_queued` (= trang thuộc
lượt, chưa xong; giữ `true` cả lúc đang trong lô, xoá khi lô của nó complete/fail) — migration 0020. Commit không gửi
`target` → manga (`ingest_mode=pages`) tự dịch, strip dừng ở `prepared` (chờ duyệt cắt trang rồi bấm Dịch); manga mà
hết hạn mức → vẫn xoá chữ + OCR rồi dừng `prepared`. `target: "translated"` gửi tường minh + hết hạn mức → 402. Web gửi
`prepared` cho "Chỉ xoá chữ + OCR (soát trước)", `translated` cho "Dịch chương".

**`advanceTranslateChain`** (`apps/api/src/jobs/translate-chain.ts`) chạy dưới khoá dòng chapter, idempotent (đã có job
dịch active → không làm gì; gọi lặp / đồng thời vẫn ra đúng 1 job). Gọi ở complete/fail của `page.prepare` và
`chapter.translate`:

- Frontier = trang `translate_queued` đầu tiên theo `ord` (bỏ trang ẩn). Trang lỗi xoá chữ + OCR (chưa có OCR) bị
  bỏ khỏi lượt; frontier còn đang xoá chữ + OCR → chờ.
- Lô = các trang đã prepared liên tiếp từ frontier, cắt theo `planBatches` (≤ 4 trang có chữ và ≤ 40 khối — cùng
  `make_batches` của worker; trang 0 khối đi kèm miễn phí, trang đơn lẻ vượt trần vẫn đi riêng).
- **Lô đầu** chạy ngay khi có ≥ 1 trang liên tiếp đã prepared. **Lô sau** chưa đầy mà còn trang phía sau đang xoá chữ +
  OCR → chờ cho đủ lô (tránh vụn lô, giữ token ≈ dịch cả chương); hết trang chờ thì chạy lô thiếu. Nhờ vậy trang lô 1 `ready`
  (sửa được) khi lô sau còn chờ/chạy.
- Claim xếp `priority`, rồi **số job đang chạy của chương**, rồi `created_at`, thứ tự trang (số nhỏ chạy trước; job
  đang chạy không bị ngắt). Bảng priority:

  | priority | Job | Lý do |
  |---|---|---|
  | 10 (`INTERACTIVE_PRIORITY`) | `chapter.export`, `page.reinpaint`, `page.ocr_region` | Người dùng bấm và đang chờ trên màn hình, job ngắn → không xếp sau backlog cả chương của bộ khác (xuất ZIP bộ đã xong khi bộ khác đang chạy). |
  | 50 (`CHAIN_PRIORITY`) | `chapter.translate` (lô dịch) | Trang đã prepare được dịch ngay, không chờ cả chương xoá chữ + OCR xong. |
  | 100 (mặc định) | `page.prepare`, `chapter.ingest`, `chapter.proofread` | Backlog cả chương. Hiệu đính gọi LLM cả chương, chạy lâu → không ưu tiên kẻo chặn lô dịch. |

  Bấm xuất liên tục không làm đói lô dịch: idempotency key của export chặn job trùng khi nội dung không đổi.
- **Chia lượt giữa các chương** (`pickClaimable` trong `apps/api/src/jobs/queue.ts`): cùng priority, worker rảnh nhận
  job của chương đang có ít job chạy nhất; hoà thì chương tạo job trước, rồi trang đầu trước.
  - Đếm job `running` còn lease của chương, mọi loại và mọi priority (lô dịch, export đang chạy cũng tính). Job đã hết
    lease không tính.
  - Số đếm chỉ xếp thứ tự, không chặn: chỉ còn một chương có job chờ thì mọi worker cùng làm chương đó.
  - Kết quả: N worker → N chương chạy cùng lúc; chương thứ N+1 bắt đầu khi một chương đang chạy hết job chờ. Một
    worker thì thường vẫn lần lượt từng chương (sau khi worker khởi động lại, job cũ còn lease tới ~150 s nên có thể
    nhảy sang chương khác).
  - Cái giá: khi có từ 2 chương chờ, chương tạo trước chỉ còn 1 worker thay vì cả N nên xong chậm hơn khoảng N lần
    (Modal: theo số container). Tổng thời gian xong hết các chương không đổi.
  - Priority 10 cũng chia lượt: tẩy lại trang của chương đang có job chạy có thể xếp sau export của chương khác, lệch
    một job ngắn.
  - Hai worker claim trong cùng vài chục ms có thể vào cùng một chương; lần claim kế tự cân lại.
  - Câu chọn job (`pickClaimableSql`) không xếp cả hàng đợi. Khoá "số job đang chạy của chương" không có trong index,
    nên câu lấy ứng viên theo hai nhánh rồi mới xếp và khoá: job của chương rảnh đi theo `jobs_claim_idx` và dừng sau
    vài chục dòng; job của chương bận là một tập riêng, đọc qua `jobs_chapter_idx`. Tập user vượt hạn mức được dựng một
    lần cho cả câu.
  - Câu này chỉ nhanh khi Postgres chịu đi theo index rồi dừng, và planner chọn đường đó theo ước lượng của nó. Ba
    quy tắc giữ cho lựa chọn đó không phụ thuộc thống kê (xem chú thích của `pickClaimableSql` trước khi sửa):
    - Nhánh chương rảnh cắt hai bước: đi theo đúng hai cột của index `(priority, created_at)` và lấy trọn nhóm hoà cuối
      (`with ties`), không có bước xếp nào trên bảng `jobs`; rồi mới xếp tập vừa cắt theo trang + id và cắt lại.
    - Planner chỉ được thấy `status = 'queued'` ở nhánh chương rảnh (để chứng minh điều kiện partial index). Mọi bộ
      lọc theo dòng khác (giờ chạy, loại job, hạn mức, breaker, tài khoản bị khoá, chương bận), và cả `status` ở nhánh
      chương bận lẫn tầng khoá, nằm sau một biểu thức `CASE` (`opaque()` trong `queue.ts`). Thêm bộ lọc mới thì đặt vào
      trong lớp bọc đó.
    - Bộ lọc tài khoản bị khoá (`notDisabledOwnerSql`) viết bằng `not in (select …)`, không viết `not exists` tương
      quan.
    Các bản trước thiếu từng quy tắc này đã quay lại đọc + xếp cả hàng đợi: khi bảng `user` chưa có thống kê (self-host
    một tài khoản), và khi thống kê bảng `jobs` cũ (analyze lúc hàng đợi trống rồi một lô job mới vào).
  - Mỗi nhánh đọc trước `max + 32` dòng (`CLAIM_LOOKAHEAD`). Nếu chừng đó dòng đầu của cả hai nhánh đều đang bị
    transaction khác khoá thì lượt claim trả rỗng dù phía sau còn job, worker nghỉ một nhịp backoff rồi claim lại.
  - Tốc độ (thời gian thật gồm lập kế hoạch; như nhau từ 78 tới 20.000 job chờ, với thống kê `jobs` mới lẫn cũ).
    Self-host một tài khoản: 0,3–0,6 ms (câu FIFO trước đây 0,12–0,19 ms). Bản 20 tài khoản: 0,3–0,6 ms không hạn mức,
    2,2–2,5 ms có hạn mức (phần lớn là một lần cộng ledger trong ngày; FIFO 0,13–0,21 ms và 3,9–4,0 ms). Câu đọc khoảng
    160–270 dòng `jobs` bất kể hàng đợi dài bao nhiêu.
  - Hai trường hợp câu đọc nhiều hơn thế: bảng `jobs` còn nhỏ (vài nghìn dòng trở xuống) thì planner có thể đọc cả
    bảng, tốn thêm dưới 0,5 ms; và khi đầu hàng là các chương đang chạy với backlog lớn, thời gian theo số job chờ của
    chính các chương đó: 2 chương bận, mỗi chương còn ~1.000 trang chờ thì 1,5–3,4 ms (FIFO 0,6–1,5 ms), tức chậm hơn
    FIFO 1,2–1,9 ms; 8 chương bận × 1.000 trang chờ thì ~8 ms. Bảng `jobs` chưa từng được analyze (phút đầu sau cài mới
    hoặc restore) thì cả câu này lẫn câu FIFO đều đọc cả hàng đợi.
- Bản nhiều người dùng chưa chia lượt theo người: ai tạo hàng loạt export khác tuỳ chọn thì chen trước job của người
  khác, và trong cùng một chương job tạo trước vẫn chạy trước. Chấp nhận ở bản hiện tại, self-host chỉ 1 người dùng.
- `payload.context`: `rolling` khi lô mở đầu chương và mọi trang hiện xen giữa/ngay sau lô còn trong lượt; còn lại
  `neighbors` (lúc claim dựng nguồn + bản dịch trang ngay trước, nguồn trang ngay sau — dịch lại trang lẻ vẫn lấy trang
  trước + sau). `payload.carry` = `result.carry` của lô thành công gần nhất trong lượt (xem dưới).
- Lô lỗi hẳn (terminal `failed`) không chặn chuỗi: trang của lô chưa có bản AI → `failed`, đã có → giữ `ready`; lô kế
  chạy tiếp; cuối lượt chương `partial_failed` nếu còn trang lỗi.
- Hết hạn mức người dùng giữa chuỗi → đóng lượt, trang chưa tới lượt giữ `prepared` / `ready` (chỉ trang của lô đã chạy
  và lỗi hẳn mới `failed`).
- **Huỷ** bất kỳ job nào của lượt (kể cả 1 trang / 1 lô) dừng cả lượt (`stopTranslateChain`: `run_target = null`, xoá
  `translate_queued`); `POST /chapters/:id/cancel` cũng đóng lượt khi không còn job nào bị huỷ (lượt đang chờ trang
  xoá chữ + OCR). Muốn dịch tiếp: bấm Dịch lại.
- Dịch (`translate-prepared`), dịch lại (`translate`, cả chương hoặc `page_ids`), "Chạy lại trang lỗi" (`retry-failed`;
  trang lỗi xoá chữ + OCR chỉ vào lượt khi chương đã có trang `ready`, không thì dừng `prepared`) khi chương còn job dịch
  đang chạy/chờ → 409 `translate_running` (riêng `translate-prepared` khi chương đang `processing` → 409 `chapter_not_prepared`); trang ẩn → 409 `page_skipped`; trang chưa có OCR → 409 `page_not_prepared`.
- **Quét lại trang** (`POST /chapters/:id/rescan {page_ids}`, menu trang "Quét lại trang n"): dịch lại chỉ dịch trên
  `ocr_result` cũ nên không cứu được trang OCR đọc sai / gắn nhầm SFX. Rescan enqueue `page.prepare` (xoá chữ + OCR lại
  từ ảnh gốc) cho các trang đã có OCR rồi mở lượt `translated` cho chúng — lô dịch chờ OCR mới. Bản dịch theo luật AI ghi
  (trang đã sửa tay → `ai_update_available`). 409: `translate_running`, `page_skipped`, `page_busy` (đang Bước 1),
  `page_not_prepared` (chưa có OCR → "Chạy lại trang lỗi"), `page_has_manual_cleanup` (`clean_rev ≠ mask_rev`: đã
  tẩy / xoá chữ tay — ảnh sạch dựng lại từ gốc sẽ mất phần đó). `page.prepare` lỗi / huỷ trên trang đã có OCR giữ trang
  như cũ (`ready` nếu đã dịch, không thì `prepared`) và bỏ trang khỏi lượt (không dịch lại OCR cũ); trang chưa từng có
  OCR vẫn `failed`.

Thứ tự khoá cố định job → chapter → pages ở mọi nhánh (claim, `applyResult`, `terminal`, advance) để không deadlock.
`refreshChapter` coi chương bận khi còn trang `translate_queued` của lượt `translated`; lượt `prepared` hết bận thì đóng.

**`carry`** (pipeline 0.7.0, `TranslateCarry` ở `packages/shared/src/job.ts`): `{notes ≤ 2000, characters ≤ 30 tên × ≤ 64}`
chuyền ngữ cảnh giữa các lô — worker trả `result.carry` (ngữ cảnh sau lô cuối, cắt theo đơn vị UTF-16 như zod), API nhét
vào `payload.carry` của lô kế, worker nạp vào `RollingContext` đầu job. Thiếu `carry` = ngữ cảnh rỗng như cũ (payload cũ vẫn chạy).

**Trí nhớ series** (pipeline 0.11.0): `carry` còn sống qua lượt và chương nhờ cột `chapters.translate_memory` (carry cuối +
`source_lang` / `target_lang`).
- **Ghi** chỉ khi lượt dịch **cả chương** đóng bình thường (hết trang chờ), từ `carry` của lô thành công gần nhất
  trong lượt: `run_target = translated`, lượt phủ mọi trang không bỏ qua đã qua bước 1 (trang lỗi bước 1 không tính).
  Dịch lại một phần, hoặc lượt bị huỷ / dừng vì hết hạn mức giữa chừng, không bao giờ ghi đè trí nhớ có sẵn. Giới hạn
  đã biết: lượt chạy tiếp sau khi dừng vì hạn mức (`translatePrepared` trên các trang còn lại) không ghi trí nhớ.
- **Đọc**: lô của lượt chưa có carry của lượt thì lấy trí nhớ của chương **khác** cùng series, cùng cặp ngôn ngữ, gần
  nhất: số chương ≤ hiện tại (gần nhất), không có thì số lớn hơn gần nhất; không bao giờ lấy chính chương đang dịch. Đã
  có carry của lượt thì dùng carry đó.
- Hợp đồng payload không đổi (vẫn `payload.carry`), trí nhớ không vào `input_rev` / idempotency.

**Gợi ý từ AI**: `result.new_terms` (≤ 50, `MAX_LEARNED_TERMS`) và `result.pronoun_pairs` (≤ 30, `MAX_LEARNED_PRONOUNS`) đều
optional, worker cắt theo UTF-16 như `carry`. Mỗi lô prompt xin ≤ 5 thuật ngữ, ≤ 3 cặp xưng hô và `context_notes` cộng
dồn ≤ 300 ký tự (hạ từ 8/5/500 sau smoke LLM thật: token ra mỗi trang +15,4% → +3,1%). API lọc rồi lưu vào
`series_suggestions`; xem mục Glossary ở [export-and-batch-edit](./export-and-batch-edit.md).

Lỗi `schema` của lô (JSON sai sau retry, vượt guard token) không fail chương: lô nhiều trang tách dịch lại từng trang;
1 trang vẫn hỏng → worker bỏ trang khỏi result → server đánh page `failed` (bản AI cũ giữ nguyên), job `succeeded` nhưng
ghi `error_class=schema` để UI gom đúng nguyên nhân. 429/provider/auth vẫn fail cả job.

**Luật AI ghi** (`jobs/page-state-writer.ts`): `state_origin = 'ai'` → ghi `state` (kể cả khi tab editor đang giữ khoá
chương — trang đang dịch / chờ lượt chỉ xem, PUT state trả 409 `page_busy`); trang đã sửa tay (`state_origin = 'user'`)
→ chỉ cập nhật `ai_state` + `ai_update_available = true`.

Gọi từ route: `inJobTx(tx => enqueueIngest | enqueueReinpaint | enqueueOcrRegion(tx, userId, …))` trong
`apps/api/src/jobs/enqueue.ts`, `translatePrepared | retranslate | retryFailedPages` trong `translate-chain.ts`. Ghi
page state từ người dùng: giữ khoá chương qua `apps/api/src/lib/chapter-lock.ts` (`assertChapterLock` → 423; trang bận
`isPageBusy` → 409 `page_busy`; ghi hàng loạt cả chương `assertChapterIdle` → 409 `chapter_busy`).

## Giao thức worker

| Lệnh | Body chính | Ghi chú |
|---|---|---|
| `POST /claim` | `worker_id, capabilities, max ≤ 8, pipeline_version, dispatch_id` | 426 khi `< MIN_PIPELINE_VERSION`; 400 capability lạ/không được cấp. Token `mac` và `modal` cùng thấy job của mọi người dùng; token `modal` không nhận job nào của người đã vượt hạn mức, token `mac` không nhận job LLM của họ (xem [hạn mức](#hạn-mức-mỗi-người-user_daily_usd)). Breaker của provider job đó dùng đang bật → bỏ qua job (xem [breaker theo provider](#circuit-breaker-theo-provider)). Response mang `jobs[].llm` (key AI đã giải mã) nên luôn `Cache-Control: no-store` — xem [Provider AI từ DB](#provider-ai-từ-db-pipeline-0100) |
| `POST /jobs/:id/heartbeat` | `lease_token, attempt, progress, stage, usage, done?, total?` | gia hạn lease 120s; ghi `jobs.progress_done/progress_total` (số ảnh/trang/đoạn đã xong / tổng của bước `stage`; thiếu = bước không đếm, worker cũ không gửi); `stop: "cancel"` khi người dùng huỷ, `stop: "paused_budget"` khi vượt ngân sách (job tốn tiền, không tính attempt) |
| `POST /jobs/:id/presign-outputs` | `names: ["clean"\|"mask"\|"page:<ord>"]` | URL PUT mới, cùng rev, TTL ≤ lease còn lại |
| `POST /jobs/:id/complete` | `result, usage, pipeline_version` | lặp với cùng lease → no-op |
| `POST /jobs/:id/fail` | `error_class, retry_after_s, message, usage, partial` | xem phân loại lỗi |
| `POST /sessions/end` | `dispatch_id, lifetime_s, busy_s` | chỉ token `kind=modal` (mode drain; token khác 403) → ledger `gpu_idle_seconds`; gửi lại = no-op |

Fencing: `lease_owner` = id token (không từ body); `{lease_token, attempt}` phải khớp và lease còn hạn, không thì 409
và không ghi gì — worker bỏ job ngay. `attempt` = `attempts + provider_retries` (thứ tự claim, tăng đơn điệu). Output
ghi vào key bất biến (`clean/{rev}`, rev cấp lúc claim từ `pages.next_rev`); DB chỉ trỏ rev của attempt thắng.

Usage: worker gửi số đếm thô (`seq` tăng dần trong attempt, `model, llm_in, llm_out, calls, gpu_s`); server clamp
(`llm_out ≤ 4096·calls`, tổng theo attempt ≤ trần số call của job, `gpu_s ≤ thời gian từ claim`), nhân bảng giá
`apps/api/src/billing/prices.ts` (model lạ → giá cao nhất, không bao giờ $0), ghi `usage_ledger` unique
`(job_id, attempt, seq, kind)`.

Heartbeat (`mtl_worker/runner.py`): thread riêng, nhịp 20s gia hạn lease + gửi usage; đổi bước (`stage`) hoặc số đếm
(`done`) thì gửi tiến độ **ngay** (tối thiểu cách lần trước 2s — nhiều lần đổi dồn dập gộp vào một lần; heartbeat sớm không
mang usage). Nhờ đó trang hiện bước ("Đang tải ảnh 3/10", "Xoá chữ", "Đang đặt chữ"…) trong vài giây; mã bước → nhãn tiếng Việt
ở `apps/web/src/features/chapter/stage-labels.ts`. `GET /chapters/:id/progress` trả `job.progress_done/progress_total` của
từng trang, `chapter.run` (`target`, `total`, `remaining`, `batch`, `batches`) và `pages[].translate_queued`,
`pages[].run_batch` (số thứ tự lô dự kiến) cho thumbnail "Chờ lượt · lô k", `pages[].ocr_ready` (đã có OCR — đúng điều kiện server nhận trang vào lượt dịch). Complete/fail/requeue xoá cặp đếm (migration 0019).

## Phân loại lỗi

| error_class | Tính attempt | Requeue |
|---|---|---|
| `provider` (5xx/timeout), `rate_limited` (429) | không | `max(Retry-After, 30s·2^min(n,5))`, tối đa 20 lần rồi `failed` |
| `schema` (JSON LLM sai sau 1 retry), `internal` | có (`max_attempts=3`) | `30s·2^n` |
| `invalid_input` (ảnh hỏng, vượt 16384px/60MP) | — | `failed` ngay |

OpenAI/compatible: HTTP 402 và 429 hết hạn mức (`insufficient_quota`, `credit_balance_exhausted`, `*_spend_limit_exceeded`,
`*_usage_limit_exceeded`) → `auth` (không retry). `jobs.error`/`fail.message` chỉ là câu chung `"<provider> HTTP <status> <error_class>"`
hoặc `"internal: <TênException>"`; chi tiết chỉ nằm ở log worker đã redact.

`auth` còn là lớp của job fail ngay lúc claim vì cấu hình AI lỗi (key không giải mã được / provider hoặc model đã mất):
`jobs.error` = "Cấu hình AI lỗi: …" — xem mục Provider AI từ DB.

### Circuit breaker theo provider

≥ 5 lỗi provider/rate_limited trong 5' của **một** provider → `runtime_flags.llm_paused:<provider_id>.until = now+2'`, chỉ
job dùng provider đó bị bỏ qua khi claim (và khi dispatcher tính job Modal cần chạy); job dùng provider khác hoặc env vẫn
chạy. Job không có `payload.llm` (chạy bằng key env của worker) dùng khoá `env` = hàng `llm_errors` / `llm_paused` có từ
trước (không đổi tên). Lỗi của job ghi vào mọi provider khác nhau trong `payload.llm`; job 1 slot DB + 1 slot env tính theo
provider DB. Lỗi provider ở `page.prepare` gửi kèm `partial {clean_rev, mask_rev, regions}` → lần sau bỏ qua detect/inpaint. Lease hết hạn → reaper
trả `queued` (giữ attempts) hoặc `failed` khi hết lượt.

## Ảnh / trang bỏ qua, chữ bỏ qua

- `chapter.ingest` chỉ nhận ảnh gốc `source_files.skip IS NULL` (`'user'` = xoá tay, `'credit'` = khớp ảnh credit
  series đã học lúc tạo chương); commit kiểm lại bộ ảnh trong transaction, đổi giữa chừng → 409 `sources_changed`.
- Trang `pages.skipped`: không vào `chapter.translate` (chuỗi lô dịch, retry, dịch lại), không làm `context_lines`, không
  tính trạng thái chương; `chapter.export` nhận `pages[].skipped` (pipeline 0.4.2).
- **Chữ bỏ qua** (`series.ignore_text`, Cài đặt series → "Chữ bỏ qua (watermark)"; ≤ 50 mục): lúc claim
  `chapter.translate`, item OCR khớp một mục được gửi `empty: true` → worker không dịch, không đặt box (ảnh đã sạch từ
  xoá chữ + OCR). `ocr_result` trong DB không đổi → bỏ mục rồi dịch lại là dịch vùng đó bình thường. Dòng khớp cũng bị bỏ khỏi
  `context_lines` (cả `page.ocr_region`; vùng người dùng tự vẽ thì vẫn dịch). Đổi danh sách tăng `glossary_rev` (khoá
  job dịch), **không** `settings_rev` (nằm trong khoá prepare → thử lại trang lỗi sẽ chạy lại xoá chữ + OCR). Quy tắc khớp
  (`compileIgnoreList`, `packages/shared/src/ignore-text.ts`, dùng chung api + bảng văn bản):
  - Mục thường: NFC, không phân biệt hoa/thường, bỏ `http(s)://`, **bỏ mọi khoảng trắng cả hai phía** (`discord . gg`
    khớp mục `discord.gg`); 3–100 ký tự tính trên dạng đã bỏ khoảng trắng.
  - Mục `/mẫu/` là regex, cờ cố định `iu`, chạy trên chữ đã chuẩn hoá (khoảng trắng gộp thành 1 dấu cách). **API khớp
    bằng RE2** (package `re2`, thời gian tuyến tính nên mẫu như `/\w*\w*\w*\w*!/` không thể làm treo claim job hay
    xem trước / áp ngược); web dùng `RegExp` gốc (form nhập, ẩn dòng ở bảng văn bản). Dialect = tập con RE2: **không** có
    tham chiếu ngược (`\1`..`\9`, `\k<tên>`) và lookahead/lookbehind (`(?=`, `(?!`, `(?<=`, `(?<!`); có nhóm
    `(?:…)`, nhóm đặt tên `(?<n>…)`, `\b`, `\d\s\w`, lớp ký tự, `{n,m}`, `\p{L}`. Form/API từ chối (400, lỗi theo
    dòng) regex dùng cú pháp trên, RE2 không biên dịch được (API kiểm bằng cách dựng thật bằng RE2), dài > 100 ký tự
    (cả hai dấu `/`) hoặc khớp chuỗi rỗng. Thêm hai chốt vì web chạy RegExp gốc (backtracking): lượng từ lồng nhau kiểu
    `(a+)+` / `(.*)*` và quá 5 lượng từ `*` / `+` / `{n,}` trong một mẫu bị từ chối — áp ở cả form lẫn API để hai bên
    cùng coi một mục là hợp lệ hay không.
  - Danh sách đã lưu từ trước: mục dạng `/…/` giờ là regex (trước đây là chữ thường, kể cả dấu `/`), và mục ngắn hơn 3
    ký tự sau khi bỏ khoảng trắng (vd `a b`) không còn hợp lệ. Lưu cài đặt series khi còn mục như vậy bị từ chối (400)
    kèm lỗi theo dòng cho tới khi sửa hoặc xoá mục đó; mục cũ đang lưu trong DB vẫn được đọc (mục không hợp lệ bị bỏ
    qua lúc so khớp).
  - Chương đã dịch không tự đổi khi sửa danh sách: bảng văn bản ẩn dòng khớp, trừ khi box còn in chữ. Muốn ẩn box đã
    đặt: Cài đặt series → "Ẩn chữ khớp trong chương đã dịch…" (xem `docs/export-and-batch-edit.md`). Watermark
    detector không bắt thì chữ còn trên ảnh.

## Ingest strip / pages

Mode ingest = `series.page_format` (`POST /chapters/:id/commit` không gửi `mode` → lấy của series; body `mode` chỉ để
override khi test/tool), ghi lại ở `chapters.ingest_mode`. Series mới không gửi `page_format` → theo ngôn ngữ gốc:
`ja` → `pages`, còn lại → `strip`. Đổi `page_format` chỉ áp cho lần commit sau (không tăng `settings_rev`).

`worker/mtl_pipeline/ingest.py`: slice liên tiếp cùng width → strip ảo → detector → cắt ở hàng không giao box (lề 16px),
ưu tiên ~4500px trong cửa sổ 3000–6000; không có → kéo dài tới 12000px; vẫn không → hàng giao ít box nhất + `cut_flag`.
Không overlap; `source_map` ghi slice gốc ↔ đoạn y của page. `mode: "pages"` (manga): 1 file = 1 page. Ingest lại khi
đã có `state_origin='user'` → 409 `chapter_has_user_edits` (tạo chương mới).

## Ngôn ngữ + thứ tự đọc

Series chọn nguồn `ko | ja | zh | en`, đích `vi | en | id | es | pt | fr` (`packages/shared/src/series-lang.ts`;
mọi nguồn đã thử chương thật). Ngôn ngữ đi trong payload, prompt
(`worker/mtl_pipeline/prompts/`) tĩnh để giữ cache:

| Job | Field | Dùng ở worker |
|---|---|---|
| `page.prepare` | `source_lang`, `reading_order` (`ltr`/`rtl`) | dòng `source_lang=…` đầu nội dung OCR; `rtl` → id vùng chữ theo hàng trên→dưới, trong hàng phải→trái (`detect.rtl_order`) |
| `page.ocr_region` | `source_lang`, `target_lang` | OCR + dịch 1 vùng |
| `chapter.translate` | `settings.source_lang`, `settings.target_lang` | `source_lang`/`target_lang` trong JSON gửi dịch |

`reading_order = rtl` chỉ khi nguồn `ja` **và** `chapters.ingest_mode = pages` (mode chương thực sự được cắt, không
phải `page_format` hiện tại); còn lại `ltr` (thuật toán cũ, id vùng không đổi). Hàng của `rtl` so với box mở hàng nên
box cao vắt qua nhiều khung không gộp hai hàng. Đổi `source_lang`/`target_lang` → `settings_rev + 1`. `honorific_policy` gửi đi là câu chỉ dẫn sinh theo
cặp nguồn → đích (`honorificText` ở `apps/api/src/jobs/enqueue.ts`). Field ngôn ngữ trong payload là optional: job
xếp hàng trước pipeline 0.4.0 thiếu → worker mặc định `ko` → `vi`, `ltr`. Pipeline 0.4.0 là `MIN_PIPELINE_VERSION`:
**mọi** worker 0.3.x nhận 426 ngay khi API mới lên → cập nhật worker Mac/Modal cùng lúc deploy API, không thì hàng
đợi dừng hẳn. Từ 0.4.1 (`settings.narration_font`) `MIN_PIPELINE_VERSION = 0.4.1` cho worker; API `PIPELINE_VERSION`
(muối input_rev) vẫn 0.4.0 nên job đã chạy không bị chạy lại. 0.4.2 (`chapter.export` `pages[].skipped`, trang đã
ẩn) nâng `MIN_PIPELINE_VERSION = 0.4.2` cùng lý do. 0.5.0: `page.prepare` ghi thêm `ocr_result.regions[].text_color` /
`outline_color` (optional, `#rrggbb`) đo từ ảnh gốc; `chapter.translate` dùng chúng để đặt màu chữ/viền
(xem `docs/typeset-layout-contract.md`). Schema `regions[]` của `inputs-chapter-translate` và `page.prepare` partial có
`additionalProperties: false` nên worker < 0.5.0 từ chối region có `text_color`/`outline_color` (lỗi hợp đồng) dù trường
là optional: trang đã prepare bằng ≥ 0.5.0 không dịch được trên worker cũ, và `MIN_PIPELINE_VERSION` phải ≥ 0.5.0 khi
API gửi các trường này (hiện 0.5.1). Chiều ngược lại ổn: trang đã prepare từ trước 0.5.0 không có màu rơi về quy tắc cực tính. 0.5.1 (`inputs.fonts` của translate/export, xem mục Font tuỳ chỉnh)
nâng `MIN_PIPELINE_VERSION = 0.5.1`: schema input có `additionalProperties: false` nên worker cũ không đọc nổi job có
font, và worker cũ cũng không biết fallback font tuỳ chỉnh. API `PIPELINE_VERSION` (muối input_rev) không đổi. 0.6.0
(cài đặt pipeline trong payload, job `chapter.proofread`, xem mục dưới) nâng `MIN_PIPELINE_VERSION = 0.6.0` cùng lý do.
0.7.0 (`carry` ở payload + result `chapter.translate`, xem mục Luồng dịch chương) nâng `MIN_PIPELINE_VERSION = 0.7.0`: schema
payload có `additionalProperties: false` nên worker 0.6.x từ chối job dịch có `carry` — worker Mac/Modal lên 0.7.0
**trước** khi deploy API, không thì claim trả 426 và hàng đợi dừng (worker 0.7.0 vẫn đọc payload cũ không có `carry`).
API `PIPELINE_VERSION` (muối input_rev) vẫn 0.4.0. 0.8.0 (`Region.style` ở result, `settings.thought_font`/`note_font` ở payload
`chapter.translate`) nâng `MIN_PIPELINE_VERSION = 0.8.0` cùng lý do; thứ tự deploy ở `docs/deployment-guide.md`. Heartbeat `done/total` không cần nâng version (API cũ bỏ qua key lạ).
0.9.0 (`page.reinpaint.auto_text_bbox`, xem mục dưới) nâng `MIN_PIPELINE_VERSION = 0.9.0`: worker cũ đòi `user_mask_key`
+ input `user_mask` nên fail job xoá chữ theo khung. API `PIPELINE_VERSION` (muối input_rev) vẫn 0.4.0.
0.11.0 (prompt dịch + hai key result optional `new_terms` / `pronoun_pairs`, trí nhớ series) **không** nâng
`MIN_PIPELINE_VERSION` (giữ 0.10.0): API cũ bỏ qua key lạ, API mới nhận result thiếu key, payload không đổi; worker
0.10.0 vẫn chạy nhưng không sinh gợi ý. API `PIPELINE_VERSION` vẫn 0.4.0.

## Xoá chữ lại (`page.reinpaint`, pipeline 0.9.0)

Payload có **đúng một** nguồn mask (zod `.refine` ở `packages/shared/src/job.ts`, route kiểm lại):

- Mask người vẽ (Mask B): `user_mask_key` + `offset` → inputs `{base_clean, user_mask}`.
- Khung OCR vùng: `auto_text_bbox: [x, y, w, h]` (toạ độ page, trong page, cạnh ≥ 4) → inputs chỉ `{base_clean}`.
  Worker (`textmask.bbox_text_mask`) chạy CTD trên dải cả bề ngang page quanh khung (cao 1.25 × ngang = đúng tỉ lệ tile
  lúc prepare; cửa sổ nhỏ bị phóng lên 1024 → mask yếu, sót nét), `build_text_mask` như 1 vùng `text_free` +
  gộp `pred > 64` trong khung (nét CTD thấy mờ mà refine bỏ; chỉ khi model đã thấy chữ rõ ≥ 1% khung), cắt trong khung +
  dilation. **Không** fallback cực tính: khung hay đè
  hình vẽ, fallback bắt nhầm nét viền mà ảnh sạch không hoàn tác được → model không thấy chữ = fail `invalid_input`
  "Không thấy chữ trong khung…" (không tạo `clean_rev` thừa). SFX cũng xoá (người dùng kéo khung = ý định rõ). Bước
  heartbeat: `detect` → `inpaint`.

Cả hai cần khoá chương và `base_clean_rev` = rev hiện tại (409 `clean_rev_changed` kèm `clean_rev`). Lúc complete,
`pages.clean_rev` chỉ đổi khi vẫn bằng `base_clean_rev`: 2 lần xoá chạy cùng lúc (khung OCR + Mask) thì lần xong sau bị
từ chối (job `failed`, lỗi `clean_rev_changed: …`, worker nhận 409) thay vì ghi đè mất kết quả lần trước. Không gọi LLM
→ không kiểm hạn mức.

## Font tuỳ chỉnh (pipeline 0.5.1)

`inputs.fonts: [{id, url, sha256}]` (optional) có ở `chapter.translate` và `chapter.export`; liệt kê font `custom-*`
của **người dùng sở hữu job** mà job dùng, dựng lúc claim (`fontInputs` ở `jobs/claim-inputs.ts`, URL presigned GET: translate
10', export 15'):

- translate: `settings.font` + `settings.narration_font` + `settings.thought_font` + `settings.note_font` của payload (snapshot lúc enqueue);
- export: `font_family` của mọi box ở trang được vẽ chữ + font mặc định hiện tại của series.

**Font hệ thống** (admin upload ở Cài đặt › Font hệ thống, bảng `system_fonts`, object `system/fonts/<font_id>`) dùng cùng
dạng id `custom-<8 hex>` (id không trùng `user_fonts`) nên `resolveCustomFonts` trả chúng cho mọi người dùng cạnh font
riêng, ở cùng danh sách `inputs.fonts` — hợp đồng và worker không đổi. Trần 20 font hoặc tổng 100MB. Xoá font hệ thống bị
chặn (409 `in_use`, kèm số series) khi series của bất kỳ ai còn dùng làm mặc định; box cũ còn tham chiếu thì fallback như font riêng đã xoá.
Rollback code về bản trước: series đã trỏ font hệ thống bị từ chối khi lưu lại (`unknownFonts` cũ) và job fallback font mặc định;
bảng và object giữ lại vô hại (down: `migrations-down/0025_system_fonts.down.sql`). Backup `infra/backup.sh` mirror cả bucket nên gồm
`system/`; lifecycle MinIO chỉ áp tag export.

Runbook gỡ font hệ thống đang được series dùng làm mặc định (vd. gỡ vì bản quyền): admin không sửa được series của người
dùng khác nên phải chạy SQL. Slot thiếu trong `series.default_fonts` nghĩa là dùng font mặc định, nên chỉ cần bỏ các khoá
đang trỏ tới font (thay `<font_id>` bằng id thật, dạng `custom-<8hex>`) rồi xoá bình thường ở Cài đặt › Font hệ thống:

```sql
UPDATE series
SET default_fonts = COALESCE((SELECT jsonb_object_agg(key, value) FROM jsonb_each_text(default_fonts) WHERE value <> '<font_id>'), '{}'::jsonb)
WHERE EXISTS (SELECT 1 FROM jsonb_each_text(default_fonts) WHERE value = '<font_id>');
```

Id gói sẵn, của người dùng khác hoặc đã xoá (box cũ còn tham chiếu — xoá font chỉ bị chặn khi là mặc định series) bị
bỏ khỏi danh sách. Worker (`mtl_worker/job_fonts.py`) tải mỗi font vào cache `~/.cache/mtl-worker/fonts/<sha256>`
(`MTL_FONT_CACHE_DIR` để đổi), kiểm sha256 và đọc thử bằng fontTools, rồi đăng ký `id → file` trong suốt job
(`use_fonts` ở `mtl_pipeline/fonts.py`; file không đuôi, Pillow/fontTools đọc theo nội dung). `font_path` /
`metrics_for` tra registry trước `worker/fonts`; id không biết → font thoại mặc định (`DEFAULT_FONT`) + log, không
làm hỏng job. Font sai hash / không đọc được bị bỏ qua và fallback tương tự; lỗi mạng khi tải ném ra để job thử lại.
Worker chỉ tải URL có trong inputs.

## Cài đặt pipeline (pipeline 0.6.0)

Cài đặt admin → Pipeline (`/settings`; `GET /api/admin/settings` và `PUT /api/admin/settings/pipeline`, chỉ email thuộc
`ADMIN_EMAILS`) là cài đặt **toàn hệ thống**, một bộ chung cho mọi người dùng (bảng `system_settings`; thiếu hàng/key = mặc
định). Đổi có hiệu lực từ job enqueue sau, job đang chờ giữ snapshot cũ. Hợp đồng: `packages/shared/src/pipeline-settings.ts`
(`PipelineSettings`, `resolvePipelineSettings` đọc từng key hợp lệ, key lỗi → mặc định). Worker không đọc DB — API
chụp vào payload lúc enqueue:

| Job | Field | Nội dung |
|---|---|---|
| `page.prepare` | `pipeline` | `detector`, `detection_threshold`, `ocr_engine` (đã chọn theo `source_lang` của series), `inpainter`, `mask_dilation` (`null` = tự động 2–6px), `inpaint_size` |
| `page.reinpaint` | `inpaint` | `inpainter`, `inpaint_size` (cả mask người vẽ lẫn `auto_text_bbox`) |
| `page.ocr_region` | `ocr_engine`, `reading_order` | OCR vùng tự vẽ theo engine; dịch vẫn qua LLM |
| `chapter.proofread` | `model_tier` | `standard` / `premium` — chỉ khi chưa gán slot Hiệu đính (0.10.0: thay bằng `llm.proofread`) |

- Mặc định (`rtdetr_v2_comic`, 0.35, `llm`, `big_lama`, tự động, 512) = hành vi trước 0.6.0. Field optional: job xếp
  hàng trước đó thiếu → worker dùng mặc định. `prepareInputRev` chỉ trộn hash tuỳ chọn khi **khác** mặc định → page /
  job cũ giữ input_rev (không bị coi là lỗi thời ở "Chạy lại trang lỗi").
- `comic_text_detector`: khối chữ lấy từ output `blk` của CTD (cùng lượt với mask, hậu xử lý YOLO + NMS port từ
  manga-image-translator), bóng thoại vẫn từ RT-DETR; khối nằm ≥ 60% trong bóng → `text_bubble`, còn lại `text_free`.
- `inpaint_size` = cạnh tối đa cửa sổ gom nhiều thành phần mask vào 1 lượt LaMa (model luôn chạy 512×512; lớn hơn
  = ít lượt, nhìn nhiều nền, nét mờ hơn). `CompositeInpainter` (flood-fill nền phẳng trước) giữ nguyên.
- OCR local (`manga_ocr` chỉ `ja`, `paddle_ocr` cho `ko/zh/ja/en`; `mtl_pipeline/local_ocr/`): cùng `OcrResult`
  như LLM — crop dưới `MIN_INK_RATIO` → `empty`, thứ tự id theo `text_regions`, độ tin < 0.5 hoặc có mực mà đọc rỗng →
  `low_conf`; **không nhận SFX** (`is_sfx` luôn false). PaddleOCR chỉ đọc khối chữ cao theo cột dọc (tách cột theo
  hình chiếu mực, phải → trái) khi trang đọc `rtl` (manga Nhật dạng trang); còn lại tách dòng ngang bằng det PP-OCR
  (manhua / webtoon chữ ngang). Engine local nạp ngay đầu handler (thiếu model → tải / lỗi trước khi tốn công detect). Không gọi LLM → usage rỗng; breaker LLM và kill-switch ngân sách
  bỏ qua `page.prepare` có `pipeline.ocr_engine` local (`isLlmPayload` ở shared, `llmJobSql` ở API). Worker `--no-llm`
  vẫn không nhận `page.prepare` (capability theo loại job).
- OCR LLM (`mtl_pipeline/ocr.py`): item `empty=false` mà `source` trống là kết quả tự mâu thuẫn (structured output cắt
  chuỗi khi chữ mở đầu bằng `"` ASCII) → `reread_blank` gửi lại riêng crop đó 1 lần; vẫn trống / lỗi → `low_conf`
  (khối giữ ảnh gốc như SFX nhưng hiện cờ cần soát). Prompt OCR / dịch / hiệu đính bắt LLM viết ngoặc kép bằng “ ”.
- Model mới là entry `optional` trong `worker/models.lock.json` (LaMa manga, MangaOCR encoder/decoder/vocab, PP-OCRv6
  det/rec, PP-OCRv5 rec tiếng Hàn): không kiểm lúc khởi động; lần đầu job cần → `ensure_model` tải đúng URL/revision,
  kiểm sha256 (lỗi → job `internal`, thử lại). `scripts/fetch_models.py` mặc định tải cả model optional.

## Nhà cung cấp AI do admin cấu hình

Cài đặt admin → AI (`/settings?section=providers|tasks`; `/api/admin/providers*`, `/api/admin/models/:id`,
`PUT /api/admin/settings/slots`): provider (`anthropic`, `gemini`, `openai`, `openai_compatible` + `base_url` https) kèm model
và giá USD/1M token do admin nhập (`ai_providers`, `ai_models`), và 3 slot OCR / Dịch / Hiệu đính (cột FK
`ocr_model_id`, `translate_model_id`, `proofread_model_id` trên `system_settings`; `null` = mặc định theo env worker).
Mẫu "DeepSeek" ở form chỉ là `openai_compatible` điền sẵn (`https://api.deepseek.com`, `json_object`, gợi ý giá
`deepseek-flash` / `deepseek-v4-pro` theo giờ cao điểm) — không có loại riêng ở DB. Worker nhận ra host
`api.deepseek.com` và gửi `thinking: disabled` (DeepSeek bật suy luận mặc định, token suy luận ăn hết trần token ra),
trừ khi model được đánh dấu reasoning.

OCR engine mặc định (cài đặt pipeline chưa lưu): `manga_ocr` cho `ja`, `paddle_ocr` cho `ko`/`zh`/`en`. Mốc input_rev
của `page.prepare` vẫn là bộ tuỳ chọn OCR LLM cũ (`PREPARE_REV_BASELINE` ở `packages/shared/src/pipeline-settings.ts`):
rev trang/job cũ không đổi, trang OCR local luôn có rev khác trang OCR LLM.

AI hiệu đính hỏi xác nhận trước khi chạy: `GET /api/chapters/:id/proofread/estimate` → số trang, provider/model của
slot Hiệu đính, khoảng USD và thời gian (trung bình token + giây/trang của ≤ 20 lượt thành công gần nhất của user;
chưa có → hằng số trong `apps/api/src/billing/proofread-estimate.ts`), và báo rõ ảnh trang được gửi lên provider.

- Key mã hoá AES-256-GCM bằng `SECRETS_KEY` (blob `base64(version|iv|tag|ct)`, AAD `ai_provider:<id>`); API chỉ trả
  `key_last4`, không bao giờ trả / log key. Đổi `SECRETS_KEY` = nhập lại key từng provider.
- `model_id` bất biến (xoá rồi thêm). Đổi `base_url` bắt buộc kèm key mới (409 `key_required`). Xoá provider / model, hoặc
  tắt `vision` của model đang gán OCR / Hiệu đính: 409 `in_use` (còn gán slot) hoặc `in_use_by_jobs` (còn job
  `queued|running|paused_budget` có `payload.llm` tham chiếu).
- `POST /api/admin/providers/:id/test`: giải mã key trong RAM, gọi endpoint liệt kê model (Anthropic `x-api-key`, Gemini
  `x-goog-api-key`, OpenAI/compatible Bearer; OpenRouter dùng `/key`); không theo redirect, timeout 10s; chỉ trả
  `{ok, reason, http_status}`.
- Slot được job dùng từ pipeline 0.10.0, xem mục dưới.

## Provider AI từ DB (pipeline 0.10.0)

Hợp đồng: `packages/shared/src/job.ts` (`LlmRef`, `LlmRefs`), `worker-protocol.ts` (`LlmConfig`, `ClaimedJob.llm`).

- **Enqueue** (`apps/api/src/ai/llm-refs.ts`): đọc 3 slot dưới `FOR SHARE` và chụp `payload.llm = {ocr?, translate?,
  proofread?}`, mỗi ref `{provider_id, model}` (không key). Slot theo loại job: `page.prepare` → `ocr` (chỉ khi OCR engine là
  `llm`); `chapter.translate` → `translate`; `page.ocr_region` → `ocr` (engine `llm`) + `translate`; `chapter.proofread` →
  `proofread`. Slot chưa gán → không có trong `llm` (không slot nào → không có `llm`) → worker dùng env cho tác vụ đó.
- **Claim** (`apps/api/src/ai/llm-config.ts`): giải mã key trong RAM và trả thêm `jobs[].llm = {ocr?, translate?,
  proofread?}`, mỗi phần `{type, model, api_key, base_url, structured_output, reasoning}`. Chỉ nằm trong response
  (`no-store`), không ghi `jobs.payload/result/error`, event hay log. Đổi key trên UI → job claim kế tiếp dùng key mới.
  Key không giải mã được (đổi / mất `SECRETS_KEY`) hoặc provider / model đã mất → job `failed`, lớp `auth`, không retry,
  `error` = "Cấu hình AI lỗi: <không giải mã được key | model «…» không còn> của provider «tên» —
  admin nhập lại key ở Cài đặt › AI" (provider đã bị xoá: câu chung "nhà cung cấp AI của tác vụ đã bị xoá", không nêu
  id); job khác trong lô claim vẫn chạy.
- **Worker** (`worker/mtl_worker/llm_cache.py`, `handlers.llm_provider`): mỗi call LLM lấy provider theo slot — có
  `claim.llm.<slot>` → `provider_for_config` (cache tối đa 8 theo type / model / base_url / structured_output / reasoning /
  hash key; bị đẩy ra thì đóng client; đổi key → client mới); không có → provider env như cũ (`model_tier` cho hiệu đính).
  Payload có `llm.<slot>` mà claim thiếu cấu hình → `auth` (không âm thầm chạy bằng key env). Không slot DB và không key
  env của `--provider` → `auth` "chưa cấu hình provider AI (slot DB hoặc env worker)"; worker không nạp sớm provider env nếu
  thiếu key. Key cấp job được đăng ký vào `log_redact` suốt job và bỏ khi xong (key env đăng ký lúc khởi động giữ nguyên);
  `fail.message` cũng qua redact. `usage.model` = model của cấu hình thực dùng.
- **Idempotency**: `llm` chỉ vào khoá idempotency (không vào `input_rev` của prepare / translate → đổi model không làm
  trang đã xử lý thành lỗi thời). Hiệu đính chưa gán slot giữ khoá `{tier}` và `model_tier` như trước (tier đọc từ
  `proofread_tier` còn lưu trong jsonb cài đặt chung, mặc định `standard`; lưu pipeline trên UI gộp vào jsonb nên không mất
  key này); có slot → khoá `{llm}`, không `model_tier`.
- **Giá** (`llmPriceFor`): job có `payload.llm` → giá admin nhập của ref khớp `usage.model`; nhiều ref khác model
  (`page.ocr_region`) → max từng chiều; không có `llm` hoặc `usage.model` không khớp ref → bảng tĩnh `LLM_PRICES_PER_MTOK`.
- Worker 0.10.0 đọc được payload / claim cũ (trường mới optional); API `MIN_PIPELINE_VERSION = 0.10.0` trả 426 cho worker
  cũ vì schema của chúng (`additionalProperties: false`) từ chối `llm`.
- Rủi ro còn lại: token worker (Mac / Modal) bị lộ → kẻ giữ token claim được job và lấy mọi key đang gán slot, dùng ngoài
  ledger. Xem [deployment-guide](./deployment-guide.md) (checklist 0.10.0) về biện pháp.

## AI hiệu đính (`chapter.proofread`)

`POST /api/chapters/:id/proofread` (chương `review` / `done` / `partial_failed`, khác → 409
`chapter_not_translated`) → job cho mọi trang hiện, `ready`; payload chụp `TranslateSettings` của series + `model_tier` (chưa gán slot Hiệu đính) hoặc `llm.proofread` (đã gán).
Idempotency theo version page_state + glossary/settings rev + tier (hoặc `llm`). Job chỉ đọc: không đổi trạng thái chương/trang, không
khoá chương. Inputs lúc claim (`ProofreadInputs`): bản dịch hiện tại (gồm sửa tay) của vùng chữ có bản dịch, bỏ vùng
khớp chữ bỏ qua, + URL ảnh gốc. Worker (`mtl_pipeline/proofread.py`, prompt `prompts/proofread_page.md`) tải + thu nhỏ
ảnh mọi trang ngay sau claim (URL ký 10', chương dài gọi LLM lâu hơn), rồi mỗi trang 1 call (JSON khối + ảnh gốc thu
rộng 640, cắt khúc ≤ 1280px, tối đa 6, JPEG) + 8 dòng cuối trang trước làm ngữ cảnh; JSON sai → thử lại 1 lần, vẫn sai
(hoặc vượt guard token riêng 3328) → bỏ trang đó, giữ gợi ý trang khác (429 / provider lỗi vẫn ném để hàng đợi
backoff); lọc gợi ý id lạ / trùng id / rỗng / trùng bản hiện tại (so bỏ khác biệt khoảng trắng trong dòng, **giữ**
xuống dòng tay) / vượt 4000 ký tự; tối đa 2000 gợi ý. Kết quả được kiểm hợp đồng trước khi lấy usage (sai → fail kèm
usage, không mất token). Premium dùng
`MTL_GEMINI_PREMIUM_MODEL` (mặc định `gemini-2.5-pro`, thinking budget 128) / `MTL_ANTHROPIC_PREMIUM_MODEL`.
Trần call `2 × số trang`. Complete (khoá dòng chương → 2 lượt xong cùng lúc chạy tuần tự): lượt cũ xong sau một lượt
mới hơn đã thành công → bỏ qua; không thì lọc lại phía server (page ngoài job, vùng không còn, trùng bản cũ, trùng
vùng) rồi **thay toàn bộ** gợi ý cũ của chương trong `proofread_suggestions` (`old_text` = bản worker đã đọc). Job chỉ
đọc nên không tính là chương "đang bận" khi ingest lại / áp ngược chữ bỏ qua (`notReadOnlyJob`). Dispatcher Modal: khi
breaker LLM bật vẫn gọi container cho job không gọi LLM (cùng `llmJobSql` với claim); vượt ngân sách thì vẫn dừng mọi
dispatch (GPU Modal là chi phí thật).
`GET …/chapters/:id/proofread` = job gần nhất + gợi ý chưa bỏ; `PATCH /api/proofread-suggestions/:id
{dismissed}` = Bỏ / hoàn tác. Editor: xem [editor.md](./editor.md#ai-hiệu-đính).

## Xuất chương

`chapter.export` (`worker/mtl_worker/export.py`) không cần model ONNX hay LLM (chạy được với `--no-llm`). Output
`export` mang `headers` đã ký (content-type + tag lifecycle) — xem [export-and-batch-edit.md](./export-and-batch-edit.md).

## Hạn mức mỗi người (`USER_DAILY_USD`)

Tách khỏi kill-switch toàn cục (`GLOBAL_DAILY_USD`, `paused_budget`, `pnpm budget-resume` — không đổi): một tài khoản
dùng quá tay không làm cạn ngân sách chung. Code: `apps/api/src/billing/user-quota.ts`.

**Chỉnh trên UI**: admin đặt hạn mức mỗi người, ngân sách ngày toàn hệ thống và bật/tắt đăng ký ở Cài đặt › Hệ thống › Hạn
mức & đăng ký (`PUT /api/admin/settings/limits`, cột trong `system_settings`). Hạn mức hiệu lực = giá trị DB, trống (`null`)
thì rơi về env (`USER_DAILY_USD`, `GLOBAL_DAILY_USD`, `SIGNUP_ENABLED`); đọc mỗi lần đánh giá nên có hiệu lực ngay, không
restart `mtl-api` / `mtl-jobs`. Không có cách đặt "không giới hạn" khi env có ngưỡng; ngân sách tháng
(`GLOBAL_MONTHLY_USD`) chỉ đặt bằng env. Hạ hạn mức xuống dưới số đã chi hôm nay (người chi nhiều nhất / tổng toàn hệ
thống) cần `confirm: true` (UI hỏi, API 409 `confirm_required` kèm số liệu và số job bị ảnh hưởng): job LLM đang chờ của
người vượt bị `failed` `quota_exceeded`, nâng lại không tự chạy lại; ngân sách ngày thấp hơn tổng đã chi làm mọi job AI
`paused_budget` tới ngày UTC mới hoặc khi nâng ngưỡng.

- Cửa sổ = ngày **UTC** (cùng `billing/budget.ts`), tính **mọi** chi phí của người dùng trong `usage_ledger` (token LLM
  + GPU). `0` = chặn mọi job LLM; không đặt (cả DB lẫn env) = không giới hạn. Bật đăng ký (env hoặc UI) bắt buộc đủ cả 2 hạn mức.
- Endpoint tạo job LLM → 402 `{error:"quota_exceeded", spent_usd, limit_usd, resets_at}`: commit (khi OCR là LLM hoặc đích
  `translated` tường minh), dịch, `translate-prepared`, chạy lại trang lỗi, `ocr-region`, hiệu đính. Job không-LLM (xoá chữ
  lại, xuất…) vẫn tạo được. Hết hạn mức **giữa** chuỗi lô → đóng lượt, trang chưa tới lượt giữ `prepared` / `ready`.
- Job LLM đang `queued` của người vượt → `failed` (`error_class=internal`, thông báo bắt đầu bằng `quota_exceeded`) ngay
  lúc claim và ở tick runner `mtl-jobs` — không dùng `paused_budget` nên chương không kẹt `processing`. Job LLM đang
  chạy: heartbeat trả `stop: "cancel"` rồi job `failed` như trên.
- Token `modal` không bao giờ claim job nào của người vượt (kể cả không-LLM): job không-LLM của họ chỉ chạy trên worker
  Mac ($0) hoặc chờ sang ngày mới. Dispatcher bỏ qua các job đó khi quyết định bật Modal.
- `GET /api/me` trả `quota {spent_usd, limit_usd|null, resets_at}`; web hiện "Hạn mức AI hôm nay" trong menu tài khoản.
- Người dùng khác không bị ảnh hưởng.

## Mac ưu tiên, Modal bù (grace)

Dispatcher Modal (5s) tính job chờ cho cả hệ thống. Khi có token Mac thấy trong 60s qua (`last_seen`), chỉ job đã chờ
quá `MAC_GRACE_S` (60s) mới được tính để bật Modal — tránh bật GPU rồi để rỗi khi máy Mac sắp nhận. Không có Mac sống →
tính mọi job đủ điều kiện ngay.

## Production (Phase 7)

Kill-switch ngân sách ở claim/heartbeat, dispatcher Modal + bảng `dispatches`, `/healthz`, mode `drain`
(`mtl-worker --mode drain --dispatch-id …`), guardrail token ra ≤ 4096/call: xem
[deployment-guide.md](./deployment-guide.md).

## Còn hoãn

- Key ảnh ingest theo `ingest_rev` (không theo attempt): hai attempt cùng rev ghi đè nhau với nội dung tất định
  (cùng input + pipeline); DB chỉ nhận kết quả của attempt có lease hợp lệ.
