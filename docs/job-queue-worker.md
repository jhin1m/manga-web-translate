# Hàng đợi job + worker

Bảng `jobs` tự quản (`FOR UPDATE SKIP LOCKED`), API worker `/worker/v1/*` có fencing, worker Python pull-only
(`worker/mtl_worker`). Hợp đồng dữ liệu: `packages/shared/src/{job,worker-protocol,page-state}.ts` → JSON Schema ở
`packages/shared/json-schema/` (worker validate payload/inputs/result bằng các file này).

## Chạy local

```bash
pnpm infra:up && pnpm db:migrate
pnpm dev                      # API :8787
pnpm jobs                     # process riêng: reaper 30s + runtime_flags.runner_heartbeat

# token worker cho 1 workspace (file mode 600, token gốc không in ra terminal)
pnpm worker-token create --name mac-$(whoami) --workspace <ws-id> --out ~/.config/mtl/worker.token

cd worker && uv sync && uv run python scripts/fetch_models.py
export GEMINI_API_KEY=…                       # không commit
MTL_TOKEN_FILE=~/.config/mtl/worker.token uv run mtl-worker --api http://localhost:8787
```

- Không có key LLM: `--no-llm` (chỉ nhận `chapter.ingest`, `page.reinpaint`).
- Token qua Keychain thay file: `security add-generic-password -s mtl-worker -a default -w` (để trống
  `MTL_TOKEN_FILE`; đổi account bằng `MTL_KEYCHAIN_ACCOUNT`).
- Chạy nền: `worker/launchd/com.mtl.worker.plist` (sửa đường dẫn, `launchctl bootstrap gui/$(id -u) …`).
- Thu hồi: `pnpm worker-token revoke --id <token-id>`.
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
enqueueOcrRegion(tx, ws, …))` trong `apps/api/src/jobs/enqueue.ts`. Ghi page state từ người dùng: giữ khoá chương qua
`apps/api/src/lib/chapter-lock.ts` (`assertChapterLock` → 423).

## Giao thức worker

| Lệnh | Body chính | Ghi chú |
|---|---|---|
| `POST /claim` | `worker_id, capabilities, max ≤ 8, pipeline_version, dispatch_id` | 426 khi `< MIN_PIPELINE_VERSION`; 400 capability lạ/không được cấp. Token workspace → chỉ workspace đó, `worker_mode='mac'`; token nền tảng → `worker_mode='modal'`. Breaker bật → bỏ qua loại job cần LLM |
| `POST /jobs/:id/heartbeat` | `lease_token, attempt, progress, stage, usage` | gia hạn lease 120s; `stop: "cancel"` khi người dùng huỷ, `stop: "paused_budget"` khi vượt ngân sách (job tốn tiền, không tính attempt) |
| `POST /jobs/:id/presign-outputs` | `names: ["clean"\|"mask"\|"page:<ord>"]` | URL PUT mới, cùng rev, TTL ≤ lease còn lại |
| `POST /jobs/:id/complete` | `result, usage, pipeline_version` | lặp với cùng lease → no-op |
| `POST /jobs/:id/fail` | `error_class, retry_after_s, message, usage, partial` | xem phân loại lỗi |
| `POST /sessions/end` | `dispatch_id, lifetime_s, busy_s` | chỉ token nền tảng (Modal, mode drain) → ledger `gpu_idle_seconds`; gửi lại = no-op |

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
- **Chữ bỏ qua** (`series.ignore_text`, Cài đặt series → "Chữ bỏ qua (watermark)"; ≤ 50 mục, 3–100 ký tự tính trên
  dạng đã chuẩn hoá): lúc claim `chapter.translate`, item OCR chứa một mục (NFC, không phân biệt hoa/thường, bỏ
  `http(s)://`, gộp khoảng trắng — `packages/shared/src/ignore-text.ts`) được gửi `empty: true` → worker không dịch,
  không đặt box (ảnh đã sạch từ Bước 1). `ocr_result` trong DB không đổi → bỏ mục rồi dịch lại là dịch vùng đó bình
  thường. Dòng khớp cũng bị bỏ khỏi `context_lines` (cả `page.ocr_region`; vùng người dùng tự vẽ thì vẫn dịch). Đổi
  danh sách tăng `glossary_rev` (khoá job dịch), **không** `settings_rev` (nằm trong khoá prepare → thử lại trang lỗi
  sẽ chạy lại Bước 1). Chương đã dịch không bị sửa ngược: bảng văn bản ẩn dòng khớp, trừ khi box còn in chữ. URL bị
  OCR tách bằng dấu cách (`discord . gg`) hoặc watermark detector không bắt thì không khớp / còn trên ảnh.

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
nguồn ≠ `ko` chỉ ghi chú "chưa kiểm định kỹ", không chặn). Ngôn ngữ đi trong payload, prompt
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
ẩn) nâng `MIN_PIPELINE_VERSION = 0.4.2` cùng lý do.

## Xuất chương

`chapter.export` (`worker/mtl_worker/export.py`) không cần model ONNX hay LLM (chạy được với `--no-llm`). Output
`export` mang `headers` đã ký (content-type + tag lifecycle) — xem [export-and-batch-edit.md](./export-and-batch-edit.md).

## Production (Phase 7)

Kill-switch ngân sách ở claim/heartbeat, dispatcher Modal + bảng `dispatches`, `/healthz`, mode `drain`
(`mtl-worker --mode drain --dispatch-id …`), guardrail token ra ≤ 2000/call: xem
[deployment-guide.md](./deployment-guide.md).

## Còn hoãn

- Key ảnh ingest theo `ingest_rev` (không theo attempt): hai attempt cùng rev ghi đè nhau với nội dung tất định
  (cùng input + pipeline); DB chỉ nhận kết quả của attempt có lease hợp lệ.
