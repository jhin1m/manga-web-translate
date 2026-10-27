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

## Luồng 2 giai đoạn

```
Bước 1 "Xoá chữ + OCR" = commit (Phase 4) → enqueueIngest → chapter.ingest
  complete [tx]: pages (uuid v5) + page_states rỗng + page.prepare × N, chapter → processing
page.prepare (song song): detect → mask → inpaint → OCR LLM (cuối cùng) → clean/{rev}, mask/{rev}, ocr_result
  complete [tx, khoá dòng chapter]: mọi page hết pending/preparing → chapter → prepared (KHÔNG tự dịch)
Bước 2 "Dịch" = POST /chapters/:id/translate-prepared → translatePrepared [tx]: chapter.translate cho page `prepared`
  (cả chương prepared → rolling, có page lỗi bước 1 → neighbors)
chapter.translate (tuần tự, lô ≤ 4 trang): dịch + typeset → ai_state theo luật AI-không-ghi-đè
  → page ready/failed; chapter → review | partial_failed
```

Gọi từ route (Phase 4–6): `inJobTx(tx => enqueueIngest | translatePrepared | retranslate | retryFailedPages | enqueueReinpaint |
enqueueOcrRegion(tx, userId, …))` trong `apps/api/src/jobs/enqueue.ts`. Ghi page state từ người dùng: giữ khoá chương qua
`apps/api/src/lib/chapter-lock.ts` (`assertChapterLock` → 423).

## Giao thức worker

| Lệnh | Body chính | Ghi chú |
|---|---|---|
| `POST /claim` | `worker_id, capabilities, max ≤ 8, pipeline_version, dispatch_id` | 426 khi `< MIN_PIPELINE_VERSION`; 400 capability lạ/không được cấp. Token `mac` và `modal` cùng thấy job của mọi người dùng; token `modal` không nhận job nào của người đã vượt hạn mức, token `mac` không nhận job LLM của họ (xem [hạn mức](#hạn-mức-mỗi-người-user_daily_usd)). Breaker bật → bỏ qua loại job cần LLM |
| `POST /jobs/:id/heartbeat` | `lease_token, attempt, progress, stage, usage` | gia hạn lease 120s; `stop: "cancel"` khi người dùng huỷ, `stop: "paused_budget"` khi vượt ngân sách (job tốn tiền, không tính attempt) |
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

## Phân loại lỗi

| error_class | Tính attempt | Requeue |
|---|---|---|
| `provider` (5xx/timeout), `rate_limited` (429) | không | `max(Retry-After, 30s·2^min(n,5))`, tối đa 20 lần rồi `failed` |
| `schema` (JSON LLM sai sau 1 retry), `internal` | có (`max_attempts=3`) | `30s·2^n` |
| `invalid_input` (ảnh hỏng, vượt 16384px/60MP) | — | `failed` ngay |

Circuit breaker: ≥ 5 lỗi provider/rate_limited trong 5' → `runtime_flags.llm_paused.until = now+2'`. Lỗi provider ở
`page.prepare` gửi kèm `partial {clean_rev, mask_rev, regions}` → lần sau bỏ qua detect/inpaint. Lease hết hạn → reaper
trả `queued` (giữ attempts) hoặc `failed` khi hết lượt.

## Ảnh / trang bỏ qua, chữ bỏ qua

- `chapter.ingest` chỉ nhận ảnh gốc `source_files.skip IS NULL` (`'user'` = xoá tay, `'credit'` = khớp ảnh credit
  series đã học lúc tạo chương); commit kiểm lại bộ ảnh trong transaction, đổi giữa chừng → 409 `sources_changed`.
- Trang `pages.skipped`: không vào `chapter.translate` (Bước 2, retry, dịch lại), không làm `context_lines`, không
  tính trạng thái chương; `chapter.export` nhận `pages[].skipped` (pipeline 0.4.2).
- **Chữ bỏ qua** (`series.ignore_text`, Cài đặt series → "Chữ bỏ qua (watermark)"; ≤ 50 mục): lúc claim
  `chapter.translate`, item OCR khớp một mục được gửi `empty: true` → worker không dịch, không đặt box (ảnh đã sạch từ
  Bước 1). `ocr_result` trong DB không đổi → bỏ mục rồi dịch lại là dịch vùng đó bình thường. Dòng khớp cũng bị bỏ khỏi
  `context_lines` (cả `page.ocr_region`; vùng người dùng tự vẽ thì vẫn dịch). Đổi danh sách tăng `glossary_rev` (khoá
  job dịch), **không** `settings_rev` (nằm trong khoá prepare → thử lại trang lỗi sẽ chạy lại Bước 1). Quy tắc khớp
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
API gửi các trường này (hiện 0.5.1). Chiều ngược lại ổn: trang bước 1 cũ không có màu rơi về quy tắc cực tính. 0.5.1 (`inputs.fonts` của translate/export, xem mục Font tuỳ chỉnh)
nâng `MIN_PIPELINE_VERSION = 0.5.1`: schema input có `additionalProperties: false` nên worker cũ không đọc nổi job có
font, và worker cũ cũng không biết fallback font tuỳ chỉnh. API `PIPELINE_VERSION` (muối input_rev) không đổi. 0.6.0
(cài đặt pipeline trong payload, job `chapter.proofread`, xem mục dưới) nâng `MIN_PIPELINE_VERSION = 0.6.0` cùng lý do.

## Font tuỳ chỉnh (pipeline 0.5.1)

`inputs.fonts: [{id, url, sha256}]` (optional) có ở `chapter.translate` và `chapter.export`; liệt kê font `custom-*`
của **người dùng sở hữu job** mà job dùng, dựng lúc claim (`fontInputs` ở `jobs/claim-inputs.ts`, URL presigned GET: translate
10', export 15'):

- translate: `settings.font` + `settings.narration_font` của payload (snapshot lúc enqueue);
- export: `font_family` của mọi box ở trang được vẽ chữ + font mặc định hiện tại của series.

Id gói sẵn, của người dùng khác hoặc đã xoá (box cũ còn tham chiếu — xoá font chỉ bị chặn khi là mặc định series) bị
bỏ khỏi danh sách. Worker (`mtl_worker/job_fonts.py`) tải mỗi font vào cache `~/.cache/mtl-worker/fonts/<sha256>`
(`MTL_FONT_CACHE_DIR` để đổi), kiểm sha256 và đọc thử bằng fontTools, rồi đăng ký `id → file` trong suốt job
(`use_fonts` ở `mtl_pipeline/fonts.py`; file không đuôi, Pillow/fontTools đọc theo nội dung). `font_path` /
`metrics_for` tra registry trước `worker/fonts`; id không biết → font thoại mặc định (`DEFAULT_FONT`) + log, không
làm hỏng job. Font sai hash / không đọc được bị bỏ qua và fallback tương tự; lỗi mạng khi tải ném ra để job thử lại.
Worker chỉ tải URL có trong inputs.

## Cài đặt pipeline (pipeline 0.6.0)

Cài đặt chung → Pipeline (`PUT /api/settings/pipeline`; `GET /api/me` trả `settings.pipeline`) lưu theo từng người
dùng (jsonb, `{}` = mặc định). Hợp đồng: `packages/shared/src/pipeline-settings.ts`
(`PipelineSettings`, `resolvePipelineSettings` đọc từng key hợp lệ, key lỗi → mặc định). Worker không đọc DB — API
chụp vào payload lúc enqueue:

| Job | Field | Nội dung |
|---|---|---|
| `page.prepare` | `pipeline` | `detector`, `detection_threshold`, `ocr_engine` (đã chọn theo `source_lang` của series), `inpainter`, `mask_dilation` (`null` = tự động 2–6px), `inpaint_size` |
| `page.reinpaint` | `inpaint` | `inpainter`, `inpaint_size` |
| `page.ocr_region` | `ocr_engine`, `reading_order` | OCR vùng tự vẽ theo engine; dịch vẫn qua LLM |
| `chapter.proofread` | `model_tier` | `standard` / `premium` |

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
- Model mới là entry `optional` trong `worker/models.lock.json` (LaMa manga, MangaOCR encoder/decoder/vocab, PP-OCRv6
  det/rec, PP-OCRv5 rec tiếng Hàn): không kiểm lúc khởi động; lần đầu job cần → `ensure_model` tải đúng URL/revision,
  kiểm sha256 (lỗi → job `internal`, thử lại). `scripts/fetch_models.py` mặc định tải cả model optional.

## AI hiệu đính (`chapter.proofread`)

`POST /api/chapters/:id/proofread` (chương `review` / `done` / `partial_failed`, khác → 409
`chapter_not_translated`) → job cho mọi trang hiện, `ready`; payload chụp `TranslateSettings` của series + `model_tier`.
Idempotency theo version page_state + glossary/settings rev + tier. Job chỉ đọc: không đổi trạng thái chương/trang, không
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

- Cửa sổ = ngày **UTC** (cùng `billing/budget.ts`), tính **mọi** chi phí của người dùng trong `usage_ledger` (token LLM
  + GPU). `0` = chặn mọi job LLM; không đặt = không giới hạn. `SIGNUP_ENABLED=true` bắt buộc phải đặt biến này.
- Endpoint tạo job LLM → 402 `{error:"quota_exceeded", spent_usd, limit_usd, resets_at}`: commit (khi OCR là LLM),
  dịch, `translate-prepared`, chạy lại trang lỗi, `ocr-region`, hiệu đính. Job không-LLM (xoá chữ lại, xuất…) vẫn tạo được.
- Job LLM đang `queued` của người vượt → `failed` (`error_class=internal`, thông báo bắt đầu bằng `quota_exceeded`) ngay
  lúc claim và ở tick runner `mtl-jobs` — không dùng `paused_budget` nên chương không kẹt `processing`. Job LLM đang
  chạy: heartbeat trả `stop: "cancel"` rồi job `failed` như trên.
- Token `modal` không bao giờ claim job nào của người vượt (kể cả không-LLM): job không-LLM của họ chỉ chạy trên worker
  Mac ($0) hoặc chờ sang ngày mới. Dispatcher bỏ qua các job đó khi quyết định bật Modal.
- `GET /api/me` trả `quota {spent_usd, limit_usd|null, resets_at}`; web hiện "Hạn mức AI hôm nay" ở Cài đặt chung.
- Người dùng khác không bị ảnh hưởng.

## Mac ưu tiên, Modal bù (grace)

Dispatcher Modal (5s) tính job chờ cho cả hệ thống. Khi có token Mac thấy trong 60s qua (`last_seen`), chỉ job đã chờ
quá `MAC_GRACE_S` (60s) mới được tính để bật Modal — tránh bật GPU rồi để rỗi khi máy Mac sắp nhận. Không có Mac sống →
tính mọi job đủ điều kiện ngay.

## Production (Phase 7)

Kill-switch ngân sách ở claim/heartbeat, dispatcher Modal + bảng `dispatches`, `/healthz`, mode `drain`
(`mtl-worker --mode drain --dispatch-id …`), guardrail token ra ≤ 2000/call: xem
[deployment-guide.md](./deployment-guide.md).

## Còn hoãn

- Key ảnh ingest theo `ingest_rev` (không theo attempt): hai attempt cùng rev ghi đè nhau với nội dung tất định
  (cùng input + pipeline); DB chỉ nhận kết quả của attempt có lease hợp lệ.
