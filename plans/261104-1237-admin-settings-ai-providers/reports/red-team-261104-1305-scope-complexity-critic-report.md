# Red team: Scope & Complexity Critic (Contract Verifier)

Plan: `plans/261104-1237-admin-settings-ai-providers/` · Ngày: 2026-11-04 · Chỉ phê phán độ phức tạp thừa trong cách
thực hiện; KHÔNG đề xuất cắt D1–D8 (quyết định của user, brainstorm:18-25).

## Finding 1: D9–D15 và phần mở rộng D3 bị dán nhãn "quyết định đã chốt (không đảo)" dù user không quyết
- **Severity:** High
- **Location:** plan.md, section "Quyết định đã chốt (không đảo)" (plan.md:36, :42-48)
- **Flaw:** Brainstorm chỉ có D1–D8 (`plans/reports/brainstorm-261104-1237-admin-settings-ai-providers-report.md:18-25`).
  D3 của user = "AES-256-GCM, master key env `SECRETS_KEY`, nhập từ UI" (brainstorm:20). Plan.md:36 nhồi thêm keyId,
  `SECRETS_KEY_PREV`, script `rotate-secrets` vào D3, rồi thêm D9–D15 (hook signup, khoá user, 7 nhánh hành vi OpenAI,
  SSRF, ma trận probe, env fallback, bump) vào cùng bảng "không đảo". Research tự ghi SSRF là "Quyết định sản phẩm"
  (`reports/research-261104-1237-openai-compatible-provider-report.md:254`) — tức chưa ai chốt.
- **Failure scenario:** Reviewer/cook sau tuân rule "không đảo quyết định của user" → mọi phần over-engineering do agent
  tự chọn (Finding 2, 3, 6) được miễn kiểm; user chưa từng thấy hay đồng ý chi phí của chúng.
- **Evidence:** brainstorm:18-25 (chỉ D1–D8), brainstorm:20 (D3 gốc), research-openai:254, plan.md:36,42-48.
- **Suggested fix:** Tách bảng: "Quyết định user (D1–D8, nguyên văn brainstorm)" và "Lựa chọn kỹ thuật (đảo được)".
  D3 về đúng phạm vi user; keyring/rotation/SSRF/probe/D11 chuyển xuống mục kỹ thuật.

## Finding 2: Máy xoay master key (keyring + PREV + PREV_ID + script) cho vài dòng provider
- **Severity:** High
- **Location:** Phase 2, sections "Secrets" (phase-02:57-62) và "Script xoay key" (phase-02:95-98); Success Criteria
  phase-02:191
- **Flaw:** Thêm 4 biến env (`SECRETS_KEY_ID`, `SECRETS_KEY_PREV`, `SECRETS_KEY_PREV_ID`, superRefine đi đôi), keyring
  `Map<keyId,Buffer>`, `secretKeyId()`, `scripts/rotate-secrets.ts` + script root, quy trình 3 bước trong docs, test
  idempotent. Số dòng cần xoay = số provider (4 loại, thực tế 1–4 dòng). Plan tự ghi đường phục hồi khi mất key là
  "nhập lại key" (phase-02 Risk "Mất SECRETS_KEY") — đó cũng chính là cách xoay key không cần code: đổi `SECRETS_KEY`,
  `verifyProviderSecrets` báo provider nào hỏng, admin dán lại key trên UI.
- **Failure scenario:** ~1 file script + 4 env + 6+ ca test + docs vận hành phải duy trì cho thao tác có thể không bao giờ
  xảy ra trong MVP; mỗi env mới là thêm 1 chỗ cấu hình sai khi deploy (superRefine chặn khởi động API).
- **Evidence:** package.json:18-25 (đã có 3 script `pnpm --filter @mtl/api exec tsx ../../scripts/*` — thêm cái thứ 4);
  apps/api/src/env.ts:10-73 (chưa có biến secret nào ngoài `BETTER_AUTH_SECRET`); research-better-auth:135-177 (nguồn
  của keyring, chỉ là đề xuất research).
- **Suggested fix:** Giữ AES-GCM + AAD + 1 byte version trong blob (rẻ, mở đường sau). Bỏ `SECRETS_KEY_ID`/`PREV`/
  `PREV_ID`, bỏ script; docs xoay = "đổi key → nhập lại key provider trên UI". Thêm khi có >10 provider hoặc yêu cầu
  compliance.

## Finding 3: HTTP client SSRF tự viết cho input chỉ admin nhập, trong khi worker gọi cùng base_url không kiểm
- **Severity:** High
- **Location:** Phase 2, section "Base URL + SSRF" (phase-02:63-71); plan.md "Câu hỏi còn mở" 6–7
- **Flaw:** `safe-request.ts` tái hiện HTTP client bằng `node:https.request` + `lookup` kiểm IP lúc connect (chống DNS
  rebinding) + `net.BlockList` 11 dải + cap 64KB + không redirect + cờ `AI_ALLOW_PRIVATE_BASE_URL`. Kẻ tấn công duy nhất
  ghi được `base_url` là admin (ADMIN_EMAILS). Đường gọi thật (mọi job) chạy ở worker qua SDK `openai` tới cùng
  `base_url` mà **không** kiểm gì (câu hỏi mở 7) — worker Mac nằm trong LAN nhà, đúng chỗ SSRF có giá trị. Phòng thủ
  dồn vào nút "Kiểm tra" (ít quan trọng nhất), bỏ trống đường chính.
- **Failure scenario:** Tốn ~2 file + 2 file test + 1 env + e2e cần server giả và bật cờ; vẫn không chặn được SSRF thật
  nếu admin nhập URL nội bộ (worker gọi). Rebinding check còn làm hỏng các endpoint hợp lệ sau CDN đổi IP.
- **Evidence:** apps/api/src/lib/alert.ts:14 và apps/api/src/jobs/dispatcher.ts:59 (outbound hiện tại dùng `fetch`, không
  có client riêng); research-openai:254 (chặn hay cho private = quyết định sản phẩm, chưa chốt).
- **Suggested fix:** Probe bằng `fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) })`; validate lúc
  lưu = `https:` + không userinfo (+ tuỳ chọn chặn literal IP private). Bỏ `safeRequest`/rebinding/BlockList và cờ env,
  hoặc nếu giữ thì phải áp cùng chính sách ở worker — không nửa vời.

## Finding 4: Contract Verifier — thiếu caller `_Deps` giả trong test worker khi handlers đổi sang `provider_for_slot`
- **Severity:** High
- **Location:** Phase 3, section "Worker" (phase-03:127-137) và "Related Code Files" (phase-03:163)
- **Flaw:** Plan đổi `handle_translate` (`handlers.py:270,279`), `run_ocr` (`:81`), `handle_ocr_region` (`:423`),
  `handle_proofread` (`:452`) sang helper `_slot(ctx, deps, slot)` → `deps.provider_for_slot`, và thêm method vào
  `Deps` Protocol (`runner.py:66-77`). Danh sách sửa chỉ có `test_worker_runner.py:172` + `test_proofread.py:173,211`.
- **Caller list `deps.provider*` (đầy đủ, grep):** handlers.py:81, :270, :279, :423, :452; main.py:58 (định nghĩa),
  :135 (eager-load); runner.py:75 (Protocol). Fake Deps trong test: test_worker_runner.py:172, test_proofread.py:170/173,
  :210/211, **test_translate_carry.py:34 (`_Deps` chỉ có `.provider`) — THIẾU**, dùng ở test_translate_carry.py:107,
  :119, :131, :140, :150, :178, :179, :193, :197.
- **Failure scenario:** `_slot` gọi `deps.provider_for_slot` → `AttributeError` ở ≥9 ca `handle_translate` → gate
  `uv run pytest` đỏ ngay bước 7; sửa vội dễ thành fake rỗng làm mất kiểm tra carry/style.
- **Evidence:** worker/tests/test_translate_carry.py:34-37, worker/mtl_worker/handlers.py:81,270,279,423,452,
  worker/mtl_worker/runner.py:66-77.
- **Suggested fix:** Không thêm method mới vào `Deps`; dùng hàm tự do `provider_for(ctx, deps, slot)` = `cfg` có →
  cache module-level; không → `deps.provider` / `deps.provider_for(tier)` như cũ. Fake hiện có không phải sửa. Nếu giữ
  thiết kế, thêm `test_translate_carry.py:34` vào Related Code Files.

## Finding 5: Phase 3 quá to để review/hoàn tác, ước lượng 2d phi thực tế
- **Severity:** High
- **Location:** Phase 3 toàn bộ (265 dòng, ~39 đường dẫn file trong "Related Code Files"); plan.md bảng Phases (2d)
- **Flaw:** Một phase gộp: đổi hợp đồng shared + emit json-schema, enqueue ×4 + idempotency, giải mã ở claim, billing
  refs, bump `MIN_PIPELINE_VERSION`, provider class mới với ~15 nhánh hành vi (D11), cache LRU + `close()`, scrub log,
  handlers ×4, bỏ tier web, docs, e2e, smoke tay với key thật 3 provider. `OpenAIProvider` là code worker thuần, không
  phụ thuộc hợp đồng — `make_provider("openai")` env là đủ để ship/đo trước.
- **Failure scenario:** 1 PR lớn đụng shared/api/worker/web cùng lúc với bump bắt buộc; lỗi ở D11 (vd. reasoning_effort)
  chặn cả phần key-qua-claim; rollback phải hạ cả hai (checklist deploy bước 5 đã phức tạp).
- **Evidence:** worker/mtl_pipeline/providers/__init__.py:13-37 (`make_provider` theo tên — thêm nhánh `openai` không cần
  hợp đồng mới); packages/shared/src/worker-protocol.ts:182-191 (`ClaimedJob` là chỗ bump duy nhất).
- **Suggested fix:** Tách 3a "`OpenAIProvider` + `make_provider('openai')` env" (không bump, pytest với client giả) và
  3b "slot/key qua claim + bump 0.10.0". Ước lượng lại 3a 1d, 3b 1.5–2d.

## Finding 6: Structured output có 3 cơ chế chồng nhau + trường hợp đồng mà worker không dùng
- **Severity:** Medium
- **Location:** Phase 2 "Requirements" (phase-02:22) + "DB" (phase-02:50); Phase 3 "Hợp đồng" (phase-03:43) + "Worker"
  (phase-03:107-120)
- **Flaw:** (a) cột `structured_output` + select "Kiểu JSON" trên UI, (b) worker tự hạ `json_object` khi 400 và nhớ trên
  instance, (c) official luôn `json_schema`. (a) thừa khi đã có (b). Mặc định còn mâu thuẫn: UI "json_object mặc định"
  (phase-02:22) vs DB `default 'json_schema'` (phase-02:50). `LlmConfig` gửi `structured_output` + `vision` cho mọi type,
  nhưng Anthropic/Gemini không nhận tham số này và không bước worker nào đọc `vision`; `structured_output` còn nằm trong
  khoá cache. Thêm: `reasoning_effort` theo tiền tố hardcode `gpt-5/o1/o3/o4` (phase-03:111-112) trái khuyến nghị
  research "không hardcode bảng trong code lõi" (research-openai:94).
- **Failure scenario:** Admin chọn sai kiểu → vẫn bị (b) sửa ngầm → UI nói một đằng, worker làm một nẻo; model mới
  ngoài danh sách tiền tố mặc định reasoning medium → `finish_reason=length` → job fail `schema`.
- **Evidence:** worker/mtl_pipeline/providers/anthropic.py:44 và gemini.py:55 (chỉ nhận `model, client`);
  worker/mtl_worker/handlers.py:81,270,423,452 (không đọc vision); research-openai:94.
- **Suggested fix:** Bỏ cột + select; compatible thử `json_schema` → hạ `json_object` 1 lần (đã có). Bỏ `vision`,
  `structured_output` khỏi `LlmConfig`. `reasoning_effort` = không gửi trừ khi model bắt đầu `gpt-5` (một quy tắc), hoặc
  để admin nhập ở model nếu thật cần.

## Finding 7: Billing đổi 2 lần; bước phase 2 là code chết và tính sai job env
- **Severity:** Medium
- **Location:** Phase 2 "Billing" (phase-02:89-93); Phase 3 `llmPriceOf(t, model, refs?)` (phase-03:97)
- **Flaw:** Phase 2 tự nói job vẫn chạy env (Overview), nhưng thêm `llmPriceOf` tra `ai_models` theo **chuỗi** model
  (max giữa provider trùng chuỗi) và fallback `max(bảng ∪ mọi ai_models)`. Phase 3 lại chồng thêm ưu tiên refs. Kết quả
  3 tầng + 1 query async mỗi heartbeat.
- **Failure scenario:** Admin khai `gemini-2.5-flash` cho provider DB giá khác → job **env** (worker `--provider
  gemini`) bị tính theo giá DB của provider khác. Admin khai 1 model đắt → giá fallback model lạ của toàn hệ thống nhảy
  theo.
- **Evidence:** apps/api/src/billing/ledger.ts:70 (caller duy nhất `llmPrice`), apps/api/src/jobs/queue.ts:214 (caller
  duy nhất `recordUsage`), apps/api/src/billing/prices.ts:16-24 (fallback hiện tại theo bảng tĩnh).
- **Suggested fix:** Không đụng billing ở phase 2. Phase 3: `payload.llm` có → giá của ref khớp `usage.model` theo
  `(provider_id, model)` (ocr_region: max của 2 ref); không → `llmPrice()` bảng tĩnh y nguyên. Bỏ tra theo chuỗi xuyên
  provider và `bảng ∪ DB`.

## Finding 8: `ai_tasks` jsonb không FK (hệ quả của "tạo đủ cột ở 0021") kéo theo code toàn vẹn tự viết
- **Severity:** Medium
- **Location:** Phase 1 "Dữ liệu" (phase-01:51, :57 "Lý do tạo đủ cột ngay"); Phase 2 "DB" (phase-02:55) + Requirements
  409 `in_use`
- **Flaw:** `ai_tasks` tạo ở 0021, trước khi có `ai_models` (0022) → không thể FK → plan phải viết tay: 409 khi xoá
  provider/model đang gán, 409 khi đổi `vision`, kiểm id tồn tại khi PUT, test cho từng ca; `ai_models` lại `ON DELETE
  CASCADE` từ provider nên chỉ chặn bằng app (không khoá → xoá và gán song song lọt).
- **Failure scenario:** Admin xoá provider ở tab này trong lúc tab khác PUT ai-tasks → slot trỏ id không tồn tại →
  `slotRefs` trả rỗng hoặc claim fail `invalid_input` ở mọi job.
- **Evidence:** packages/db/src/schema/app.ts:54,60,122 (repo dùng FK + `onDelete` làm mặc định cho toàn vẹn).
- **Suggested fix:** Bỏ `ai_tasks` khỏi 0021; ở 0022 thêm 3 cột `ocr_model_id / translate_model_id / proofread_model_id
  uuid REFERENCES ai_models ON DELETE RESTRICT` vào `system_settings`. Xoá model/provider đang gán → lỗi FK → 409; bỏ
  code kiểm tay (giữ chỉ check vision).

## Finding 9: Font hệ thống ép đổi hợp đồng worker (`sys-*`) chỉ để đổi tiền tố
- **Severity:** Medium
- **Location:** Phase 6 Overview (phase-06:16-17), Architecture `SYSTEM_FONT_PREFIX`; plan.md:56 (tự quyết gộp regex vào
  0.10.0); phase-03:17,101
- **Flaw:** `font_id` đã unique toàn bảng, không theo user. Dùng lại dạng `custom-<8hex>` cho font hệ thống thì regex
  worker, json-schema, `isCustomFontId`, `resolveCustomFonts` không đổi; phase 6 hết phụ thuộc phase 3; không cần
  `SYSTEM_FONT_PREFIX`/`newSystemFontId`/`isSystemFontId`.
- **Failure scenario:** Phase 3 trễ/rollback → phase 6 bị chặn; worker 0.10.0 bắt buộc chỉ vì chuỗi `sys-`. Thêm 1 điểm
  lệch giữa `lib/fonts.ts:45` (lọc `isCustomFontId`) và tiền tố mới — quên sửa → font hệ thống bị loại khỏi
  `inputs.fonts` âm thầm.
- **Evidence:** packages/db/src/schema/app.ts:194 (`fontId ... .unique()`), packages/shared/src/worker-protocol.ts:112,
  packages/shared/json-schema/inputs-chapter-export.schema.json:493, inputs-chapter-translate.schema.json:211,
  apps/api/src/lib/fonts.ts:21,24,45.
- **Suggested fix:** Id font hệ thống = `newCustomFontId()`, đảm bảo không trùng bằng kiểm cả 2 bảng khi sinh (hoặc
  gộp `system_fonts` vào `user_fonts` với `user_id` null). Bỏ thay đổi `JobFonts` khỏi phase 3; phụ thuộc phase 6 chỉ còn 1.

## Finding 10: Seed pipeline ở boot API — một lần di chuyển dữ liệu thành code chạy mãi
- **Severity:** Medium
- **Location:** Phase 1 "Migrate pipeline user_settings → system_settings" (phase-01:60-76) + Tests After 12 + Risk 1
- **Flaw:** Để chọn đúng dòng của "admin đầu tiên trong ADMIN_EMAILS", plan thêm `seedSystemSettings` chạy mỗi lần
  khởi động API, 1 file test riêng, quy tắc thứ tự csv, mục deploy "đặt env trước". D1 đã chấp nhận user khác mất cài
  đặt; thực tế chỉ owner chỉnh pipeline.
- **Failure scenario:** `index.ts` hiện đồng bộ (serve ngay) → phải chuyển sang async boot; seed lỗi DB lúc boot làm API
  không lên. Code + test sống vĩnh viễn cho thao tác 1 lần.
- **Evidence:** apps/api/src/index.ts:1-14 (boot không có await/DB); apps/api/src/routes/me.ts:36-43 (nơi ghi
  `user_settings` duy nhất).
- **Suggested fix:** Trong SQL 0021: `INSERT INTO system_settings (id, pipeline) SELECT 1, pipeline FROM user_settings
  ORDER BY updated_at DESC LIMIT 1 ON CONFLICT DO NOTHING` (hoặc không copy, admin đặt lại 1 form). Bỏ seed boot + test.

## Câu hỏi chưa giải quyết
- User có thực sự muốn rotation script (brainstorm:106 chỉ nêu như rủi ro "xoay master key chỉ qua script") hay chấp
  nhận "nhập lại key"?
- Chính sách SSRF (research-openai:254) cần user chốt trước khi chọn giữa Finding 3 "bỏ" và "áp cả worker".
