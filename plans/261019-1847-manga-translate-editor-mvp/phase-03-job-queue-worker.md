---
phase: 3
title: "Job queue + worker protocol (fencing, 2 giai đoạn) + worker local Mac"
status: pending
priority: P1
effort: "7d"
dependencies: [1, 2]
---
# Phase 3: Hàng đợi job, giao thức worker, worker local

## Overview
Bảng `jobs` + API lease qua HTTP **có fencing**; bọc `mtl_pipeline` (Phase 1) thành worker Python pull-only chạy trên Mac. Pipeline 2 giai đoạn: `page.prepare` song song theo trang → `chapter.translate` tuần tự theo chương (red team #5). Phân loại lỗi provider, circuit breaker, ingest cắt strip theo detector. Reaper chạy trong process riêng (systemd unit riêng ở Phase 7). Cùng giao thức dùng cho Modal ở Phase 7.

## Requirements
- Worker chỉ gọi ra ngoài (HTTPS) → chạy sau NAT. Auth Bearer `worker_tokens` (lưu hash). Token đọc từ **file (`MTL_TOKEN_FILE`, quyền 600) hoặc macOS Keychain**, không qua argv (red team, gộp kèm).
- **Fencing (red team #2):** `lease_owner` = `worker_tokens.id` lấy từ token (không từ body); claim cấp `lease_token` ngẫu nhiên + `attempt`; heartbeat/complete/fail/presign-outputs bắt buộc `{lease_token, attempt}` — sai hoặc lease đã hết → **409**, không ghi gì; worker nhận 409 phải bỏ job.
- Lease 120s, heartbeat 20s. Presigned PUT output TTL ≤ thời gian lease còn lại; hết hạn → gọi `presign-outputs` (fenced) để lấy lại.
- Output ghi vào key **bất biến có revision** (rev cấp lúc claim từ `pages.next_rev`); DB chỉ trỏ `clean_rev`/`mask_rev` tới rev của attempt thắng khi complete hợp lệ.
- Claim từ chối worker có `pipeline_version` < `MIN_PIPELINE_VERSION` (426) (red team #2).
- **Chi phí tính ở server (red team #2, #14):** worker gửi số đếm thô (`llm_in`, `llm_out`, `model`, `gpu_s`) trên heartbeat (delta), complete **và fail**; server clamp (`llm_out` ≤ `max_output_tokens`·số call, `gpu_s` ≤ thời gian thực từ claim), nhân bảng giá `apps/api/src/billing/prices.ts`, ghi `usage_ledger` (unique `(job_id, attempt, seq, kind)` → không đếm đôi).
- **Idempotency (red team #3):** `idempotency_key` theo `input_rev` (định nghĩa ở Phase 2); unique chỉ trên job active → enqueue trùng khi job cũ `failed` tạo job mới (nút chạy lại có tác dụng); `complete` lặp với cùng lease → no-op.
- **Phân loại lỗi (red team #7):** `error_class` ∈ `provider` (5xx/timeout LLM), `rate_limited` (429), `schema` (JSON LLM sai sau 1 lần retry trong worker), `invalid_input` (ảnh hỏng/vượt trần pixel), `internal`.
  - `provider`/`rate_limited`: **không tính attempt**; requeue `run_after = max(Retry-After, 30s·2^min(n,5))`; `provider_retries` ≤ 20 rồi mới `failed`.
  - `schema`/`internal`: tính attempt, `max_attempts`=3, backoff 30s·2^n. `invalid_input`: `failed` ngay.
  - **Circuit breaker:** ≥ 5 lỗi `provider` trong 5 phút → `runtime_flags.llm_paused_until = now+2'` → claim bỏ qua loại job cần LLM (`page.prepare`, `chapter.translate`, `page.ocr_region`).
  - Artifact trước LLM được giữ: `page.prepare` gọi LLM cuối cùng; `fail` kèm `partial {clean_rev, mask_rev, regions}` (fenced) → API lưu, lần chạy sau bỏ qua detect/inpaint.
- **Chế độ worker theo workspace (red team #9):** `workspace_settings.worker_mode` = `mac` | `modal`; claim chỉ trả job khớp chế độ, không quy tắc ưu tiên chéo; không có handler RunPod.
- Mọi ghi `page_states` từ job tuân theo luật AI-không-ghi-đè (red team #1, dưới). Không có `assertQuota` ở MVP; ngân sách toàn cục kiểm ở claim (Phase 7) (red team #8, #14).
- Worker mở ảnh qua `images.py`: header trước, trần 16384px/cạnh, ~60MP/file (red team #12).
- Worker kiểm `models.lock.json` khi khởi động, `HF_HUB_OFFLINE=1` (red team #15).

## Architecture
### Loại job (red team #3, #4, #5)
| type | Input | Output / ghi DB khi complete (fenced, 1 transaction) |
|---|---|---|
| `chapter.ingest` | source_files của chapter | Worker ghép slice liên tiếp (cùng width) thành strip ảo, **chạy detector trên strip ảo**, chọn hàng cắt **không giao box nào** (lề 16px), gần chiều cao mục tiêu 3000–6000px; không có hàng an toàn → **kéo dài page tới trần cứng 12000px**; vượt trần vẫn không có → cắt ở hàng giao ít box nhất + `cut_flag`. **Không overlap.** Manga thường: 1 file = 1 page. API: tạo `pages` (id tất định uuid v5(chapter, ingest_rev, ord)) + `page_states` rỗng + enqueue `page.prepare` từng page, chapter → `processing` |
| `page.prepare` (giai đoạn 1, song song) | original, `source_lang`, `pipeline_version` | detect → textmask (cực tính) → inpaint → OCR LLM (chỉ chép). Ghi `clean/{rev}`, `mask/{rev}`, `pages.ocr_result`, `prepare_input_rev`, page → `prepared`. Nếu mọi page của chapter đã terminal → enqueue `chapter.translate` cho các page `prepared` |
| `chapter.translate` (giai đoạn 2, tuần tự) | `ocr_result` các page theo `ord`, glossary snapshot + `glossary_rev`, pronoun_rules, settings + `settings_rev`, `page_ids` (cả chương hoặc tập con), ngữ cảnh lân cận | Gộp lô K trang/call, ngữ cảnh cuộn, typeset từng page → mỗi page: ghi `ai_state`, `ai_rev+1` theo luật dưới; page → `ready` / `failed`; chapter → `review` hoặc `partial_failed` |
| `page.reinpaint` | `base_clean_rev`, `user_mask_key` + `offset` (Phase 5) | `clean/{rev}` mới; `pages.clean_rev` = rev mới (không chạm `page_states`) |
| `page.ocr_region` | page + bbox + ngữ cảnh lân cận | Region (OCR + dịch 1 vùng) trong `jobs.result`; editor tự chèn vào state (job không ghi `page_states`) |
| `chapter.export` | Phase 6 | Phase 6 |

`capabilities` của worker phải là tập con `JobType`; claim với capability lạ → 400; test: mọi `JobType` có handler trong worker (red team #3).

**Chạy lại (red team #5):** chạy lại chương = `chapter.translate` toàn chương (dùng lại `ocr_result` nếu `prepare_input_rev` không đổi); chạy lại 1 trang = `chapter.translate` với `page_ids=[p]` + ngữ cảnh `source` của trang n−1, n+1 và bản dịch trang n−1 (`context_used=neighbors`); "chạy lại trang lỗi" cấp chương = `page.prepare` cho page `failed` ở giai đoạn 1 rồi `chapter.translate` cho chúng.

### Luật ghi `page_states` từ AI (red team #1, #6)
```
khi chapter.translate complete cho page p:
  history ← (version, state) hiện tại  ;  ai_state ← mới ; ai_rev += 1 ; version += 1
  nếu state_origin = 'ai' (chưa ai sửa) VÀ chapter không bị khoá:
      state ← ai_state
  ngược lại:
      ai_update_available ← true   (editor hiện "có kết quả AI mới", merge theo vùng ở Phase 5)
version không bao giờ reset; page_state_history giữ 50 bản.
```
Mọi người ghi `page_states` (PUT editor, find/replace, áp glossary) phải giữ khoá chương — ép ở server qua `apps/api/src/lib/chapter-lock.ts` (Phase 3 tạo, Phase 4–6 dùng) (red team #6).

### Worker API (`apps/api/src/routes/worker.ts`)
```
POST /worker/v1/claim
  req  {"worker_id":"mac-ducanh","capabilities":["page.prepare","chapter.translate","page.reinpaint"],"max":1,
        "pipeline_version":"0.3.0","dispatch_id":null}
  res  {"jobs":[{"id":"…","type":"page.prepare","attempt":2,"lease_token":"…","lease_expires_at":"…",
         "payload":{…JobPayload},"inputs":{"original":"<presigned GET>"},
         "outputs":{"clean":{"rev":7,"put":"<presigned PUT, TTL ≤ lease>"},"mask":{"rev":7,"put":"…"}}}]}
  SQL: UPDATE jobs SET status='running', lease_owner=$token_id, lease_token=$rand, lease_expires_at=now()+120s,
              attempts=attempts+1
       WHERE id IN (SELECT j.id FROM jobs j JOIN workspace_settings s USING (workspace_id)
                    WHERE j.status='queued' AND j.run_after<=now() AND j.type=ANY($caps)
                      AND ($token_ws IS NULL OR j.workspace_id=$token_ws)
                      AND s.worker_mode = $mode            -- token workspace → 'mac', token platform → 'modal' (red team #9)
                      AND NOT (j.type=ANY($llm_types) AND $llm_paused)
                    ORDER BY j.priority, j.created_at FOR UPDATE SKIP LOCKED LIMIT $max) RETURNING *
POST /worker/v1/jobs/:id/heartbeat       {"lease_token","attempt","progress":0.6,"stage":"inpaint","usage":{…delta}}
                                         → {"lease_expires_at":"…","stop":null|"cancel"|"paused_budget"}
POST /worker/v1/jobs/:id/presign-outputs {"lease_token","attempt","names":["clean"]} → URL mới, cùng rev
POST /worker/v1/jobs/:id/complete        {"lease_token","attempt","result":{…JobResult},"usage":{…},"pipeline_version"}
POST /worker/v1/jobs/:id/fail            {"lease_token","attempt","error_class":"rate_limited","retry_after_s":30,
                                          "message":"…","usage":{…},"partial":{…}|null}
```
Reaper (`apps/api/src/jobs/reaper.ts`, chạy trong `apps/api/src/jobs/runner.ts` — process riêng, không trong API): 30s/lần, lease hết hạn → `queued` (attempts giữ, lease_token xoá) hoặc `failed` khi hết attempts; cập nhật trạng thái chapter.

Progress tới UI: **polling** `GET /api/w/:ws/chapters/:id/progress` (TanStack Query 2–3s); không SSE (red team #13).

Worker (`worker/mtl_worker/`): vòng lặp `claim → tải input → chạy pipeline (heartbeat thread riêng gửi stage + usage delta) → PUT output → complete`; 409 → bỏ job, không retry; `stop` → dừng sạch; SIGTERM → hoàn tất job đang chạy hoặc `fail(internal)`; model nạp 1 lần. LLM key platform lấy từ env/secret của worker (BYOK qua proxy API → Phase 8).

## Related Code Files
Create:
- `apps/api/src/jobs/{queue.ts,reaper.ts,runner.ts,enqueue.ts,idempotency.ts,errors.ts,breaker.ts,page-state-writer.ts}`
- `apps/api/src/lib/chapter-lock.ts`, `apps/api/src/billing/{prices.ts,ledger.ts}`
- `apps/api/src/routes/{worker.ts,jobs.ts,progress.ts}`
- `packages/db/src/schema/runtime-flags.ts` + migration (`runtime_flags` key PK, value jsonb, until)
- `apps/api/test/{queue.test.ts,worker-protocol.test.ts,worker-fencing.test.ts,error-classes.test.ts,ai-write-rules.test.ts}`
- `worker/mtl_worker/{__init__,main,client,runner,ingest,token}.py`
- `worker/mtl_pipeline/ingest.py` (strip ảo + chọn hàng cắt theo detector)
- `worker/tests/{test_contract_schema.py,test_ingest_cuts.py,test_handlers_cover_job_types.py}`
- `scripts/worker-token.ts` (tạo token, ghi ra file 600)
Modify:
- `worker/mtl_pipeline/schema.py` (validate theo JSON Schema từ `packages/shared`)
- `packages/shared/src/job.ts`

## Implementation Steps
1. `queue.ts`: enqueue (partial-unique idempotency), claim SKIP LOCKED (lọc worker_mode, breaker, pipeline_version), heartbeat/complete/fail **fenced**, cancel; `errors.ts` phân loại + backoff.
2. `ledger.ts` + `prices.ts`: clamp + tính tiền server-side; usage từ heartbeat/complete/fail.
3. `runner.ts` + reaper; test kill worker giữa chừng → job quay lại sau lease.
4. Route worker + auth token (sha256, so sánh constant-time), giới hạn `workspace_id` của token; test âm cho heartbeat/complete/fail/presign-outputs: lease_token sai, attempt cũ, token khác → 409, DB không đổi.
5. `chapter.ingest` + chọn hàng cắt theo detector; complete tạo pages + enqueue `page.prepare` cùng transaction; chặn ingest lại khi có page `state_origin='user'` → 409 "tạo chương mới" (red team #4).
6. `page.prepare` (thứ tự LLM cuối, `partial` khi lỗi provider); kích hoạt `chapter.translate` khi mọi page terminal.
7. `chapter.translate` + `page-state-writer.ts` (luật AI-không-ghi-đè, history).
8. `page.reinpaint`, `page.ocr_region`.
9. Worker CLI: `uv run mtl-worker --api https://…` (token từ `MTL_TOKEN_FILE` hoặc Keychain); launchd plist mẫu.
10. Route progress (polling) + test contract: worker gửi result, API validate zod; worker validate payload bằng JSON Schema.

## Success Criteria
- [ ] 1 chương KO 40 slice: commit → ingest → giai đoạn 1 song song → giai đoạn 2 → `review`, 0 job kẹt; tiến độ thấy qua polling.
- [ ] Kill -9 worker giữa job → job chạy lại thành công sau ≤ 150s; worker cũ sống lại gửi complete → 409, không ghi page/ledger.
- [ ] Gửi `complete` 2 lần cùng lease → 1 bộ dòng ledger; enqueue trùng khi job active → cùng job id; khi job cũ `failed` → job mới.
- [ ] 2 worker song song không bao giờ claim cùng 1 job (test 1000 job).
- [ ] Giả lập 429 liên tục: attempts không tăng, job requeue theo Retry-After, breaker bật sau 5 lỗi, chapter cuối cùng `review`/`partial_failed` chứ không kẹt `processing`.
- [ ] Ingest strip 40 slice golden KO → không hàng cắt nào giao box; ingest lại khi đã có chỉnh sửa → 409.
- [ ] Chạy lại `chapter.translate` trên page đã sửa tay → `state` giữ nguyên, `ai_update_available=true`, version tăng.
- [ ] Token workspace A không claim được job workspace B; token Mac không claim job của workspace `worker_mode='modal'`.
- [ ] Ảnh 20000×20000 → `invalid_input`, worker không OOM.

## Risk Assessment
| Rủi ro | K×A | Giảm thiểu |
|---|---|---|
| Bóng thoại bị cắt ngang khi ingest | TB × Cao | Detector trên strip ảo, cắt ở hàng không giao box, kéo dài tới trần, `cut_flag` (red team #4) |
| Worker zombie ghi đè kết quả mới | TB × Cao | lease_token + attempt + key có revision (red team #2) |
| Job treo do worker chết | TB × TB | Lease + reaper process riêng |
| LLM sập/429 đốt attempt và tiền | TB × Cao | Phân loại lỗi, Retry-After, breaker, giữ artifact trước LLM (red team #7) |
| Chạy lại AI xoá chỉnh sửa tay | TB × Cao | Luật AI-không-ghi-đè + history (red team #1) |
| Giai đoạn 2 dài, lease hết giữa chừng | TB × TB | Heartbeat 20s; lô ≤ 4 trang/call; lỗi giữa chừng chỉ tốn lại phần text (rẻ) |
| Worker báo usage gian/sai | Thấp × TB | Server clamp + bảng giá server |
| Worker local lộ token | Thấp × TB | Token workspace-scoped, đọc từ file/Keychain, revoke được, capability tối thiểu |

Rollback: `jobs` độc lập; có thể chuyển sang pg-boss bằng cách thay `queue.ts` (giữ API worker). Migration additive.
