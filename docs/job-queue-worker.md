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
commit (Phase 4) → enqueueIngest → chapter.ingest
  complete [tx]: pages (uuid v5) + page_states rỗng + page.prepare × N, chapter → processing
page.prepare (song song): detect → mask → inpaint → OCR LLM (cuối cùng) → clean/{rev}, mask/{rev}, ocr_result
  complete [tx, khoá dòng chapter]: mọi page hết pending/preparing → chapter.translate cho page `prepared`
chapter.translate (tuần tự, lô ≤ 4 trang): dịch + typeset → ai_state theo luật AI-không-ghi-đè
  → page ready/failed; chapter → review | partial_failed
```

Gọi từ route (Phase 4–6): `inJobTx(tx => enqueueIngest | retranslate | retryFailedPages | enqueueReinpaint |
enqueueOcrRegion(tx, ws, …))` trong `apps/api/src/jobs/enqueue.ts`. Ghi page state từ người dùng: giữ khoá chương qua
`apps/api/src/lib/chapter-lock.ts` (`assertChapterLock` → 423).

## Giao thức worker

| Lệnh | Body chính | Ghi chú |
|---|---|---|
| `POST /claim` | `worker_id, capabilities, max ≤ 8, pipeline_version, dispatch_id` | 426 khi `< MIN_PIPELINE_VERSION`; 400 capability lạ/không được cấp. Token workspace → chỉ workspace đó, `worker_mode='mac'`; token nền tảng → `worker_mode='modal'`. Breaker bật → bỏ qua loại job cần LLM |
| `POST /jobs/:id/heartbeat` | `lease_token, attempt, progress, stage, usage` | gia hạn lease 120s; `stop: "cancel"` khi người dùng huỷ |
| `POST /jobs/:id/presign-outputs` | `names: ["clean"\|"mask"\|"page:<ord>"]` | URL PUT mới, cùng rev, TTL ≤ lease còn lại |
| `POST /jobs/:id/complete` | `result, usage, pipeline_version` | lặp với cùng lease → no-op |
| `POST /jobs/:id/fail` | `error_class, retry_after_s, message, usage, partial` | xem phân loại lỗi |

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

## Ingest strip

`worker/mtl_pipeline/ingest.py`: slice liên tiếp cùng width → strip ảo → detector → cắt ở hàng không giao box (lề 16px),
ưu tiên ~4500px trong cửa sổ 3000–6000; không có → kéo dài tới 12000px; vẫn không → hàng giao ít box nhất + `cut_flag`.
Không overlap; `source_map` ghi slice gốc ↔ đoạn y của page. `mode: "pages"` (manga): 1 file = 1 page. Ingest lại khi
đã có `state_origin='user'` → 409 `chapter_has_user_edits` (tạo chương mới).

## Xuất chương

`chapter.export` (`worker/mtl_worker/export.py`) không cần model ONNX hay LLM (chạy được với `--no-llm`). Output
`export` mang `headers` đã ký (content-type + tag lifecycle) — xem [export-and-batch-edit.md](./export-and-batch-edit.md).

## Còn hoãn

- Kiểm ngân sách ở claim, `dispatches`/Modal, `/healthz` đọc `runner_heartbeat`: Phase 7.
- Key ảnh ingest theo `ingest_rev` (không theo attempt): hai attempt cùng rev ghi đè nhau với nội dung tất định
  (cùng input + pipeline); DB chỉ nhận kết quả của attempt có lease hợp lệ.
