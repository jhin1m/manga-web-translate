---
title: "Manga translate editor MVP"
description: "Web app tự dịch manhwa KO sang tiếng Việt (pipeline 2 giai đoạn) + editor kiểu Canva để sửa, worker AI chạy local Mac hoặc Modal, invite-only, kiến trúc sẵn multi-tenant."
status: in-progress
priority: P1
effort: "~39d (MVP P1-P7) + ~8d trước mở đăng ký công khai (P8) + ~5d extension (P9)"
tags: [manga, manhwa, translation, ai-pipeline, editor, konva, hono, drizzle, python-worker, multi-tenant]
created: 2026-10-19
---

# Manga translate editor MVP

## Mục tiêu
Nhóm scanlation của owner (invite-only) upload một chương manhwa KO (ảnh/ZIP) → hệ thống tự detect, OCR, xoá chữ theo trang (song song), rồi dịch theo chương (tuần tự, đủ ngữ cảnh xưng hô) và dán chữ → mở editor để sửa → xuất PNG/ZIP/CBZ. MVP chỉ KO → VI; JA/ZH/EN sau MVP (red team #10). Kiến trúc sẵn multi-workspace (auth, hàng đợi job có fencing, usage ledger); control plane SaaS (quota, BYOK, takedown…) ở Phase 8 trước khi mở đăng ký công khai (red team #8). Chưa có thanh toán.

Bằng chứng: `../reports/researcher-261020-0139-ai-pipeline-models-report.md`, `../reports/researcher-261020-0139-infra-cost-editor-stack-report.md`, `../reports/red-team-261020-0157-manga-mvp-plan-review-report.md`.

## Luồng dữ liệu
```
upload (presigned POST) ─> commit (HEAD + magic bytes) ─> chapter.ingest (cắt theo detector, không overlap)
  ─> [tx] pages (id tất định) + page.prepare × N ─(song song)─> detect · mask chữ · inpaint · OCR LLM
  ─> [tx khi mọi page terminal] chapter.translate ─(tuần tự, lô K trang)─> dịch + typeset ─> ai_state/ai_rev
  ─> state (chỉ khi chưa ai sửa) ─> editor (khoá chương, If-Match, IndexedDB) ─> chapter.export ─> download 5'
```

## Tóm tắt quyết định
| Mảng | Quyết định |
|---|---|
| Pipeline | Tự dựng; được dùng/chép code và model từ repo mở bất kể license (manga-image-translator, BallonsTranslator, comic-text-detector, Koharu…) nếu nhanh hơn. License xét ở Phase 8 trước khi thương mại hoá |
| Kiến trúc AI | **2 giai đoạn (red team #5):** `page.prepare` theo trang, song song (detect + mask chữ + inpaint + OCR LLM vision chỉ chép chữ) → `chapter.translate` theo chương, tuần tự theo `ord`, gộp lô ~4 trang/call với glossary, quy tắc xưng hô, ngữ cảnh cuộn → typeset |
| Detect | 2 model: ogkalu `comic-text-and-bubble-detector` RT-DETRv2 ONNX (box bóng/chữ, vùng typeset) + `comic-text-detector` ONNX (mask chữ mức pixel, code chép từ manga-image-translator) + tile strip dài; mask = vùng giãn của chữ (không cả lòng bóng); heuristic cực tính tự viết chỉ là fallback (red team #15) |
| OCR + dịch | LLM qua interface provider; mặc định Gemini Flash-class, so sánh `claude-haiku-5-5`. OCR local (manga-ocr, RapidOCR) sau MVP (red team #10) |
| Inpaint | Flood-fill trên mask chữ + LaMa (big-lama ONNX) sau interface `Inpainter` |
| Typeset | Tự viết auto-fit, Pillow **bắt buộc raqm**, hợp đồng layout chung với Konva (NFC, baseline từ ascent/descent, stroke ra ngoài) (red team #11); font đủ dấu tiếng Việt; lưu JSON text box, không bake; chỉ chữ ngang |
| App | pnpm monorepo TS: Vite+React SPA, Hono API, Drizzle+Postgres, better-auth (organization = workspace, đăng ký chỉ qua lời mời), MinIO presigned POST/GET trên domain riêng |
| Tenant | Workspace trên URL `/api/w/:ws/...`, `scoped()` cho mọi tra cứu kể cả theo id (red team #13) |
| Hàng đợi | **Lệch khỏi đề xuất:** bảng `jobs` tự quản + `FOR UPDATE SKIP LOCKED` thay pg-boss. Không Redis. Fencing `lease_token`+`attempt`, key storage có revision, phân loại lỗi provider + circuit breaker (red team #2, #7) |
| Worker | Python, vòng lặp pull qua HTTP, chỉ gọi ra ngoài → Mac sau NAT chạy được; mỗi workspace chọn `worker_mode` = `mac` **hoặc** `modal`; Modal đánh thức qua bảng `dispatches` (red team #9). Không RunPod |
| Tiến độ | Polling TanStack Query 2–3s, không SSE (red team #13) |
| Editor | react-konva, layer original/clean/text/mask, zustand+immer patches (undo ≥ 100), tile cho strip dài, khoá chương ép ở server, hàng đợi patch IndexedDB, merge kết quả AI mới theo vùng (red team #1, #6) |
| Export | Render phía server từ `page_state` bằng `render.py`; editor lưu `lines` đã ngắt; tải qua endpoint xác thực → presigned GET ≤ 5' |
| Chi phí | Server tính tiền từ số đếm thô; kill-switch ngân sách toàn cục kiểm ở claim, job → `paused_budget` (red team #14) |
| Deploy | VPS + Cloudflare + systemd (`mtl-api`, `mtl-jobs` tách unit), backup Postgres + MinIO |
| UI | Không "AI slop": cấm chữ gradient, glassmorphism, blob, pastel/cute |

### Mâu thuẫn đã phát hiện và cách xử lý
1. **pg-boss và giao thức worker HTTP:** pg-boss có state job riêng; ta vẫn phải có bảng `jobs` riêng (progress, cost, worker, lease, idempotency) → 2 nguồn sự thật; lease + heartbeat qua HTTP cũng không khớp mô hình `work()`. → Một bảng `jobs` với `SKIP LOCKED`. Muốn quay lại pg-boss thì chỉ `apps/api/src/jobs/queue.ts` đổi.
2. **WYSIWYG giữa Konva (browser) và Pillow (server):** → Text box lưu `lines[]` đã ngắt; server chỉ vẽ; cùng file font; hợp đồng layout chốt ở spike Phase 1; gate lệch bbox glyph ≤ 1px + soi mắt 5 trang (red team #11).
3. **Strip manhwa bị cắt thành nhiều file, bóng thoại vắt qua ranh giới file:** → Ingest ghép slice thành strip ảo, chạy detector, cắt ở hàng không giao box; không có thì kéo dài page tới trần cứng, không overlap; lưu `source_map` để xuất lại theo slice gốc (Phase 3) (red team #4).
4. **Ngữ cảnh trang trước vô nghĩa khi chạy song song:** → tách 2 giai đoạn, dịch tuần tự theo chương (red team #5).

## Các phase
| # | Phase | Ưu tiên | Effort | Phụ thuộc | Trạng thái |
|---|---|---|---|---|---|
| 1 | [Spike & benchmark pipeline (KO, 2 giai đoạn)](./phase-01-pipeline-spike-benchmark.md) | P1 | 5d | — | Pending |
| 2 | [Scaffold monorepo, DB, auth, storage](./phase-02-monorepo-db-auth-storage.md) | P1 | 4d | — (song song P1) | Completed |
| 3 | [Hàng đợi job + worker protocol + worker local](./phase-03-job-queue-worker.md) | P1 | 7d | 1 (gate), 2 | Pending |
| 4 | [Web: upload, cài đặt series, tiến độ, danh sách trang](./phase-04-web-upload-series-progress.md) | P1 | 4d | 2, 3 | Pending |
| 5 | [Editor react-konva](./phase-05-editor-konva.md) | P1 | 12d | 3, 4 (router/layout) | Pending |
| 6 | [Export + glossary/find-replace](./phase-06-export-glossary-polish.md) | P1 | 3d | 3, 5 | Pending |
| 7 | [Production MVP: VPS, systemd, backup, kill-switch, Modal](./phase-07-production-deploy-quotas.md) | P1 | 4d | 3–6 | Pending |
| 8 | [Trước khi mở đăng ký công khai: quota, BYOK, admin, takedown](./phase-08-pre-public-signup-saas.md) | P2 | ~8d | 7 | Pending |
| 9 | [(Sau MVP) Chrome extension — phác thảo](./phase-09-chrome-extension-outline.md) | P3 | ~5d | 7 (nội bộ); đăng công khai cần 8 | Pending |

MVP = P1–P7 (~39d). Song song: P1 ‖ P2. P4 và P5 chồng lấn sau khi P4 xong router/layout (ownership thư mục tách ở từng phase; `apps/api/src/lib/chapter-lock.ts` do P3 tạo, P4–P6 chỉ gọi). P8 và P9 (bản nội bộ) có thể song song sau P7 — chỉ chung dòng mount route trong `apps/api/src/index.ts` (merge tuần tự). File test dùng chung `apps/api/test/tenant-isolation.test.ts` chỉ được thêm case (append), mỗi phase thêm case cho route của mình.

## Đồ thị phụ thuộc
```
P1 (gate go/no-go) ─┐
P2 ─────────────────┴─> P3 ─> P4 ─> P5 ─> P6 ─> P7 ═══ MVP (invite-only) ═══┬─> P8 (trước mở đăng ký) ─┐
                              └────(router xong)──┘                          └─> P9 nội bộ ─────────────┴─> P9 đăng Web Store
```

## Tiêu chí chấp nhận MVP
- [ ] Owner upload **2 chương manhwa KO strip** (mỗi chương ≥ 40 slice, 2 series khác kiểu bóng) → bản dịch tự động xong qua 2 giai đoạn; worker Mac (onnxruntime **CPU EP**): giai đoạn 1 ≤ 30s/trang p50; worker Modal ấm: giai đoạn 1 ≤ 10s/trang p50 (red team #10).
- [ ] ≥ 85% bóng thoại không cần sửa vị trí/xoá chữ (owner đánh giá trên golden KO, Phase 1 đo, Phase 7 đo lại).
- [ ] Editor: sửa text, di chuyển/resize/xoay box, đổi font, brush mask → re-inpaint, undo/redo ≥ 100 bước, mở page dài tới trần ingest 12.000px (và ảnh thử 20.000px) không crash trên Chrome + Safari.
- [ ] Chạy lại AI (chương hoặc 1 trang) không bao giờ ghi đè chỉnh sửa tay; 409/crash không mất thay đổi chưa lưu (red team #1, #6).
- [ ] Export PNG/ZIP/CBZ khớp editor: lệch bbox glyph ≤ 1px trên page_state golden + owner soi mắt 5 trang không thấy khác (red team #11).
- [ ] 2 workspace tách biệt: test tự động "id thuộc B, người gọi thuộc A" trên mọi route (red team #13).
- [ ] Worker fencing: heartbeat/complete/fail với lease cũ → 409, không ghi (red team #2).
- [ ] Mọi job ghi `usage_ledger` (cả fail và heartbeat), chi phí tính ở server; kill-switch ngân sách toàn cục chặn claim, job → `paused_budget` (red team #14).
- [ ] Chi phí LLM trung bình ≤ $0.005/trang (tổng 2 giai đoạn) ở model mặc định.
- [ ] Storage private-by-default, MinIO domain riêng + `nosniff`; đăng ký chỉ qua lời mời; backup Postgres + MinIO restore thử thành công (red team #8, #12).

Không thuộc MVP (→ Phase 8): quota theo workspace / 402, BYOK, ma trận role chi tiết, admin nền tảng, takedown, ToS.

## Rủi ro chính (chi tiết ở từng phase)
Chữ đè art/SFX (P1,P3) · chữ đảo màu/viền (P1) · bóng bị cắt khi ingest (P3) · worker zombie ghi đè (P3) · chạy lại AI xoá chỉnh sửa (P3,P5) · LLM sập/429 (P3) · giới hạn kích thước canvas (P5) · lệch render Konva/Pillow (P1,P5,P6) · LLM bịa trên crop rỗng (P1,P3) · bùng chi phí: thinking token, cold start, dispatch trùng (P1,P7) · upload độc hại (P2,P4) · DMCA/bản quyền khi mở công khai (P8).

## Rollback
Greenfield, mỗi phase một nhánh/PR. Migration Drizzle chỉ thêm (additive) tới hết MVP; mỗi migration có `down` thủ công. Worker versioned (`pipeline_version` trong job; claim lọc `MIN_PIPELINE_VERSION`) → chạy lại job với phiên bản đã duyệt. Storage key bất biến có revision → quay về rev cũ bằng cách đổi con trỏ `clean_rev`.

## Đã chốt với user (20/10/2026)
- Backend: **TypeScript (Hono)**.
- Nguồn chính: **manhwa (KO)** → Phase 1 làm KO strip (tile, ghép/cắt slice, chữ ngang); mọi tối ưu typeset mặc định nhắm strip dọc. JA/ZH/EN chuyển sang sau MVP (red team #10).
- Extension: **sau MVP** (Phase 9).
- Cộng tác: **khoá theo chương** + optimistic version, không realtime; khoá ép ở server (red team #6).
- Duyệt thêm (20/10/2026): tách control plane SaaS ra Phase 8 (red team #8); pipeline 2 giai đoạn (red team #5).
- **Bỏ mọi ràng buộc license trong MVP** (20/10/2026): không chặn GPL/AGPL, không kiểm license weight/font, không license-check. Rà license một lần ở Phase 8 trước khi thương mại hoá.

## Câu hỏi mở
1. Kênh cảnh báo vận hành (Telegram/ntfy/email)? (Phase 7)
2. Domain cho MinIO (`files.<domain>`) — tên miền nào, có đi qua Cloudflare proxy không? (Phase 2/7)
3. Token worker Mac: token workspace dài hạn (revoke tay) hay token ngắn hạn xoay vòng qua device flow? Mặc định MVP: token workspace dài hạn lưu file 600/Keychain. (Phase 3)

Đã giải quyết: Torii baseline (bỏ khỏi MVP, red team #10); TS vs Go (user chốt TS).

## Red Team Review
- Phiên: 2026-10-20 — báo cáo: [`../reports/red-team-261020-0157-manga-mvp-plan-review-report.md`](../reports/red-team-261020-0157-manga-mvp-plan-review-report.md)
- Phát hiện: 15 (chấp nhận 15, bác 0). Mức: 3 Critical / 11 High / 1 Medium. Kèm mục "Gộp kèm" (cắt mạ vàng) — chấp nhận toàn bộ.
- User duyệt riêng #8 (tách control plane SaaS → Phase 8) và #5 (pipeline 2 giai đoạn) ngày 20/10/2026.

| # | Phát hiện | Mức | Xử lý | Áp vào |
|---|---|---|---|---|
| 1 | Chạy lại AI ghi đè `state` đã sửa tay, reset version | Critical | Chấp nhận: AI chỉ ghi `ai_state`/`ai_rev`; ghi `state` khi chưa ai sửa + chương không khoá; cờ `ai_update_available` + merge theo vùng; version không reset; `page_state_history` | P2, P3, P5, plan |
| 2 | Worker không fencing, key cố định, usage do worker tự báo | Critical | Chấp nhận: `lease_owner` từ token, `lease_token`+`attempt` → 409; key `…/clean/{rev}.png`; PUT TTL ≤ lease; `MIN_PIPELINE_VERSION`; chi phí tính ở server | P2, P3 |
| 3 | Hợp đồng job hở (commit enqueue khi chưa có page, `input_rev` không định nghĩa, idempotency trả job failed, mask người vẽ không có đường đi) | Critical | Chấp nhận: ingest complete tạo pages + enqueue cùng tx; `input_rev` + `series.glossary_rev/settings_rev`; unique idempotency chỉ job active; `user_mask` + route presign | P2, P3, P4, P5 |
| 4 | Ingest cắt xuyên narration, overlap dịch 2 lần, re-ingest mồ côi | High | Chấp nhận: detector trên strip ảo, cắt hàng không giao box, kéo dài tới trần 12000px, bỏ overlap, page id tất định, chặn re-ingest khi đã sửa | P2, P3, P4, P6 |
| 5 | Ngữ cảnh trang trước vô nghĩa khi song song; thumbnail 1024 cạnh dài | High | Chấp nhận (user duyệt): `page.prepare` song song → `chapter.translate` tuần tự gộp lô; tile theo bề rộng; `context_used`; bench 2 giai đoạn + nhánh không ngữ cảnh | P1, P3, plan |
| 6 | Khoá chương chỉ tư vấn, ghi đè mù, mất sửa khi crash | High | Chấp nhận: server ép khoá mọi writer (423); 409 → rebase patch; `clean_rev` cột ở `pages`; IndexedDB pending | P3, P4, P5, P6 |
| 7 | LLM sập/429 cháy attempt, chương kẹt `processing` | High | Chấp nhận: `error_class`, provider/rate-limit không tính attempt, Retry-After, circuit breaker, giữ artifact trước LLM, `partial_failed` + chạy lại trang lỗi | P2, P3, P4 |
| 8 | Phase 7 nhồi control plane SaaS, BYOK rủi ro | High | Chấp nhận (user duyệt): P7 = VPS/systemd/backup PG+MinIO/kill-switch/healthz/invite-only/Modal; Phase 8 mới cho quota, BYOK proxy, admin, audit, takedown, ToS | P2, P7, P8, P9, plan |
| 9 | Dispatcher bắn trùng, `active_leases==0` toàn cục, RunPod code chết | High | Chấp nhận: bảng `dispatches`, `oldest_queued_age`, `worker_mode` mac\|modal, bỏ RunPod, backoff `no_claim` | P2, P3, P7 |
| 10 | Phase 1 quá tải, gate không đo được, tổng effort phi thực tế | High | Chấp nhận: KO-only ~30 slice, Label Studio, ground truth LLM+owner, cỡ mẫu ≥200/≥50, phân tầng; JA/ZH/EN + OCR local + Torii sau MVP; P5 12d; tổng MVP 39d | P1, P4, P5, plan |
| 11 | Konva ≠ Pillow, gate pixel-diff % sẽ đỏ | High | Chấp nhận: hợp đồng layout (baseline font, stroke ra ngoài, NFC, raqm bắt buộc) trong spike P1; gate bbox glyph ≤1px + soi mắt 5 trang | P1, P2, P5, P6, plan |
| 12 | Upload chỉ kiểm ở browser, bom nén, XSS cùng domain | High | Chấp nhận: presigned POST `content-length-range`, HEAD + magic bytes khi commit, trần pixel ở worker, MinIO domain riêng + nosniff | P1, P2, P3, P4, P7 |
| 13 | Workspace từ header, SSE bỏ qua membership, test tenant không bắt route theo id | High | Chấp nhận: `/api/w/:ws/...`, `scoped().byId`, test "id thuộc B, người gọi A", polling thay SSE | P2, P3, P4, P5, P6, P9 |
| 14 | Ledger đếm thiếu, quota không khoá, kill-switch chỉ chặn Modal | High | Chấp nhận: usage trên fail+heartbeat, `gpu_idle_seconds`, kill-switch kiểm ở claim, `paused_budget`; quota giữ chỗ nguyên tử + đối soát → P8 | P3, P7, P8 |
| 15 | Mask không xét đảo màu, flood-fill cả lòng bóng, "MPS", weight pickle | Medium | Chấp nhận: cực tính theo box, mask chữ giãn, CPU EP chuẩn, `models.lock.json`, chỉ onnx/safetensors, `HF_HUB_OFFLINE=1` | P1, P3 |

Gộp kèm đã áp: bỏ chữ dọc (P5), bỏ layout `fixed_height` (P6), find/replace chữ thường trong chương + preview, không regex/series (P6), bỏ SSE (P3, P4, P9), undo ≥ 100 thống nhất (P5, plan), reaper + dispatcher ở unit `mtl-jobs` riêng (P3, P7), bỏ CI so route-test + license-check chạy tay khi release (P2, P7), `workspace_quotas`/`audit_log` tạo ở P8 (giữ `usage_ledger` ở P2), xoá rủi ro "TS vs Go" (P2), export tải qua endpoint xác thực + presigned GET ≤ 5' (P6), token worker từ file/Keychain (P3).

### Whole-Plan Consistency Sweep
Đã `grep -rn` trên `plan.md` + `phase-0*.md` sau khi sửa:
| Từ khoá cũ | Kết quả |
|---|---|
| `pixel-diff` | Chỉ còn trong câu "bỏ pixel-diff %" (P1) và "cắt … pixel-diff" (P6) — đúng |
| `SSE`, `EventSource` | Chỉ còn dạng "không SSE" (P3, P4, P9, plan) — đúng |
| `X-Workspace-Id` | 0 kết quả |
| `RunPod` | Chỉ còn "không RunPod / không có handler RunPod" (P3, P7, plan) — đúng |
| `chữ dọc`, `vertical` | Chỉ còn "không có chữ dọc / không có `vertical`" (P5) — đúng |
| `regex` | Chỉ còn "không regex" (P6) — đúng |
| `MPS` | Chỉ còn "onnxruntime không có MPS EP" (P1) — đúng |
| `overlap` | Còn `overlap=20%` của **tile detect** (P1) — khác khái niệm, giữ; ingest/export ghi "không overlap" — đúng |
| `page.process` | 0 kết quả (đổi thành `page.prepare` + `chapter.translate`) |
| `phase-08-chrome` | 0 kết quả; link mới `phase-09-chrome-extension-outline.md`, `phase-08-pre-public-signup-saas.md` tồn tại |
| `24h` / `24 giờ` | Còn "job … 24h" (số liệu admin, P8) và "ảnh ephemeral xoá sau 24 giờ" (P9) — không phải link export; link export ≤ 5' (P6) |
| `402` | Chỉ ở P8 và dòng "Không thuộc MVP" của plan — đúng |
| `version 1` | Chỉ còn `schema_version 1` (P5) — khác khái niệm; "state (version 1)" đã xoá |
| `clean.png` | 0 kết quả (key có revision) |
| `JA`, `Torii`, `manga-ocr` | Chỉ trong ngữ cảnh "sau MVP" (P1, plan) — đúng |
| `assertQuota`, `workspace_quotas`, `audit_log`, `BYOK` | Chỉ ở P8, hoặc câu "không có ở MVP / tạo ở P8" (P2, P3, P7) — đúng |
| `200 bước` | 0 kết quả; undo thống nhất ≥ 100 |
| `argv` | Chỉ "không qua argv" (P3) — đúng |
| `CoreML` | Chỉ "tuỳ chọn, không vào gate" (P1) — đúng |

Kiểm chéo thêm: effort bảng phase = frontmatter từng file (5+4+7+4+12+3+4 = 39d MVP; P8 ~8d; P9 ~5d); mỗi finding có marker `(red team #N)` ở mọi phase trong cột "Áp vào" của báo cáo; trần page ingest 12000px khớp giữa P3, P5 và tiêu chí editor; `clean_rev` chỉ là cột `pages` (không còn trong `page_state`); `chapter-lock.ts` do P3 tạo, P4–P6 dùng.

Mâu thuẫn chưa giải quyết: **0**. Ghi chú không phải mâu thuẫn: tên file `phase-07-production-deploy-quotas.md` giữ nguyên để không vỡ link dù quota đã chuyển sang P8.

<!-- slug: manga-translate-editor-mvp -->
