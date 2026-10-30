---
title: "Phase 2: Tiến độ từng ảnh/trang + nhãn tiếng Việt"
status: completed
effort: 6h
---

# Phase 2: Tiến độ từng ảnh/trang + nhãn tiếng Việt

## Overview

Worker báo tiến độ ngay khi đổi bước/đếm (throttle ≥ 2s) kèm `done/total`; DB lưu `jobs.progress_done/total`
(migration 0019); web có 1 bảng mã bước → nhãn tiếng Việt (`stage-labels.ts`) dùng ở thumbnail trang, cột ảnh gốc,
drawer Hoạt động. Chạy song song với P1 (không chung file).

## Context

- `worker/mtl_worker/runner.py:28` `HEARTBEAT_S = 20.0`; `JobContext.report` `:100-103` chỉ ghi state;
  `Heartbeat._run` `:187-191` gửi mỗi 20s; `heartbeat_once` `:148-165`.
- `worker/mtl_worker/client.py:42-44` (Protocol), `:140-144` (body heartbeat).
- `worker/mtl_worker/ingest.py:17,21,28` báo `download/detect/upload` theo % không đếm.
- `worker/mtl_worker/handlers.py:92,97,99,116` prepare (không có bước inpaint); `:245,264` translate.
- `worker/mtl_pipeline/pipeline.py:126-144` `prepare_image` (detect → mask → inpaint, không callback).
- `worker/mtl_worker/export.py:127,142,155` export `download/render/upload`.
- `packages/shared/src/worker-protocol.ts:36-41` `HeartbeatRequest` (zod object, mặc định bỏ key lạ → API cũ + worker
  mới vẫn chạy).
- `apps/api/src/jobs/queue.ts:235-237` heartbeat ghi `progress/stage`; reset ở claim `:149-150`, requeue `:579-580`,
  pauseForBudget `:602-603`, complete `:274`.
- `apps/api/src/routes/jobs.ts:9-26` `jobView`; `progress.ts:75,78` dùng `jobView`.
- Web: `page-status.ts:58-75` (`BUSY_STEP` "Bước 1"), `activity-drawer.tsx:22` ("GĐ1 · …"), `:240` in `j.stage` thô;
  `chapter-workspace.tsx:484-487` tính `cutting`; `source-rail.tsx:21,79-86,135`; `source-rail-model.ts` (`sourceLabel`).
- Poll tiến độ `use-chapter-data.ts:21` 2,5s → nhãn đổi ≤ 2s (heartbeat) + 2,5s (poll) < 5s.

## Requirements

- `report(stage, progress, done=None, total=None)`: đổi `stage` hoặc `done` → đánh thức thread heartbeat; gửi ngay nếu
  lần gửi trước ≥ 2s, không thì gửi lúc tròn 2s (gộp nhiều lần đổi). Chỉ đổi `progress` → chờ nhịp 20s. Nhịp 20s
  gia hạn lease giữ nguyên.
- Heartbeat body thêm `done`, `total` (int | null). API cũ bỏ qua → không cần nâng pipeline version.
- Ingest: `download` i/n (ảnh), `cut` i/n (đoạn — đổi tên từ `detect`), `upload` i/n (trang).
- Prepare: `detect` → `inpaint` → `ocr` → `upload` (callback `on_stage` trong `prepare_image`); `reuse_partial` giữ.
- Translate: `translate` → `typeset` i/n trang. Export: `download` i/n, `render` i/n, `upload`.
- DB `jobs.progress_done integer null`, `jobs.progress_total integer null`; reset `null` ở claim/requeue/pause; `jobView`
  trả `progress_done`, `progress_total`.
- `stage-labels.ts`: `(job.type, stage)` → nhãn tiếng Việt, thêm " i/n" (+ đơn vị nếu có) khi có `done/total`; mã lạ →
  "Đang xử lý"; không bao giờ trả mã tiếng Anh.
- Dùng nhãn ở: thumbnail trang (`thumbMark`), cột ảnh gốc khi đang cắt (dòng đầu + nhãn từng ảnh "Đã tải" / "Đang tải" /
  "Chờ" / "Đang xử lý"), drawer Hoạt động (thay `j.stage`; "GĐ1 · xoá chữ + OCR" → "Xoá chữ + OCR").
- Export dùng nhãn VI: **không làm ở P2** (`export-panel.tsx` thuộc P1) → P5 nối `stageLabel` vào ExportRow.

## Architecture

```
worker handler ─report(stage,p,done,total)─▶ JobContext (lock) ─wake─▶ Heartbeat thread
   Heartbeat: wait(min(interval - since_last, ∞ khi wake)) → nếu wake: chờ tới last+min_gap → heartbeat_once()
   heartbeat_once ─POST /jobs/:id/heartbeat {progress,stage,done,total,usage}─▶ API heartbeat()
API: UPDATE jobs SET lease, progress, stage, progress_done, progress_total ─▶ GET /chapters/:id/progress (jobView)
web: useChapterData poll 2,5s → ProgressPage.job.{stage,progress_done,progress_total} → stageLabel() → UI
```

```py
# runner.py
MIN_HEARTBEAT_GAP_S = 2.0
class JobContext:
    wake: threading.Event
    def report(self, stage: str, progress: float, done: int | None = None, total: int | None = None) -> None: ...
class Heartbeat:
    def __init__(self, ctx: JobContext, interval: float = HEARTBEAT_S, min_gap: float = MIN_HEARTBEAT_GAP_S): ...
def run_job(client, job, handlers, deps, deadline=None, heartbeat_s=HEARTBEAT_S, heartbeat_gap_s=MIN_HEARTBEAT_GAP_S) -> str
# client.py
def heartbeat(self, job, progress, stage, usage, done: int | None = None, total: int | None = None) -> dict
# pipeline.py
def prepare_image(self, img, rtl=False, opts=None, on_stage: Callable[[str], None] | None = None)
```
```ts
// packages/shared/src/worker-protocol.ts
HeartbeatRequest = z.object({ ...Fence, progress, stage, usage,
  done: z.number().int().min(0).max(100_000).nullish(), total: z.number().int().min(0).max(100_000).nullish() });
// apps/web/src/features/chapter/stage-labels.ts
export function stageLabel(job: Pick<JobView, "type" | "stage" | "progress_done" | "progress_total"> | null,
  opts?: { short?: boolean }): string | null;    // short: bỏ " i/n" cho thumbnail 112px
// source-rail-model.ts
export type IngestView = { stage: string | null; progress: number | null; done: number | null; total: number | null; label: string };
export function ingestTag(index: number, ing: IngestView): { label: "Đã tải" | "Đang tải" | "Chờ" | "Đang xử lý"; tone: Tone };
```

Bảng nhãn (khởi điểm): ingest `download` "Đang tải ảnh", `cut`/`detect` "Đang cắt trang" (đơn vị "đoạn"), `upload`
"Đang lưu trang"; prepare `detect` "Nhận diện chữ", `inpaint` "Xoá chữ", `ocr` "Đọc chữ (OCR)", `upload` "Lưu ảnh",
`reuse_partial` "Dùng lại ảnh đã xoá chữ"; translate `translate` "Đang dịch", `typeset` "Đang đặt chữ"; export
`download` "Tải ảnh", `render` "Vẽ chữ", `upload` "Đóng gói"; reinpaint `inpaint` "Xoá chữ lại"; ocr_region `ocr`
"Đọc chữ", `translate` "Dịch"; proofread `proofread` "Hiệu đính".

## File sở hữu

| Thao tác | Đường dẫn |
|---|---|
| Sửa | `worker/mtl_worker/runner.py` |
| Sửa | `worker/mtl_worker/client.py` |
| Sửa | `worker/mtl_worker/ingest.py` |
| Sửa (prepare + `typeset` report của translate) | `worker/mtl_worker/handlers.py` |
| Sửa | `worker/mtl_worker/export.py` (chỉ tham số `done/total` của `ctx.report`) |
| Sửa | `worker/mtl_pipeline/pipeline.py` (`prepare_image` thêm `on_stage`) |
| Sửa (fake `heartbeat`/`prepare_image` + test mới) | `worker/tests/test_worker_runner.py` |
| Sửa (fake `heartbeat` nhận `done,total`) | `worker/tests/test_export_slices.py` |
| Sửa | `packages/shared/src/worker-protocol.ts` |
| Sửa | `packages/db/src/schema/app.ts` (bảng `jobs`) |
| Tạo (drizzle-kit `--name jobs_progress_counts`) | `packages/db/migrations/0019_jobs_progress_counts.sql`, `packages/db/migrations/meta/0019_snapshot.json` |
| Sửa (do generate) | `packages/db/migrations/meta/_journal.json` |
| Tạo | `packages/db/migrations-down/0019_jobs_progress_counts.down.sql` |
| Sửa | `apps/api/src/jobs/queue.ts` (heartbeat + reset ở claim/requeue/pauseForBudget) |
| Sửa | `apps/api/src/routes/jobs.ts` (`jobView`) |
| Tạo | `apps/api/test/job-progress.test.ts` |
| Tạo | `apps/web/src/features/chapter/stage-labels.ts`, `apps/web/src/features/chapter/stage-labels.test.ts` |
| Sửa | `apps/web/src/features/chapter/api.ts` (`JobView` thêm 2 field) |
| Sửa | `apps/web/src/features/chapter/page-status.ts`, `apps/web/src/features/chapter/page-status.test.ts` |
| Sửa | `apps/web/src/features/chapter/activity-drawer.tsx` |
| Sửa | `apps/web/src/features/chapter/source-rail.tsx` |
| Sửa | `apps/web/src/features/chapter/source-rail-model.ts`, `apps/web/src/features/chapter/source-rail-model.test.ts` |
| Sửa (chỉ khối `ingestJob`/`cutting` dòng ~484-487 và prop `SourceRail` ~975) | `apps/web/src/features/chapter/chapter-workspace.tsx` |
| Sửa (nếu cần style nhãn ảnh gốc) | `apps/web/src/features/chapter/chapter-workspace.css` |

## Không được đụng

`export-panel.tsx`, `export-drawer.tsx`, `export-warnings.ts(.test)`, `export-options.ts(.test)`, `export-panel.css`
(P1), `apps/web/e2e/**`, `packages/shared/src/job.ts`, `packages/shared/json-schema/**` (P3), `enqueue.ts`,
`claim-inputs.ts`, `progress.ts`. Trong `activity-drawer.tsx` không đổi dòng `import { ExportRow, useExports }`.
Trong `handlers.py` không đổi logic dịch (`handle_translate` ngoài lệnh `report`).

## Test viết trước (đỏ trước khi code)

`worker/tests/test_worker_runner.py`
- `test_stage_change_sends_heartbeat_without_waiting_for_interval` — handler `report("detect",0.05)` rồi ngủ 0,3s;
  `run_job(..., heartbeat_s=60, heartbeat_gap_s=0.05)` → FakeClient ghi ≥ 1 heartbeat có `stage=="detect"` trong 0,3s.
- `test_rapid_stage_changes_are_throttled` — 10 lần `report` đổi stage trong 0,05s, `heartbeat_gap_s=0.2`, ngủ 0,25s →
  số heartbeat ≤ 2 và heartbeat cuối mang stage cuối.
- `test_progress_only_change_waits_for_interval` — cùng stage, chỉ đổi progress 5 lần, `heartbeat_s=60` → 0 heartbeat.
- `test_heartbeat_carries_done_and_total` — `report("upload",0.8,done=3,total=12)` → heartbeat nhận `done=3,total=12`.
- `test_prepare_reports_inpaint_between_detect_and_ocr` — FakePipeline gọi `on_stage("inpaint")`; ghi lại thứ tự stage
  qua ctx → `["detect","inpaint","ocr","upload"]`.
- `test_ingest_counts_images_and_pages` — fake ctx ghi report; 3 ảnh → có `("download",done=1..3,total=3)` và
  `("upload",done=k,total=n)`.

`apps/api/test/job-progress.test.ts`
- "heartbeat stores done/total and the progress view returns them" — claim `page.prepare`, heartbeat `{stage:"upload",
  done:3,total:12}` → `GET /chapters/:id/progress` `pages[i].job.progress_done===3`, `progress_total===12`.
- "a heartbeat without counts clears them" — heartbeat không gửi `done/total` → `null`.
- "requeue and a new claim reset the counts" — fail `provider` → job `queued` có `progress_done===null`.

`apps/web/src/features/chapter/stage-labels.test.ts`
- "ingest stages read as Vietnamese with counts" — `{type:"chapter.ingest",stage:"download",progress_done:3,progress_total:12}` → `"Đang tải ảnh 3/12"`; `cut` → `"Đang cắt trang 2/5 đoạn"`; `detect` (worker cũ) cùng nhãn.
- "prepare shows inpaint as its own step" — `inpaint` → `"Xoá chữ"`.
- "short form drops counts" — `{short:true}` → không chứa `/`.
- "unknown or English codes never leak" — `stage:"foo"` → `"Đang xử lý"`; với mọi job type × stage trong bảng, nhãn không khớp `/^[a-z_]+$/`.
- "null stage gives null" — `stage:null` → `null`.

`apps/web/src/features/chapter/page-status.test.ts` (thêm)
- "running prepare job shows its step and percent" — job `page.prepare` running stage `inpaint` progress 0.4 → `thumbMark` label `"Xoá chữ · 40%"`.
- "pending page without a job waits for text removal" — `status:"pending"`, job null → label `"Chờ xoá chữ"`; không còn chữ "Bước 1".

`apps/web/src/features/chapter/source-rail-model.test.ts` (thêm)
- "downloaded images are marked while ingest downloads" — `ingestTag(1,{stage:"download",done:3,total:5,…})` → "Đã tải"; index 3 → "Đang tải"; index 4 → "Chờ"; stage `cut` → mọi index "Đang xử lý".

Lệnh hẹp:
`cd worker && uv run pytest tests/test_worker_runner.py -q` ·
`pnpm --filter @mtl/api test -- job-progress` (cần `pnpm infra:up`) ·
`pnpm --filter @mtl/web exec vitest run src/features/chapter/stage-labels.test.ts src/features/chapter/page-status.test.ts src/features/chapter/source-rail-model.test.ts`

## Implementation Steps

1. Viết test worker → đỏ. Sửa `runner.py` (Event `wake`, `_last_sent`, `report` so stage/done cũ), `client.py`,
   fake trong 2 file test; `run_job` nhận `heartbeat_gap_s`. Thread heartbeat: `__exit__` set cả `_stop` lẫn `wake`.
2. `pipeline.py` `on_stage`; `handlers.py` prepare truyền `on_stage=lambda s: ctx.report(s, {"inpaint":0.3}.get(s,…))`
   (ánh xạ % cố định: detect 0.05, inpaint 0.3, ocr 0.6, upload 0.9); translate `typeset` thêm `done=i+1,total=n`.
   `ingest.py` đổi `detect`→`cut`, thêm đếm. `export.py` thêm đếm cho `download/render`.
3. Shared `HeartbeatRequest`; schema `jobs` + `pnpm db:generate --name jobs_progress_counts`; viết down
   (`ALTER TABLE jobs DROP COLUMN progress_done, DROP COLUMN progress_total`).
4. Test API → đỏ; sửa `queue.ts` (heartbeat set `progressDone: req.done ?? null`, `progressTotal`; reset `null` ở 3 chỗ),
   `jobView`. Xanh.
5. Test web → đỏ; tạo `stage-labels.ts`; sửa `api.ts` `JobView`; `page-status.ts` (nhãn bước từ `stageLabel(job,
   {short:true})`, fallback "Chờ xoá chữ"/"Xoá chữ"/"Đang dịch"); `activity-drawer.tsx` (`stageLabel(j)` + i/n,
   đổi nhãn job prepare); `source-rail-model.ts` `ingestTag`; `source-rail.tsx` nhận `ingest?: IngestView` thay
   `cutting`; `chapter-workspace.tsx` dựng `IngestView` từ `ingestJob`.
6. `cd worker && uv run pytest -q && uv run ruff check . && uv run mypy mtl_worker mtl_pipeline`; `pnpm test`,
   `pnpm typecheck`, `pnpm lint`.

## Success Criteria

- [x] Mọi test mới xanh; `uv run pytest` + `pnpm test` toàn repo xanh; ruff/mypy/biome/typecheck sạch.
- [ ] `pnpm db:migrate` áp 0019 trên DB dev; down file chạy được. *(Chưa áp DB dev — không được phép chạy migrate DB dùng chung. Đã kiểm: 0019 áp qua reset DB test của api; down file chạy trên DB test → 2 cột mất, journal lùi 1.)*
- [ ] Kiểm tay (worker thật, chương 10 ảnh): cột ảnh gốc "Đang tải ảnh 3/10" → "Đang cắt trang …" → "Đang lưu trang i/n";
      thumbnail trang "Nhận diện chữ" → "Xoá chữ" → "Đọc chữ (OCR)"; nhãn đổi trong ≤ 5s sau khi worker log đổi bước.
      *(Chưa kiểm tay — cần worker thật. Đã có test: heartbeat gửi ngay khi đổi bước, throttle theo gap, poll 2,5s.)*
- [x] Không còn mã bước tiếng Anh ở thumbnail, cột ảnh gốc, drawer Hoạt động.

## Risk + rollback

| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| Heartbeat dày → tải API | L×M | ≥ 2s/job, chỉ khi đổi stage/done; upload 300 trang ≈ 1 req/2s |
| Race thread heartbeat ↔ handler (usage seq) | L×H | handler không tự gọi `heartbeat_once`; chỉ set `wake`; `take_usage` đã có lock |
| Worker mới + API cũ | L×L | zod bỏ key lạ; không đổi `MIN_PIPELINE_VERSION` |
| Đổi tên `detect`→`cut` ở ingest làm web cũ hiện mã lạ | L×L | `stage-labels` map cả hai; web cũ chỉ in thô như trước |
| Fake client ở test khác chưa nhận kwarg mới | M×L | đã liệt kê 2 file fake; `rg "def heartbeat" worker/tests` trước khi chạy |

Rollback: revert code (worker/api/web độc lập nhau); `0019` additive — giữ cột hoặc chạy down file.

## Docs (controller làm cuối)

`docs/job-queue-worker.md` bảng "Giao thức worker" dòng heartbeat: thêm `done,total`, throttle ≥ 2s khi đổi bước,
nhịp 20s gia hạn; danh sách mã bước theo job (nguồn nhãn: `apps/web/src/features/chapter/stage-labels.ts`).
