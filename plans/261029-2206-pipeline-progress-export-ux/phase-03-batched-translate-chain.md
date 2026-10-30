---
title: "Phase 3: Chuỗi job dịch theo lô"
status: completed
effort: 10h
---

# Phase 3: Chuỗi job `chapter.translate` theo lô

## Overview

Thay "1 job dịch cả chương" bằng chuỗi job tuần tự, mỗi job 1 lô ≤ 4 trang & ≤ 40 khối (port `make_batches`). Lô kế
được enqueue trong transaction complete/fail của lô trước hoặc của `page.prepare` → trang lô 1 xong (`ready`) khi
lô sau còn chờ; 1 lô lỗi hẳn không chặn chuỗi. Ngữ cảnh: dòng dịch trang trước (`neighbors`) + `carry`
(notes + tên nhân vật) đi qua result → payload. Thay `autoTranslatePages` (manga) bằng `run_target`.

## Context

- `apps/api/src/jobs/enqueue.ts:274-313` `enqueueTranslate` (1 job, `context` rolling/neighbors); `:316-329`
  `retranslate`; `:335-367` `retryFailedPages`; `:534-542` `translatePrepared`; `:524-531` `autoTranslatePages` (manga,
  thêm ở `262ab45`); `:496-517` `createIngestedPages`; `:548-570` `refreshChapter`; `:153-189` `enqueueIngest`;
  `:85-118` `insertJob` (idempotency + `priority`, mặc định 100).
- `apps/api/src/jobs/queue.ts:309-312` prepare complete gọi `refreshChapter` + `autoTranslatePages`; `:315-360`
  translate complete; `:527-535` terminal prepare (failed → `autoTranslatePages`); `:536-548` terminal translate;
  `:119` claim `ORDER BY priority, created_at` (job dịch tạo sau xếp sau mọi `page.prepare` nếu cùng priority).
- `apps/api/src/jobs/claim-inputs.ts:123-140` `neighborLines` (trang ngay trước: nguồn + dịch, ngay sau: nguồn;
  `MAX_CONTEXT_LINES=24` `:27`); `:206` rolling → `context_lines: []`.
- Worker: `worker/mtl_pipeline/translate.py:47-65` `make_batches`, `:68-80` `update_context` (notes, characters),
  `:128-174` `translate_chapter`; `worker/mtl_worker/handlers.py:243-246` dựng `initial_context` chỉ từ `context_lines`.
- Payload/result: `packages/shared/src/job.ts:131-139`, `:222-225`; JSON Schema có `additionalProperties:false`
  (`packages/shared/json-schema/job-payload.schema.json`) → worker cũ từ chối field mới → phải nâng pipeline.
- Route: `apps/api/src/routes/chapters.ts:97` `CommitBody`, `:267-320` commit, `:391-399` translate-prepared,
  `:402-409` retry-failed, `:412-425` translate, `:428-435` cancel (`cancelChapterJobs`, `lib/chapter-removal.ts:19`).
- Progress: `apps/api/src/routes/progress.ts:16-80`.
- Version: `worker/mtl_worker/__init__.py:12` `0.6.0`; `apps/api/src/env.ts:39-42` `MIN_PIPELINE_VERSION` mặc định
  `0.6.0`; `apps/api/test/worker-helpers.ts:16`, `apps/web/e2e/fake-worker.ts:10` `VERSION = "0.6.0"`.

## Requirements

1. **Lượt dịch (run)** trên `chapters`: `run_target` (`prepared` | `translated` | null), `run_started_at`, `run_total`;
   trên `pages`: `translate_queued` = "trang thuộc lượt dịch hiện tại, chưa xong" (giữ `true` cả lúc đang trong lô,
   xoá khi lô của nó complete/fail).
2. `advanceTranslateChain` dưới khoá dòng chapter, idempotent, gọi ở: complete `page.prepare`, terminal `page.prepare`
   failed, complete `chapter.translate`, terminal `chapter.translate` failed. Huỷ (cancelled) → `stopTranslateChain`.
3. Frontier = trang `translate_queued` đầu tiên (ord, bỏ trang ẩn). Trang lỗi Bước 1 (`failed`, chưa có OCR) → xoá cờ,
   bỏ qua. Frontier còn ở Bước 1 → chờ. Lô = các trang đủ điều kiện liên tiếp (trong danh sách queued) từ frontier,
   cắt theo `planBatches` (≤ 4 trang có khối, ≤ 40 khối; trang 0 khối đi kèm miễn phí).
4. **Lô đầu** của lượt chạy ngay khi có ≥ 1 trang. **Lô sau**: nếu lô chưa đầy VÀ còn trang queued phía sau đang ở Bước 1
   → chờ (tránh vụn lô, giữ token ≈ cũ); hết trang chờ Bước 1 → chạy lô thiếu.
5. Job lô: `priority = 50` (trước `page.prepare` 100), `context = "rolling"` nếu trang đầu lô không có trang hiện nào
   đứng trước, ngược lại `"neighbors"`; `carry` = `result.carry` của job dịch thành công gần nhất trong lượt.
6. Lô lỗi hẳn (terminal failed) → trang chưa có bản AI `failed`, có rồi giữ `ready` (như cũ), xoá cờ → lô kế chạy.
7. Hết frontier → `run_target = null`, `refreshChapter` → `review | partial_failed | prepared`.
8. Hết hạn mức người dùng giữa chuỗi → dừng lượt (trang còn lại giữ `prepared`).
9. Lối vào chuỗi: `translatePrepared` (Bước 2 cũ), `retranslate` cả chương / tập trang, `retryFailedPages` (trang lỗi
   Bước 2; trang lỗi Bước 1 vào chuỗi chỉ khi chương đã có trang `ready`), commit `target:"translated"`.
   Lượt đang chạy → 409 `translate_running`.
10. Commit: body `target?: "prepared" | "translated"`; mặc định `translated` khi `ingest_mode === "pages"` (giữ hành vi
    manga của `autoTranslatePages`), còn lại `prepared` (giữ hành vi strip cho tới P5). `target:"translated"` luôn
    `assertQuota`.
11. Worker tối thiểu: payload + result `chapter.translate` thêm `carry?: { notes ≤ 2000, characters ≤ 30 × ≤ 64 }`;
    worker nạp `carry` vào `RollingContext`, trả `carry` cuối lô. Pipeline `0.7.0`, `MIN_PIPELINE_VERSION = 0.7.0`
    (API `PIPELINE_VERSION` muối input_rev giữ `0.4.0`).
12. Progress trả `chapter.run` + `pages[].translate_queued`, `pages[].run_batch` cho P5.

## Architecture

### Dữ liệu (migration 0020, `--name translate_chain`)

```sql
ALTER TABLE chapters ADD COLUMN run_target text, ADD COLUMN run_started_at timestamptz,
  ADD COLUMN run_total integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT chapters_run_target_chk CHECK (run_target IS NULL OR run_target IN ('prepared','translated'));
ALTER TABLE pages ADD COLUMN translate_queued boolean NOT NULL DEFAULT false;
```
Down: drop 4 cột + constraint. Dữ liệu cũ: mọi chương `run_target NULL` = hành vi cũ.

### Luồng

```
POST commit {target} ─▶ enqueueIngest: run_target=target, run_started_at=now ─▶ chapter.ingest
ingest complete ─▶ createIngestedPages: translate_queued = (run_target='translated'), run_total=N ─▶ page.prepare×N
page.prepare complete/failed [tx] ─▶ lockChapter ─▶ ghi page ─▶ refreshChapter ─▶ advanceTranslateChain
POST translate-prepared | translate {page_ids?} | retry-failed ─▶ startTranslateRun ─▶ advanceTranslateChain
advanceTranslateChain [khoá dòng chapter]:
  run_target≠translated → null │ có job chapter.translate active → null │ hết hạn mức → stop → null
  queued = pages(translate_queued, !skipped) ORDER BY ord
  xoá cờ trang lỗi Bước 1 │ queued rỗng → run_target=null, refreshChapter → null
  frontier chưa có OCR → null (chờ prepare)
  lô = planBatches(liên tiếp đủ điều kiện)[0]; lô sau chưa đầy + còn trang Bước 1 phía sau → null
  insertJob(chapter.translate, page_ids=lô, priority 50, context, carry) ; chapter.status=processing
chapter.translate complete [tx] ─▶ lockChapter ─▶ writeAiState… ─▶ xoá cờ page_ids ─▶ refreshChapter ─▶ advance
chapter.translate terminal failed ─▶ (như cũ) ─▶ xoá cờ ─▶ refreshChapter ─▶ advance │ cancelled ─▶ stopTranslateChain
```
Thứ tự khoá cố định **chapter → pages** trong mọi nhánh prepare/translate của `applyResult` và `terminal` (gọi
`lockChapter` trước khi ghi page) để không deadlock với `advanceTranslateChain` (đang giữ khoá chapter, cập nhật page).

### Chữ ký

```ts
// apps/api/src/jobs/translate-chain.ts (mới; import từ enqueue.ts, enqueue.ts KHÔNG import ngược → không vòng)
export const CHAIN_PRIORITY = 50, MAX_BATCH_PAGES = 4, MAX_BATCH_REGIONS = 40;
export type RunTarget = "prepared" | "translated";
export type ChainPage = { id: string; regions: number };
export function regionCount(ocr: OcrResult | null): number;      // item !empty && !is_sfx && source.trim()
export function planBatches(pages: ChainPage[], maxPages?: number, maxRegions?: number): ChainPage[][];
export async function startTranslateRun(tx: DbLike, userId: string, chapterId: string, pageIds?: string[]):
  Promise<{ job: Job | null; created: boolean }>;
export async function advanceTranslateChain(tx: DbLike, userId: string, chapterId: string): Promise<Job | null>;
export async function stopTranslateChain(tx: DbLike, userId: string, chapterId: string): Promise<void>;
export async function translatePrepared(tx, userId, chapterId): Promise<{ job: Job | null; created: boolean }>;
export async function retranslate(tx, userId, chapterId, pageIds?: string[]): Promise<{ job: Job | null; created: boolean }>;
export async function retryFailedPages(tx, userId, chapterId): Promise<Job[]>;
// enqueue.ts (đổi)
export async function enqueueIngest(tx, userId, chapterId, mode?: PageFormat, target?: RunTarget);
export async function enqueueTranslate(tx, userId, chapterId, pageIds, context, opts?: { priority?: number; carry?: TranslateCarry });
// xoá autoTranslatePages, chuyển translatePrepared/retranslate/retryFailedPages sang translate-chain.ts
// refreshChapter: busy thêm điều kiện (run_target='translated' && còn trang translate_queued); run_target='prepared'
//   và hết bận → run_target=null.
```
```ts
// packages/shared/src/job.ts
export const TranslateCarry = z.object({ notes: z.string().max(2000), characters: z.array(z.string().min(1).max(64)).max(30) });
// payload chapter.translate: carry: TranslateCarry.optional(); result chapter.translate: carry: TranslateCarry.optional()
```
```py
# worker/mtl_pipeline/translate.py: ChapterTranslation thêm `context: RollingContext` (ngữ cảnh sau lô cuối)
# worker/mtl_worker/handlers.py handle_translate:
#   initial = RollingContext(lines=context_lines, characters=carry.characters, notes=carry.notes)
#   result["carry"] = {"notes": tr.context.notes[:2000], "characters": tr.context.characters[-30:]} (cắt từng tên ≤ 64)
```
Progress (`routes/progress.ts`): `chapter.run = run_target ? { target, total: run_total, remaining: <số trang queued>,
batch: <số job dịch tạo từ run_started_at>, batches: batch + planBatches(queued ngoài job active).length } : null`;
`pages[].translate_queued`, `pages[].run_batch` (số thứ tự lô dự kiến, 1-based, `null` nếu không queued).

## File sở hữu

| Thao tác | Đường dẫn |
|---|---|
| Sửa | `packages/db/src/schema/app.ts` (`chapters`, `pages`) |
| Tạo (drizzle-kit `--name translate_chain`) | `packages/db/migrations/0020_translate_chain.sql`, `packages/db/migrations/meta/0020_snapshot.json` |
| Sửa (do generate) | `packages/db/migrations/meta/_journal.json` |
| Tạo | `packages/db/migrations-down/0020_translate_chain.down.sql` |
| Sửa | `packages/shared/src/job.ts` |
| Sửa (do `pnpm schema:emit`) | `packages/shared/json-schema/job-payload.schema.json`, `packages/shared/json-schema/job-result.schema.json` |
| Tạo | `apps/api/src/jobs/translate-chain.ts` |
| Sửa | `apps/api/src/jobs/enqueue.ts` |
| Sửa | `apps/api/src/jobs/queue.ts` (`applyResult` prepare/translate, `terminal` prepare/translate, import) |
| Sửa | `apps/api/src/routes/chapters.ts` (commit `target`, 3 route dịch, cancel gọi `stopTranslateChain`) |
| Sửa | `apps/api/src/routes/progress.ts` |
| Sửa | `apps/api/src/env.ts` (`MIN_PIPELINE_VERSION` mặc định `0.7.0` + comment) |
| Tạo | `apps/api/test/translate-chain.test.ts` |
| Sửa | `apps/api/test/worker-helpers.ts` (`VERSION = "0.7.0"`, import `translatePrepared` từ `translate-chain.ts`) |
| Sửa | `apps/api/test/worker-protocol.test.ts` (ca manga + import `retranslate`) |
| Sửa | `apps/api/test/cancel-and-recovery.test.ts` (import `retranslate`) |
| Sửa (chỉ ca vỡ do hành vi chuỗi, nếu có) | `apps/api/test/chapters.test.ts`, `apps/api/test/error-classes.test.ts`, `apps/api/test/claim-fonts.test.ts` |
| Sửa | `worker/mtl_pipeline/translate.py` |
| Sửa (chỉ `handle_translate`) | `worker/mtl_worker/handlers.py` |
| Sửa | `worker/mtl_worker/__init__.py` (`PIPELINE_VERSION = "0.7.0"`) |
| Tạo | `worker/tests/test_translate_carry.py` |
| Sửa | `apps/web/e2e/fake-worker.ts` (`VERSION = "0.7.0"`) |

## Không được đụng

`apps/web/src/**` (P5 dùng API mới), `page-state-writer.ts`, `lib/chapter-lock.ts`, `routes/page-state.ts`,
`routes/find-replace.ts` (P4), `claim-inputs.ts` (không cần đổi: `neighbors` + payload `carry` đủ), `runner.py`,
`client.py`, `ingest.py` (P2 xong rồi, không đổi thêm). Không đổi luật AI-ghi (`writeAiState(... chapterLocked)` giữ
nguyên ở P3).

## Test viết trước (đỏ trước khi code)

`apps/api/test/translate-chain.test.ts` (Postgres; dùng `seedUser`, `addSources`, `claimJobs`, `doIngest`, `doPrepare`,
`doTranslate`, `failJob` của `worker-helpers.ts`; `beforeEach(cancelActiveJobs)`; chương 9 trang, mỗi trang 1 khối)
- "planBatches matches make_batches" — thuần: 6 trang × 1 khối → [4,2]; trang 41 khối đi riêng; 3 trang × 15 khối →
  [2,1]; trang 0 khối đi kèm không tính vào 4.
- "first batch starts as soon as one page is prepared" — commit target translated; complete prepare trang 0 → đúng 1 job
  `chapter.translate` `page_ids=[p0]`, `priority 50`, `context "rolling"`; complete prepare trang 1..8 → vẫn 1 job active.
- "chain advances batch by batch in page order" — complete lô 1 → lô 2 = `[p1..p4]`, `context "neighbors"`; trang 0
  `ready` + `translate_queued=false` trong khi lô 2 `queued` (**tiêu chí 2**); chạy hết → chương `review`,
  `run_target null`, 3 job dịch tổng.
- "a later batch waits to fill while pages are still in step 1" — lô 1 xong khi mới prepared p1,p2 (p3.. còn pending)
  → không có job mới; prepare p3,p4 → lô `[p1..p4]`.
- "a failed batch does not stop the chain" — lô 2 `failJob("invalid_input")` → trang lô 2 `failed`, trang lô 1 vẫn
  `ready`, lô 3 được enqueue; hết chuỗi → `partial_failed` (**tiêu chí 4**). Thêm biến thể provider hết retry: đặt
  `provider_retries=20` rồi fail `provider` → cùng kết quả.
- "carry from the previous batch result goes into the next payload" — complete lô 1 với result
  `carry:{notes:"Minjun = Min-jun",characters:["Minjun"]}` → payload lô 2 `carry` bằng đúng giá trị đó (**tiêu chí 7**).
- "advance called twice in a row creates one job" — `inJobTx(advance)` × 2 tuần tự → 1 job active.
- "concurrent advances create exactly one job" — `Promise.all` 5 × `inJobTx(advance)` → 1 job active, không lỗi.
- "cancelling stops the chain" — `POST /chapters/:id/cancel` giữa chuỗi → `run_target null`, mọi `translate_queued`
  false, complete prepare còn lại không tạo job dịch, chương không kẹt `processing`.
- "step-1 failures are skipped by the frontier" — p0 prepare `invalid_input` → lô 1 bắt đầu từ p1.
- "commit with target prepared stops at prepared" — commit `{target:"prepared"}` → hết prepare → chương `prepared`,
  0 job dịch, `run_target null` (**tiêu chí 5**).
- "translating three selected pages translates only them" — chương prepared 9 trang; `POST /translate {page_ids:[p2,p5,p7]}`
  → mọi job dịch chỉ chứa các id này; trang khác giữ `prepared` (**tiêu chí 6**).
- "a second run while one is active is rejected" — `POST /translate` khi lượt đang chạy → 409 `translate_running`.
- "manga commits default to the translated target" — series `page_format: pages`, commit không body → lô 1 tự chạy.
- "over-quota stops the chain" — `env.USER_DAILY_USD = 0` sau lô 1 → advance không tạo job, `run_target null`,
  trang còn lại `prepared` (khôi phục env trong `finally`).

`apps/api/test/worker-protocol.test.ts` — viết lại ca "manga (ingest từng trang) tự sang dịch…": sau prepare p0 có lô
`[p0]`; complete lô → lô kế chứa `[p1,p2]` (hoặc `[p1]` khi p2 lỗi), không còn assert 1 job 3 trang.

`worker/tests/test_translate_carry.py`
- `test_translate_chapter_returns_final_context` — ScriptedProvider trả `context_notes="n1"` rồi `"n2"` → `tr.context.notes == "n2"`, characters gồm speaker.
- `test_handler_seeds_context_from_payload_carry` — payload `carry={"notes":"Minjun","characters":["Minjun"]}` → request đầu
  tới provider có `context.notes=="Minjun"` và `"Minjun" in context.characters`.
- `test_handler_returns_carry_within_limits` — notes 5000 ký tự, 50 tên → result `carry.notes` 2000 ký tự, 30 tên, và
  `validate_contract("job-result", result)` qua.
- `test_payload_without_carry_still_valid` — payload cũ (không `carry`) chạy như trước.

Lệnh hẹp: `pnpm --filter @mtl/api test -- translate-chain` · `pnpm --filter @mtl/api test -- worker-protocol` ·
`cd worker && uv run pytest tests/test_translate_carry.py -q`

## Implementation Steps

1. Viết `translate-chain.test.ts` + `test_translate_carry.py` → đỏ.
2. Schema DB + `pnpm db:generate --name translate_chain` + down file; `pnpm db:migrate`.
3. Shared `TranslateCarry` vào payload/result; `pnpm schema:emit`; worker `translate.py` (`context` cuối),
   `handlers.py` (nạp/trả `carry`), version 0.7.0 (worker, `env.ts`, `worker-helpers.ts`, `fake-worker.ts`). Pytest xanh.
4. `translate-chain.ts`: `regionCount`, `planBatches`, `startTranslateRun` (kiểm trang thuộc chương, không ẩn, đã
   prepare; lượt active → 409 `translate_running`; set `run_target='translated'`, `run_started_at=now()`,
   `run_total=n`, `translate_queued=true`), `advanceTranslateChain` (theo luồng trên), `stopTranslateChain`
   (`run_target=null`, cờ false, `refreshChapter`), chuyển `translatePrepared`/`retranslate`/`retryFailedPages`.
5. `enqueue.ts`: `enqueueIngest(target)`, `createIngestedPages` set cờ + `run_total`, `enqueueTranslate` nhận
   `priority/carry`, `refreshChapter` theo lượt, xoá `autoTranslatePages`.
6. `queue.ts`: `lockChapter` đầu nhánh prepare/translate của `applyResult` và `terminal`; thay `autoTranslatePages` bằng
   `advanceTranslateChain`; translate complete/terminal xoá `translate_queued` cho `page_ids` rồi advance (failed) hoặc
   `stopTranslateChain` (cancelled); prepare cancelled → `stopTranslateChain`.
7. Routes: commit `target` (+ quota), translate-prepared/translate/retry-failed import từ `translate-chain.ts`, trả
   `job: job ? jobView(job) : null`; cancel → `inJobTx(stopTranslateChain)` sau `cancelChapterJobs`. Progress thêm
   `run`, `translate_queued`, `run_batch`.
8. Chạy toàn bộ `pnpm --filter @mtl/api test`; sửa ca vỡ do hành vi chuỗi (chỉ đổi assert, không nới logic).
9. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `cd worker && uv run pytest -q`.

## Success Criteria

- [x] `translate-chain.test.ts` 15 ca xanh (+3 ca bổ sung: commit manga hết hạn mức có/không `target`, dịch lại trang đầu giữ ngữ cảnh trang sau); `test_translate_carry.py` xanh; toàn bộ test api/web/worker xanh.
- [x] `grep -rn autoTranslatePages apps/` rỗng.
- [x] Payload lô trong DB có `priority=50`, `carry` từ lô trước; worker 0.6.0 nhận 426.
- [ ] Kiểm tay (worker thật, `--no-llm` không đủ — cần key): chương 9 trang strip, gọi `POST /translate-prepared` →
      trang 1 `ready` trong khi lô 2 đang chạy (xem `/progress`). — Chưa làm (không có key LLM trong phiên thực thi);
      hành vi tương đương đã có test "chain advances batch by batch in page order" (lô 1 `ready` khi lô 2 `queued`).

## Risk + rollback

| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| Race prepare complete ↔ translate complete cùng advance | M×H | `FOR UPDATE` dòng chapter + kiểm job active sau khi giữ khoá + unique idempotency active; test đồng thời |
| Deadlock chapter ↔ page | M×H | Thứ tự khoá chapter → pages ở mọi nhánh; advance chỉ cập nhật trang đã prepared (không trang đang có tx prepare) |
| Lô dịch xếp sau mọi `page.prepare` → mất "dòng chảy" | H×M | `priority 50` |
| Vụn lô khi prepare chậm → tăng token | M×M | Chỉ lô đầu được thiếu; lô sau chờ đầy khi còn trang Bước 1 |
| Mất notes/tên giữa job → lệch tên | M×M | `carry` qua result/payload + `neighbors` 12 dòng trang trước; kiểm tay chương mẫu |
| Chương kẹt `processing` (cờ còn mà không job) | L×H | Huỷ/stop xoá cờ; `refreshChapter` coi lượt bận chỉ khi còn cờ; mọi terminal translate xoá cờ của `page_ids` |
| Worker < 0.7.0 dừng hàng đợi khi API lên | H×H | Checklist deploy: nâng worker Mac/Modal cùng lúc (như 0.6.0) |
| Modal drain thoát giữa 2 lô | L×M | Lô kế enqueue trong tx complete → hàng đợi không rỗng lúc worker hỏi tiếp |
| Hạn mức hết giữa chuỗi → mỗi lô fail lần lượt | M×L | advance kiểm `userQuotaStatus` → stop lượt |

Rollback: revert API + worker về 0.6.0 cùng lúc (API cũ chấp nhận worker 0.6.0; worker 0.7.0 vẫn đọc payload cũ).
Migration 0020 additive — để nguyên cột hoặc chạy down. Chương đang giữa chuỗi khi rollback: chạy
`UPDATE chapters c SET status='prepared' WHERE status='processing' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE
j.chapter_id=c.id AND j.status IN ('queued','running','paused_budget'));` rồi người dùng bấm "Dịch" lại (trang đã
`ready` giữ nguyên, translateKey khác tập trang → không trùng job).

## Docs (controller làm cuối)

`docs/job-queue-worker.md`: thay sơ đồ "Luồng 2 giai đoạn" bằng lượt dịch (`run_target`, `translate_queued`, frontier,
quy tắc lô đầu/lô sau, priority 50, `context` rolling/neighbors, `carry`); mục "Ngôn ngữ + thứ tự đọc" thêm đoạn 0.7.0
(`carry`, `MIN_PIPELINE_VERSION = 0.7.0`). `docs/deployment-guide.md` + `README.md`: checklist nâng worker 0.7.0.
